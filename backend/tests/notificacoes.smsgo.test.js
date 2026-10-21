const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const smsgo = require("../services/notificacoes/provedores/smsgo");
const { resposta } = require("./helpers/http");

afterEach(() => mock.restoreAll());

// O token fica em cache por chave; cada teste usa uma chave própria.
let contador = 0;
function novaChave() {
  contador += 1;
  return "chave-" + contador;
}

const TOKEN = (modo = "live") => resposta(200, { token: "oat_token", mode: modo });

function responderCom(...respostas) {
  const chamadas = [];
  mock.method(globalThis, "fetch", async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    return proxima;
  });
  return chamadas;
}

test("enviarSms troca a SMSGo-key por token e envia phone, message, reference e sms_type_id", async () => {
  const apiKey = novaChave();
  const chamadas = responderCom(TOKEN(), resposta(200, { id: "uuid-1", quantity: 1, status: "queued" }));
  const resultado = await smsgo.enviarSms({
    apiKey,
    para: "+5535999990000",
    mensagem: "Agro Alerta: teste",
    referencia: "envio-7",
    tipoSmsId: 2,
  });
  assert.deepEqual(resultado, { provedorId: "uuid-1", status: "queued", teste: false });

  assert.equal(chamadas[0].url, "https://api.smsgo.com.br/v1/auth/token");
  assert.equal(chamadas[0].opcoes.headers["SMSGo-key"], apiKey);
  assert.equal(chamadas[1].url, "https://api.smsgo.com.br/v1/sms/send/single");
  assert.equal(chamadas[1].opcoes.method, "POST");
  assert.equal(chamadas[1].opcoes.headers.Authorization, "Bearer oat_token");
  assert.deepEqual(JSON.parse(chamadas[1].opcoes.body), {
    phone: "+5535999990000",
    message: "Agro Alerta: teste",
    reference: "envio-7",
    sms_type_id: 2,
  });
});

test("o token é reaproveitado e sms_type_id só vai quando configurado; o sandbox é sinalizado", async () => {
  const apiKey = novaChave();
  const chamadas = responderCom(
    TOKEN("test"),
    resposta(200, { id: "uuid-1", status: "queued", test: true }),
    resposta(200, { id: "uuid-2", status: "queued", test: true })
  );
  const primeiro = await smsgo.enviarSms({ apiKey, para: "+5535999990000", mensagem: "a", referencia: "envio-1" });
  await smsgo.enviarSms({ apiKey, para: "+5535999990000", mensagem: "b", referencia: "envio-2" });
  assert.equal(primeiro.teste, true);
  assert.equal(chamadas.length, 3);
  assert.equal(JSON.parse(chamadas[1].opcoes.body).sms_type_id, undefined);
  assert.equal(await smsgo.obterModo({ apiKey }), "test");
});

test("401 no envio renova o token uma vez e repete a chamada", async () => {
  const apiKey = novaChave();
  const chamadas = responderCom(
    TOKEN(),
    resposta(401, { error: true, code: "unauthorized", message: "token expirado" }),
    resposta(200, { token: "oat_novo", mode: "live" }),
    resposta(200, { id: "uuid-3", status: "queued" })
  );
  const resultado = await smsgo.enviarSms({ apiKey, para: "+5535999990000", mensagem: "a", referencia: "envio-3" });
  assert.equal(resultado.provedorId, "uuid-3");
  assert.equal(chamadas[3].opcoes.headers.Authorization, "Bearer oat_novo");
});

test("401 persistente ou chave recusada é credencial inválida (definitiva)", async () => {
  responderCom(TOKEN(), resposta(401, {}), TOKEN(), resposta(401, { message: "token inválido" }));
  await assert.rejects(
    smsgo.enviarSms({ apiKey: novaChave(), para: "+5535999990000", mensagem: "a", referencia: "envio-4" }),
    { codigo: "credencial_invalida", temporario: false }
  );

  responderCom(resposta(401, { error: true, code: "unauthorized", message: "SMSGo-key inválida" }));
  await assert.rejects(smsgo.obterModo({ apiKey: novaChave() }), (erro) => {
    assert.equal(erro.codigo, "credencial_invalida");
    assert.match(erro.message, /SMSGo-key inválida/);
    return true;
  });
});

