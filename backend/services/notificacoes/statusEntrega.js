/**
 * Confirmação de entrega.
 *
 * "enviado" só diz que a API do provedor aceitou a mensagem; os passos seguintes
 * exigem confirmação do próprio provedor:
 *   E-mail (Resend): consulta periódica GET /emails/{id} (funciona sem URL pública)
 *     e webhook assinado pela Svix → "entregue" ou "falhou".
 *   WhatsApp (Evolution API): webhooks com os recibos do WhatsApp (messages.update)
 *     — SERVER_ACK → "confirmado_servidor", DELIVERY_ACK → "entregue",
 *     READ/PLAYED → "lido", ERROR → "falhou". Sem webhook o envio fica em "enviado":
 *     nenhuma confirmação é presumida.
 *
 * Os estados só avançam: recibo repetido ou fora de ordem (a entrega chegando
 * depois da leitura) não rebaixa nada, e a leitura comprova a entrega, que comprova
 * a confirmação do servidor. Um recibo que chega antes da resposta do envio (que é
 * quem traz o id da mensagem) fica guardado e é aplicado quando o id é gravado.
 *
 * Resultado incerto: se a resposta do envio não voltou, mas a Evolution emitiu
 * "send.message" para o mesmo número e o mesmo texto, a mensagem comprovadamente
 * saiu — o envio passa a "enviado" com o id do evento, sem nenhum reenvio.
 *
 * Uma reclamação de spam no e-mail revoga o consentimento desse canal.
 */

const crypto = require("crypto");
const { pool } = require("../db");
const { registrarEvento } = require("./eventos");
const { registrarConsentimento } = require("./consentimentos");
const { registrarEventoAdmin } = require("./controle");
const { statusPorEventoResend } = require("./provedores/resend");
const { assinaturaResendValida, jwtEvolutionValido } = require("./assinaturas");
const { digitosDoWhatsapp, remetenteCorresponde, telefoneDoWhatsapp, formatarTelefone } = require("../contato");

const JANELA_CONSULTA_DIAS = 3;
const INTERVALO_ENTRE_CONSULTAS_MIN = 5;
// Por quanto tempo um "send.message" sem envio conhecido ainda pode resolver um resultado incerto.
const JANELA_CONFIRMACAO_MIN = 15;

// ---- E-mail ----------------------------------------------------------------------

/**
 * Aplica um resultado de entrega de e-mail ({ status, detalhe, reclamacao }).
 * Só sai de "enviado": confirmação repetida ou fora de ordem não rebaixa nada.
 */
async function aplicarResultadoDeEntrega(envioId, resultado, origem) {
  let atualizado = false;
  if (resultado.status) {
    const confirmado = resultado.status === "entregue";
    const { rows } = await pool.query(
      `UPDATE notificacao_envios
       SET status = $2,
           entregue_em = CASE WHEN $3 THEN NOW() ELSE entregue_em END,
           erro_codigo = CASE WHEN $3 THEN erro_codigo ELSE 'falha_entrega' END,
           erro_mensagem = CASE WHEN $3 THEN erro_mensagem ELSE $4 END,
           atualizado_em = NOW()
       WHERE id = $1 AND status = 'enviado'
       RETURNING id`,
      [envioId, resultado.status, confirmado, resultado.detalhe]
    );
    atualizado = rows.length > 0;
  }
  await registrarEvento(pool, envioId, origem, atualizado ? resultado.status : null, resultado.detalhe);

  if (resultado.reclamacao) {
    const { rows } = await pool.query("SELECT usuario_id, destino FROM notificacao_envios WHERE id = $1", [envioId]);
    if (rows[0] && rows[0].usuario_id !== null) {
      await registrarConsentimento(pool, {
        usuarioId: rows[0].usuario_id,
        canal: "email",
        concedido: false,
        destino: rows[0].destino,
        origem: "reclamacao_spam",
      });
    }
  }
  return atualizado;
}

