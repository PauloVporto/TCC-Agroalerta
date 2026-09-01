const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const { buscarClimaAtual } = require("./weather");
const { buscarContextoMercado } = require("./marketQuotes");
const {
  NOMES_CULTURA,
  montarContextoLlm,
  promptAnaliseMercado,
  promptProjecaoMercado,
  chamarClaudeComBusca,
  temChaveLlm,
} = require("./llm");

const mercadoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "mercado.json"), "utf-8")
);

const NOTICIAS_CURADAS_FALLBACK = {
  cafe: [
    "Mercado interno: referência Cepea para arábica no Brasil, em R$/saca 60 kg.",
    "Internacional: contrato ICE Nova York (KC) e paridade convertida pelo PTAX.",
    "Câmbio e estoques mundiais de arábica pesam no prêmio/desconto do café brasileiro.",
  ],
  soja: [
    "Mercado interno: saca em reais no Brasil, influenciada por prêmio de porto e frete.",
    "Internacional: CBOT Chicago; China segue como principal demanda de exportação.",
    "PTAX define a paridade de exportação que o produtor compara com o preço local.",
  ],
  milho: [
    "Mercado interno: safrinha e etanol de milho pressionam ou sustentam o preço no Brasil.",
    "Internacional: CBOT; exportação brasileira compete com EUA e Ucrânia.",
    "Paridade cambial ajuda a decidir se vale vender no mercado interno ou exportar.",
  ],
  cana: [
    "Mercado interno: mix das usinas entre açúcar e etanol no Centro-Sul.",
    "Internacional: açúcar #11 na ICE; paridade em R$/saca 50 kg via PTAX.",
    "Câmbio e prêmio do cristal brasileiro definem a atratividade da exportação.",
  ],
  feijao: [
    "Feijão é mercado essencialmente interno (não há futuro líquido nas bolsas).",
    "Preço ao produtor no Brasil depende de safra, entressafra e demanda doméstica.",
    "Sem paridade internacional direta; o câmbio afeta só insumos importados.",
  ],
};

const SUL_DE_MINAS = { latitude: -22.2461, longitude: -45.7008 };

function serieInterna(cultura) {
  return mercadoData[cultura] || null;
}

function resumoSerie(historico) {
  const ultimosPrecos = historico.historico.slice(-14);
  const precoAtual = ultimosPrecos[ultimosPrecos.length - 1].preco;
  const precoInicio = ultimosPrecos[0].preco;
  const variacaoPercentual = (((precoAtual - precoInicio) / precoInicio) * 100).toFixed(1);
  return {
    precoAtual,
    unidade: historico.unidade,
    variacaoPercentual,
  };
}

async function obterHistorico(cultura) {
  const base = serieInterna(cultura);
  if (!base) return null;

  const mercado = await buscarContextoMercado(cultura);
  return {
    ...base,
    mercado: "brasil",
    fonteAoVivo: mercado.fonteMercado,
    mercadoInterno: {
      nome: "Mercado interno Brasil",
      unidade: base.unidade,
      fonte: base.fonte,
      historico: base.historico,
    },
    internacional: mercado.internacional
      ? {
          ticker: mercado.internacional.ticker,
          nome: mercado.internacional.nome,
          bolsa: mercado.internacional.bolsa,
          preco: mercado.internacional.preco,
          unidade: mercado.internacional.unidade,
          data: mercado.internacional.data,
          moeda: mercado.internacional.moeda,
          fonte: mercado.internacional.fonte,
          historico: mercado.internacional.historico,
        }
      : null,
    paridade: mercado.paridade
      ? {
          nome: mercado.paridade.nome,
          preco: mercado.paridade.preco,
          unidade: mercado.paridade.unidade,
          data: mercado.paridade.data,
          fonte: mercado.paridade.fonte,
          historico: mercado.paridade.historico,
        }
      : null,
    cotacaoAoVivo: mercado.internacional
      ? {
          ticker: mercado.internacional.ticker,
          nome: mercado.internacional.nome,
          preco: mercado.internacional.preco,
          unidade: mercado.internacional.unidade,
          data: mercado.internacional.data,
          moeda: mercado.internacional.moeda,
          fonte: mercado.internacional.fonte,
        }
      : null,
    dolarPtax: mercado.dolar,
    icBrAgro: mercado.icBrAgro,
  };
}

