/**
 * Confirmação de entrega.
 *
 * "enviado" só diz que a API do provedor aceitou a mensagem; "entregue" exige
 * confirmação do próprio provedor, que chega por dois caminhos:
 *   - consulta periódica: GET /emails/{id} (Resend) e GET /v1/sms/{id}/show
 *     (SMSGo) — funciona no ambiente local, sem URL pública;
 *   - webhooks (Resend e SMSGo), que exigem uma URL HTTPS pública.
 *
 * Uma reclamação de spam no e-mail revoga o consentimento desse canal.
 */

const crypto = require("crypto");
const { pool } = require("../db");
const { registrarEvento } = require("./fila");
const { registrarConsentimento } = require("./consentimentos");
const { statusPorEventoResend } = require("./provedores");
const { assinaturaResendValida, assinaturaSmsgoValida } = require("./assinaturas");

const JANELA_CONSULTA_DIAS = 3;
const INTERVALO_ENTRE_CONSULTAS_MIN = 5;

/**
 * Aplica um resultado de entrega ({ status, detalhe, reclamacao }) a um envio.
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

/** Consulta nos provedores a entrega dos envios aceitos nos últimos dias. */
async function consultarStatusDeEntrega({ provedores, limite = 20, log = console.log }) {
  // Marca a consulta antes de fazer, para um envio que o provedor atual não
  // sabe consultar não ocupar o lote para sempre.
  const { rows } = await pool.query(
    `UPDATE notificacao_envios SET status_consultado_em = NOW()
     WHERE id IN (
       SELECT id FROM notificacao_envios
       WHERE status = 'enviado' AND provedor_id IS NOT NULL
         AND enviado_em > NOW() - make_interval(days => $2)
         AND (status_consultado_em IS NULL OR status_consultado_em < NOW() - make_interval(mins => $3))
       ORDER BY enviado_em
       LIMIT $1)
     RETURNING id, canal, provedor, provedor_id, modo`,
    [limite, JANELA_CONSULTA_DIAS, INTERVALO_ENTRE_CONSULTAS_MIN]
  );

  let atualizados = 0;
  for (const envio of rows) {
    const provedor = provedores[envio.canal];
    if (!provedor.consultarStatus || provedor.nome !== envio.provedor || provedor.modo !== envio.modo) continue;
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

// ---- Webhooks ------------------------------------------------------------------

async function webhookNovo(provedor, eventoId, tipo, payload) {
  const { rowCount } = await pool.query(
    `INSERT INTO notificacao_webhooks (provedor, evento_id, tipo, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provedor, evento_id) DO NOTHING`,
    [provedor, eventoId, tipo, payload]
  );
  return rowCount === 1;
}

async function envioDoProvedor(provedor, provedorId) {
  if (!provedorId) return null;
  const { rows } = await pool.query(
    "SELECT id FROM notificacao_envios WHERE provedor = $1 AND provedor_id = $2",
    [provedor, String(provedorId)]
  );
  return rows[0] ? rows[0].id : null;
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

const STATUS_SMSGO = { delivered: "entregue", failed: "falhou" };

async function processarWebhookSmsgo({ cabecalhos, corpoBruto, segredo }) {
  if (!segredo) return SEM_SEGREDO("SMSGO_WEBHOOK_SECRET");
  if (!assinaturaSmsgoValida(corpoBruto, cabecalhos["x-smsgo-signature"], segredo)) return ASSINATURA_INVALIDA;
  const evento = lerJson(corpoBruto);
  if (!evento || !evento.event) return CORPO_INVALIDO;
  const eventoId = evento.id || crypto.createHash("sha256").update(corpoBruto).digest("hex");
  if (!(await webhookNovo("smsgo", String(eventoId), evento.event, evento))) return RECEBIDO;

  const dados = evento.data || {};
  if (evento.event === "sms.status") {
    const envioId = await envioDoProvedor("smsgo", dados.sendId);
    if (envioId) {
      await aplicarResultadoDeEntrega(
        envioId,
        { status: STATUS_SMSGO[dados.status] || null, reclamacao: false, detalhe: "SMSGo: " + dados.status },
        "webhook"
      );
    }
  }
  return RECEBIDO;
}

module.exports = {
  aplicarResultadoDeEntrega,
  consultarStatusDeEntrega,
  iniciarConsultaDeEntrega,
  pararConsultaDeEntrega,
  processarWebhookResend,
  processarWebhookSmsgo,
};
