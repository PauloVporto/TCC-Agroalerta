const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  lerConfiguracao,
  modoDoCanal,
  chaveSmsgoAtiva,
  avisosDeConfiguracao,
} = require("../services/notificacoes/config");

test("sem variáveis, os dois canais ficam simulados, com o sandbox ligado e limites conservadores", () => {
  const config = lerConfiguracao({});
  assert.equal(modoDoCanal(config, "email"), "simulado");
  assert.equal(modoDoCanal(config, "sms"), "simulado");
  assert.equal(config.email.provedor, "resend");
  assert.equal(config.sms.provedor, "smsgo");
  assert.equal(config.sms.smsgo.sandbox, true);
  assert.equal(config.sms.custoPorSegmento, null);
  assert.equal(config.sms.orcamentoMensal, null);
  assert.deepEqual(
    [config.sms.limiteDiario, config.sms.limiteMensal, config.sms.limitePorProdutorDia, config.sms.maxSegmentos],
    [20, 200, 3, 1]
  );
  assert.equal(config.monitoramento.ativo, true);
  assert.equal(config.monitoramento.intervaloMin, 60);
  assert.deepEqual(avisosDeConfiguracao(config), []);
});

test("o SMS só usa a chave de produção com SMSGO_SANDBOX=false explícito", () => {
  const env = { SMS_SENDING_ENABLED: "true", SMSGO_API_KEY: "chave-real", SMSGO_TEST_API_KEY: "test_chave" };
  const sandbox = lerConfiguracao(env);
  assert.equal(modoDoCanal(sandbox, "sms"), "sandbox");
  assert.equal(chaveSmsgoAtiva(sandbox.sms), "test_chave");

  const real = lerConfiguracao({ ...env, SMSGO_SANDBOX: "false" });
  assert.equal(modoDoCanal(real, "sms"), "real");
  assert.equal(chaveSmsgoAtiva(real.sms), "chave-real");

  assert.equal(modoDoCanal(lerConfiguracao({ ...env, SMS_PROVIDER: "twilio" }), "sms"), "real");
});

test("números aceitam vírgula decimal e valores inválidos voltam ao padrão", () => {
  const config = lerConfiguracao({
    SMS_COST_PER_SEGMENT: "0,075",
    SMS_MONTHLY_BUDGET: "3.50",
    SMS_DAILY_LIMIT: "abc",
    SMSGO_SMS_TYPE_ID: "2",
    WEATHER_MONITOR_ENABLED: "false",
    EMAIL_SENDING_ENABLED: " TRUE ",
  });
  assert.equal(config.sms.custoPorSegmento, 0.075);
  assert.equal(config.sms.orcamentoMensal, 3.5);
  assert.equal(config.sms.limiteDiario, 20);
  assert.equal(config.sms.smsgo.tipoSmsId, 2);
  assert.equal(config.monitoramento.ativo, false);
  assert.equal(modoDoCanal(config, "email"), "real");
});

test("avisos apontam credenciais ausentes, remetente de teste e SMS real sem orçamento", () => {
  const avisos = avisosDeConfiguracao(
    lerConfiguracao({
      EMAIL_SENDING_ENABLED: "true",
      SMS_SENDING_ENABLED: "true",
      SMSGO_SANDBOX: "false",
    })
  );
  assert.equal(avisos.length, 4);
  assert.match(avisos[0], /RESEND_API_KEY/);
  assert.match(avisos[1], /EMAIL_FROM está vazio/);
  assert.match(avisos[2], /SMSGO_API_KEY está vazia/);
  assert.match(avisos[3], /SMS_COST_PER_SEGMENT e SMS_MONTHLY_BUDGET/);

  const comRemetenteDeTeste = avisosDeConfiguracao(
    lerConfiguracao({
      EMAIL_SENDING_ENABLED: "true",
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "Agro Alerta <onboarding@resend.dev>",
      SMS_SENDING_ENABLED: "true",
    })
  );
  assert.equal(comRemetenteDeTeste.length, 2);
  assert.match(comRemetenteDeTeste[0], /resend\.dev/);
  assert.match(comRemetenteDeTeste[1], /SMSGO_TEST_API_KEY está vazia/);
});

test("avisos apontam provedor não suportado e Twilio incompleta", () => {
  const avisos = avisosDeConfiguracao(
    lerConfiguracao({
      EMAIL_SENDING_ENABLED: "true",
      EMAIL_PROVIDER: "sendgrid",
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "Agro Alerta <alertas@agroalerta.com.br>",
      SMS_SENDING_ENABLED: "true",
      SMS_PROVIDER: "outro",
      SMS_COST_PER_SEGMENT: "0.075",
      SMS_MONTHLY_BUDGET: "10",
    })
  );
  assert.deepEqual(avisos.length, 2);
  assert.match(avisos[0], /EMAIL_PROVIDER="sendgrid"/);
  assert.match(avisos[1], /SMS_PROVIDER="outro"/);

  const twilio = avisosDeConfiguracao(
    lerConfiguracao({ SMS_SENDING_ENABLED: "true", SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1" })
  );
  assert.equal(twilio.length, 2);
  assert.match(twilio[0], /TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ou TWILIO_FROM/);
});
