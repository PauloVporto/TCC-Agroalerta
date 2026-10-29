const { test, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const anthropic = require("../services/anthropic");
const market = require("../services/market");

const serie = (precos) => precos.map((preco, i) => ({ data: "2026-09-" + String(i + 1).padStart(2, "0"), preco }));
const respostaApi = (texto) => ({ dados: { id: "msg_m", model: "claude-teste", usage: { input_tokens: 5, output_tokens: 9 } }, texto, requestId: "req_m" });

let chaveOriginal;
beforeEach(() => { chaveOriginal = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = "chave-de-teste"; });
afterEach(() => {
  mock.restoreAll();
  if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = chaveOriginal;
});

test("classificarTendencia usa ±2% como limiar", () => {
  assert.equal(market.classificarTendencia(2), "alta");
  assert.equal(market.classificarTendencia(1.99), "estavel");
  assert.equal(market.classificarTendencia(0), "estavel");
  assert.equal(market.classificarTendencia(-1.99), "estavel");
  assert.equal(market.classificarTendencia(-2), "queda");
});

test("resumirSerie calcula início, fim, extremos e variação líquida", () => {
  const r = market.resumirSerie(serie([100, 110, 90, 105]));
  assert.equal(r.precoInicio, 100);
  assert.equal(r.precoFim, 105);
  assert.equal(r.minimo.preco, 90);
  assert.equal(r.maximo.preco, 110);
  assert.equal(r.variacaoPercentual, 5);
});

test("o prompt traz a regra de classificação e os números da série", () => {
  const prompt = market.montarPromptTendencia({ cultura: "soja", unidade: "saca 60kg", serie: serie([100, 103]) });
  assert.match(prompt, /soja/);
  assert.match(prompt, /\+2% ou mais = "alta"/);
  assert.match(prompt, /2026-09-01=100; 2026-09-02=103/);
  assert.match(prompt, /Não cite eventos, países, estoques/);
});

test("interpretarSerieComIA lê o JSON e devolve a proveniência da chamada", async () => {
  mock.method(anthropic, "mensagens", async () => respostaApi('{"tendencia":"alta","resumo":"Alta de 5%."}'));
  const r = await market.interpretarSerieComIA({ cultura: "cafe", unidade: "saca 60kg", serie: serie([100, 105]) });
  assert.equal(r.tendencia, "alta");
  assert.equal(r.resumo, "Alta de 5%.");
  assert.equal(r.formatoValido, true);
  assert.equal(r.requestId, "req_m");
  assert.equal(r.respostaId, "msg_m");
  assert.equal(r.promptVersao, market.PROMPT_MERCADO_VERSAO);
});

test("texto fora do formato JSON vira resumo bruto e é marcado como formato inválido", async () => {
  mock.method(anthropic, "mensagens", async () => respostaApi("O preço subiu."));
  const r = await market.interpretarSerieComIA({ cultura: "cafe", unidade: "saca 60kg", serie: serie([100, 105]) });
  assert.equal(r.formatoValido, false);
  assert.equal(r.tendencia, null);
  assert.equal(r.resumo, "O preço subiu.");
});

test("tendência fora do conjunto permitido é formato inválido", async () => {
  mock.method(anthropic, "mensagens", async () => respostaApi('{"tendencia":"disparada","resumo":"x"}'));
  const r = await market.interpretarSerieComIA({ cultura: "cafe", unidade: "saca 60kg", serie: serie([100, 105]) });
  assert.equal(r.formatoValido, false);
});

test("interpretarSerieComIA lança em falha da API (sem fallback simulado)", async () => {
  mock.method(anthropic, "mensagens", async () => { throw Object.assign(new Error("x"), { codigo: "tempo_limite" }); });
  await assert.rejects(market.interpretarSerieComIA({ cultura: "cafe", unidade: "saca 60kg", serie: serie([100, 105]) }), (e) => e.codigo === "tempo_limite");
});
