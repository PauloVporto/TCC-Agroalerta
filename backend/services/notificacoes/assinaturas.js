/**
 * Verificação da assinatura dos webhooks, sempre sobre o corpo bruto recebido.
 *
 * Resend: esquema da Svix (cabeçalhos svix-id, svix-timestamp, svix-signature).
 *   A assinatura é o HMAC-SHA256, em base64, de "id.timestamp.corpo", com a parte
 *   do segredo após "whsec_" decodificada de base64. O cabeçalho pode trazer
 *   várias assinaturas ("v1,<base64> v1,<base64>"); basta uma conferir.
 * SMSGo: cabeçalho X-SMSGo-Signature = "sha256=" + HMAC-SHA256 hexadecimal do corpo.
 *
 * As comparações são em tempo constante para não vazar a assinatura esperada.
 */

const crypto = require("crypto");

const TOLERANCIA_SEGUNDOS = 5 * 60;

function iguais(recebido, esperado) {
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assinaturaResendValida({ id, timestamp, assinaturas }, corpoBruto, segredo, agoraMs = Date.now()) {
  if (!id || !timestamp || !assinaturas || !segredo) return false;
  const instante = Number(timestamp);
  if (!Number.isFinite(instante) || Math.abs(agoraMs / 1000 - instante) > TOLERANCIA_SEGUNDOS) return false;

  const chave = Buffer.from(segredo.replace(/^whsec_/, ""), "base64");
  const esperada = crypto
    .createHmac("sha256", chave)
    .update(`${id}.${timestamp}.${corpoBruto.toString("utf8")}`)
    .digest("base64");
  return String(assinaturas)
    .split(" ")
    .some((item) => {
      const [versao, valor] = item.split(",");
      return versao === "v1" && valor !== undefined && iguais(valor, esperada);
    });
}

function assinaturaSmsgoValida(corpoBruto, cabecalho, segredo) {
  if (!cabecalho || !segredo) return false;
  const esperada = "sha256=" + crypto.createHmac("sha256", segredo).update(corpoBruto).digest("hex");
  return iguais(cabecalho, esperada);
}

module.exports = { assinaturaResendValida, assinaturaSmsgoValida };
