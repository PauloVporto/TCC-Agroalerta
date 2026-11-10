const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { buscarClimaOpenMeteo } = require("../services/openmeteo");
const { montarContextoLlm } = require("../services/llm");

test("Open-Meteo: separa previsão de chuva e dias secos históricos", async () => {
  const simulado = mock.method(globalThis, "fetch", async (url) => ({
    ok: true,
    json: async () => url.includes("historical-forecast")
      ? { daily: { precipitation_sum: [4, 0, 0] } }
      : { daily: {
        time: ["2026-10-21", "2026-10-22"],
        temperature_2m_min: [9, 8], precipitation_sum: [1, 2],
        wind_speed_10m_max: [22, 10],
      } },
  }));
  try {
    const clima = await buscarClimaOpenMeteo(-20.123, -44.567);
    assert.equal(clima.fonte, "open-meteo");
    assert.equal(clima.diasSemChuva, 2);
    assert.equal(clima.chuvaAcumulada7dias, 3);
    assert.equal(clima.temperaturaMinima, 8);
    assert.equal(clima.ventoMaximoKmh, 22);
  } finally {
    simulado.mock.restore();
  }
});

test("LLM monta contexto com clima, dólar e cotação", () => {
  const texto = montarContextoLlm({
    cultura: "cafe",
    clima: {
      fonte: "open-meteo",
      temperaturaMinima: 9,
      chuvaAcumulada7dias: 12,
      diasSemChuva: 3,
      probabilidadeChuva7dias: 40,
      ventoMaximoKmh: 18,
    },
    mercado: {
      dolar: { valor: 5.4, data: "2026-08-31" },
      internacional: {
        fonte: "yahoo-finance",
        bolsa: "ICE",
        ticker: "KC=F",
        preco: 320.5,
        unidade: "US¢/lb",
        data: "2026-08-29",
      },
      paridade: { preco: 2280.4, unidade: "R$/saca 60kg" },
    },
    historicoInterno: { precoAtual: 1730, unidade: "saca 60kg", variacaoPercentual: "1.2" },
  });

  assert.match(texto, /café arábica/);
  assert.match(texto, /open-meteo/);
  assert.match(texto, /KC=F/);
  assert.match(texto, /PTAX/);
  assert.match(texto, /1730/);
  assert.match(texto, /Mercado interno Brasil/);
  assert.match(texto, /Paridade internacional/);
});

test("llm.js: contexto complementar de mercado só traz fatos com fonte e data", () => {
  const { contextoMercadoComplementar } = require("../services/llm");
  const texto = contextoMercadoComplementar({
    ptax: { cotacaoVenda: 5.4, dataHora: "2026-11-09 13:07:00" },
    cotacao: { fonte: "Stooq", simbolo: "kc.f", valorAtual: 320.5, unidade: "US¢/lb", data: "2026-11-09" },
  });
  assert.match(texto, /PTAX venda/);
  assert.match(texto, /2026-11-09/);
  assert.match(texto, /kc\.f/);
  assert.equal(contextoMercadoComplementar({}), "");
});

test("prompt de mercado: sem contexto fica igual ao avaliado; com contexto acrescenta bloco no fim", () => {
  const { montarPromptTendencia } = require("../services/market");
  const serie = [{ data: "2026-11-01", preco: 100 }, { data: "2026-11-02", preco: 103 }];
  const base = montarPromptTendencia({ cultura: "cafe", unidade: "saca", serie });
  const comCtx = montarPromptTendencia({ cultura: "cafe", unidade: "saca", serie, contextoComplementar: "Câmbio: R$ 5,4" });
  assert.ok(comCtx.startsWith(base));
  assert.match(comCtx.slice(base.length), /Contexto complementar[\s\S]*Câmbio: R\$ 5,4/);
});

test("prompt de clima: previsão diária só aparece quando existe", () => {
  const { montarContextoClima } = require("../services/climaIA");
  const talhao = { nome: "T", cultura: "feijao", fase: "floracao" };
  const clima = { fonte: "open-meteo", temperaturaMinima: 5, chuvaAcumulada7dias: 1, diasSemChuva: 2, probabilidadeChuva7dias: 10, ventoMaximoKmh: 9 };
  assert.doesNotMatch(montarContextoClima({ talhao, clima, alertas: [] }), /Previsão diária/);
  const previsaoDiaria = [{ data: "2026-11-10", descricao: "Sol", chuvaMm: 0, tempMin: 5 }];
  const ctx = montarContextoClima({ talhao, clima: { ...clima, previsaoDiaria }, alertas: [] });
  assert.match(ctx, /Previsão diária: 2026-11-10: Sol, 0 mm, mín 5°C/);
  assert.match(ctx, /\(feijão, fase/);
});
