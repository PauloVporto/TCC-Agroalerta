/**
 * Mercado interno: série mensal contínua 2010–2026
 * + projeção mensal 2027–2028 (baseline estatístico; IA pode refinar no market.js).
 *
 * Os pontos diários de mercado.json (mar–ago/2026) viram médias mensais
 * e preenchem/calibram a série; demais meses são sintéticos calibrados.
 */

const ANO_INICIO = 2010;
const ANO_HISTORICO_FIM = 2026;
const ANOS_PROJECAO = [2027, 2028];
const ANO_PROJECAO = ANOS_PROJECAO[0];
const ANO_PROJECAO_FIM = ANOS_PROJECAO[ANOS_PROJECAO.length - 1];

/** Preço médio de referência em 2010 (R$) — ordem de grandeza Cepea/Conab */
const PERFIL_CULTURA = {
  cafe: { preco2010: 420, ciclo: 5.5, vol: 0.11 },
  soja: { preco2010: 58, ciclo: 4.8, vol: 0.1 },
  milho: { preco2010: 32, ciclo: 4.5, vol: 0.12 },
  cana: { preco2010: 78, ciclo: 6.0, vol: 0.08 },
  feijao: { preco2010: 95, ciclo: 4.2, vol: 0.13 },
};

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function isoMes(ano, mes) {
  return ano + "-" + String(mes).padStart(2, "0") + "-15";
}

function chaveMes(iso) {
  return String(iso || "").slice(0, 7);
}

function gerarMensalSintetico(cultura, precoAlvoFim, ateAno, ateMes) {
  const perfil = PERFIL_CULTURA[cultura] || { preco2010: 100, ciclo: 5, vol: 0.1 };
  const seed = hashString(cultura);
  const mensal = [];
  const totalMeses = (ateAno - ANO_INICIO) * 12 + ateMes;
  const taxaMensal = Math.pow(precoAlvoFim / perfil.preco2010, 1 / Math.max(totalMeses, 1));

  let mesIdx = 0;
  for (let ano = ANO_INICIO; ano <= ateAno; ano++) {
    const limiteMes = ano === ateAno ? ateMes : 12;
    for (let mes = 1; mes <= limiteMes; mes++) {
      const sazonal = 1 + Math.sin((mes / 12) * Math.PI * 2 + seed * 0.1) * 0.045;
      const ciclo = 1 + Math.sin((mesIdx / perfil.ciclo) * Math.PI * 2 + seed) * perfil.vol;
      const choque = 1 + Math.sin(mesIdx * 0.35 + seed * 1.3) * 0.025;
      const tendencia = perfil.preco2010 * Math.pow(taxaMensal, mesIdx);
      const preco = tendencia * sazonal * ciclo * choque;

      mensal.push({
        data: isoMes(ano, mes),
        preco: Number(Math.max(preco, perfil.preco2010 * 0.55).toFixed(2)),
        tipo: "historico",
        granularidade: "mensal",
        origem: "sintetico-calibrado",
      });
      mesIdx++;
    }
  }
  return mensal;
}

/** Agrupa pontos diários (ou mistos) em média mensal */
function mediasMensaisDePontos(pontos) {
  const porMes = {};
  for (const p of pontos || []) {
    const key = chaveMes(p.data);
    if (!key || key.length < 7) continue;
    if (!porMes[key]) porMes[key] = [];
    porMes[key].push(Number(p.preco));
  }
  const out = {};
  for (const [key, precos] of Object.entries(porMes)) {
    out[key] = Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2));
  }
  return out;
}

/**
 * Série mensal contínua 2010-01 … 2026-12.
 * Meses com dados em mercado.json usam a média real/calibrada; demais são sintéticos.
 */
function montarHistoricoMensalCompleto(historicoReal, cultura) {
  const mediasReais = mediasMensaisDePontos(historicoReal);
  const precosReais = Object.values(mediasReais);
  const precoAlvo =
    precosReais.length > 0
      ? precosReais.reduce((a, b) => a + b, 0) / precosReais.length
      : (PERFIL_CULTURA[cultura] || { preco2010: 100 }).preco2010 * 2.2;

  const base = gerarMensalSintetico(cultura, precoAlvo, ANO_HISTORICO_FIM, 12);

  // Suaviza transição nos 3 meses antes do primeiro mês “real”
  const chavesReais = Object.keys(mediasReais).sort();
  const primeiroReal = chavesReais[0];
  let idxPrimeiro = primeiroReal ? base.findIndex((p) => chaveMes(p.data) === primeiroReal) : -1;
  if (idxPrimeiro < 0) idxPrimeiro = base.length;

  const janela = 3;
  return base.map((p, i) => {
    const key = chaveMes(p.data);
    if (mediasReais[key] != null) {
      return {
        ...p,
        preco: mediasReais[key],
        origem: "cepea-ref",
      };
    }
    if (primeiroReal && i >= idxPrimeiro - janela && i < idxPrimeiro) {
      const w = (i - (idxPrimeiro - janela) + 1) / janela;
      const alvo = mediasReais[primeiroReal];
      return {
        ...p,
        preco: Number((p.preco * (1 - w) + alvo * w).toFixed(2)),
        origem: "sintetico-calibrado",
      };
    }
    return p;
  });
}

