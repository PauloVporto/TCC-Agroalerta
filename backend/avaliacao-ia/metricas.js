/**
 * Funções puras de pontuação da avaliação de assertividade (sem rede, sem API).
 */
const { tipoDoAlerta, nivelGeralDosAlertas } = require("../services/climaIA");
const { resumirSerie, LIMIAR_TENDENCIA_PCT } = require("../services/market");

const CRITERIOS = ["coerencia", "clareza", "relevancia", "ausenciaInvencao", "consistencia"];
const LIMITE_MEDIA_SATISFATORIO = 4.0;
const LIMITE_NOTA_MINIMA = 3;

const arred = (v, c = 2) => (v == null || Number.isNaN(v) ? null : Number(v.toFixed(c)));
const soma = (a) => a.reduce((s, v) => s + v, 0);

function media(valores) {
  const v = valores.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return v.length ? soma(v) / v.length : null;
}

// Desvio-padrão amostral.
function desvio(valores) {
  const v = valores.filter((x) => typeof x === "number" && !Number.isNaN(x));
  if (v.length < 2) return 0;
  const m = media(v);
  return Math.sqrt(soma(v.map((x) => (x - m) ** 2)) / (v.length - 1));
}

// Intervalo de confiança de Wilson (95% por padrão) para uma proporção k/n.
function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, inf: null, sup: null };
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centro = (p + (z * z) / (2 * n)) / den;
  const margem = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { p, inf: Math.max(0, centro - margem), sup: Math.min(1, centro + margem) };
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
}

// ── Números citados × números permitidos ─────────────────────────────────────

// Cada token numérico vira uma lista de interpretações possíveis (1.730 pode ser 1730 ou 1,73).
function extrairNumeros(texto) {
  const tokens = String(texto || "").match(/\d+(?:[.,]\d+)*/g) || [];
  return tokens.map((token) => {
    const temPonto = token.includes("."), temVirgula = token.includes(",");
    let candidatos;
    if (temPonto && temVirgula) {
      const decimal = token.lastIndexOf(",") > token.lastIndexOf(".") ? "," : ".";
      const milhar = decimal === "," ? "." : ",";
      candidatos = [Number(token.split(milhar).join("").replace(decimal, "."))];
    } else if (temVirgula) {
      candidatos = /^\d{1,3}(,\d{3})+$/.test(token)
        ? [Number(token.replace(/,/g, "")), Number(token.replace(",", "."))]
        : [Number(token.replace(",", "."))];
    } else if (temPonto) {
      candidatos = /^\d{1,3}(\.\d{3})+$/.test(token)
        ? [Number(token.replace(/\./g, "")), Number(token)]
        : [Number(token)];
    } else {
      candidatos = [Number(token)];
    }
    return { token, candidatos: candidatos.filter((n) => Number.isFinite(n)) };
  });
}

function bate(a, b) {
  return Math.abs(a - b) <= Math.max(0.06, Math.abs(b) * 0.002);
}

function conjuntoPermitido(contexto, extras = []) {
  const doContexto = extrairNumeros(contexto).flatMap((t) => t.candidatos);
  return [...doContexto, ...extras.filter((n) => Number.isFinite(n))].flatMap((n) => [n, Math.abs(n)]);
}

// Tokens do texto que não correspondem a nenhum número do contexto (nem a derivados informados).
function numerosSuspeitos(texto, permitidos) {
  return extrairNumeros(texto)
    .filter((t) => !t.candidatos.some((c) => permitidos.some((p) => bate(c, p))))
    .map((t) => t.token);
}

// Valores que um analista pode calcular legitimamente a partir da série (variações, amplitudes).
function derivadosMercado(serie) {
  const r = resumirSerie(serie);
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const d = [
    r.precoInicio, r.precoFim, r.minimo.preco, r.maximo.preco, r.variacaoPercentual,
    r.precoFim - r.precoInicio, r.maximo.preco - r.minimo.preco,
    pct(r.maximo.preco, r.minimo.preco), pct(r.precoFim, r.minimo.preco), pct(r.precoFim, r.maximo.preco),
    pct(r.minimo.preco, r.precoInicio), pct(r.maximo.preco, r.precoInicio), pct(r.precoFim, r.precoInicio),
    LIMIAR_TENDENCIA_PCT,
  ];
  return d.filter((x) => x != null);
}

// ── Pontuação objetiva ───────────────────────────────────────────────────────

