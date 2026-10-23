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
