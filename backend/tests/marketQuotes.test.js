const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SIMBOLOS } = require("../services/marketSymbols");

test("futuros públicos cobrem café, soja, milho e cana (açúcar)", () => {
  assert.equal(SIMBOLOS.cafe.ticker, "KC=F");
  assert.equal(SIMBOLOS.soja.ticker, "ZS=F");
  assert.equal(SIMBOLOS.milho.ticker, "ZC=F");
  assert.equal(SIMBOLOS.cana.ticker, "SB=F");
  assert.equal(SIMBOLOS.feijao, null);
});
