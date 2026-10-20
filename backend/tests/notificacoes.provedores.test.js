const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const resend = require("../services/notificacoes/provedores/resend");
const smsgo = require("../services/notificacoes/provedores/smsgo");
const twilio = require("../services/notificacoes/provedores/twilio");
const { criarProvedorSimulado } = require("../services/notificacoes/provedores/simulado");
const {
  provedoresDaConfiguracao,
  statusPorEventoResend,
  statusPorResumoSmsgo,
} = require("../services/notificacoes/provedores");
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

test("modo simulado: nenhum provedor externo, só log com o destino mascarado", async () => {
  const { email, sms } = provedoresDaConfiguracao(lerConfiguracao({}));
  assert.equal(email.nome, "simulado");
  assert.equal(sms.modo, "simulado");

  const linhas = [];
  const simulado = criarProvedorSimulado("sms", (linha) => linhas.push(linha));
  const { provedorId } = await simulado.enviar(MENSAGEM);
  assert.match(provedorId, /^simulado-[0-9a-f-]{36}$/);
  assert.equal(linhas[0], "[notificacoes:simulado] sms para (35) 9****-0000 | Boas-vindas");

  const emailSimulado = criarProvedorSimulado("email", (linha) => linhas.push(linha));
  await emailSimulado.enviar({ ...MENSAGEM, destino: "produtor@fazenda.com.br" });
  assert.match(linhas[1], /pr\*\*\*@fazenda\.com\.br/);
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

test("SMS pela SMSGo usa a chave do modo (sandbox ou produção), o tipo de SMS e a referência", async () => {
  const enviar = mock.method(smsgo, "enviarSms", async () => ({ provedorId: "uuid-1" }));
  mock.method(smsgo, "consultarEnvio", async () => ({ entregues: 1, falhas: 0, emAndamento: 0, concluido: true }));
  const env = { SMS_SENDING_ENABLED: "true", SMSGO_API_KEY: "real", SMSGO_TEST_API_KEY: "test_x", SMSGO_SMS_TYPE_ID: "2" };

  const { sms: sandbox } = provedoresDaConfiguracao(lerConfiguracao(env));
  assert.deepEqual([sandbox.nome, sandbox.modo], ["smsgo", "sandbox"]);
  await sandbox.enviar(MENSAGEM);
  assert.deepEqual(enviar.mock.calls[0].arguments[0], {
    apiKey: "test_x",
    para: "+5535999990000",
    mensagem: "texto",
    referencia: "envio-1",
    tipoSmsId: 2,
  });
  assert.equal((await sandbox.consultarStatus("uuid-1")).status, "entregue");

  const { sms: real } = provedoresDaConfiguracao(lerConfiguracao({ ...env, SMSGO_SANDBOX: "false" }));
  assert.equal(real.modo, "real");
  await real.enviar(MENSAGEM);
  assert.equal(enviar.mock.calls[1].arguments[0].apiKey, "real");
});

test("Twilio continua disponível como alternativa legada", async () => {
  const enviar = mock.method(twilio, "enviarSms", async () => ({ provedorId: "SM1" }));
  const { sms } = provedoresDaConfiguracao(
    lerConfiguracao({ SMS_SENDING_ENABLED: "true", SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+1555" })
  );
  assert.deepEqual([sms.nome, sms.modo, sms.consultarStatus], ["twilio", "real", undefined]);
  assert.deepEqual(await sms.enviar(MENSAGEM), { provedorId: "SM1" });
  assert.deepEqual(enviar.mock.calls[0].arguments[0], {
    accountSid: "AC1",
    authToken: "t",
    remetente: "+1555",
    para: "+5535999990000",
    mensagem: "texto",
  });
});

test("provedor não suportado falha de forma definitiva ao enviar", async () => {
  const { email, sms } = provedoresDaConfiguracao(
    lerConfiguracao({ EMAIL_SENDING_ENABLED: "true", EMAIL_PROVIDER: "sendgrid", SMS_SENDING_ENABLED: "true", SMS_PROVIDER: "zenvia" })
  );
  await assert.rejects(email.enviar(MENSAGEM), { codigo: "configuracao_ausente", message: 'EMAIL_PROVIDER="sendgrid" não é um provedor suportado.' });
  await assert.rejects(sms.enviar(MENSAGEM), { codigo: "configuracao_ausente", temporario: false });
});

test("eventos do Resend viram entregue, falhou ou em trânsito", () => {
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

test("resumo da SMSGo vira entregue, falhou ou em andamento", () => {
  assert.equal(statusPorResumoSmsgo({ entregues: 1, falhas: 0, concluido: true }).status, "entregue");
  assert.equal(statusPorResumoSmsgo({ entregues: 0, falhas: 1, concluido: true }).status, "falhou");
  assert.equal(statusPorResumoSmsgo({ entregues: 0, falhas: 1, concluido: false }).status, null);
  assert.equal(statusPorResumoSmsgo({ entregues: 0, falhas: 0, concluido: false }).status, null);
});
