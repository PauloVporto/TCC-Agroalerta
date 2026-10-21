/**
 * Fila persistente de notificações (tabela notificacao_envios).
 *
 * - enfileirar() grava a mensagem com uma chave de idempotência única: a mesma
 *   chave nunca gera dois envios, mesmo que o ciclo que a criou rode de novo.
 * - processarFila() trata um canal por vez. Cada provedor diz o que pode sair agora
 *   (liberacao): o e-mail libera tudo; o WhatsApp só libera com todas as travas
 *   abertas (whatsapp.js). O que não está liberado espera na fila até a validade
 *   (expira_em); vencida a validade, o envio vira "expirado".
 * - Lotes são reservados com FOR UPDATE SKIP LOCKED (duas execuções nunca pegam a
 *   mesma linha) e uma trava com prazo (processando_ate). O WhatsApp tem um único
 *   despachante por vez (advisory lock), uma mensagem por reserva e ritmo limitado.
 * - Antes de cada envio, consentimento e contato são lidos de novo do banco.
 * - Falha temporária é reagendada com espera crescente; falha definitiva ou
 *   tentativas esgotadas terminam em "falhou". Cada passo vira um evento.
 * - Resultado incerto nunca é reenviado. A Evolution API não tem chave de
 *   idempotência: se a mensagem pode ter saído (requisição sem resposta, ou o
 *   backend caiu depois de chamá-la — tentativa_iniciada_em marcado), o envio fica
 *   "incerto" e só o administrador decide reenviar.
 */

const crypto = require("crypto");
const { pool } = require("../db");
const { registrarEvento } = require("./eventos");
const { ErroProvedor } = require("./provedores/comum");
const { aplicarEventosGuardados, idPelaMensagemTransmitida } = require("./statusEntrega");
const { autorizacaoVigente } = require("./consentimentos");
const { emailValido, normalizarTelefone, ehCelular, mascararEmail, mascararTelefone } = require("../contato");

const ESPERA_ENTRE_TENTATIVAS_MIN = [1, 5, 15, 60];
const PRAZO_PROCESSAMENTO_MIN = 2;
const TAMANHO_LOTE = 10;

// Como cada canal obtém e valida o destino a partir do contato atual do produtor.
const CANAIS = {
  email: {
    destino: (contato) => contato.email,
    invalido: (destino) =>
      emailValido(destino) ? null : { codigo: "email_invalido", mensagem: "E-mail do produtor ausente ou inválido." },
    mascarar: mascararEmail,
  },
  whatsapp: {
    destino: (contato) => normalizarTelefone(contato.telefone),
    invalido: (destino) =>
      ehCelular(destino)
        ? null
        : { codigo: "telefone_invalido", mensagem: "Celular do produtor ausente ou inválido (o WhatsApp exige celular)." },
    mascarar: mascararTelefone,
  },
};

function esperaAntesDaProxima(tentativasFeitas, aguardarSegundos) {
  const indice = Math.min(tentativasFeitas, ESPERA_ENTRE_TENTATIVAS_MIN.length) - 1;
  const espera = ESPERA_ENTRE_TENTATIVAS_MIN[indice] * 60 * 1000;
  return aguardarSegundos ? Math.max(espera, aguardarSegundos * 1000) : espera;
}

/**
 * Coloca uma mensagem na fila. Devolve o id do envio, ou null se a chave de
 * idempotência já existia (mensagem enfileirada antes).
 */
async function enfileirar(db, m) {
  const { rows } = await db.query(
    `INSERT INTO notificacao_envios
       (usuario_id, alerta_id, canal, tipo, chave_idempotencia, destino, assunto,
        conteudo, conteudo_html, resumo, regiao, nivel, max_tentativas, expira_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING id`,
    [
      m.usuarioId, m.alertaId || null, m.canal, m.tipo, m.chaveIdempotencia, m.destino || null,
      m.assunto || null, m.conteudo, m.conteudoHtml || null, m.resumo, m.regiao || null,
      m.nivel || null, m.maxTentativas, m.expiraEm || null,
    ]
  );
  if (!rows[0]) return null;
  const id = Number(rows[0].id);
  await registrarEvento(db, id, "enfileirado", "pendente", "Mensagem preparada e colocada na fila.");
  return id;
}

