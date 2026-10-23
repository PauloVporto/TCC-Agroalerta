const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const resend = require("../services/notificacoes/provedores/resend");
const { resposta } = require("./helpers/http");

afterEach(() => mock.restoreAll());

const EMAIL = {
  apiKey: "re_teste",
  remetente: "Agro Alerta <alertas@agroalerta.com.br>",
  para: "produtor@fazenda.com.br",
  assunto: "Bem-vindo ao Agro Alerta!",
  html: "<p>Olá</p>",
  texto: "Olá",
  chaveIdempotencia: "agroalerta-envio-1-abc",
  tags: [{ name: "tipo", value: "boas_vindas" }],
};

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

test("enviarEmail faz POST /emails com a chave, a chave de idempotência e o conteúdo", async () => {
  const chamadas = responderCom(resposta(200, { id: "email-123" }));
  assert.deepEqual(await resend.enviarEmail(EMAIL), { provedorId: "email-123" });

  const { url, opcoes } = chamadas[0];
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(opcoes.method, "POST");
  assert.equal(opcoes.headers.Authorization, "Bearer re_teste");
  assert.equal(opcoes.headers["Idempotency-Key"], "agroalerta-envio-1-abc");
  assert.equal(opcoes.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(opcoes.body), {
    from: EMAIL.remetente,
    to: [EMAIL.para],
    subject: EMAIL.assunto,
    html: EMAIL.html,
    text: EMAIL.texto,
    tags: EMAIL.tags,
  });
});

test("sem chave ou remetente, falha por configuração sem chamar a API", async () => {
  const chamadas = responderCom();
  await assert.rejects(resend.enviarEmail({ ...EMAIL, apiKey: "" }), { codigo: "configuracao_ausente", temporario: false });
  await assert.rejects(resend.enviarEmail({ ...EMAIL, remetente: "" }), { codigo: "configuracao_ausente" });
  assert.equal(chamadas.length, 0);
});

const ERROS = [
  [401, { name: "validation_error", message: "API key is invalid" }, "credencial_invalida", false],
  [403, { name: "restricted_api_key", message: "This API key is restricted" }, "credencial_invalida", false],
  [
    403,
    { name: "validation_error", message: "You can only send testing emails to your own email address (dono@exemplo.com)." },
    "remetente_de_teste",
    false,
  ],
  [403, { name: "validation_error", message: "The agroalerta.com.br domain is not verified." }, "dominio_nao_verificado", false],
  [429, { name: "daily_quota_exceeded", message: "Daily quota exceeded" }, "cota_excedida", false],
  [429, { name: "rate_limit_exceeded", message: "Too many requests" }, "limite_taxa", true],
  [409, { name: "concurrent_idempotent_requests", message: "Still processing" }, "requisicao_em_andamento", true],
  [409, { name: "invalid_idempotent_request", message: "Different payload" }, "requisicao_invalida", false],
  [422, { name: "missing_required_field", message: "Missing to" }, "requisicao_invalida", false],
  [500, "Internal Server Error", "erro_provedor", true],
];

for (const [status, corpo, codigo, temporario] of ERROS) {
  test(`HTTP ${status} ${typeof corpo === "string" ? corpo : corpo.name} vira ${codigo}`, async () => {
    responderCom(resposta(status, corpo));
    await assert.rejects(resend.enviarEmail(EMAIL), (erro) => {
      assert.equal(erro.name, "ErroProvedor");
      assert.equal(erro.provedor, "resend");
      assert.equal(erro.codigo, codigo);
      assert.equal(erro.temporario, temporario);
      assert.equal(erro.status, status);
      assert.ok(!erro.message.includes("re_teste"), "a mensagem não pode expor a chave");
      return true;
    });
  });
}

test("o remetente de teste gera uma explicação de como liberar os envios", async () => {
  responderCom(resposta(403, { name: "validation_error", message: "You can only send testing emails to your own email address" }));
  await assert.rejects(resend.enviarEmail(EMAIL), /verifique um domínio próprio/i);
});

test("limite de taxa repassa o Retry-After para a próxima tentativa", async () => {
  responderCom(resposta(429, { name: "rate_limit_exceeded", message: "slow down" }, { "retry-after": "30" }));
  await assert.rejects(resend.enviarEmail(EMAIL), { codigo: "limite_taxa", aguardarSegundos: 30 });
});

test("queda de conexão é falha temporária", async () => {
  responderCom(new TypeError("fetch failed"));
  await assert.rejects(resend.enviarEmail(EMAIL), { codigo: "falha_conexao", temporario: true });
});

test("consultarEmail lê o last_event do envio", async () => {
  const chamadas = responderCom(resposta(200, { id: "email-123", last_event: "delivered" }), resposta(200, { id: "email-124" }));
  assert.deepEqual(await resend.consultarEmail({ apiKey: "re_teste", id: "email-123" }), { ultimoEvento: "delivered" });
  assert.equal(chamadas[0].url, "https://api.resend.com/emails/email-123");
  assert.equal(chamadas[0].opcoes.method, "GET");
  assert.equal(chamadas[0].opcoes.body, undefined);
  assert.deepEqual(await resend.consultarEmail({ apiKey: "re_teste", id: "email-124" }), { ultimoEvento: null });
});

test("listarDominios devolve a lista de domínios da conta", async () => {
  responderCom(resposta(200, { data: [{ name: "agroalerta.com.br", status: "verified" }] }), resposta(200, {}));
  assert.deepEqual(await resend.listarDominios({ apiKey: "re_teste" }), [{ name: "agroalerta.com.br", status: "verified" }]);
  assert.deepEqual(await resend.listarDominios({ apiKey: "re_teste" }), []);
});
