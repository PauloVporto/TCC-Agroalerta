const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { assinaturaResendValida, jwtEvolutionValido } = require("../services/notificacoes/assinaturas");
const { jwtEvolution } = require("./helpers/jwt");

// Exemplo oficial da documentação da Svix (docs.svix.com/receiving/verifying-payloads/how-manual).
const SVIX = {
  segredo: "whsec_plJ3nmyCDGBKInavdOK15jsl",
  id: "msg_loFOjxBNrRLzqYUf",
  timestamp: "1731705121",
  corpo: Buffer.from('{"event_type":"ping","data":{"success":true}}'),
  assinatura: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
};
const AGORA = Number(SVIX.timestamp) * 1000;
const cabecalhos = (extra = {}) => ({ id: SVIX.id, timestamp: SVIX.timestamp, assinaturas: SVIX.assinatura, ...extra });

test("Resend: aceita o exemplo oficial da Svix", () => {
  assert.equal(assinaturaResendValida(cabecalhos(), SVIX.corpo, SVIX.segredo, AGORA), true);
});

test("Resend: aceita quando uma das várias assinaturas confere", () => {
  const varias = "v1,assinaturaAntiga= " + SVIX.assinatura;
  assert.equal(assinaturaResendValida(cabecalhos({ assinaturas: varias }), SVIX.corpo, SVIX.segredo, AGORA), true);
});

test("Resend: recusa corpo alterado, segredo errado, versão desconhecida e cabeçalho ausente", () => {
  const alterado = Buffer.from('{"event_type":"ping","data":{"success":false}}');
  assert.equal(assinaturaResendValida(cabecalhos(), alterado, SVIX.segredo, AGORA), false);
  assert.equal(assinaturaResendValida(cabecalhos(), SVIX.corpo, "whsec_" + Buffer.from("outro").toString("base64"), AGORA), false);
  assert.equal(assinaturaResendValida(cabecalhos({ assinaturas: SVIX.assinatura.replace("v1,", "v2,") }), SVIX.corpo, SVIX.segredo, AGORA), false);
  assert.equal(assinaturaResendValida(cabecalhos({ assinaturas: "v1" }), SVIX.corpo, SVIX.segredo, AGORA), false);
  assert.equal(assinaturaResendValida(cabecalhos({ id: undefined }), SVIX.corpo, SVIX.segredo, AGORA), false);
  assert.equal(assinaturaResendValida(cabecalhos(), SVIX.corpo, "", AGORA), false);
});

test("Resend: recusa assinatura fora da janela de 5 minutos (repetição de webhook antigo)", () => {
  assert.equal(assinaturaResendValida(cabecalhos(), SVIX.corpo, SVIX.segredo, AGORA + 6 * 60 * 1000), false);
  assert.equal(assinaturaResendValida(cabecalhos(), SVIX.corpo, SVIX.segredo, AGORA + 4 * 60 * 1000), true);
  assert.equal(assinaturaResendValida(cabecalhos({ timestamp: "ontem" }), SVIX.corpo, SVIX.segredo, AGORA), false);
});

// Token gerado pelo jsonwebtoken 9.0.2 de dentro da imagem evoapicloud/evolution-api:v2.3.7, com
// jwt.sign({ iat: 1761400000, exp: 1761400600, app: "evolution", action: "webhook" }, "segredo-do-webhook", { algorithm: "HS256" }).
const JWT_DE_REFERENCIA =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NjE0MDAwMDAsImV4cCI6MTc2MTQwMDYwMCwiYXBwIjoiZXZvbHV0aW9uIiwiYWN0aW9uIjoid2ViaG9vayJ9.V__-UXkhaRGcHY8Zv02N0qfYafVsiIIhQcUCcjWr9jY";

test("Evolution: aceita o JWT HS256 do webhook dentro da validade de 10 minutos", () => {
  const agora = 1761400000 * 1000;
  assert.equal(jwtEvolutionValido("Bearer " + JWT_DE_REFERENCIA, "segredo-do-webhook", agora), true);
  assert.equal(jwtEvolutionValido("Bearer " + JWT_DE_REFERENCIA, "segredo-do-webhook", agora + 9 * 60 * 1000), true);
  assert.equal(jwtEvolutionValido("Bearer " + jwtEvolution("outro-segredo"), "outro-segredo"), true);
});

test("Evolution: recusa JWT vencido, do futuro, de outro segredo, adulterado ou de outro emissor", () => {
  const agora = 1761400000 * 1000;
  const segredo = "segredo-do-webhook";
  assert.equal(jwtEvolutionValido("Bearer " + JWT_DE_REFERENCIA, segredo, agora + 12 * 60 * 1000), false, "vencido");
  assert.equal(jwtEvolutionValido("Bearer " + jwtEvolution(segredo, { agoraMs: agora + 5 * 60 * 1000 }), segredo, agora), false, "emitido no futuro");
  assert.equal(jwtEvolutionValido("Bearer " + JWT_DE_REFERENCIA, "segredo-errado", agora), false);
  const [cabecalho, , assinatura] = JWT_DE_REFERENCIA.split(".");
  const corpoTrocado = Buffer.from(JSON.stringify({ iat: 1761400000, exp: 1899999999, app: "evolution", action: "webhook" })).toString("base64url");
  assert.equal(jwtEvolutionValido(`Bearer ${cabecalho}.${corpoTrocado}.${assinatura}`, segredo, agora), false, "corpo trocado");
  assert.equal(jwtEvolutionValido("Bearer " + jwtEvolution(segredo, { app: "outro" }), segredo), false);
  assert.equal(jwtEvolutionValido("Bearer " + jwtEvolution(segredo, { action: "login" }), segredo), false);
  assert.equal(jwtEvolutionValido("Bearer " + jwtEvolution(segredo, { alg: "none" }), segredo), false, "alg diferente de HS256");
  assert.equal(jwtEvolutionValido("Bearer " + jwtEvolution(segredo, { exp: "nunca" }), segredo), false);
});

test("Evolution: recusa cabeçalho ausente, sem Bearer, malformado ou sem segredo configurado", () => {
  const segredo = "s";
  const token = jwtEvolution(segredo);
  assert.equal(jwtEvolutionValido(undefined, segredo), false);
  assert.equal(jwtEvolutionValido(token, segredo), false);
  assert.equal(jwtEvolutionValido("Basic " + token, segredo), false);
  assert.equal(jwtEvolutionValido("Bearer", segredo), false);
  assert.equal(jwtEvolutionValido("Bearer a.b", segredo), false);
  assert.equal(jwtEvolutionValido("Bearer " + token, ""), false);
  const [, corpo] = token.split(".");
  const assinaturaDeLixo = crypto.createHmac("sha256", segredo).update(`!!.${corpo}`).digest("base64url");
  assert.equal(jwtEvolutionValido(`Bearer !!.${corpo}.${assinaturaDeLixo}`, segredo), false, "cabeçalho ilegível");
});