/**
 * Retira da fila os envios ainda não despachados de um produtor num canal (ex.: ao
 * revogar o consentimento). Devolve quantos foram cancelados.
 */
async function cancelarPendentesDoProdutor(db, usuarioId, canal, motivo) {
  const { rows } = await db.query(
    `UPDATE notificacao_envios
     SET status = 'cancelado', erro_codigo = 'cancelado', erro_mensagem = $3, atualizado_em = NOW()
     WHERE usuario_id = $1 AND canal = $2 AND status = 'pendente'
     RETURNING id`,
    [usuarioId, canal, motivo]
  );
  for (const { id } of rows) await registrarEvento(db, id, "cancelado", "cancelado", motivo);
  return rows.length;
}

// ---- Manutenção a cada rodada -----------------------------------------------------

/**
 * Travas vencidas (o backend caiu ou travou no meio de um envio): se a chamada ao
 * provedor já tinha começado sem reenvio seguro, o resultado é incerto; senão o
 * envio simplesmente volta para a fila.
 */
async function recuperarTravasVencidas() {
  const incertos = await pool.query(
    `UPDATE notificacao_envios
     SET status = 'incerto', erro_codigo = 'resultado_incerto',
         erro_mensagem = 'O backend parou durante o envio: não há como saber se a mensagem saiu. Não será reenviada automaticamente.',
         processando_ate = NULL, atualizado_em = NOW()
     WHERE status = 'processando' AND processando_ate < NOW() AND tentativa_iniciada_em IS NOT NULL
     RETURNING id, erro_mensagem`
  );
  for (const envio of incertos.rows) await registrarEvento(pool, envio.id, "incerto", "incerto", envio.erro_mensagem);

  const devolvidos = await pool.query(
    `UPDATE notificacao_envios SET status = 'pendente', processando_ate = NULL, atualizado_em = NOW()
     WHERE status = 'processando' AND processando_ate < NOW()
     RETURNING id`
  );
  for (const envio of devolvidos.rows) {
    await registrarEvento(pool, envio.id, "retomado", "pendente", "Trava vencida antes do envio: a mensagem volta para a fila.");
  }
}

async function expirarVencidos() {
  const { rows } = await pool.query(
    `UPDATE notificacao_envios
     SET status = 'expirado', erro_codigo = 'validade_vencida',
         erro_mensagem = 'A mensagem não saiu dentro da validade e não será mais enviada.', atualizado_em = NOW()
     WHERE status = 'pendente' AND retido_em IS NULL AND expira_em IS NOT NULL AND expira_em <= NOW()
     RETURNING id, erro_mensagem`
  );
  for (const envio of rows) await registrarEvento(pool, envio.id, "expirado", "expirado", envio.erro_mensagem);
  return rows.length;
}

// ---- Reserva e processamento --------------------------------------------------------

async function haPendentes(canal) {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM notificacao_envios
                    WHERE canal = $1 AND status = 'pendente' AND retido_em IS NULL AND proxima_tentativa_em <= NOW()) AS existe`,
    [canal]
  );
  return rows[0].existe;
}

async function reservarLote(canal, tipos, tamanho) {
  const { rows } = await pool.query(
    `UPDATE notificacao_envios
     SET status = 'processando', tentativas = tentativas + 1, tentativa_iniciada_em = NULL,
         processando_ate = NOW() + make_interval(mins => $4), atualizado_em = NOW()
     WHERE id IN (
       SELECT id FROM notificacao_envios
       WHERE canal = $1 AND tipo = ANY($2) AND status = 'pendente' AND retido_em IS NULL AND proxima_tentativa_em <= NOW()
         AND (expira_em IS NULL OR expira_em > NOW())
       ORDER BY proxima_tentativa_em, id
       LIMIT $3
       FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [canal, tipos, tamanho, PRAZO_PROCESSAMENTO_MIN]
  );
  return rows.sort((a, b) => Number(a.id) - Number(b.id));
}

