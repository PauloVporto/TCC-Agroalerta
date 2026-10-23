/**
 * Autenticidade dos webhooks.
 *
 * Resend: esquema da Svix (cabeçalhos svix-id, svix-timestamp, svix-signature),
 *   sempre sobre o corpo bruto. A assinatura é o HMAC-SHA256, em base64, de
 *   "id.timestamp.corpo", com a parte do segredo após "whsec_" decodificada de
 *   base64. O cabeçalho pode trazer várias assinaturas ("v1,<b64> v1,<b64>").
 *
 * Evolution API (v2.3.7): com "jwt_key" nos headers do webhook, cada chamada traz
 *   "Authorization: Bearer <JWT>" — HS256 assinado com essa chave, payload
 *   { iat, exp, app: "evolution", action: "webhook" } e validade de 10 minutos
 *   (src/api/integrations/event/webhook/webhook.controller.ts). Um JWT repetido
 *   dentro da validade é inofensivo: os eventos são deduplicados.
 *
 * As comparações são em tempo constante para não vazar a assinatura esperada.
 */

const crypto = require("crypto");

const TOLERANCIA_SVIX_SEGUNDOS = 5 * 60;
const TOLERANCIA_RELOGIO_SEGUNDOS = 60;

function iguais(recebido, esperado) {
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assinaturaResendValida({ id, timestamp, assinaturas }, corpoBruto, segredo, agoraMs = Date.now()) {
  if (!id || !timestamp || !assinaturas || !segredo) return false;
  const instante = Number(timestamp);
  if (!Number.isFinite(instante) || Math.abs(agoraMs / 1000 - instante) > TOLERANCIA_SVIX_SEGUNDOS) return false;

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

function lerParteDoJwt(parte) {
  try {
    return JSON.parse(Buffer.from(parte, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function jwtEvolutionValido(autorizacao, segredo, agoraMs = Date.now()) {
  if (!autorizacao || !segredo) return false;
  const [esquema, token] = String(autorizacao).split(" ");
  if (esquema !== "Bearer" || !token) return false;
  const partes = token.split(".");
  if (partes.length !== 3) return false;

  const [cabecalho, corpo, assinatura] = partes;
  const esperada = crypto.createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest("base64url");
  if (!iguais(assinatura, esperada)) return false;

  const dadosCabecalho = lerParteDoJwt(cabecalho);
  const dados = lerParteDoJwt(corpo);
  if (!dadosCabecalho || dadosCabecalho.alg !== "HS256" || !dados) return false;
  const agora = agoraMs / 1000;
  return (
    dados.app === "evolution" &&
    dados.action === "webhook" &&
    Number.isFinite(dados.exp) &&
    Number.isFinite(dados.iat) &&
    dados.exp > agora - TOLERANCIA_RELOGIO_SEGUNDOS &&
    dados.iat <= agora + TOLERANCIA_RELOGIO_SEGUNDOS
  );
}

module.exports = { assinaturaResendValida, jwtEvolutionValido };