function riscosEsperados(alertas) {
  return (alertas || []).map((a) => ({ tipo: tipoDoAlerta(a.id), nivel: a.nivel })).filter((r) => r.tipo);
}

function objetivoClima({ alertas, analise }) {
  const esperados = riscosEsperados(alertas);
  const tiposEsperados = [...new Set(esperados.map((r) => r.tipo))];
  const nivelEsperado = nivelGeralDosAlertas(alertas);
  if (!analise) {
    return { formatoValido: false, nivelCorreto: false, tp: 0, fp: 0, fn: tiposEsperados.length, riscosExatos: false, niveisCorretos: 0, tiposIA: [] };
  }
  const tiposIA = [...new Set(analise.riscos.map((r) => r.tipo))];
  const tp = tiposIA.filter((t) => tiposEsperados.includes(t));
  const niveisCorretos = tp.filter((t) => {
    const esp = esperados.find((r) => r.tipo === t);
    const ia = analise.riscos.find((r) => r.tipo === t);
    return esp && ia && esp.nivel === ia.nivel;
  }).length;
  return {
    formatoValido: true,
    nivelCorreto: analise.nivelGeral === nivelEsperado,
    tp: tp.length,
    fp: tiposIA.length - tp.length,
    fn: tiposEsperados.length - tp.length,
    riscosExatos: jaccard(tiposIA, tiposEsperados) === 1,
    niveisCorretos,
    tiposIA,
  };
}

function objetivoMercado({ esperado, tendencia, formatoValido }) {
  return { formatoValido: Boolean(formatoValido), tendenciaCorreta: Boolean(formatoValido) && tendencia === esperado.tendencia, tendenciaIA: formatoValido ? tendencia : null };
}

// Concordância entre duas execuções do mesmo cenário, em [0, 1].
function concordanciaClima(a, b) {
  if (!a || !b) return 0;
  return 0.5 * (a.nivelGeral === b.nivelGeral ? 1 : 0) +
    0.5 * jaccard(a.riscos.map((r) => r.tipo), b.riscos.map((r) => r.tipo));
}

function concordanciaMercado(a, b) {
  return a && b && a === b ? 1 : 0;
}

const notaConsistencia = (concordancia) => arred(1 + 4 * concordancia);

function satisfatorio(notas) {
  const v = CRITERIOS.map((c) => notas[c]);
  if (v.some((x) => typeof x !== "number")) return false;
  return media(v) >= LIMITE_MEDIA_SATISFATORIO && Math.min(...v) >= LIMITE_NOTA_MINIMA;
}

// Proveniência: só conta como resposta do Claude quem tem identificadores devolvidos pela API.
function origemComprovada({ requestId, respostaId, modelo } = {}) {
  return /^req_/.test(requestId || "") && /^msg_/.test(respostaId || "") && typeof modelo === "string" && modelo.length > 0;
}

// ── Agregação por módulo ─────────────────────────────────────────────────────

function resumirModulo(cenarios) {
  const n = cenarios.length;
  const criterios = {};
  for (const c of CRITERIOS) {
    const v = cenarios.map((x) => x.notas[c]);
    criterios[c] = {
      media: arred(media(v)),
      desvio: arred(desvio(v)),
      pctNota4ouMais: arred((v.filter((x) => x >= 4).length / (n || 1)) * 100, 1),
    };
  }
  const k = cenarios.filter((x) => x.satisfatorio).length;
  const w = wilson(k, n);
  return {
    n,
    criterios,
    mediaGeral: arred(media(CRITERIOS.map((c) => criterios[c].media))),
    satisfatorios: { k, n, pct: arred((w.p ?? 0) * 100, 1), ic95: [arred((w.inf ?? 0) * 100, 1), arred((w.sup ?? 0) * 100, 1)] },
  };
}

function resumirObjetivoClima(respostas) {
  const n = respostas.length;
  const tp = soma(respostas.map((r) => r.objetivo.tp));
  const fp = soma(respostas.map((r) => r.objetivo.fp));
  const fn = soma(respostas.map((r) => r.objetivo.fn));
  const pct = (k) => arred((k / (n || 1)) * 100, 1);
  return {
    respostas: n,
    jsonValidoPct: pct(respostas.filter((r) => r.objetivo.formatoValido).length),
    nivelGeralCorretoPct: pct(respostas.filter((r) => r.objetivo.nivelCorreto).length),
    conjuntoDeRiscosExatoPct: pct(respostas.filter((r) => r.objetivo.riscosExatos).length),
    precisaoRiscosPct: tp + fp ? arred((tp / (tp + fp)) * 100, 1) : null,
    recallRiscosPct: tp + fn ? arred((tp / (tp + fn)) * 100, 1) : null,
    comFalsoAlarmePct: pct(respostas.filter((r) => r.objetivo.fp > 0).length),
    comNumeroForaDoContextoPct: pct(respostas.filter((r) => r.numerosSuspeitos.length > 0).length),
  };
}

