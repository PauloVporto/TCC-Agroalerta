const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  paraGsm7,
  contarUnidades,
  contarSegmentos,
  limiteDeUnidades,
  cortar,
} = require("../services/notificacoes/textoSms");

test("paraGsm7 tira acentos e símbolos que forçariam a cobrança em UCS-2", () => {
  assert.equal(paraGsm7("Atenção: mínima de 1,5 °C em São João!"), "Atencao: minima de 1,5C em Sao Joao!");
  assert.equal(paraGsm7("Período “crítico” – chuva… 🌧"), 'Periodo "critico" - chuva...');
  assert.equal(paraGsm7("1º lote, 2ª etapa, a’b"), "1 lote, 2 etapa, a'b");
  assert.equal(paraGsm7("  espaços\t\tduplos  "), "espacos duplos");
});

test("contarSegmentos: 160 posições num SMS, 153 por parte quando dividido", () => {
  assert.equal(contarSegmentos("a".repeat(160)), 1);
  assert.equal(contarSegmentos("a".repeat(161)), 2);
  assert.equal(contarSegmentos("a".repeat(306)), 2);
  assert.equal(contarSegmentos("a".repeat(307)), 3);
});

test("caracteres da tabela de extensão ocupam duas posições", () => {
  assert.equal(contarUnidades("[a]"), 5);
  assert.equal(contarSegmentos("€".repeat(80)), 1);
  assert.equal(contarSegmentos("€".repeat(81)), 2);
});

test("limiteDeUnidades e cortar respeitam o máximo de segmentos", () => {
  assert.equal(limiteDeUnidades(1), 160);
  assert.equal(limiteDeUnidades(2), 306);
  assert.equal(cortar("curto", 160), "curto");
  const cortado = cortar("palavra ".repeat(30), 50);
  assert.equal(contarUnidades(cortado) <= 50, true);
  assert.match(cortado, /\.\.\.$/);
  assert.equal(contarUnidades(cortar("{".repeat(40), 20)) <= 20, true);
});