async function contatoAtual(usuarioId, canal) {
  const { rows } = await pool.query(
    `SELECT u.email, u.telefone, d.concedido, d.destino
     FROM usuarios u
     LEFT JOIN LATERAL (
       SELECT c.concedido, c.destino FROM notificacao_consentimentos c
       WHERE c.usuario_id = u.id AND c.canal = $2
       ORDER BY c.criado_em DESC, c.id DESC LIMIT 1) d ON TRUE
     WHERE u.id = $1`,
    [usuarioId, canal]
  );
  return rows[0] || null;
}

// Atualiza a linha e registra o evento; se o envio sumiu (conta excluída), não faz nada.
async function finalizar(envio, campos, evento) {
  const nomes = Object.keys(campos);
  const atribuicoes = nomes.map((nome, i) => `${nome} = $${i + 2}`).join(", ");
  const { rowCount } = await pool.query(
    `UPDATE notificacao_envios SET ${atribuicoes}, processando_ate = NULL, atualizado_em = NOW() WHERE id = $1`,
    [envio.id, ...nomes.map((nome) => campos[nome])]
  );
  if (rowCount) await registrarEvento(pool, envio.id, evento.tipo, campos.status, evento.detalhe);
  return rowCount > 0;
}

function bloquear(envio, provedor, codigo, mensagem) {
  return finalizar(
    envio,
    { status: "bloqueado", provedor: provedor.nome, erro_codigo: codigo, erro_mensagem: mensagem },
    { tipo: "bloqueado", detalhe: `${codigo}: ${mensagem}` }
  );
}

function falhar(envio, provedor, codigo, mensagem) {
  return finalizar(
    envio,
    { status: "falhou", provedor: provedor.nome, modo: provedor.modo, erro_codigo: codigo, erro_mensagem: mensagem },
    { tipo: "falhou", detalhe: `${codigo}: ${mensagem}` }
  );
}

function marcarIncerto(envio, provedor, erro) {
  return finalizar(
    envio,
    { status: "incerto", provedor: provedor.nome, modo: provedor.modo, erro_codigo: erro.codigo, erro_mensagem: erro.message },
    { tipo: "incerto", detalhe: `${erro.codigo}: ${erro.message} (não será reenviada automaticamente)` }
  );
}

function reagendar(envio, provedor, erro, esperaMs) {
  return finalizar(
    envio,
    {
      status: "pendente",
      provedor: provedor.nome,
      erro_codigo: erro.codigo,
      erro_mensagem: erro.message,
      proxima_tentativa_em: new Date(Date.now() + esperaMs),
    },
    { tipo: "falha_temporaria", detalhe: `${erro.codigo}: ${erro.message} (nova tentativa em ${Math.round(esperaMs / 60000)} min)` }
  );
}

// A mensagem não chegou a sair: volta para a fila sem gastar a tentativa.
function adiar(envio, { ate = new Date(), codigo, mensagem }) {
  return finalizar(
    envio,
    {
      status: "pendente",
      tentativas: envio.tentativas - 1,
      erro_codigo: codigo,
      erro_mensagem: mensagem,
      proxima_tentativa_em: ate,
    },
    { tipo: "adiado", detalhe: `${codigo}: ${mensagem}` }
  );
}

// Reservados que nem chegaram a ser processados (a rodada foi interrompida): voltam à fila intactos.
async function devolverSemTentar(envios) {
  if (envios.length === 0) return;
  await pool.query(
    `UPDATE notificacao_envios SET status = 'pendente', tentativas = tentativas - 1, processando_ate = NULL, atualizado_em = NOW()
     WHERE id = ANY($1) AND status = 'processando'`,
    [envios.map((e) => e.id)]
  );
}

