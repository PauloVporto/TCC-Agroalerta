/**
 * Entrega de alertas ao produtor por e-mail e SMS (celular).
 *
 * E-mail: SMTP via nodemailer (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM…).
 * SMS: Twilio REST (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
 *
 * Sem credenciais → modo simulado (registra o envio e loga o destino),
 * para a demo do TCC continuar 100% testável.
 */

const nodemailer = require("nodemailer");
const { pool } = require("./db");

function smtpConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function twilioConfigurado() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM
  );
}

function statusCanais() {
  return {
    email: smtpConfigurado() ? "real" : "simulado",
    sms: twilioConfigurado() ? "real" : "simulado",
  };
}

/** Normaliza telefone BR para E.164 (+55…) */
function normalizarTelefone(telefone) {
  if (!telefone) return null;
  let digitos = String(telefone).replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  if (digitos.length === 10 || digitos.length === 11) digitos = "55" + digitos;
  if (!digitos.startsWith("55") || digitos.length < 12) return null;
  return "+" + digitos;
}

function montarTextoSms(mensagem) {
  const rec = mensagem.recomendacao ? " Recado: " + mensagem.recomendacao : "";
  const corpo = "AgroAlerta: " + mensagem.titulo + ". " + mensagem.corpo + rec;
  return corpo.length > 480 ? corpo.slice(0, 477) + "…" : corpo;
}

function montarEmailHtml(mensagem, usuario) {
  const nivel = (mensagem.nivel || "medio").toUpperCase();
  return (
    `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.45;color:#26221D">` +
    `<p style="margin:0 0 8px;font-size:13px;color:#6B6356">AgroAlerta · alerta climático</p>` +
    `<h2 style="margin:0 0 12px;font-size:20px">${escapar(mensagem.titulo)}</h2>` +
    `<p style="margin:0 0 8px"><strong>Nível:</strong> ${escapar(nivel)}</p>` +
    `<p style="margin:0 0 12px">${escapar(mensagem.corpo)}</p>` +
    (mensagem.recomendacao
      ? `<p style="margin:0 0 12px;padding:10px 12px;background:#F4F1EA;border-radius:8px"><em>${escapar(mensagem.recomendacao)}</em></p>`
      : "") +
    `<p style="margin:16px 0 0;font-size:12px;color:#6B6356">Olá, ${escapar(usuario.nome || "produtor")}. ` +
    `Este aviso foi enviado para o e-mail cadastrado na sua conta AgroAlerta.</p>` +
    `</div>`
  );
}

function escapar(t) {
  return String(t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let transporterCache = null;

function obterTransporter() {
  if (!smtpConfigurado()) return null;
  if (transporterCache) return transporterCache;
  transporterCache = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth:
      process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
        : undefined,
  });
  return transporterCache;
}

async function enviarEmail({ para, assunto, texto, html }) {
  if (!para) return { ok: false, modo: "erro", detalhe: "E-mail do produtor ausente" };
  const transporter = obterTransporter();
  if (!transporter) {
    console.log(`[notificar:email:simulado] → ${para} | ${assunto}\n${texto}`);
    return { ok: true, modo: "simulado", detalhe: "E-mail simulado (configure SMTP_* para envio real)" };
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: para,
    subject: assunto,
    text: texto,
    html: html || texto,
  });
  return { ok: true, modo: "real", detalhe: "E-mail enviado via SMTP" };
}

async function enviarSms({ para, texto }) {
  const destino = normalizarTelefone(para);
  if (!destino) {
    return { ok: false, modo: "erro", detalhe: "Telefone inválido ou ausente (use DDD + número)" };
  }
  if (!twilioConfigurado()) {
    console.log(`[notificar:sms:simulado] → ${destino}\n${texto}`);
    return { ok: true, modo: "simulado", detalhe: "SMS simulado para " + destino + " (configure TWILIO_* para envio real)" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const auth = Buffer.from(sid + ":" + token).toString("base64");
  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: destino, From: from, Body: texto }),
    }
  );
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return {
      ok: false,
      modo: "erro",
      detalhe: corpo.message || corpo.error_message || "Falha Twilio HTTP " + resp.status,
    };
  }
  return { ok: true, modo: "real", detalhe: "SMS enviado · sid " + (corpo.sid || "") };
}

