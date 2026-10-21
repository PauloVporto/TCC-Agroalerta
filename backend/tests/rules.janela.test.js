const { test } = require("node:test");
const assert = require("node:assert/strict");
const { avaliarAlertas } = require("../services/rules");

function dia(data, campos = {}) {
  return { data, tempMin: 12, tempMax: 26, chuvaMm: 0, chuvaProbabilidade: 10, ventoMaxKmh: 15, ...campos };
}

const CLIMA_NORMAL = {
  temperaturaMinima: 12,
  chuvaAcumulada7dias: 10,
  diasSemChuva: 2,
  probabilidadeChuva7dias: 10,
  ventoMaximoKmh: 15,
  previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21"), dia("2026-10-22"), dia("2026-10-23")],
};

function alertaDa(regra, cultura, fase, clima) {
  return avaliarAlertas(cultura, fase, clima).find((a) => a.id === regra);
}

test("geada: a janela são os dias da previsão com mínima no limiar do nível", () => {
  const clima = {
    ...CLIMA_NORMAL,
    temperaturaMinima: 1.4,
    previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21", { tempMin: 1.4 }), dia("2026-10-22", { tempMin: 2 }), dia("2026-10-23", { tempMin: 4.8 })],
  };
  const alto = alertaDa("cafe_geada", "cafe", "floracao", clima);
  assert.equal(alto.nivel, "alto");
  assert.equal(alto.janela, "21/10 a 22/10");

  const medio = alertaDa("cafe_geada", "cafe", "floracao", { ...clima, temperaturaMinima: 4.8 });
  assert.equal(medio.nivel, "medio");
  assert.equal(medio.janela, "21/10 a 23/10");
});

test("excesso de chuva descreve a chuva como prevista, no período da previsão", () => {
  const alerta = alertaDa("cafe_excesso_chuva", "cafe", "floracao", { ...CLIMA_NORMAL, chuvaAcumulada7dias: 180 });
  assert.match(alerta.mensagem, /^180 mm de chuva previstos para os próximos dias/);
  assert.doesNotMatch(alerta.mensagem, /últimos/);
  assert.equal(alerta.janela, "20/10 a 23/10");
});

test("chuva na colheita e vento forte usam os dias da previsão em que o risco aparece", () => {
  const clima = {
    ...CLIMA_NORMAL,
    probabilidadeChuva7dias: 80,
    ventoMaximoKmh: 64,
    previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21", { chuvaProbabilidade: 80, ventoMaxKmh: 64 }), dia("2026-10-22")],
  };
  assert.equal(alertaDa("soja_chuva_colheita", "soja", "colheita", clima).janela, "21/10");
  assert.equal(alertaDa("soja_vento_forte", "soja", "colheita", clima).janela, "21/10");
});

test("sem previsão diária que date o risco, a janela não inventa datas", () => {
  const semPrevisao = { ...CLIMA_NORMAL, temperaturaMinima: 1, ventoMaximoKmh: 70, previsaoDiaria: undefined };
  assert.equal(alertaDa("cafe_geada", "cafe", "floracao", semPrevisao).janela, "próximos dias");
  assert.equal(alertaDa("soja_vento_forte", "soja", "floracao", semPrevisao).janela, "próximos dias");
  // A previsão do OpenWeather não traz vento por dia: nenhum dia confere, e a janela fica genérica.
  const diasSemVento = CLIMA_NORMAL.previsaoDiaria.map(({ ventoMaxKmh, ...resto }) => resto);
  assert.equal(
    alertaDa("soja_vento_forte", "soja", "floracao", { ...CLIMA_NORMAL, ventoMaximoKmh: 70, previsaoDiaria: diasSemVento }).janela,
    "próximos dias"
  );
  assert.equal(
    alertaDa("soja_chuva_colheita", "soja", "colheita", { ...CLIMA_NORMAL, probabilidadeChuva7dias: 70 }).janela,
    "próximos dias"
  );
  assert.equal(
    alertaDa("cafe_excesso_chuva", "cafe", "floracao", { ...semPrevisao, chuvaAcumulada7dias: 160 }).janela,
    "próximos dias"
  );
  assert.equal(
    alertaDa("cafe_geada", "cafe", "floracao", { ...CLIMA_NORMAL, temperaturaMinima: 4 }).janela,
    "próximos dias"
  );
});

test("estiagem continua contando os dias secos já observados", () => {
  const alerta = alertaDa("cafe_estiagem", "cafe", "floracao", { ...CLIMA_NORMAL, diasSemChuva: 16 });
  assert.equal(alerta.nivel, "alto");
  assert.equal(alerta.janela, "últimos 16 dias");
});
