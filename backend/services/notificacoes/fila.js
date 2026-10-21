/**
 * Fila persistente de notificações (tabela notificacao_envios).
 *
 * - enfileirar() grava a mensagem com uma chave de idempotência única: a mesma
 *   chave nunca gera dois envios, mesmo que o ciclo que a criou rode de novo.
 * - processarFila() reserva lotes com FOR UPDATE SKIP LOCKED (duas execuções
 *   nunca pegam a mesma linha) e uma trava com prazo (processando_ate): se o
 *   backend cair no meio de um envio, a linha volta à fila quando o prazo vence.
 * - Antes de cada envio, consentimento e contato são lidos de novo do banco.
 * - Falha temporária é reagendada com espera crescente; falha definitiva ou
 *   tentativas esgotadas terminam em "falhou". Cada passo vira um evento.
 */

const crypto = require("crypto");
const { pool } = require("../db");
const { ErroProvedor } = require("./provedores/comum");
const { reservarSms } = require("./limitesSms");
const { emailValido, normalizarTelefone, ehCelular, mascararEmail, mascararTelefone } = require("../contato");

const ESPERA_ENTRE_TENTATIVAS_MIN = [1, 5, 15, 60];
const PRAZO_PROCESSAMENTO_MIN = 2;
const TAMANHO_LOTE = 10;

function esperaAntesDaProxima(tentativasFeitas, aguardarSegundos) {
  const indice = Math.min(tentativasFeitas, ESPERA_ENTRE_TENTATIVAS_MIN.length) - 1;
  const espera = ESPERA_ENTRE_TENTATIVAS_MIN[indice] * 60 * 1000;
  return aguardarSegundos ? Math.max(espera, aguardarSegundos * 1000) : espera;
}

async function registrarEvento(db, envioId, tipo, status, detalhe = null) {
  await db.query(
    "INSERT INTO notificacao_eventos (envio_id, tipo, status, detalhe) VALUES ($1, $2, $3, $4)",
    [envioId, tipo, status, detalhe]
  );
}

/**
 * Coloca uma mensagem na fila. Devolve o id do envio, ou null se a chave de
 * idempotência já existia (mensagem enfileirada antes).
 */
async function enfileirar(db, m) {
  const { rows } = await db.query(
    `INSERT INTO notificacao_envios
       (usuario_id, alerta_id, canal, tipo, chave_idempotencia, destino, assunto,
        conteudo, conteudo_html, resumo, regiao, nivel, max_tentativas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING id`,
    [
      m.usuarioId, m.alertaId || null, m.canal, m.tipo, m.chaveIdempotencia, m.destino || null,
      m.assunto || null, m.conteudo, m.conteudoHtml || null, m.resumo, m.regiao || null,
      m.nivel || null, m.maxTentativas,
    ]
  );
  if (!rows[0]) return null;
  const id = Number(rows[0].id);
  await registrarEvento(db, id, "enfileirado", "pendente");
  return id;
}