test("resposta de autenticação sem token é falha temporária do provedor", async () => {
  responderCom(resposta(200, { mode: "live" }));
  await assert.rejects(smsgo.obterModo({ apiKey: novaChave() }), { codigo: "erro_provedor", temporario: true });
});

const ERROS = [
  [402, { error: true, code: "insufficient_balance", message: "Saldo insuficiente" }, "saldo_insuficiente", false],
  [409, { error: true, code: "provider_out_of_stock", message: "Sem estoque" }, "provedor_indisponivel", true],
  [429, { error: true, code: "rate_limited", message: "Muitas requisições" }, "limite_taxa", true],
  [500, "erro interno", "erro_provedor", true],
  [400, { error: true, code: "bad_request", message: "JSON inválido" }, "requisicao_invalida", false],
];

for (const [status, corpo, codigo, temporario] of ERROS) {
  test(`HTTP ${status} no envio vira ${codigo}`, async () => {
    responderCom(TOKEN(), resposta(status, corpo, { "retry-after": "12" }));
    await assert.rejects(
      smsgo.enviarSms({ apiKey: novaChave(), para: "+5535999990000", mensagem: "a", referencia: "envio-5" }),
      (erro) => {
        assert.equal(erro.provedor, "smsgo");
        assert.equal(erro.codigo, codigo);
        assert.equal(erro.temporario, temporario);
        assert.equal(erro.aguardarSegundos, temporario ? 12 : null);
        return true;
      }
    );
  });
}

test("422 traz os campos recusados na mensagem", async () => {
  responderCom(
    TOKEN(),
    resposta(422, {
      error: true,
      code: "validation_error",
      message: "Dados inválidos",
      errors: [{ field: "phone", message: "formato inválido" }],
    })
  );
  await assert.rejects(
    smsgo.enviarSms({ apiKey: novaChave(), para: "+55", mensagem: "a", referencia: "envio-6" }),
    { codigo: "requisicao_invalida", message: "SMSGo: Dados inválidos (phone: formato inválido)" }
  );
});

test("queda de conexão e chave ausente", async () => {
  responderCom(new TypeError("fetch failed"));
  await assert.rejects(
    smsgo.enviarSms({ apiKey: novaChave(), para: "+5535999990000", mensagem: "a", referencia: "envio-8" }),
    { codigo: "falha_conexao", temporario: true }
  );
  await assert.rejects(smsgo.consultarSaldo({ apiKey: "" }), { codigo: "configuracao_ausente" });
  await assert.rejects(smsgo.obterModo({ apiKey: "" }), { codigo: "configuracao_ausente" });
});

test("consultas da conta: entrega, saldo, tipos de SMS e webhook (sem expor o segredo)", async () => {
  const apiKey = novaChave();
  const chamadas = responderCom(
    TOKEN(),
    resposta(200, { id: "uuid-1", summary: { total: 1, delivered: 1, failed: 0, inProgress: 0, done: true } }),
    resposta(200, { id: "uuid-2" }),
    resposta(200, { balance: 3, currency: "BRL", company: { name: "Empresa" } }),
    resposta(200, { data: [{ id: 2, name: "SHORTCODE TOKEN", price: 0.075 }] }),
    resposta(200, {}),
    resposta(200, { url: "https://exemplo.com/webhooks/smsgo", secret: "whsec_segredo" }),
    resposta(200, { url: null, secret: null })
  );
  assert.deepEqual(await smsgo.consultarEnvio({ apiKey, id: "uuid-1" }), { entregues: 1, falhas: 0, emAndamento: 0, concluido: true });
  assert.equal(chamadas[1].url, "https://api.smsgo.com.br/v1/sms/uuid-1/show");
  assert.deepEqual(await smsgo.consultarEnvio({ apiKey, id: "uuid-2" }), { entregues: 0, falhas: 0, emAndamento: 0, concluido: false });
  assert.deepEqual(await smsgo.consultarSaldo({ apiKey }), { saldo: 3, moeda: "BRL" });
  assert.deepEqual(await smsgo.listarTiposSms({ apiKey }), [{ id: 2, name: "SHORTCODE TOKEN", price: 0.075 }]);
  assert.deepEqual(await smsgo.listarTiposSms({ apiKey }), []);
  assert.deepEqual(await smsgo.consultarWebhook({ apiKey }), { url: "https://exemplo.com/webhooks/smsgo", temSegredo: true });
  assert.deepEqual(await smsgo.consultarWebhook({ apiKey }), { url: null, temSegredo: false });
});
