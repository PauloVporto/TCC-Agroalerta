const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  montarSerieComProjecao, fatoresSazonais, taxaAnualDeTendencia, mediasMensais,
} = require("../services/marketProjection");

const BASE = {
  unidade: "saca 60kg",
  fonte: "Cepea/Esalq (teste)",
  historico: [
    { data: "2026-07-31", preco: 140, origem: "cepea-ref" },
    { data: "2026-08-31", preco: 143.4, origem: "cepea-ref" },
  ],
};

// Padrão sazonal com média 1: caro no 1º semestre, barato no 2º.
const SAZONAL = [1.1, 1.08, 1.05, 1.02, 1.0, 0.97, 0.94, 0.92, 0.95, 0.98, 1.0, 0.99];
const MEDIA_SAZONAL = SAZONAL.reduce((a, b) => a + b, 0) / 12;

// Um ponto por mês, do mês inicial em diante; precoDoMes recebe (indice, mes de 1 a 12).
function serieMensal(anoInicio, totalMeses, precoDoMes) {
  return Array.from({ length: totalMeses }, (_, i) => {
    const ano = anoInicio + Math.floor(i / 12);
    const mes = (i % 12) + 1;
    return { data: `${ano}-${String(mes).padStart(2, "0")}-15`, preco: precoDoMes(i, mes) };
  });
}

function baseCom(historico) {
  return { unidade: "saca 60kg", fonte: "teste", historico };
}

test("devolve o histórico real só com data e preço", () => {
  const serie = montarSerieComProjecao(BASE, "soja");
  assert.deepEqual(serie.historico, [
    { data: "2026-07-31", preco: 140 },
    { data: "2026-08-31", preco: 143.4 },
  ]);
});

test("projeta 24 meses consecutivos de 2027 a 2028", () => {
  const { projecao, anosProjecao } = montarSerieComProjecao(BASE, "soja");
  assert.deepEqual(anosProjecao, [2027, 2028]);
  assert.equal(projecao.length, 24);
  assert.equal(projecao[0].data, "2027-01-15");
  assert.equal(projecao[23].data, "2028-12-15");
  projecao.forEach((ponto) => {
    assert.deepEqual(Object.keys(ponto), ["data", "preco"]);
    assert.ok(ponto.preco > 0);
  });
});

test("preserva unidade, fonte e cultura e informa o método da projeção", () => {
  const serie = montarSerieComProjecao(BASE, "soja");
  assert.equal(serie.cultura, "soja");
  assert.equal(serie.unidade, "saca 60kg");
  assert.equal(serie.fonte, "Cepea/Esalq (teste)");
  assert.match(serie.metodoProjecao, /últimos 3 meses/);
  assert.match(serie.metodoProjecao, /log-linear/);
  assert.match(serie.metodoProjecao, /média móvel/);
});

test("histórico curto (menos de um ano) projeta o nível atual, sem tendência nem sazonalidade", () => {
  const serie = montarSerieComProjecao(BASE, "soja");
  assert.equal(serie.tendenciaAnual, 0);
  serie.projecao.forEach((ponto) => assert.equal(ponto.preco, 141.7));
});

test("histórico vazio não gera projeção", () => {
  const serie = montarSerieComProjecao(baseCom([]), "cafe");
  assert.deepEqual(serie.projecao, []);
  assert.equal(serie.tendenciaAnual, 0);
});

test("mediasMensais agrupa por mês, tira a média e ordena", () => {
  const mensais = mediasMensais([
    { data: "2026-02-10", preco: 30 },
    { data: "2026-01-05", preco: 10 },
    { data: "2026-01-20", preco: 20 },
  ]);
  assert.deepEqual(mensais, [
    { ano: 2026, mes: 1, preco: 15 },
    { ano: 2026, mes: 2, preco: 30 },
  ]);
});

test("fatoresSazonais recupera o padrão de cada mês em série sem tendência", () => {
  const mensais = mediasMensais(serieMensal(2015, 60, (_, mes) => 200 * SAZONAL[mes - 1]));
  const fatores = fatoresSazonais(mensais);
  fatores.forEach((fator, i) => assert.ok(Math.abs(fator - SAZONAL[i] / MEDIA_SAZONAL) < 1e-9));
});

test("fatoresSazonais têm média 1", () => {
  const mensais = mediasMensais(serieMensal(2015, 60, (i, mes) => 100 * 1.01 ** i * SAZONAL[mes - 1]));
  const fatores = fatoresSazonais(mensais);
  const mediaFatores = fatores.reduce((a, b) => a + b, 0) / 12;
  assert.ok(Math.abs(mediaFatores - 1) < 1e-12);
});

test("fatoresSazonais devolvem 1 quando algum mês não tem janela de 12 meses completa", () => {
  const mensais = mediasMensais(serieMensal(2025, 20, (_, mes) => 100 * SAZONAL[mes - 1]));
  assert.deepEqual(fatoresSazonais(mensais), Array(12).fill(1));
});

test("taxaAnualDeTendencia recupera crescimento exponencial constante", () => {
  const niveis = [2020, 2021, 2022, 2023].map((ano, i) => ({ ano, nivel: 100 * 1.1 ** i }));
  assert.ok(Math.abs(taxaAnualDeTendencia(niveis) - 0.1) < 1e-12);
});

test("taxaAnualDeTendencia é zero com um único ano", () => {
  assert.equal(taxaAnualDeTendencia([{ ano: 2026, nivel: 100 }, { ano: 2026, nivel: 120 }]), 0);
});

test("projeção continua a tendência e a sazonalidade de uma série sintética conhecida", () => {
  // 10% ao ano, mês a mês, com sazonalidade; dados de jan/2016 a dez/2026.
  const preco = (i, mes) => 100 * 1.1 ** (i / 12) * SAZONAL[mes - 1];
  const serie = montarSerieComProjecao(baseCom(serieMensal(2016, 132, preco)), "cafe");

  assert.ok(Math.abs(serie.tendenciaAnual - 0.1) < 0.002);
  serie.projecao.forEach((ponto, k) => {
    const esperado = preco(132 + k, (k % 12) + 1);
    assert.ok(Math.abs(ponto.preco / esperado - 1) < 0.01, `${ponto.data}: ${ponto.preco} x ${esperado}`);
  });
});

test("projeção parte do nível recente, não da média do histórico", () => {
  // Preço estável em 100 por dez anos e salto para 200 nos três últimos meses de 2026.
  const preco = (i) => (i >= 129 ? 200 : 100);
  const serie = montarSerieComProjecao(baseCom(serieMensal(2016, 132, preco)), "cafe");
  const janeiro = serie.projecao[0].preco;
  assert.ok(janeiro > 190 && janeiro < 230, `jan/2027 projetado em ${janeiro}`);
});