function resumirObjetivoMercado(respostas) {
  const n = respostas.length;
  const pct = (k) => arred((k / (n || 1)) * 100, 1);
  const matriz = {};
  for (const r of respostas) {
    const esp = r.esperado.tendencia, prev = r.objetivo.tendenciaIA || "sem_formato";
    matriz[esp] = matriz[esp] || {};
    matriz[esp][prev] = (matriz[esp][prev] || 0) + 1;
  }
  return {
    respostas: n,
    jsonValidoPct: pct(respostas.filter((r) => r.objetivo.formatoValido).length),
    tendenciaCorretaPct: pct(respostas.filter((r) => r.objetivo.tendenciaCorreta).length),
    comNumeroForaDoContextoPct: pct(respostas.filter((r) => r.numerosSuspeitos.length > 0).length),
    matrizConfusao: matriz,
  };
}

// ── Percentuais finais (assertividade) ───────────────────────────────────────

function respostasValidas(cenarios) {
  return cenarios.filter((c) => !c.excluido).flatMap((c) => c.execucoes.filter((e) => !e.excluida));
}

const intervalo = (k, n) => {
  const w = wilson(k, n);
  return { k, n, pct: arred((w.p ?? 0) * 100, 1), ic95: [arred((w.inf ?? 0) * 100, 1), arred((w.sup ?? 0) * 100, 1)] };
};

/**
 * Percentuais finais a partir dos registros por cenário (respostas.json).
 *  - índice de assertividade = média das 5 notas ÷ 5 (por módulo; geral ponderado pelo nº de cenários);
 *  - acerto objetivo = respostas corretas ÷ respostas contra o gabarito
 *    (clima: nível geral E conjunto de riscos idênticos; mercado: tendência);
 *  - satisfatórias = cenários com média ≥ 4,0 e nenhum critério < 3.
 */
function calcularAssertividade({ clima = [], mercado = [] }) {
  const modulos = {};
  for (const [nome, lista] of [["clima", clima], ["mercado", mercado]]) {
    const incluidos = lista.filter((c) => !c.excluido);
    if (!incluidos.length) continue;
    const resumo = resumirModulo(incluidos);
    const respostas = respostasValidas(lista);
    const acertos = respostas.filter((e) => (nome === "clima" ? e.objetivo.nivelCorreto && e.objetivo.riscosExatos : e.objetivo.tendenciaCorreta)).length;
    modulos[nome] = {
      cenarios: incluidos.length,
      respostas: respostas.length,
      excluidos: lista.length - incluidos.length,
      mediaGeral: resumo.mediaGeral,
      indice: arred((resumo.mediaGeral / 5) * 100, 1),
      criterios: resumo.criterios,
      acertoObjetivo: intervalo(acertos, respostas.length),
      satisfatorios: resumo.satisfatorios,
    };
  }
  const lista = Object.values(modulos);
  const cenarios = soma(lista.map((m) => m.cenarios));
  const geral = {
    cenarios,
    respostas: soma(lista.map((m) => m.respostas)),
    indice: cenarios ? arred(soma(lista.map((m) => m.indice * m.cenarios)) / cenarios, 1) : null,
    acertoObjetivo: intervalo(soma(lista.map((m) => m.acertoObjetivo.k)), soma(lista.map((m) => m.acertoObjetivo.n))),
    satisfatorios: intervalo(soma(lista.map((m) => m.satisfatorios.k)), soma(lista.map((m) => m.satisfatorios.n))),
  };
  return { modulos, geral };
}

module.exports = {
  calcularAssertividade,
  CRITERIOS, LIMITE_MEDIA_SATISFATORIO, LIMITE_NOTA_MINIMA,
  arred, media, desvio, wilson, jaccard,
  extrairNumeros, conjuntoPermitido, numerosSuspeitos, derivadosMercado,
  objetivoClima, objetivoMercado, concordanciaClima, concordanciaMercado, notaConsistencia,
  satisfatorio, origemComprovada, resumirModulo, resumirObjetivoClima, resumirObjetivoMercado,
};
