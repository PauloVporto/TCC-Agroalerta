const { test } = require("node:test");
const assert = require("node:assert/strict");
const { avaliarAlertas, culturasSuportadas } = require("../services/rules");

test("culturas suportadas incluem as cinco do TCC", () => {
  assert.deepEqual(culturasSuportadas().sort(), ["cafe", "cana", "feijao", "milho", "soja"]);
});

test("café dispara geada alta com temperatura mínima 1°C", () => {
  const alertas = avaliarAlertas("cafe", "floracao", {
    temperaturaMinima: 1,
    chuvaAcumulada7dias: 10,
    diasSemChuva: 2,
    probabilidadeChuva7dias: 20,
    ventoMaximoKmh: 10,
  });
  const geada = alertas.find((a) => a.id === "cafe_geada");
  assert.ok(geada);
  assert.equal(geada.nivel, "alto");
});

test("soja em floração dispara estiagem alta após 10 dias secos", () => {
  const alertas = avaliarAlertas("soja", "floracao", {
    temperaturaMinima: 18,
    chuvaAcumulada7dias: 0,
    diasSemChuva: 10,
    probabilidadeChuva7dias: 5,
    ventoMaximoKmh: 12,
  });
  const estiagem = alertas.find((a) => a.id === "soja_estiagem");
  assert.equal(estiagem.nivel, "alto");
});

test("não gera alerta quando o clima está dentro da faixa", () => {
  const alertas = avaliarAlertas("milho", "vegetativo", {
    temperaturaMinima: 16,
    chuvaAcumulada7dias: 40,
    diasSemChuva: 1,
    probabilidadeChuva7dias: 30,
    ventoMaximoKmh: 20,
  });
  assert.equal(alertas.length, 0);
});