/** Consulta no provedor de e-mail a entrega dos envios aceitos nos últimos dias. */
async function consultarStatusDeEntrega({ provedores, limite = 20, log = console.log }) {
  const provedor = provedores.email;
  if (!provedor.consultarStatus) return 0;
  // Marca a consulta antes de fazer, para um envio que o provedor atual não
  // sabe consultar não ocupar o lote para sempre.
  const { rows } = await pool.query(
    `UPDATE notificacao_envios SET status_consultado_em = NOW()
     WHERE id IN (
       SELECT id FROM notificacao_envios
       WHERE canal = 'email' AND status = 'enviado' AND provedor_id IS NOT NULL
         AND enviado_em > NOW() - make_interval(days => $2)
         AND (status_consultado_em IS NULL OR status_consultado_em < NOW() - make_interval(mins => $3))
       ORDER BY enviado_em
       LIMIT $1)
     RETURNING id, provedor, provedor_id, modo`,
    [limite, JANELA_CONSULTA_DIAS, INTERVALO_ENTRE_CONSULTAS_MIN]
  );

  let atualizados = 0;
  for (const envio of rows) {
    if (provedor.nome !== envio.provedor || provedor.modo !== envio.modo) continue;
    try {
      const resultado = await provedor.consultarStatus(envio.provedor_id);
      if (resultado.status || resultado.reclamacao) {
        if (await aplicarResultadoDeEntrega(envio.id, resultado, "consulta")) atualizados++;
      }
    } catch (erro) {
      log(`[notificacoes] não foi possível consultar a entrega do envio ${envio.id}: ${erro.message}`);
    }
  }
  return atualizados;
}

let temporizador = null;

function iniciarConsultaDeEntrega({ provedores, intervaloMs = INTERVALO_ENTRE_CONSULTAS_MIN * 60 * 1000, log = console.log }) {
  if (temporizador) return;
  const rodar = () =>
    consultarStatusDeEntrega({ provedores, log }).catch((erro) =>
      log("[notificacoes] falha na consulta de entregas: " + erro.message)
    );
  temporizador = setInterval(rodar, intervaloMs);
  temporizador.unref();
}

function pararConsultaDeEntrega() {
  clearInterval(temporizador);
  temporizador = null;
}

// ---- WhatsApp: recibos ------------------------------------------------------------

const ORDEM_WHATSAPP = { enviado: 1, confirmado_servidor: 2, entregue: 3, lido: 4 };
const RECIBOS = { SERVER_ACK: "confirmado_servidor", DELIVERY_ACK: "entregue", READ: "lido", PLAYED: "lido" };

/**
 * Aplica um recibo do WhatsApp (status da Evolution: SERVER_ACK, DELIVERY_ACK,
 * READ, PLAYED, ERROR...). Devolve true se o envio mudou de estado.
 */
async function aplicarReciboWhatsapp(envioId, recibo, origem) {
  if (recibo === "ERROR") {
    const { rowCount } = await pool.query(
      `UPDATE notificacao_envios
       SET status = 'falhou', erro_codigo = 'falha_entrega',
           erro_mensagem = 'O WhatsApp informou erro na entrega da mensagem.', atualizado_em = NOW()
       WHERE id = $1 AND status IN ('enviado', 'confirmado_servidor')`,
      [envioId]
    );
    await registrarEvento(pool, envioId, origem, rowCount ? "falhou" : null, "WhatsApp: ERROR");
    return rowCount > 0;
  }
  const novo = RECIBOS[recibo];
  if (!novo) {
    await registrarEvento(pool, envioId, origem, null, "WhatsApp: " + recibo);
    return false;
  }
  const ordem = ORDEM_WHATSAPP[novo];
  const { rowCount } = await pool.query(
    `UPDATE notificacao_envios
     SET status = $2,
         confirmado_servidor_em = COALESCE(confirmado_servidor_em, NOW()),
         entregue_em = CASE WHEN $3::int >= 3 THEN COALESCE(entregue_em, NOW()) ELSE entregue_em END,
         lido_em = CASE WHEN $3::int >= 4 THEN COALESCE(lido_em, NOW()) ELSE lido_em END,
         atualizado_em = NOW()
     WHERE id = $1
       AND (CASE status WHEN 'enviado' THEN 1 WHEN 'confirmado_servidor' THEN 2
                        WHEN 'entregue' THEN 3 WHEN 'lido' THEN 4 ELSE 99 END) < $3::int`,
    [envioId, novo, ordem]
  );
  await registrarEvento(
    pool,
    envioId,
    origem,
    rowCount ? novo : null,
    rowCount ? `WhatsApp: ${recibo}` : `WhatsApp: ${recibo} (repetido ou fora de ordem; estado mantido)`
  );
  return rowCount > 0;
}