// Ponto sem volta: a partir daqui, se o backend cair, o resultado é incerto.
async function marcarInicioDaTentativa(envio) {
  await pool.query("UPDATE notificacao_envios SET tentativa_iniciada_em = NOW() WHERE id = $1", [envio.id]);
}

async function registrarAceite(envio, { provedor, liberacao }, { provedorId, destino, detalhe }) {
  await finalizar(
    envio,
    {
      status: "enviado",
      modo: provedor.modo,
      provedor: provedor.nome,
      provedor_id: provedorId,
      destino,
      remetente: (liberacao && liberacao.remetente) || null,
      enviado_em: new Date(),
      erro_codigo: null,
      erro_mensagem: null,
    },
    { tipo: "aceito", detalhe }
  );
  await aplicarEventosGuardados(envio.id, provedor.nome, provedorId);
}

function hashCurto(texto) {
  return crypto.createHash("sha256").update(String(texto)).digest("hex").slice(0, 12);
}

function mensagemParaProvedor(envio, destino) {
  return {
    destino,
    assunto: envio.assunto,
    html: envio.conteudo_html,
    texto: envio.conteudo,
    resumo: envio.resumo,
    // Muda só se o destino mudar: retentativas do mesmo envio reaproveitam a chave.
    chaveIdempotencia: `agroalerta-envio-${envio.id}-${hashCurto(destino)}`,
    referencia: `envio-${envio.id}`,
    tags: [
      { name: "tipo", value: envio.tipo },
      { name: "envio_id", value: String(envio.id) },
    ],
  };
}

/**
 * Processa um envio reservado. Devolve "interromper" quando nada mais do canal
 * deve sair nesta rodada (ex.: o administrador bloqueou os envios agora há pouco).
 */
async function processarEnvio(envio, { provedor, liberacao, log }) {
  const canal = CANAIS[envio.canal];
  if (envio.tentativas > envio.max_tentativas) {
    await falhar(envio, provedor, "tentativas_esgotadas", `Limite de ${envio.max_tentativas} tentativas atingido.`);
    return null;
  }

  let destino = envio.destino;
  if (envio.usuario_id !== null) {
    const contato = await contatoAtual(envio.usuario_id, envio.canal);
    if (!contato) return null;
    if (!autorizacaoVigente(envio.canal, contato, contato.telefone)) {
      const trocouDeNumero = contato.concedido === true && envio.canal === "whatsapp";
      await bloquear(
        envio,
        provedor,
        trocouDeNumero ? "telefone_alterado" : "sem_consentimento",
        trocouDeNumero
          ? "O celular mudou depois da autorização: o produtor precisa autorizar o WhatsApp para o número novo."
          : "O produtor não autorizou este canal ou revogou a autorização."
      );
      return null;
    }
    destino = canal.destino(contato);
    const invalido = canal.invalido(destino);
    if (invalido) {
      await bloquear(envio, provedor, invalido.codigo, invalido.mensagem);
      return null;
    }
  }

  if (provedor.reservarVez) {
    const vez = await provedor.reservarVez(envio);
    if (!vez.ok) {
      await adiar(envio, vez);
      return vez.global ? "interromper" : null;
    }
  }

  const reenvioSeguro = provedor.reenvioSeguro !== false;
  if (!reenvioSeguro) await marcarInicioDaTentativa(envio);

  const mascarado = canal.mascarar(destino);
  try {
    const { provedorId } = await provedor.enviar(mensagemParaProvedor(envio, destino));
    if (provedor.modo === "simulado") {
      await finalizar(
        envio,
        { status: "simulado", modo: provedor.modo, provedor: provedor.nome, provedor_id: provedorId, destino, enviado_em: new Date(), erro_codigo: null, erro_mensagem: null },
        { tipo: "simulado", detalhe: "Envio simulado, sem chamada externa." }
      );
    } else {
      await registrarAceite(envio, { provedor, liberacao }, {
        provedorId,
        destino,
        detalhe: `Aceito pela API do provedor ${provedor.nome} (id ${provedorId}); ainda não é confirmação de entrega.`,
      });
    }
    log(`[notificacoes] envio ${envio.id} (${envio.canal}, ${envio.tipo}) → ${mascarado}: ${provedor.modo === "simulado" ? "simulado" : "aceito"}`);
  } catch (erro) {
    const falha =
      erro instanceof ErroProvedor
        ? erro
        : new ErroProvedor({
            provedor: provedor.nome,
            codigo: "erro_interno",
            mensagem: erro.message,
            temporario: reenvioSeguro,
            incerto: !reenvioSeguro,
          });
    // Sem resposta, mas a Evolution pode já ter avisado (send.message) que a mensagem saiu.
    const confirmadoPorEvento = falha.incerto ? await idPelaMensagemTransmitida(envio, destino) : null;
    if (confirmadoPorEvento) {
      await registrarAceite(envio, { provedor, liberacao }, {
        provedorId: confirmadoPorEvento,
        destino,
        detalhe: `Sem resposta da API (${falha.codigo}), mas a Evolution confirmou a transmissão (send.message, id ${confirmadoPorEvento}).`,
      });
    } else if (falha.incerto) {
      await marcarIncerto(envio, provedor, falha);
    } else if (falha.temporario && envio.tentativas < envio.max_tentativas) {
      await reagendar(envio, provedor, falha, esperaAntesDaProxima(envio.tentativas, falha.aguardarSegundos));
    } else {
      await falhar(envio, provedor, falha.codigo, falha.message);
    }
    log(`[notificacoes] envio ${envio.id} (${envio.canal}) → ${mascarado}: ${falha.codigo} (tentativa ${envio.tentativas})`);
  }
  return null;
}

