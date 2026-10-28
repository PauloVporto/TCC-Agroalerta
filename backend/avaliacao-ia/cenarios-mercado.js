/**
 * 30 cenários de mercado (15 café, 15 soja): séries de 14 observações diárias geradas com
 * PRNG de semente fixa (reprodutíveis). O gabarito é a regra única de services/market.js
 * (classificarTendencia sobre a variação líquida: alta ≥ +2%, queda ≤ −2%, estável entre os dois).
 * O primeiro e o último ponto são fixados, então a variação líquida é a pretendida; só os
 * pontos intermediários recebem ruído. As variações ficam a pelo menos 1 p.p. do limiar.
 */
const { classificarTendencia, resumirSerie } = require("../services/market");

const N = 14;

function mulberry32(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function datas() {
  return Array.from({ length: N }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 1 + i));
    return d.toISOString().slice(0, 10);
  });
}

// forma: pontos de controle em % sobre o preço inicial (interpolados linearmente ao longo de N pontos).
function gerarSerie({ inicio, controle, ruidoPct, semente }) {
  const rnd = mulberry32(semente);
  const passos = controle.length - 1;
  const valores = Array.from({ length: N }, (_, i) => {
    const pos = (i / (N - 1)) * passos;
    const k = Math.min(Math.floor(pos), passos - 1);
    const f = pos - k;
    return controle[k] + (controle[k + 1] - controle[k]) * f;
  });
  const dts = datas();
  return valores.map((pct, i) => {
    const intermediario = i > 0 && i < N - 1;
    const ruido = intermediario ? (rnd() - 0.5) * 2 * ruidoPct : 0;
    return { data: dts[i], preco: Number((inicio * (1 + (pct + ruido) / 100)).toFixed(2)) };
  });
}

// [sufixo, categoria, descrição, intenção, pontos de controle (%), ruído (%)]
const FORMAS = [
  ["01", "alta", "Alta forte e contínua (+9,5%)", "alta", [0, 9.5], 0.5],
  ["02", "alta", "Alta moderada (+5%)", "alta", [0, 5], 0.4],
  ["03", "alta", "Alta leve (+3,2%)", "alta", [0, 3.2], 0.3],
  ["04", "queda", "Queda forte e contínua (-8,5%)", "queda", [0, -8.5], 0.5],
  ["05", "queda", "Queda moderada (-4,5%)", "queda", [0, -4.5], 0.4],
  ["06", "queda", "Queda leve (-3,3%)", "queda", [0, -3.3], 0.3],
  ["07", "estavel", "Estável, leve alta de +0,4%", "estavel", [0, 0.4], 0.3],
  ["08", "estavel", "Estável, leve queda de -0,6%", "estavel", [0, -0.6], 0.3],
  ["09", "estavel", "Estável com variação líquida de +1,0%", "estavel", [0, 1.0], 0.25],
  ["10", "lateral_volatil", "Lateral com oscilações de ±3% e fechamento em +0,3%", "estavel", [0, 3, -3, 3, -3, 0.3], 0.3],
  ["11", "reversao", "Sobe até +6% no meio e devolve tudo, fechando em -5%", "queda", [0, 6, -5], 0.3],
  ["12", "reversao", "Cai até -6% no meio e recupera, fechando em +5%", "alta", [0, -6, 5], 0.3],
  ["13", "alta_com_realizacao", "Alta com realização no fim, fechando em +4%", "alta", [0, 7, 4], 0.3],
  ["14", "queda_com_repique", "Queda com repique no fim, fechando em -4%", "queda", [0, -7, -4], 0.3],
  ["15", "reversao_estavel", "Sobe até +7% e devolve, fechando em +0,8% (estável pela regra)", "estavel", [0, 7, 0.8], 0.3],
];

const CULTURAS = [
  { cultura: "cafe", prefixo: "MC", inicio: 1680, unidade: "saca 60kg (arábica)", semente: 1000 },
  { cultura: "soja", prefixo: "MS", inicio: 128, unidade: "saca 60kg", semente: 2000 },
];

const CENARIOS_MERCADO = CULTURAS.flatMap(({ cultura, prefixo, inicio, unidade, semente }) =>
  FORMAS.map(([sufixo, categoria, descricao, intencao, controle, ruidoPct]) => {
    const serie = gerarSerie({ inicio, controle, ruidoPct, semente: semente + Number(sufixo) });
    const resumo = resumirSerie(serie);
    return {
      id: prefixo + sufixo,
      modulo: "mercado",
      categoria,
      descricao,
      cultura,
      entrada: { cultura, unidade, serie },
      intencao: { tendencia: intencao },
      esperado: { tendencia: classificarTendencia(resumo.variacaoPercentual), variacaoPercentual: resumo.variacaoPercentual },
    };
  })
);

module.exports = { CENARIOS_MERCADO };
