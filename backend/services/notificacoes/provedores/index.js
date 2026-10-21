/**
 * Escolhe o provedor de cada canal a partir da configuração e traduz o status de
 * entrega de cada um para o vocabulário da fila: "entregue", "falhou" ou null
 * (ainda em trânsito).
 *
 * Todo provedor expõe { nome, modo, enviar(mensagem) } e, quando o provedor
 * permite consultar a entrega, consultarStatus(provedorId).
 */

const resend = require("./resend");
const smsgo = require("./smsgo");
const twilio = require("./twilio");
const { criarProvedorSimulado } = require("./simulado");
const { erroDeConfiguracao } = require("./comum");
const { chaveSmsgoAtiva } = require("../config");

const EVENTOS_ENTREGUES = ["delivered", "opened", "clicked", "complained"];
const EVENTOS_FALHOS = ["bounced", "failed", "suppressed", "canceled"];

// Evento do Resend (last_event da consulta ou type do webhook, com ou sem "email.").
function statusPorEventoResend(evento) {
  const nome = String(evento || "").replace(/^email\./, "");
  if (EVENTOS_ENTREGUES.includes(nome)) {
    return { status: "entregue", reclamacao: nome === "complained", detalhe: "Resend: " + nome };
  }
  if (EVENTOS_FALHOS.includes(nome)) return { status: "falhou", reclamacao: false, detalhe: "Resend: " + nome };
  return { status: null, reclamacao: false, detalhe: "Resend: " + (nome || "sem evento") };
}

function statusPorResumoSmsgo({ entregues, falhas, concluido }) {
  if (entregues > 0) return { status: "entregue", reclamacao: false, detalhe: "SMSGo: entregue" };
  if (concluido && falhas > 0) return { status: "falhou", reclamacao: false, detalhe: "SMSGo: falha na entrega" };
  return { status: null, reclamacao: false, detalhe: "SMSGo: em andamento" };
}

function provedorNaoSuportado(variavel, valor) {
  return {
    nome: valor,
    modo: "real",
    async enviar() {
      throw erroDeConfiguracao(valor, `${variavel}="${valor}" não é um provedor suportado.`);
    },
  };
}

function provedorDeEmail(config) {
  const { email } = config;
  if (!email.envioAtivo) return criarProvedorSimulado("email");
  if (email.provedor !== "resend") return provedorNaoSuportado("EMAIL_PROVIDER", email.provedor);
  return {
    nome: "resend",
    modo: "real",
    enviar: (m) =>
      resend.enviarEmail({
        apiKey: email.resendApiKey,
        remetente: email.remetente,
        para: m.destino,
        assunto: m.assunto,
        html: m.html,
        texto: m.texto,
        chaveIdempotencia: m.chaveIdempotencia,
        tags: m.tags,
      }),
    consultarStatus: async (id) =>
      statusPorEventoResend((await resend.consultarEmail({ apiKey: email.resendApiKey, id })).ultimoEvento),
  };
}

function provedorDeSms(config) {
  const { sms } = config;
  if (!sms.envioAtivo) return criarProvedorSimulado("sms");
  if (sms.provedor === "twilio") {
    return {
      nome: "twilio",
      modo: "real",
      enviar: (m) => twilio.enviarSms({ ...sms.twilio, para: m.destino, mensagem: m.texto }),
    };
  }
  if (sms.provedor !== "smsgo") return provedorNaoSuportado("SMS_PROVIDER", sms.provedor);
  const apiKey = chaveSmsgoAtiva(sms);
  return {
    nome: "smsgo",
    modo: sms.smsgo.sandbox ? "sandbox" : "real",
    enviar: (m) =>
      smsgo.enviarSms({ apiKey, para: m.destino, mensagem: m.texto, referencia: m.referencia, tipoSmsId: sms.smsgo.tipoSmsId }),
    consultarStatus: async (id) => statusPorResumoSmsgo(await smsgo.consultarEnvio({ apiKey, id })),
  };
}

function provedoresDaConfiguracao(config) {
  return { email: provedorDeEmail(config), sms: provedorDeSms(config) };
}

module.exports = { provedoresDaConfiguracao, statusPorEventoResend, statusPorResumoSmsgo };