async function persistirAnalise(analise) {
  try {
    await pool.query(
      `INSERT INTO analises_ia (cultura, resumo, gerar_por, fontes, contexto)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        analise.cultura,
        analise.resumo,
        analise.gerarPor,
        JSON.stringify(analise.fontes || []),
        JSON.stringify({
          clima: analise.climaUsado,
          internacional: analise.internacional,
          paridade: analise.paridade,
          dolarPtax: analise.dolarPtax,
          icBrAgro: analise.icBrAgro,
        }),
      ]
    );
  } catch (erro) {
    console.error("[market] Não foi possível persistir análise:", erro.message);
  }
}

async function gerarAnaliseTendencia(cultura) {
  const historico = serieInterna(cultura);
  if (!historico) {
    throw new Error("Cultura não suportada para análise de mercado: " + cultura);
  }

  const interno = resumoSerie(historico);
  const [clima, mercado] = await Promise.all([
    buscarClimaAtual(SUL_DE_MINAS.latitude, SUL_DE_MINAS.longitude),
    buscarContextoMercado(cultura),
  ]);

  const contexto = montarContextoLlm({
    cultura,
    clima,
    mercado,
    historicoInterno: interno,
  });

  if (!temChaveLlm()) {
    const simulada = gerarAnaliseSimulada(
      cultura,
      interno.variacaoPercentual,
      interno.precoAtual,
      NOTICIAS_CURADAS_FALLBACK[cultura] || [],
      { clima, mercado, contexto }
    );
    await persistirAnalise(simulada);
    return simulada;
  }

  try {
    const { texto, fontes } = await chamarClaudeComBusca(promptAnaliseMercado(contexto));
    const analise = {
      cultura,
      variacaoPercentual: Number(interno.variacaoPercentual),
      precoAtual: interno.precoAtual,
      unidade: historico.unidade,
      resumo: texto || "Não foi possível gerar a análise a partir da busca. Tente novamente.",
      fontes,
      fatoresConsiderados:
        fontes.length > 0 ? fontes.map((f) => f.titulo) : NOTICIAS_CURADAS_FALLBACK[cultura] || [],
      gerarPor: "ia_clima_mercado",
      geradoEm: new Date().toISOString(),
      contextoLlm: contexto,
      climaUsado: clima,
      cotacaoAoVivo: mercado.internacional,
      internacional: mercado.internacional,
      paridade: mercado.paridade,
      dolarPtax: mercado.dolar,
      icBrAgro: mercado.icBrAgro,
    };
    await persistirAnalise(analise);
    return analise;
  } catch (erro) {
    console.error("[market] Falha ao gerar análise via IA, usando fallback simulado:", erro.message);
    const simulada = gerarAnaliseSimulada(
      cultura,
      interno.variacaoPercentual,
      interno.precoAtual,
      NOTICIAS_CURADAS_FALLBACK[cultura] || [],
      { clima, mercado, contexto }
    );
    await persistirAnalise(simulada);
    return simulada;
  }
}

function gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, noticias, extras = {}) {
  const tendencia = Number(variacaoPercentual) >= 0 ? "alta" : "queda";
  const resumo =
    "Nas últimas duas semanas, o preço de " +
    (NOMES_CULTURA[cultura] || cultura) +
    " apresentou tendência de " +
    tendencia +
    " (" +
    variacaoPercentual +
    "%). O LLM está em modo simulado; o contexto climático e de mercado já foi montado para a banca (veja contextoLlm).";

  return {
    cultura,
    variacaoPercentual: Number(variacaoPercentual),
    precoAtual,
    unidade: mercadoData[cultura].unidade,
    resumo,
    fontes: [],
    fatoresConsiderados: noticias,
    gerarPor: "simulado",
    geradoEm: new Date().toISOString(),
    contextoLlm: extras.contexto || "",
    climaUsado: extras.clima || null,
    cotacaoAoVivo: extras.mercado ? extras.mercado.internacional : null,
    internacional: extras.mercado ? extras.mercado.internacional : null,
    paridade: extras.mercado ? extras.mercado.paridade : null,
    dolarPtax: extras.mercado ? extras.mercado.dolar : null,
    icBrAgro: extras.mercado ? extras.mercado.icBrAgro : null,
  };
}

function adicionarDias(iso, dias) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function projetarPontos(historico, horizontes = [30, 60, 90]) {
  const janela = (historico || []).slice(-30);
  if (janela.length < 5) return [];
  const n = janela.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  janela.forEach((p, i) => {
    sumX += i;
    sumY += p.preco;
    sumXY += i * p.preco;
    sumXX += i * i;
  });
  const den = n * sumXX - sumX * sumX;
  const b = den === 0 ? 0 : (n * sumXY - sumX * sumY) / den;
  const a = (sumY - b * sumX) / n;
  const ultimo = janela[n - 1];
  return horizontes.map((dias) => ({
    data: adicionarDias(ultimo.data, dias),
    horizonteDias: dias,
    preco: Number(Math.max(0, a + b * (n - 1 + dias)).toFixed(2)),
    tipo: "projecao",
  }));
}

async function gerarProjecao(cultura) {
  const historico = await obterHistorico(cultura);
  if (!historico) throw new Error("Cultura não suportada: " + cultura);
  const interno = resumoSerie(serieInterna(cultura));
  const pontos = projetarPontos(historico.historico);
  const ancora = historico.paridade || historico.internacional;
  const contexto = montarContextoLlm({
    cultura,
    clima: await buscarClimaAtual(SUL_DE_MINAS.latitude, SUL_DE_MINAS.longitude),
    mercado: {
      dolar: historico.dolarPtax,
      internacional: historico.internacional,
      paridade: historico.paridade,
      icBrAgro: historico.icBrAgro,
    },
    historicoInterno: interno,
  });

  let resumo;
  let gerarPor = "simulado";
  let fontes = [];
  if (temChaveLlm()) {
    try {
      const out = await chamarClaudeComBusca(promptProjecaoMercado(contexto, pontos), 500);
      resumo = out.texto;
      fontes = out.fontes;
      gerarPor = "ia_projecao";
    } catch (erro) {
      console.error("[market] Projeção IA falhou:", erro.message);
    }
  }
  if (!resumo) {
    const d30 = pontos.find((p) => p.horizonteDias === 30);
    resumo =
      "Projeção estatística do mercado interno (últimos 30 pregões) aponta R$ " +
      (d30 ? d30.preco.toFixed(2) : interno.precoAtual) +
      " em 30 dias. " +
      (ancora
        ? "A âncora internacional/paridade está em " +
          (historico.paridade ? "R$ " + historico.paridade.preco : historico.internacional.preco + " " + historico.internacional.unidade) +
          "."
        : "Sem contrato internacional; a projeção usa só o mercado interno.") +
      " Use como cenário, não como garantia de preço.";
  }

  return {
    cultura,
    unidade: historico.unidade,
    precoAtual: interno.precoAtual,
    pontos,
    ancora,
    resumo,
    gerarPor,
    fontes,
    geradoEm: new Date().toISOString(),
  };
}

async function obterContextoIntegracao(cultura) {
  const historico = await obterHistorico(cultura);
  if (!historico) throw new Error("Cultura não suportada: " + cultura);
  const interno = resumoSerie(serieInterna(cultura));
  const clima = await buscarClimaAtual(SUL_DE_MINAS.latitude, SUL_DE_MINAS.longitude);
  const mercado = {
    dolar: historico.dolarPtax,
    internacional: historico.internacional,
    cotacaoAoVivo: historico.internacional,
    paridade: historico.paridade,
    icBrAgro: historico.icBrAgro,
  };
  return {
    cultura,
    contextoLlm: montarContextoLlm({ cultura, clima, mercado, historicoInterno: interno }),
    clima,
    mercado,
  };
}

module.exports = {
  obterHistorico,
  gerarAnaliseTendencia,
  gerarProjecao,
  projetarPontos,
  obterContextoIntegracao,
  chamarClaudeComBusca,
  resumoMercadoInterno: (cultura) => {
    const base = serieInterna(cultura);
    return base ? resumoSerie(base) : null;
  },
};
