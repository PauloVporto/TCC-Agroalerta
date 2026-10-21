const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  lerConfiguracao,
  modoDoCanal,
  evolutionConfigurada,
  avisosDeConfiguracao,
} = require("../services/notificacoes/config");

const WHATSAPP_COMPLETO = {
  WHATSAPP_SENDING_ENABLED: "true",
  WHATSAPP_EXPECTED_SENDER: "9503",
  EVOLUTION_API_URL: "http://evolution-api:8080/",
  EVOLUTION_API_KEY: "chave",
  EVOLUTION_WEBHOOK_URL: "http://backend:3001/api/notificacoes/webhooks/evolution",
  EVOLUTION_WEBHOOK_SECRET: "segredo",
};

test("sem variáveis: e-mail simulado, WhatsApp desativado, monitoramento desligado e ritmo conservador", () => {
  const config = lerConfiguracao({});
  assert.equal(modoDoCanal(config, "email"), "simulado");
  assert.equal(modoDoCanal(config, "whatsapp"), "desativado");
  assert.equal(config.email.provedor, "resend");
  assert.equal(config.whatsapp.evolution.instancia, "agroalerta");
  assert.equal(config.whatsapp.remetenteEsperado, "");
  assert.deepEqual(
    [config.whatsapp.intervaloMinimoMs, config.whatsapp.limitePorHora, config.whatsapp.limiteDiario, config.whatsapp.limitePorProdutorDia],
    [4000, 30, 100, 5]
  );
  assert.equal(config.whatsapp.evolution.tempoLimiteMs, 30000);
  assert.equal(config.monitoramento.ativo, false, "só liga com WEATHER_MONITOR_ENABLED=true explícito");
  assert.equal(config.monitoramento.intervaloMin, 60);
  assert.equal(evolutionConfigurada(config), false);
  assert.deepEqual(avisosDeConfiguracao(config), []);
});

test("WhatsApp: desativado na implantação, sem configuração ou real", () => {
  assert.equal(modoDoCanal(lerConfiguracao({ ...WHATSAPP_COMPLETO, WHATSAPP_SENDING_ENABLED: "false" }), "whatsapp"), "desativado");
  assert.equal(modoDoCanal(lerConfiguracao({ WHATSAPP_SENDING_ENABLED: "true" }), "whatsapp"), "nao_configurado");
  const real = lerConfiguracao(WHATSAPP_COMPLETO);
  assert.equal(modoDoCanal(real, "whatsapp"), "real");
  assert.equal(real.whatsapp.evolution.url, "http://evolution-api:8080", "a barra final é removida");
  assert.deepEqual(avisosDeConfiguracao(real), []);
});

test("segredos da Evolution vêm de NOME_FILE (Docker secrets) antes de NOME", () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "agroalerta-segredos-"));
  const arquivo = path.join(pasta, "evolution_api_key");
  fs.writeFileSync(arquivo, "chave-do-arquivo\n");
  try {
    const config = lerConfiguracao({ EVOLUTION_API_KEY: "da-variavel", EVOLUTION_API_KEY_FILE: arquivo, EVOLUTION_WEBHOOK_SECRET: "s" });
    assert.equal(config.whatsapp.evolution.apiKey, "chave-do-arquivo");
    assert.equal(config.whatsapp.evolution.webhookSecret, "s");
    assert.equal(lerConfiguracao({ EVOLUTION_API_KEY_FILE: path.join(pasta, "nao-existe") }).whatsapp.evolution.apiKey, "");
  } finally {
    fs.rmSync(pasta, { recursive: true });
  }
});

test("números aceitam vírgula decimal, valores inválidos voltam ao padrão e o remetente fica só com dígitos", () => {
  const config = lerConfiguracao({
    WHATSAPP_MIN_INTERVAL_MS: "2500,5",
    WHATSAPP_HOURLY_LIMIT: "abc",
    WHATSAPP_EXPECTED_SENDER: "+55 (35) 99999-9503",
    WEATHER_MONITOR_ENABLED: " TRUE ",
    EMAIL_SENDING_ENABLED: " TRUE ",
  });
  assert.equal(config.whatsapp.intervaloMinimoMs, 2500.5);
  assert.equal(config.whatsapp.limitePorHora, 30);
  assert.equal(config.whatsapp.remetenteEsperado, "5535999999503");
  assert.equal(config.monitoramento.ativo, true);
  assert.equal(modoDoCanal(config, "email"), "real");
});

test("avisos de e-mail: credenciais ausentes, remetente de teste e provedor não suportado", () => {
  const avisos = avisosDeConfiguracao(lerConfiguracao({ EMAIL_SENDING_ENABLED: "true" }));
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /RESEND_API_KEY/);
  assert.match(avisos[1], /EMAIL_FROM está vazio/);

  const deTeste = avisosDeConfiguracao(
    lerConfiguracao({ EMAIL_SENDING_ENABLED: "true", RESEND_API_KEY: "re_x", EMAIL_FROM: "Agro Alerta <onboarding@resend.dev>" })
  );
  assert.equal(deTeste.length, 1);
  assert.match(deTeste[0], /resend\.dev/);

  const outro = avisosDeConfiguracao(
    lerConfiguracao({ EMAIL_SENDING_ENABLED: "true", EMAIL_PROVIDER: "sendgrid", RESEND_API_KEY: "re_x", EMAIL_FROM: "AA <a@agro.com.br>" })
  );
  assert.deepEqual(outro.length, 1);
  assert.match(outro[0], /EMAIL_PROVIDER="sendgrid"/);
});

test("avisos de WhatsApp: URL, chave, remetente esperado e webhook", () => {
  const avisos = avisosDeConfiguracao(lerConfiguracao({ WHATSAPP_SENDING_ENABLED: "true" }));
  assert.equal(avisos.length, 4);
  assert.match(avisos[0], /EVOLUTION_API_URL/);
  assert.match(avisos[1], /EVOLUTION_API_KEY/);
  assert.match(avisos[2], /WHATSAPP_EXPECTED_SENDER/);
  assert.match(avisos[3], /EVOLUTION_WEBHOOK_URL ou EVOLUTION_WEBHOOK_SECRET/);
});