// Só um processo despacha o canal por vez: os outros pulam a rodada.
async function comTravaExclusiva(nome, executar) {
  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query("SELECT pg_try_advisory_lock(hashtext($1)) AS livre", [nome]);
    if (!rows[0].livre) return 0;
    try {
      return await executar();
    } finally {
      await cliente.query("SELECT pg_advisory_unlock(hashtext($1))", [nome]);
    }
  } finally {
    cliente.release();
  }
}

// Motivo de retenção já informado no log, por canal (sem registro = liberado): só mudanças são registradas.
const retencaoInformada = {};

function informarRetencao(canal, motivo, log) {
  if ((retencaoInformada[canal] ?? null) === motivo) return;
  retencaoInformada[canal] = motivo;
  log(motivo ? `[notificacoes] ${canal} retido: ${motivo}` : `[notificacoes] ${canal} liberado para envio`);
}

async function processarCanal(canal, provedor, contexto) {
  if (!(await haPendentes(canal))) return 0;
  const liberacao = await provedor.liberacao();
  informarRetencao(canal, liberacao.motivo, contexto.log);
  if (liberacao.tipos.length === 0) return 0;

  const despachar = async () => {
    let tratados = 0;
    const tamanho = provedor.tamanhoLote || TAMANHO_LOTE;
    for (;;) {
      const lote = await reservarLote(canal, liberacao.tipos, tamanho);
      for (const [posicao, envio] of lote.entries()) {
        let resultado = null;
        try {
          resultado = await processarEnvio(envio, { ...contexto, provedor, liberacao });
        } catch (erro) {
          // A trava com prazo cuida do envio; os demais do lote seguem.
          contexto.log(`[notificacoes] erro inesperado no envio ${envio.id}: ${erro.message}`);
        }
        tratados++;
        if (resultado === "interromper") {
          await devolverSemTentar(lote.slice(posicao + 1));
          return tratados;
        }
      }
      if (lote.length < tamanho) return tratados;
    }
  };
  return provedor.despachoExclusivo ? comTravaExclusiva("agroalerta_despacho_" + canal, despachar) : despachar();
}

