const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const twilio = require("../services/notificacoes/provedores/twilio");
const { resposta } = require("./helpers/http");

afterEach(() => mock.restoreAll());

const SMS = { accountSid: "AC123", authToken: "segredo", remetente: "+15550001111", para: "+5535999990000", mensagem: "Agro Alerta: teste" };

test("Twilio (legado) envia com autenticação básica e formulário To/From/Body", async () => {
  const chamadas = [];
  mock.method(globalThis, "fetch", async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return resposta(201, { sid: "SM1" });
  });
  assert.deepEqual(await twilio.enviarSms(SMS), { provedorId: "SM1" });
  assert.equal(chamadas[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
  assert.equal(chamadas[0].opcoes.headers.Authorization, "Basic " + Buffer.from("AC123:segredo").toString("base64"));
  assert.equal(chamadas[0].opcoes.body.toString(), "To=%2B5535999990000&From=%2B15550001111&Body=Agro+Alerta%3A+teste");
});

for (const [status, codigo, temporario] of [
  [400, "requisicao_invalida", false],
  [401, "credencial_invalida", false],
  [429, "limite_taxa", true],
  [503, "erro_provedor", true],
]) {
  test(`Twilio HTTP ${status} vira ${codigo}`, async () => {
    mock.method(globalThis, "fetch", async () => resposta(status, { message: "erro " + status }));
    await assert.rejects(twilio.enviarSms(SMS), { provedor: "twilio", codigo, temporario, message: "Twilio: erro " + status });
  });
}

test("Twilio sem corpo de erro ou sem credenciais", async () => {
  mock.method(globalThis, "fetch", async () => resposta(500, ""));
  await assert.rejects(twilio.enviarSms(SMS), { message: "Twilio: HTTP 500" });
  await assert.rejects(twilio.enviarSms({ ...SMS, authToken: "" }), { codigo: "configuracao_ausente" });
});