async function reservarLote() {
  const { rows } = await pool.query(
    `UPDATE notificacao_envios
     SET status = 'processando', tentativas = tentativas + 1,
         processando_ate = NOW() + make_interval(mins => $2), atualizado_em = NOW()
     WHERE id IN (
       SELECT id FROM notificacao_envios
       WHERE (status = 'pendente' AND proxima_tentativa_em <= NOW())
          OR (status = 'processando' AND processando_ate < NOW())
       ORDER BY proxima_tentativa_em, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [TAMANHO_LOTE, PRAZO_PROCESSAMENTO_MIN]
  );
  return rows.sort((a, b) => Number(a.id) - Number(b.id));
}

async function contatoAtual(usuarioId, canal) {
  const { rows } = await pool.query(
    `SELECT u.email, u.telefone,
            (SELECT c.concedido FROM notificacao_consentimentos c
             WHERE c.usuario_id = u.id AND c.canal = $2
             ORDER BY c.criado_em DESC, c.id DESC LIMIT 1) AS consentido
     FROM usuarios u WHERE u.id = $1`,
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

async function processarEnvio(envio, { config, provedores, log }) {
  const provedor = provedores[envio.canal];
  if (envio.tentativas > envio.max_tentativas) {
    return falhar(envio, provedor, "tentativas_esgotadas", `Limite de ${envio.max_tentativas} tentativas atingido.`);
  }

  let destino = envio.destino;
  if (envio.usuario_id !== null) {
    const contato = await contatoAtual(envio.usuario_id, envio.canal);
    if (!contato) return;
    if (contato.consentido !== true) {
      return bloquear(envio, provedor, "sem_consentimento", "O produtor não autorizou este canal ou revogou a autorização.");
    }
    destino = envio.canal === "email" ? contato.email : normalizarTelefone(contato.telefone);
    if (envio.canal === "email" && !emailValido(destino)) {
      return bloquear(envio, provedor, "email_invalido", "E-mail do produtor ausente ou inválido.");
    }
    if (envio.canal === "sms" && !ehCelular(destino)) {
      return bloquear(envio, provedor, "telefone_invalido", "Celular do produtor ausente ou inválido (SMS só chega a celular).");
    }
  }

  if (envio.canal === "sms") {
    const reserva = await reservarSms(envio, provedor.modo, config.sms);
    if (!reserva.ok) return bloquear(envio, provedor, reserva.codigo, reserva.mensagem);
  }

  const mascarado = envio.canal === "email" ? mascararEmail(destino) : mascararTelefone(destino);
  try {
    const { provedorId } = await provedor.enviar(mensagemParaProvedor(envio, destino));
    const simulado = provedor.modo === "simulado";
    await finalizar(
      envio,
      {
        status: simulado ? "simulado" : "enviado",
        modo: provedor.modo,
        provedor: provedor.nome,
        provedor_id: provedorId,
        destino,
        enviado_em: new Date(),
        erro_codigo: null,
        erro_mensagem: null,
      },
      {
        tipo: simulado ? "simulado" : "aceito",
        detalhe: simulado ? "Envio simulado, sem chamada externa." : `Aceito pelo ${provedor.nome} (id ${provedorId}).`,
      }
    );
    log(`[notificacoes] envio ${envio.id} (${envio.canal}, ${envio.tipo}) → ${mascarado}: ${simulado ? "simulado" : "aceito"}`);
  } catch (erro) {
    const falha =
      erro instanceof ErroProvedor
        ? erro
        : new ErroProvedor({ provedor: provedor.nome, codigo: "erro_interno", mensagem: erro.message, temporario: true });
    if (falha.temporario && envio.tentativas < envio.max_tentativas) {
      await reagendar(envio, provedor, falha, esperaAntesDaProxima(envio.tentativas, falha.aguardarSegundos));
    } else {
      await falhar(envio, provedor, falha.codigo, falha.message);
    }
    log(`[notificacoes] envio ${envio.id} (${envio.canal}) → ${mascarado}: ${falha.codigo} (tentativa ${envio.tentativas})`);
  }
}

// ---- Teste manual de provedor (scripts/testar-*.js) ---------------------------
// Fica no histórico como qualquer envio, mas fora da fila automática: sem
// processando_ate, a fila nunca o reserva (e, portanto, nunca o reenvia).

async function registrarTesteManual({ canal, destino, assunto = null, conteudo, conteudoHtml = null, provedor, modo, segmentos = null, custo = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notificacao_envios
       (canal, tipo, chave_idempotencia, destino, assunto, conteudo, conteudo_html, resumo,
        status, modo, provedor, segmentos, custo_estimado, tentativas, max_tentativas)
     VALUES ($1, 'teste', $2, $3, $4, $5, $6, $7, 'processando', $8, $9, $10, $11, 1, 1)
     RETURNING id`,
    [
      canal, `teste:${canal}:${crypto.randomUUID()}`, destino, assunto, conteudo, conteudoHtml,
      canal === "email" ? "Teste manual de e-mail" : "Teste manual de SMS", modo, provedor, segmentos, custo,
    ]
  );
  const id = Number(rows[0].id);
  await registrarEvento(pool, id, "teste_manual", "processando", "Envio confirmado manualmente no script de teste.");
  return id;
}

async function concluirTesteManual(envioId, { provedorId = null, erro = null }) {
  if (erro) {
    return finalizar(
      { id: envioId },
      { status: "falhou", erro_codigo: erro.codigo || "erro_interno", erro_mensagem: erro.message },
      { tipo: "falhou", detalhe: `${erro.codigo || "erro_interno"}: ${erro.message}` }
    );
  }
  return finalizar(
    { id: envioId },
    { status: "enviado", provedor_id: provedorId, enviado_em: new Date() },
    { tipo: "aceito", detalhe: `Aceito pelo provedor (id ${provedorId}).` }
  );
}

/** Processa tudo o que estiver pronto na fila. Devolve quantos envios foram tratados. */
async function processarFila(contexto) {
  const { log = console.log } = contexto;
  let tratados = 0;
  for (;;) {
    const lote = await reservarLote();
    for (const envio of lote) {
      try {
        await processarEnvio(envio, { ...contexto, log });
      } catch (erro) {
        // A trava com prazo devolve o envio à fila; os demais do lote seguem.
        log(`[notificacoes] erro inesperado no envio ${envio.id}: ${erro.message}`);
      }
      tratados++;
    }
    if (lote.length < TAMANHO_LOTE) return tratados;
  }
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
  processarFila,
  registrarEvento,
  registrarTesteManual,
  concluirTesteManual,
  iniciarFila,
  acordarFila,
  pararFila,
  esperaAntesDaProxima,
};
