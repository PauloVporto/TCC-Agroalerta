const crypto = require("crypto");

/**
 * JWT como o que a Evolution API v2.3.7 manda no webhook: jsonwebtoken.sign com
 * HS256, payload { iat, exp: iat + 600, app: "evolution", action: "webhook" }.
 */
function jwtEvolution(segredo, { agoraMs = Date.now(), alg = "HS256", ...extra } = {}) {
  const iat = Math.floor(agoraMs / 1000);
  const parte = (objeto) => Buffer.from(JSON.stringify(objeto)).toString("base64url");
  const cabecalho = parte({ alg, typ: "JWT" });
  const corpo = parte({ iat, exp: iat + 600, app: "evolution", action: "webhook", ...extra });
  const assinatura = crypto.createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest("base64url");
  return `${cabecalho}.${corpo}.${assinatura}`;
}

module.exports = { jwtEvolution };