// ---- Webhooks (armazenamento comum) -------------------------------------------------

async function webhookNovo(provedor, eventoId, tipo, payload, { referencia = null, envioId = null, processado = true } = {}) {
  const { rowCount } = await pool.query(
    `INSERT INTO notificacao_webhooks (provedor, evento_id, tipo, payload, referencia, envio_id, processado_em)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN NOW() END)
     ON CONFLICT (provedor, evento_id) DO NOTHING`,
    [provedor, eventoId, tipo, payload, referencia, envioId, processado]
  );
  return rowCount === 1;
}

async function envioDoProvedor(provedor, provedorId) {
  if (!provedorId) return null;
  const { rows } = await pool.query(
    "SELECT id FROM notificacao_envios WHERE provedor = $1 AND provedor_id = $2",
    [provedor, String(provedorId)]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Aplica, na ordem dos estados, os eventos que chegaram antes do id da mensagem
 * ser gravado no envio. Chamado logo depois do aceite.
 */
async function aplicarEventosGuardados(envioId, provedor, provedorId) {
  if (provedor !== "evolution") return 0;
  const { rows } = await pool.query(
    `UPDATE notificacao_webhooks SET envio_id = $1, processado_em = NOW()
     WHERE provedor = 'evolution' AND referencia = $2 AND processado_em IS NULL
     RETURNING tipo, payload`,
    [envioId, String(provedorId)]
  );
  const ordem = (evento) => (evento.tipo === "send.message" ? 0 : ORDEM_WHATSAPP[RECIBOS[evento.payload.recibo]] || 5);
  for (const evento of rows.sort((a, b) => ordem(a) - ordem(b))) {
    if (evento.tipo === "messages.update") await aplicarReciboWhatsapp(envioId, evento.payload.recibo, "webhook");
    else await registrarEvento(pool, envioId, "webhook", null, "Evolution API: mensagem transmitida ao WhatsApp (send.message).");
  }
  return rows.length;
}

function hashDoTexto(texto) {
  return crypto.createHash("sha256").update(String(texto)).digest("hex");
}

function textoDaMensagem(mensagem) {
  if (!mensagem) return "";
  return mensagem.conversation || (mensagem.extendedTextMessage && mensagem.extendedTextMessage.text) || "";
}

/**
 * Procura um "send.message" ainda sem envio, recebido nos últimos minutos, para o
 * mesmo número e com o mesmo texto do envio. Devolve o id da mensagem ou null.
 */
async function idPelaMensagemTransmitida(envio, destino) {
  const { rows } = await pool.query(
    `SELECT referencia, payload FROM notificacao_webhooks
     WHERE provedor = 'evolution' AND tipo = 'send.message' AND processado_em IS NULL
       AND payload->>'hashTexto' = $1 AND recebido_em > NOW() - make_interval(mins => $2)
     ORDER BY recebido_em`,
    [hashDoTexto(envio.conteudo), JANELA_CONFIRMACAO_MIN]
  );
  const candidatos = rows.filter((r) => remetenteCorresponde(r.payload.destino, digitosDoWhatsapp(destino)));
  return candidatos.length === 1 ? candidatos[0].referencia : null;
}

// Envio incerto recente para o mesmo número e o mesmo texto de um "send.message" que acabou de chegar.
async function incertoDaMensagemTransmitida(payload) {
  const { rows } = await pool.query(
    `SELECT id, destino, conteudo FROM notificacao_envios
     WHERE canal = 'whatsapp' AND status = 'incerto' AND provedor_id IS NULL
       AND tentativa_iniciada_em > NOW() - make_interval(mins => $1)`,
    [JANELA_CONFIRMACAO_MIN]
  );
  const candidatos = rows.filter(
    (e) => hashDoTexto(e.conteudo) === payload.hashTexto && remetenteCorresponde(payload.destino, digitosDoWhatsapp(e.destino))
  );
  return candidatos.length === 1 ? Number(candidatos[0].id) : null;
}

async function resolverIncerto(envioId, provedorId) {
  const { rowCount } = await pool.query(
    `UPDATE notificacao_envios
     SET status = 'enviado', provedor_id = $2, enviado_em = COALESCE(enviado_em, NOW()),
         erro_codigo = NULL, erro_mensagem = NULL, atualizado_em = NOW()
     WHERE id = $1 AND status = 'incerto'`,
    [envioId, provedorId]
  );
  if (rowCount) {
    await registrarEvento(
      pool,
      envioId,
      "incerto_resolvido",
      "enviado",
      `A Evolution API confirmou a transmissão (send.message, id ${provedorId}); nada foi reenviado.`
    );
  }
  return rowCount > 0;
}

// Há um envio de WhatsApp saindo agora? Só então um evento sem envio conhecido pode ser nosso.
async function envioWhatsappEmAndamento() {
  const { rows } = await pool.query(
    "SELECT EXISTS (SELECT 1 FROM notificacao_envios WHERE canal = 'whatsapp' AND status = 'processando') AS existe"
  );
  return rows[0].existe;
}

// ---- Webhooks da Evolution API -------------------------------------------------------

const MOTIVOS_DESCONEXAO = {
  401: "a sessão foi encerrada no celular (aparelho desconectado)",
  403: "o WhatsApp recusou a conexão",
  408: "a conexão expirou",
  428: "a conexão foi perdida",
  440: "a sessão foi substituída por outra conexão",
  500: "a sessão ficou inválida",
  515: "o WhatsApp pediu para reiniciar a conexão",
};

async function tratarRecibo(dados) {
  // Só recibos de mensagens que este número enviou, fora de grupos e status.
  if (dados.fromMe !== true || !dados.keyId || !dados.status) return;
  const remoto = String(dados.remoteJid || "");
  if (remoto.endsWith("@g.us") || remoto === "status@broadcast") return;

  const envioId = await envioDoProvedor("evolution", dados.keyId);
  // Sem envio com esse id e sem envio saindo agora, a mensagem não é desta aplicação
  // (ex.: digitada no próprio celular do remetente): não é guardada.
  if (!envioId && !(await envioWhatsappEmAndamento())) return;
  const novo = await webhookNovo(
    "evolution",
    `messages.update:${dados.keyId}:${dados.status}`,
    "messages.update",
    { recibo: dados.status },
    { referencia: String(dados.keyId), envioId, processado: Boolean(envioId) }
  );
  if (novo && envioId) await aplicarReciboWhatsapp(envioId, dados.status, "webhook");
}

async function tratarMensagemTransmitida(dados) {
  const id = dados.key && dados.key.id;
  if (!id || (dados.key.fromMe !== undefined && dados.key.fromMe !== true)) return;
  const payload = { destino: digitosDoWhatsapp(dados.key.remoteJid), hashTexto: hashDoTexto(textoDaMensagem(dados.message)) };

  let envioId = await envioDoProvedor("evolution", id);
  if (!envioId) {
    const incerto = await incertoDaMensagemTransmitida(payload);
    if (incerto && (await resolverIncerto(incerto, String(id)))) envioId = incerto;
  }
  if (!envioId && !(await envioWhatsappEmAndamento())) return;
  const novo = await webhookNovo("evolution", "send.message:" + id, "send.message", payload, {
    referencia: String(id),
    envioId,
    processado: Boolean(envioId),
  });
  if (novo && envioId) {
    await registrarEvento(pool, envioId, "webhook", null, "Evolution API: mensagem transmitida ao WhatsApp (send.message).");
    await aplicarEventosGuardados(envioId, "evolution", id);
  }
}

async function tratarConexao(dados, config, corpoBruto) {
  const eventoId = "connection.update:" + crypto.createHash("sha256").update(corpoBruto).digest("hex");
  const novo = await webhookNovo("evolution", eventoId, "connection.update", {
    estado: dados.state || null,
    motivo: dados.statusReason ?? null,
  });
  if (!novo) return;

  if (dados.state === "open") {
    const telefone = telefoneDoWhatsapp(dados.wuid);
    const numero = telefone ? formatarTelefone(telefone) : "número não informado";
    const valido = remetenteCorresponde(dados.wuid, config.whatsapp.remetenteEsperado);
    await registrarEventoAdmin(pool, {
      categoria: "conexao",
      tipo: valido ? "conectado" : "remetente_inesperado",
      detalhe: valido
        ? `WhatsApp conectado: ${numero}.`
        : `Conectado um número diferente do remetente esperado (${numero}): envios bloqueados.`,
    });
  } else if (dados.state === "close" || dados.state === "refused") {
    const motivo = MOTIVOS_DESCONEXAO[dados.statusReason] || `código ${dados.statusReason ?? "desconhecido"}`;
    await registrarEventoAdmin(pool, {
      categoria: "conexao",
      tipo: "desconectado",
      detalhe: `WhatsApp desconectado: ${motivo}. Os envios ficam retidos até a reconexão.`,
    });
  }
  // "connecting" não é registrado: acontece em toda reconexão automática e a cada QR.
}

function lerJson(corpoBruto) {
  try {
    return JSON.parse(corpoBruto.toString("utf8"));
  } catch {
    return null;
  }
}

const SEM_SEGREDO = (variavel) => ({ status: 503, corpo: { erro: `Webhook desativado: defina ${variavel}.` } });
const ASSINATURA_INVALIDA = { status: 401, corpo: { erro: "Assinatura inválida." } };
const CORPO_INVALIDO = { status: 400, corpo: { erro: "Corpo do webhook inválido." } };
const INSTANCIA_DESCONHECIDA = { status: 403, corpo: { erro: "Instância desconhecida." } };
const RECEBIDO = { status: 200, corpo: { ok: true } };

async function processarWebhookResend({ cabecalhos, corpoBruto, segredo }) {
  if (!segredo) return SEM_SEGREDO("RESEND_WEBHOOK_SECRET");
  const assinatura = {
    id: cabecalhos["svix-id"],
    timestamp: cabecalhos["svix-timestamp"],
    assinaturas: cabecalhos["svix-signature"],
  };
  if (!assinaturaResendValida(assinatura, corpoBruto, segredo)) return ASSINATURA_INVALIDA;
  const evento = lerJson(corpoBruto);
  if (!evento || !evento.type) return CORPO_INVALIDO;
  if (!(await webhookNovo("resend", assinatura.id, evento.type, evento))) return RECEBIDO;

  const dados = evento.data || {};
  const envioId = await envioDoProvedor("resend", dados.email_id);
  if (envioId) {
    const resultado = statusPorEventoResend(evento.type);
    if (dados.bounce && dados.bounce.message) resultado.detalhe += " — " + dados.bounce.message;
    await aplicarResultadoDeEntrega(envioId, resultado, "webhook");
  }
  return RECEBIDO;
}

/**
 * Webhook da Evolution API: JWT conferido, instância conferida e cada evento
 * deduplicado (o mesmo recibo, o mesmo id transmitido ou o mesmo corpo de conexão).
 * Ignora com 200 o que não interessa, para a Evolution não repetir à toa.
 */
async function processarWebhookEvolution({ cabecalhos, corpoBruto, config }) {
  const cfg = config.whatsapp.evolution;
  if (!cfg.webhookSecret) return SEM_SEGREDO("EVOLUTION_WEBHOOK_SECRET");
  if (!jwtEvolutionValido(cabecalhos.authorization, cfg.webhookSecret)) return ASSINATURA_INVALIDA;
  const evento = lerJson(corpoBruto);
  if (!evento || typeof evento.event !== "string") return CORPO_INVALIDO;
  if (evento.instance !== cfg.instancia) return INSTANCIA_DESCONHECIDA;

  const dados = evento.data && typeof evento.data === "object" ? evento.data : {};
  if (evento.event === "messages.update") await tratarRecibo(dados);
  else if (evento.event === "send.message") await tratarMensagemTransmitida(dados);
  else if (evento.event === "connection.update") await tratarConexao(dados, config, corpoBruto);
  return RECEBIDO;
}

module.exports = {
  aplicarResultadoDeEntrega,
  consultarStatusDeEntrega,
  iniciarConsultaDeEntrega,
  pararConsultaDeEntrega,
  aplicarReciboWhatsapp,
  aplicarEventosGuardados,
  idPelaMensagemTransmitida,
  processarWebhookResend,
  processarWebhookEvolution,
};
