/**
 * Envio de SMS pela Twilio — integração legada, mantida como alternativa
 * (SMS_PROVIDER=twilio). Vem da primeira versão das notificações (branch
 * LuizHenrique) e usa as mesmas variáveis TWILIO_*.
 */

const { ErroProvedor, erroDeConfiguracao, requisitar, lerCorpo, segundosDeEspera } = require("./comum");

function erroDaResposta(resposta, corpo) {
  const status = resposta.status;
  const original = corpo && typeof corpo === "object" ? corpo.message : String(corpo || "");
  const temporario = status === 429 || status >= 500;
  let codigo = "requisicao_invalida";
  if (status === 401) codigo = "credencial_invalida";
  else if (status === 429) codigo = "limite_taxa";
  else if (status >= 500) codigo = "erro_provedor";
  return new ErroProvedor({
    provedor: "twilio",
    codigo,
    temporario,
    status,
    mensagem: "Twilio: " + (original || "HTTP " + status),
    aguardarSegundos: temporario ? segundosDeEspera(resposta) : null,
  });
}

async function enviarSms({ accountSid, authToken, remetente, para, mensagem }) {
  if (!accountSid || !authToken || !remetente) {
    throw erroDeConfiguracao("twilio", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM são obrigatórios.");
  }
  const resposta = await requisitar("twilio", `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(accountSid + ":" + authToken).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: para, From: remetente, Body: mensagem }),
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  return { provedorId: corpo.sid };
}

module.exports = { enviarSms };
