/**
 * Integração com a API REST v1 da SMSGo (https://api.smsgo.com.br).
 *
 * Endpoints e campos seguem os SDKs oficiais da SMSGo (sms-go/smsgo-sdk-nodejs e
 * smsgo-sdk-php) e a referência em smsgo.apidog.io:
 *   GET  /v1/auth/token        cabeçalho SMSGo-key → token Bearer (48 h) e modo live|test
 *   POST /v1/sms/send/single   { phone (E.164), message, reference, sms_type_id }
 *   GET  /v1/sms/{id}/show     resumo da entrega (delivered, failed, inProgress, done)
 *   GET  /v1/account/balance, /v1/sms-types, /v1/account/webhook
 *
 * Chaves com prefixo test_ usam o sandbox: a API responde como em produção, mas
 * não debita saldo nem entrega a mensagem.
 */

const { ErroProvedor, erroDeConfiguracao, requisitar, lerCorpo, segundosDeEspera } = require("./comum");

const URL_BASE = "https://api.smsgo.com.br";
const VALIDADE_TOKEN_MS = 47 * 60 * 60 * 1000; // o token vale 48 h; renova com folga

const tokens = new Map();

function erroDaResposta(resposta, corpo) {
  const status = resposta.status;
  const objeto = corpo && typeof corpo === "object" ? corpo : {};
  const original = String(objeto.message || (typeof corpo === "string" ? corpo : "") || "HTTP " + status);
  const campos = Array.isArray(objeto.errors)
    ? " (" + objeto.errors.map((e) => `${e.field}: ${e.message}`).join("; ") + ")"
    : "";
  const erro = (codigo, temporario) =>
    new ErroProvedor({
      provedor: "smsgo",
      codigo,
      temporario,
      status,
      mensagem: "SMSGo: " + original + campos,
      aguardarSegundos: temporario ? segundosDeEspera(resposta) : null,
    });

  if (status === 401) return erro("credencial_invalida", false);
  if (status === 402) return erro("saldo_insuficiente", false);
  if (status === 409) return erro("provedor_indisponivel", true);
  if (status === 429) return erro("limite_taxa", true);
  if (status >= 500) return erro("erro_provedor", true);
  return erro("requisicao_invalida", false);
}

async function obterToken(apiKey) {
  const emCache = tokens.get(apiKey);
  if (emCache && emCache.expiraEm > Date.now()) return emCache;

  const resposta = await requisitar("smsgo", URL_BASE + "/v1/auth/token", {
    headers: { "SMSGo-key": apiKey, Accept: "application/json" },
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  if (!corpo || !corpo.token) {
    throw new ErroProvedor({
      provedor: "smsgo",
      codigo: "erro_provedor",
      mensagem: "SMSGo: resposta de autenticação sem token.",
      temporario: true,
      status: resposta.status,
    });
  }
  const novo = { token: corpo.token, modo: corpo.mode === "test" ? "test" : "live", expiraEm: Date.now() + VALIDADE_TOKEN_MS };
  tokens.set(apiKey, novo);
  return novo;
}

async function chamar(apiKey, metodo, caminho, dados, tokenRenovado = false) {
  if (!apiKey) throw erroDeConfiguracao("smsgo", "Chave da SMSGo não configurada.");
  const { token } = await obterToken(apiKey);
  const headers = { Authorization: "Bearer " + token, Accept: "application/json" };
  if (dados) headers["Content-Type"] = "application/json";
  const resposta = await requisitar("smsgo", URL_BASE + caminho, {
    method: metodo,
    headers,
    body: dados ? JSON.stringify(dados) : undefined,
  });

  // Token expirado ou revogado: troca a chave por um token novo uma única vez.
  if (resposta.status === 401 && !tokenRenovado) {
    tokens.delete(apiKey);
    return chamar(apiKey, metodo, caminho, dados, true);
  }
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  return corpo;
}

async function enviarSms({ apiKey, para, mensagem, referencia, tipoSmsId = null }) {
  const dados = { phone: para, message: mensagem, reference: referencia };
  if (tipoSmsId !== null) dados.sms_type_id = tipoSmsId;
  const corpo = await chamar(apiKey, "POST", "/v1/sms/send/single", dados);
  return { provedorId: corpo.id, status: corpo.status, teste: corpo.test === true };
}

async function consultarEnvio({ apiKey, id }) {
  const corpo = await chamar(apiKey, "GET", "/v1/sms/" + encodeURIComponent(id) + "/show");
  const resumo = corpo.summary || {};
  return {
    entregues: Number(resumo.delivered || 0),
    falhas: Number(resumo.failed || 0),
    emAndamento: Number(resumo.inProgress || 0),
    concluido: resumo.done === true,
  };
}

async function obterModo({ apiKey }) {
  if (!apiKey) throw erroDeConfiguracao("smsgo", "Chave da SMSGo não configurada.");
  return (await obterToken(apiKey)).modo;
}

async function consultarSaldo({ apiKey }) {
  const corpo = await chamar(apiKey, "GET", "/v1/account/balance");
  return { saldo: Number(corpo.balance), moeda: corpo.currency };
}

async function listarTiposSms({ apiKey }) {
  const corpo = await chamar(apiKey, "GET", "/v1/sms-types");
  return Array.isArray(corpo.data) ? corpo.data : [];
}

async function consultarWebhook({ apiKey }) {
  const corpo = await chamar(apiKey, "GET", "/v1/account/webhook");
  return { url: corpo.url || null, temSegredo: Boolean(corpo.secret) };
}

module.exports = {
  enviarSms,
  consultarEnvio,
  obterModo,
  consultarSaldo,
  listarTiposSms,
  consultarWebhook,
};