async function registrarEnvio({ mensagemId, usuarioId, canal, destino, modo, ok, detalhe }) {
  await pool.query(
    `INSERT INTO envios_alerta
       (mensagem_id, usuario_id, canal, destino, modo, sucesso, detalhe)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [mensagemId, usuarioId, canal, destino, modo, ok, detalhe || ""]
  );
}

async function buscarUsuarioNotificacao(usuarioId) {
  const r = await pool.query(
    `SELECT u.id, u.nome, u.email, u.telefone, u.papel,
            COALESCE(p.notificacoes, TRUE) AS notificacoes
     FROM usuarios u
     LEFT JOIN preferencias_usuario p ON p.usuario_id = u.id
     WHERE u.id = $1`,
    [usuarioId]
  );
  return r.rows[0] || null;
}

/**
 * Envia e-mail + SMS para mensagens ainda não despachadas (ou resetadas).
 * Respeita preferencias_usuario.notificacoes.
 */
async function despacharMensagensPendentes(usuarioId, mensagens) {
  const usuario = await buscarUsuarioNotificacao(usuarioId);
  if (!usuario || usuario.papel === "fornecedor") {
    return { enviados: 0, pulados: (mensagens || []).length, motivo: "nao_produtor" };
  }
  if (!usuario.notificacoes) {
    return { enviados: 0, pulados: (mensagens || []).length, motivo: "notificacoes_desligadas" };
  }

  const pendentes = (mensagens || []).filter(
    (m) => m && m.id && (!m.enviadoEmailEm || !m.enviadoSmsEm)
  );
  let enviados = 0;

  for (const msg of pendentes) {
    const assunto = "AgroAlerta · " + msg.titulo;
    const texto =
      msg.titulo +
      "\n\n" +
      msg.corpo +
      (msg.recomendacao ? "\n\nRecomendação: " + msg.recomendacao : "") +
      "\n\n— AgroAlerta";

    if (!msg.enviadoEmailEm) {
      try {
        const email = await enviarEmail({
          para: usuario.email,
          assunto,
          texto,
          html: montarEmailHtml(msg, usuario),
        });
        await registrarEnvio({
          mensagemId: msg.id,
          usuarioId,
          canal: "email",
          destino: usuario.email,
          modo: email.modo,
          ok: email.ok,
          detalhe: email.detalhe,
        });
        if (email.ok) {
          await pool.query(
            `UPDATE mensagens_produtor
             SET enviado_email_em = NOW(), status_email = $2
             WHERE id = $1`,
            [msg.id, email.modo]
          );
          msg.enviadoEmailEm = new Date().toISOString();
          msg.statusEmail = email.modo;
          enviados++;
        } else {
          await pool.query(
            `UPDATE mensagens_produtor SET status_email = $2 WHERE id = $1`,
            [msg.id, "erro:" + (email.detalhe || "").slice(0, 120)]
          );
        }
      } catch (erro) {
        console.error("[notificar] e-mail:", erro.message);
        await pool.query(
          `UPDATE mensagens_produtor SET status_email = $2 WHERE id = $1`,
          [msg.id, "erro:" + erro.message.slice(0, 120)]
        );
        await registrarEnvio({
          mensagemId: msg.id,
          usuarioId,
          canal: "email",
          destino: usuario.email,
          modo: "erro",
          ok: false,
          detalhe: erro.message,
        }).catch(() => {});
      }
    }

    if (!msg.enviadoSmsEm) {
      try {
        const sms = await enviarSms({
          para: usuario.telefone,
          texto: montarTextoSms(msg),
        });
        await registrarEnvio({
          mensagemId: msg.id,
          usuarioId,
          canal: "sms",
          destino: normalizarTelefone(usuario.telefone) || usuario.telefone || "",
          modo: sms.modo,
          ok: sms.ok,
          detalhe: sms.detalhe,
        });
        if (sms.ok) {
          await pool.query(
            `UPDATE mensagens_produtor
             SET enviado_sms_em = NOW(), status_sms = $2
             WHERE id = $1`,
            [msg.id, sms.modo]
          );
          msg.enviadoSmsEm = new Date().toISOString();
          msg.statusSms = sms.modo;
          enviados++;
        } else {
          await pool.query(
            `UPDATE mensagens_produtor SET status_sms = $2 WHERE id = $1`,
            [msg.id, "erro:" + (sms.detalhe || "").slice(0, 120)]
          );
        }
      } catch (erro) {
        console.error("[notificar] sms:", erro.message);
        await pool.query(
          `UPDATE mensagens_produtor SET status_sms = $2 WHERE id = $1`,
          [msg.id, "erro:" + erro.message.slice(0, 120)]
        );
        await registrarEnvio({
          mensagemId: msg.id,
          usuarioId,
          canal: "sms",
          destino: usuario.telefone || "",
          modo: "erro",
          ok: false,
          detalhe: erro.message,
        }).catch(() => {});
      }
    }
  }

  return { enviados, pulados: pendentes.length, canais: statusCanais() };
}

module.exports = {
  smtpConfigurado,
  twilioConfigurado,
  statusCanais,
  normalizarTelefone,
  enviarEmail,
  enviarSms,
  despacharMensagensPendentes,
  buscarUsuarioNotificacao,
};