/** @deprecated alias — mantém compatibilidade */
function estenderHistorico(historicoReal, cultura) {
  return montarHistoricoMensalCompleto(historicoReal, cultura);
}

function agregarAnual(historico) {
  const porAno = {};
  for (const p of historico || []) {
    if (p.tipo === "projecao") continue;
    const ano = p.data.slice(0, 4);
    if (!porAno[ano]) porAno[ano] = [];
    porAno[ano].push(p.preco);
  }

  return Object.entries(porAno)
    .map(([ano, precos]) => ({
      ano: Number(ano),
      data: ano + "-12-15",
      preco: Number((precos.reduce((a, b) => a + b, 0) / precos.length).toFixed(2)),
      tipo: "historico",
      granularidade: "anual",
    }))
    .sort((a, b) => a.ano - b.ano);
}

function regressaoLinear(pontos) {
  const n = pontos.length;
  if (n < 2) return { a: pontos[0]?.preco || 0, b: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  pontos.forEach((p, i) => {
    sumX += i;
    sumY += p.preco;
    sumXY += i * p.preco;
    sumXX += i * i;
  });
  const den = n * sumXX - sumX * sumX;
  const b = den === 0 ? 0 : (n * sumXY - sumX * sumY) / den;
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

function fatorSazonalMes(cultura, mes, ano) {
  const seed = hashString(cultura + String(ano));
  return 1 + Math.sin((mes / 12) * Math.PI * 2 + seed * 0.2) * 0.035;
}

function projetarAnos(historico, cultura, anos = ANOS_PROJECAO) {
  const anualHist = agregarAnual(historico).filter((p) => p.ano >= 2018);
  const { a, b } = regressaoLinear(anualHist);

  const mensal = [];
  const trimestres = [];
  const anuais = [];
  const porAno = {};

  anos.forEach((ano, idxAno) => {
    // Índice além da amostra histórica: 2027 = length, 2028 = length+1
    let precoAnualBase = Math.max(0, a + b * (anualHist.length + idxAno));
    // Suaviza crescimento extremo no 2º ano de projeção
    if (idxAno > 0 && anualHist.length) {
      const ultimo = anualHist[anualHist.length - 1].preco;
      const maxDelta = Math.abs(ultimo) * 0.18 * (idxAno + 1);
      const delta = precoAnualBase - ultimo;
      if (Math.abs(delta) > maxDelta) {
        precoAnualBase = ultimo + Math.sign(delta || 1) * maxDelta;
      }
    }

    const mesesAno = [];
    for (let mes = 1; mes <= 12; mes++) {
      const sazonal = fatorSazonalMes(cultura, mes, ano);
      const ponto = {
        data: isoMes(ano, mes),
        preco: Number((precoAnualBase * sazonal).toFixed(2)),
        tipo: "projecao",
        granularidade: "mensal",
        horizonteRotulo: ano + "-" + String(mes).padStart(2, "0"),
        ano,
        origem: "projecao-estatistica",
      };
      mesesAno.push(ponto);
      mensal.push(ponto);
    }

    porAno[ano] = mesesAno;

    [1, 4, 7, 10].forEach((mesIni, i) => {
      const fatia = mesesAno.slice(i * 3, i * 3 + 3);
      const media = fatia.reduce((s, p) => s + p.preco, 0) / fatia.length;
      trimestres.push({
        data: isoMes(ano, mesIni + 1),
        preco: Number(media.toFixed(2)),
        tipo: "projecao",
        granularidade: "trimestral",
        horizonteRotulo: "T" + (i + 1) + " " + ano,
        ano,
      });
    });

    anuais.push({
      ano,
      data: ano + "-12-15",
      preco: Number((mesesAno.reduce((s, p) => s + p.preco, 0) / mesesAno.length).toFixed(2)),
      tipo: "projecao",
      granularidade: "anual",
      horizonteRotulo: ano + " (projeção)",
    });
  });

  return {
    anuais,
    anual: anuais[0] || null,
    mensal,
    porAno,
    trimestres,
    anos,
  };
}

/** Compat: só 2027 */
function projetarAno2027(historico, cultura) {
  const full = projetarAnos(historico, cultura, [2027]);
  return {
    anual: full.anual,
    mensal: full.mensal,
    trimestres: full.trimestres,
  };
}

/**
 * Aplica ajustes percentuais/absolutos da IA sobre a baseline mensal.
 * aceita: { "2027-01": 1710, ... } ou { "2027-01": { "preco": 1710 } }
 * Limite: ±18% em relação à baseline.
 */
function aplicarAjustesMensaisIa(mensalBase, ajustes, origem = "projecao-ia") {
  if (!ajustes || typeof ajustes !== "object") return mensalBase;
  return mensalBase.map((p) => {
    const key = chaveMes(p.data);
    let novo = ajustes[key];
    if (novo == null) novo = ajustes[p.horizonteRotulo];
    if (novo != null && typeof novo === "object") novo = novo.preco ?? novo.valor;
    if (novo == null || !Number.isFinite(Number(novo))) return p;
    const alvo = Number(novo);
    const min = p.preco * 0.82;
    const max = p.preco * 1.18;
    const limitado = Math.min(max, Math.max(min, alvo));
    return {
      ...p,
      preco: Number(limitado.toFixed(2)),
      origem,
      baseline: p.preco,
    };
  });
}

function remontarAgregadosProjecao(mensal, anos = ANOS_PROJECAO) {
  const porAno = {};
  const trimestres = [];
  const anuais = [];
  for (const ano of anos) {
    const mesesAno = mensal.filter((p) => p.ano === ano || p.data.startsWith(String(ano)));
    porAno[ano] = mesesAno;
    [1, 4, 7, 10].forEach((mesIni, i) => {
      const fatia = mesesAno.slice(i * 3, i * 3 + 3);
      if (!fatia.length) return;
      const media = fatia.reduce((s, p) => s + p.preco, 0) / fatia.length;
      trimestres.push({
        data: isoMes(ano, mesIni + 1),
        preco: Number(media.toFixed(2)),
        tipo: "projecao",
        granularidade: "trimestral",
        horizonteRotulo: "T" + (i + 1) + " " + ano,
        ano,
      });
    });
    if (mesesAno.length) {
      anuais.push({
        ano,
        data: ano + "-12-15",
        preco: Number((mesesAno.reduce((s, p) => s + p.preco, 0) / mesesAno.length).toFixed(2)),
        tipo: "projecao",
        granularidade: "anual",
        horizonteRotulo: ano + " (projeção)",
      });
    }
  }
  return { porAno, trimestres, anuais, anual: anuais[0] || null, mensal, anos };
}

function montarSerieMercado(historicoReal, cultura) {
  const historico = montarHistoricoMensalCompleto(historicoReal, cultura);
  const historicoAnual = agregarAnual(historico);
  const projecao = projetarAnos(historico, cultura, ANOS_PROJECAO);

  const anos = [];
  for (let a = ANO_PROJECAO_FIM; a >= ANO_INICIO; a--) anos.push(String(a));

  return {
    historico,
    historicoAnual: [...historicoAnual, ...projecao.anuais],
    projecao2027: projecao.porAno[2027] || [],
    projecao2028: projecao.porAno[2028] || [],
    projecaoMensal: projecao.mensal,
    projecaoPorAno: projecao.porAno,
    projecaoTrimestres: projecao.trimestres,
    projecaoTrimestres2027: (projecao.trimestres || []).filter((t) => t.ano === 2027),
    anosDisponiveis: anos,
    anosProjecao: ANOS_PROJECAO,
    anoInicio: ANO_INICIO,
    anoHistoricoFim: ANO_HISTORICO_FIM,
    anoProjecao: ANO_PROJECAO,
    anoProjecaoFim: ANO_PROJECAO_FIM,
  };
}

function anosDoHistorico(historico) {
  return [...new Set((historico || []).map((p) => p.data.slice(0, 4)))].sort((a, b) => Number(b) - Number(a));
}

module.exports = {
  ANO_INICIO,
  ANO_HISTORICO_FIM,
  ANO_PROJECAO,
  ANO_PROJECAO_FIM,
  ANOS_PROJECAO,
  estenderHistorico,
  montarHistoricoMensalCompleto,
  agregarAnual,
  projetarAno2027,
  projetarAnos,
  aplicarAjustesMensaisIa,
  remontarAgregadosProjecao,
  montarSerieMercado,
  anosDoHistorico,
  mediasMensaisDePontos,
};
