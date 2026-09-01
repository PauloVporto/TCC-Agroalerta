const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const { buscarClimaAtual } = require("./weather");
const { buscarContextoMercado } = require("./marketQuotes");
const {
  NOMES_CULTURA,
  montarContextoLlm,
  promptAnaliseMercado,
  chamarClaudeComBusca,
  temChaveLlm,
} = require("./llm");

const mercadoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "mercado.json"), "utf-8")
);

const NOTICIAS_CURADAS_FALLBACK = {
  cafe: [
    "Previsão de clima mais seco que a média nas principais regiões produtoras de Minas Gerais nas próximas semanas.",
    "Estoques mundiais de café arábica seguem em nível historicamente baixo.",
    "Câmbio (dólar) em leve alta, favorecendo exportadores.",
  ],
  soja: [
    "Boas condições de plantio relatadas nos EUA, favorecendo expectativa de safra recorde.",
    "China mantém ritmo de importações estável em relação ao mês anterior.",
    "Custo de fretes marítimos em leve queda no último mês.",
  ],
  milho: [
    "Safrinha de milho com boa evolução no Centro-Oeste, pressionando preços internos.",
    "Demanda de etanol de milho segue aquecida em usinas do interior de Minas e Goiás.",
    "Exportações de milho brasileiro em ritmo forte, sustentando preços no mercado externo.",
  ],
  cana: [
    "Moagem de cana-de-açúcar na região Sudeste segue dentro da média histórica para o período.",
    "Preço do açúcar no mercado internacional em leve alta, favorecendo o mix das usinas.",
    "Custo de fertilizantes nitrogenados estável no último trimestre.",
  ],
  feijao: [
    "Área plantada de feijão de segunda safra menor que no ano anterior em Minas Gerais.",
    "Demanda interna aquecida por conta do período de entressafra.",
    "Condições climáticas favoráveis à colheita nas principais regiões produtoras.",
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
    fonteAoVivo: mercado.fonteMercado,
    cotacaoAoVivo: mercado.cotacaoAoVivo
      ? {
          ticker: mercado.cotacaoAoVivo.ticker,
          nome: mercado.cotacaoAoVivo.nome,
          preco: mercado.cotacaoAoVivo.preco,
          unidade: mercado.cotacaoAoVivo.unidade,
          data: mercado.cotacaoAoVivo.data,
          moeda: mercado.cotacaoAoVivo.moeda,
          fonte: mercado.cotacaoAoVivo.fonte,
        }
      : null,
    dolarPtax: mercado.dolar,
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
          cotacaoAoVivo: analise.cotacaoAoVivo,
          dolarPtax: analise.dolarPtax,
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
      cotacaoAoVivo: mercado.cotacaoAoVivo,
      dolarPtax: mercado.dolar,
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
    cotacaoAoVivo: extras.mercado ? extras.mercado.cotacaoAoVivo : null,
    dolarPtax: extras.mercado ? extras.mercado.dolar : null,
  };
}

async function obterContextoIntegracao(cultura) {
  const historico = await obterHistorico(cultura);
  if (!historico) throw new Error("Cultura não suportada: " + cultura);
  const interno = resumoSerie(serieInterna(cultura));
  const clima = await buscarClimaAtual(SUL_DE_MINAS.latitude, SUL_DE_MINAS.longitude);
  const mercado = {
    dolar: historico.dolarPtax,
    cotacaoAoVivo: historico.cotacaoAoVivo,
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
  obterContextoIntegracao,
  chamarClaudeComBusca,
};
