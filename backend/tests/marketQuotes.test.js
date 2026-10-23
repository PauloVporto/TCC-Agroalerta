const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SIMBOLOS } = require("../services/marketSymbols");
const { internacionalParaReais, converterHistorico } = require("../services/marketParity");

test("futuros internacionais cobrem café, soja, milho e açúcar", () => {
  assert.equal(SIMBOLOS.cafe.ticker, "KC=F");
  assert.equal(SIMBOLOS.soja.ticker, "ZS=F");
  assert.equal(SIMBOLOS.milho.ticker, "ZC=F");
  assert.equal(SIMBOLOS.cana.ticker, "SB=F");
  assert.equal(SIMBOLOS.feijao, null);
});

test("converte café ICE (¢/lb) para R$/saca 60kg", () => {
  const reais = internacionalParaReais("cafe", 300, 5);
  assert.equal(reais, 1984.14);
});

test("converte soja CBOT (¢/bu) para R$/saca 60kg", () => {
  const reais = internacionalParaReais("soja", 1000, 5);
  assert.ok(reais > 100 && reais < 150);
});

test("feijão não tem paridade internacional", () => {
  assert.equal(internacionalParaReais("feijao", 100, 5), null);
});

test("histórico internacional usa PTAX do dia quando existe", () => {
  const convertido = converterHistorico(
    "cafe",
    [{ data: "2026-08-01", preco: 300 }],
    { "2026-08-01": 5 },
    4
  );
  assert.equal(convertido[0].preco, 1984.14);
});
