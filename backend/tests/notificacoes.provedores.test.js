const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const resend = require("../services/notificacoes/provedores/resend");
const evolution = require("../services/notificacoes/provedores/evolution");
const { criarProvedorSimulado } = require("../services/notificacoes/provedores/simulado");
const { provedoresDaConfiguracao, TIPOS_AUTOMATICOS } = require("../services/notificacoes/provedores");
const { lerConfiguracao } = require("../services/notificacoes/config");

afterEach(() => mock.restoreAll());

const MENSAGEM = {
  destino: "+5535999990000",
  assunto: "Assunto",
  html: "<p>x</p>",
  texto: "texto",
  resumo: "Boas-vindas",
  chaveIdempotencia: "chave-1",
  referencia: "envio-1",
  tags: [{ name: "tipo", value: "boas_vindas" }],
};

test("e-mail simulado: nenhum provedor externo, só log com o destino mascarado, e tudo liberado", async () => {
  const { email } = provedoresDaConfiguracao(lerConfiguracao({}));
  assert.deepEqual([email.nome, email.modo], ["simulado", "simulado"]);
  assert.deepEqual(await email.liberacao(), { tipos: TIPOS_AUTOMATICOS, motivo: null, remetente: null });

  const linhas = [];
  const simulado = criarProvedorSimulado("email", (linha) => linhas.push(linha));
  const { provedorId } = await simulado.enviar({ ...MENSAGEM, destino: "produtor@fazenda.com.br" });
  assert.match(provedorId, /^simulado-[0-9a-f-]{36}$/);
  assert.equal(linhas[0], "[notificacoes:simulado] email para pr***@fazenda.com.br | Boas-vindas");

  await criarProvedorSimulado("whatsapp", (linha) => linhas.push(linha)).enviar(MENSAGEM);
  assert.match(linhas[1], /whatsapp para \(35\) 9\*\*\*\*-0000/);
});

test("e-mail real usa o Resend com a chave, o remetente e a idempotência do envio", async () => {
  const enviar = mock.method(resend, "enviarEmail", async () => ({ provedorId: "email-1" }));
  mock.method(resend, "consultarEmail", async () => ({ ultimoEvento: "bounced" }));
  const { email } = provedoresDaConfiguracao(
    lerConfiguracao({ EMAIL_SENDING_ENABLED: "true", RESEND_API_KEY: "re_x", EMAIL_FROM: "AA <a@agro.com>" })
  );
  assert.deepEqual([email.nome, email.modo], ["resend", "real"]);
  assert.deepEqual(await email.enviar({ ...MENSAGEM, destino: "p@x.com" }), { provedorId: "email-1" });
  assert.deepEqual(enviar.mock.calls[0].arguments[0], {
    apiKey: "re_x",
    remetente: "AA <a@agro.com>",
    para: "p@x.com",
    assunto: "Assunto",
    html: "<p>x</p>",
    texto: "texto",
    chaveIdempotencia: "chave-1",
    tags: MENSAGEM.tags,
  });
  assert.equal((await email.consultarStatus("email-1")).status, "falhou");
});

test("WhatsApp usa a instância da Evolution, sem reenvio seguro, um despachante e uma mensagem por vez", async () => {
  const enviar = mock.method(evolution, "enviarTexto", async () => ({ provedorId: "3EB0A1" }));
  const config = lerConfiguracao({ EVOLUTION_API_URL: "http://evo:8080", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE: "agroalerta" });
  const { whatsapp } = provedoresDaConfiguracao(config);
  assert.deepEqual(
    [whatsapp.nome, whatsapp.modo, whatsapp.reenvioSeguro, whatsapp.despachoExclusivo, whatsapp.tamanhoLote],
    ["evolution", "real", false, true, 1]
  );
  assert.deepEqual(await whatsapp.enviar(MENSAGEM), { provedorId: "3EB0A1" });
  assert.deepEqual(enviar.mock.calls[0].arguments, [config.whatsapp.evolution, { numero: "5535999990000", texto: "texto" }]);
});

test("provedor de e-mail não suportado falha de forma definitiva ao enviar", async () => {
  const { email } = provedoresDaConfiguracao(lerConfiguracao({ EMAIL_SENDING_ENABLED: "true", EMAIL_PROVIDER: "sendgrid" }));
  assert.equal((await email.liberacao()).tipos.length, 2);
  await assert.rejects(email.enviar(MENSAGEM), {
    codigo: "configuracao_ausente",
    temporario: false,
    message: 'EMAIL_PROVIDER="sendgrid" não é um provedor suportado.',
  });
});

test("eventos do Resend viram entregue, falhou ou em trânsito", () => {
  const { statusPorEventoResend } = resend;
  for (const evento of ["delivered", "opened", "clicked", "email.delivered"]) {
    assert.deepEqual(statusPorEventoResend(evento), { status: "entregue", reclamacao: false, detalhe: "Resend: " + evento.replace("email.", "") });
  }
  assert.deepEqual(statusPorEventoResend("email.complained"), { status: "entregue", reclamacao: true, detalhe: "Resend: complained" });
  for (const evento of ["bounced", "failed", "suppressed", "canceled"]) {
    assert.equal(statusPorEventoResend(evento).status, "falhou");
  }
  assert.equal(statusPorEventoResend("sent").status, null);
  assert.equal(statusPorEventoResend("email.delivery_delayed").status, null);
  assert.deepEqual(statusPorEventoResend(null), { status: null, reclamacao: false, detalhe: "Resend: sem evento" });
});