/** Processa tudo o que estiver pronto na fila. Devolve quantos envios foram tratados. */
async function processarFila(contexto) {
  const log = contexto.log || console.log;
  await recuperarTravasVencidas();
  await expirarVencidos();
  let tratados = 0;
  for (const [canal, provedor] of Object.entries(contexto.provedores)) {
    tratados += await processarCanal(canal, provedor, { ...contexto, log });
  }
  return tratados;
}

// ---- Teste manual de provedor (scripts/testar-*.js) ---------------------------
// Fica no histórico como qualquer envio, mas fora da fila automática: reservada só
// pelo script (sem processando_ate), a fila nunca a pega — e, portanto, nunca a reenvia.

async function registrarTesteManual({ canal, destino, assunto = null, conteudo, conteudoHtml = null, provedor, modo, remetente = null, usuarioId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notificacao_envios
       (canal, tipo, chave_idempotencia, destino, assunto, conteudo, conteudo_html, resumo,
        status, modo, provedor, remetente, tentativas, max_tentativas, tentativa_iniciada_em, usuario_id)
     VALUES ($1, 'teste', $2, $3, $4, $5, $6, $7, 'processando', $8, $9, $10, 1, 1, NOW(), $11)
     RETURNING id`,
    [
      canal, `teste:${canal}:${crypto.randomUUID()}`, destino, assunto, conteudo, conteudoHtml,
      canal === "email" ? "Teste manual de e-mail" : "Teste manual de WhatsApp", modo, provedor, remetente, usuarioId,
    ]
  );
  const id = Number(rows[0].id);
  await registrarEvento(pool, id, "teste_manual", "processando", "Envio confirmado manualmente no script de teste.");
  return id;
}

async function concluirTesteManual(envioId, { provedorId = null, erro = null }) {
  if (erro) {
    const status = erro.incerto ? "incerto" : "falhou";
    return finalizar(
      { id: envioId },
      { status, erro_codigo: erro.codigo || "erro_interno", erro_mensagem: erro.message },
      { tipo: status, detalhe: `${erro.codigo || "erro_interno"}: ${erro.message}` }
    );
  }
  await finalizar(
    { id: envioId },
    { status: "enviado", provedor_id: provedorId, enviado_em: new Date() },
    { tipo: "aceito", detalhe: `Aceito pelo provedor (id ${provedorId}).` }
  );
  const { rows } = await pool.query("SELECT provedor FROM notificacao_envios WHERE id = $1", [envioId]);
  await aplicarEventosGuardados(envioId, rows[0].provedor, provedorId);
}

// ---- Execução automática -----------------------------------------------------

let contextoAtivo = null;
let temporizador = null;
let rodadaAtual = null;
let pedirOutraRodada = false;

function rodar() {
  if (rodadaAtual) {
    pedirOutraRodada = true;
    return rodadaAtual;
  }
  rodadaAtual = (async () => {
    try {
      do {
        pedirOutraRodada = false;
        await processarFila(contextoAtivo);
      } while (pedirOutraRodada);
    } catch (erro) {
      console.error("[notificacoes] falha ao processar a fila:", erro.message);
    } finally {
      rodadaAtual = null;
    }
  })();
  return rodadaAtual;
}

/** Inicia o processamento periódico; a primeira rodada retoma o que ficou pendente. */
function iniciarFila(contexto) {
  if (temporizador) return;
  contextoAtivo = contexto;
  temporizador = setInterval(rodar, contexto.config.fila.intervaloMs);
  temporizador.unref();
  rodar();
}

/** Processa já, sem esperar o próximo intervalo (ex.: logo após um cadastro). */
function acordarFila() {
  if (temporizador) rodar();
}

function pararFila() {
  clearInterval(temporizador);
  temporizador = null;
  return rodadaAtual || Promise.resolve();
}

module.exports = {
  enfileirar,
  cancelarPendentesDoProdutor,
  processarFila,
  expirarVencidos,
  recuperarTravasVencidas,
  registrarTesteManual,
  concluirTesteManual,
  iniciarFila,
  acordarFila,
  pararFila,
  esperaAntesDaProxima,
};
