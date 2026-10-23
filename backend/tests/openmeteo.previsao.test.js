const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { buscarClimaOpenMeteo } = require("../services/openmeteo");
const { resposta } = require("./helpers/http");

afterEach(() => mock.restoreAll());

test("a previsão diária traz mínima com uma casa decimal e vento máximo de cada dia", async () => {
  mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("historical-forecast")) {
      return resposta(200, { daily: { precipitation_sum: [3, 0, 0] } });
    }
    return resposta(200, {
      daily: {
        time: ["2026-10-20", "2026-10-21"],
        temperature_2m_min: [1.44, null],
        temperature_2m_max: [24.66, 25.1],
        precipitation_sum: [0, 12.34],
        precipitation_probability_max: [10, 80],
        wind_speed_10m_max: [61.6, null],
        et0_fao_evapotranspiration: [3, 3.2],
      },
      hourly: {
        time: ["2026-10-20T03:00", "2026-10-20T05:00", "2026-10-20T06:00", "2026-10-21T05:00"],
        temperature_2m: [2.1, 1.44, null, 3.9],
      },
    });
  });

  // Coordenadas exclusivas deste teste: o serviço guarda as respostas em cache por local.
  const clima = await buscarClimaOpenMeteo(-21.0001, -45.0001);
  assert.deepEqual(clima.previsaoDiaria[0], {
    data: "2026-10-20",
    tempMax: 24.7,
    tempMin: 1.4,
    horaMinima: "05:00",
    chuvaMm: 0,
    chuvaProbabilidade: 10,
    ventoMaxKmh: 62,
    descricao: "Ensolarado",
    icone: "☀️",
  });
  assert.equal(clima.previsaoDiaria[1].ventoMaxKmh, 0);
  assert.equal(clima.previsaoDiaria[1].horaMinima, null, "sem mínima diária, não há hora da mínima");
  assert.equal(clima.temperaturaMinima, 1.4);
  assert.equal(clima.diasSemChuva, 2);
  assert.equal(clima.fonte, "open-meteo");
});

test("sem temperatura horária, a hora da mínima fica desconhecida (nada é inventado)", async () => {
  mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("historical-forecast")) return resposta(200, { daily: { precipitation_sum: [] } });
    assert.match(url, /&hourly=temperature_2m/);
    return resposta(200, { daily: { time: ["2026-10-20"], temperature_2m_min: [0.8] } });
  });
  // Coordenadas diferentes das do teste anterior até a 3ª casa (a chave do cache).
  const clima = await buscarClimaOpenMeteo(-22.5, -46.5);
  assert.equal(clima.previsaoDiaria[0].tempMin, 0.8);
  assert.equal(clima.previsaoDiaria[0].horaMinima, null);
});
