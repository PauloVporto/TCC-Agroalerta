const { test } = require("node:test");
const assert = require("node:assert/strict");
const { processarRespostaOpenMeteo } = require("../services/weather");
const { montarContextoLlm } = require("../services/llm");

test("Open-Meteo: agrega mínimo, chuva passada e dias secos consecutivos", () => {
  const hoje = new Date();
  const iso = (offset) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const clima = processarRespostaOpenMeteo({
    daily: {
      time: [iso(-3), iso(-2), iso(-1), iso(0), iso(1)],
      temperature_2m_min: [12, 11, 10, 9, 8],
      precipitation_sum: [4, 0, 0, 1, 2],
      precipitation_probability_max: [10, 20, 30, 40, 50],
      wind_speed_10m_max: [12, 18, 22, 15, 10],
    },
  });

  assert.equal(clima.fonte, "open-meteo");
  assert.equal(clima.diasSemChuva, 2);
  assert.equal(clima.chuvaAcumulada7dias, 4);
  assert.equal(clima.temperaturaMinima, 8);
  assert.equal(clima.ventoMaximoKmh, 22);
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
