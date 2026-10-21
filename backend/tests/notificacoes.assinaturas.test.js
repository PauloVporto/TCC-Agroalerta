const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { assinaturaResendValida, assinaturaSmsgoValida } = require("../services/notificacoes/assinaturas");

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

test("SMSGo: confere sha256=<hmac hexadecimal> do corpo bruto", () => {
  const corpo = Buffer.from('{"event":"sms.status","data":{"sendId":"uuid-1","status":"delivered"}}');
  const segredo = "whsec_smsgo";
  const assinatura = "sha256=" + crypto.createHmac("sha256", segredo).update(corpo).digest("hex");
  assert.equal(assinaturaSmsgoValida(corpo, assinatura, segredo), true);
  assert.equal(assinaturaSmsgoValida(Buffer.from(corpo.toString().replace("delivered", "failed")), assinatura, segredo), false);
  assert.equal(assinaturaSmsgoValida(corpo, assinatura.slice(0, -2), segredo), false);
  assert.equal(assinaturaSmsgoValida(corpo, undefined, segredo), false);
  assert.equal(assinaturaSmsgoValida(corpo, assinatura, ""), false);
});
