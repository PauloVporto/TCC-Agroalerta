const fs = require("fs");
const path = require("path");
const { buscarNoticiasCultura } = require("./noticias");

const mercadoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "mercado.json"), "utf-8")
);

const anthropic = require("./anthropic");

const NOMES_CULTURA = {
  cafe: "café arábica",
  soja: "soja",
};

// Fallback estático: usado apenas quando o Google News RSS falha completamente
const NOTICIAS_FALLBACK = {
  cafe: [
    { titulo: "Previsão de clima mais seco nas principais regiões produtoras de Minas Gerais nas próximas semanas.", fonte: "Curadoria interna" },
    { titulo: "Estoques mundiais de café arábica seguem em nível historicamente baixo.", fonte: "Curadoria interna" },
    { titulo: "Câmbio (dólar) em leve alta, favorecendo exportadores.", fonte: "Curadoria interna" },
  ],
  soja: [
    { titulo: "Boas condições de plantio relatadas nos EUA, favorecendo expectativa de safra recorde.", fonte: "Curadoria interna" },
    { titulo: "China mantém ritmo de importações estável em relação ao mês anterior.", fonte: "Curadoria interna" },
    { titulo: "Custo de fretes marítimos em leve queda no último mês.", fonte: "Curadoria interna" },
  ],
};

function obterHistorico(cultura) {
  return mercadoData[cultura] || null;
}

async function chamarClaude(prompt, maxTokens = 900) {
  const { texto, dados, requestId } = await anthropic.mensagens({
    model: "claude-haiku-4-5-20251001",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return { texto, modelo: dados.model, respostaId: dados.id, requestId };
}

async function gerarAnaliseTendencia(cultura) {
  const historico = obterHistorico(cultura);

  if (!historico) {
    throw new Error("Cultura não suportada para análise de mercado: " + cultura);
  }

  const ultimosPrecos = historico.historico.slice(-14);
  const precoAtual = ultimosPrecos[ultimosPrecos.length - 1].preco;
  const precoInicio = ultimosPrecos[0].preco;
  const variacaoPercentual = (((precoAtual - precoInicio) / precoInicio) * 100).toFixed(1);
  const nomeCultura = NOMES_CULTURA[cultura] || cultura;

  // Sempre busca notícias reais dos RSS dos veículos — independente de ter API Key ou não
  let noticias = [];
  try {
    noticias = await buscarNoticiasCultura(cultura);
  } catch (_) {}
  if (noticias.length === 0) {
    noticias = NOTICIAS_FALLBACK[cultura] || [];
  }

  if (!anthropic.chaveConfigurada()) {
    return { ...gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, noticias),
      ia: anthropic.estadoFalha({ codigo: "nao_configurada" }) };
  }

  const prompt =
    "Você é um analista de mercado agrícola brasileiro especializado em commodities, escrevendo para um produtor rural do Sul de Minas Gerais. " +
    "Com base nos dados históricos de preço fornecidos abaixo, elabore uma análise qualitativa de tendência para o mercado de " + nomeCultura + ". " +
    "Cubra os principais fatores que influenciam esse mercado: " +
    "(1) tendência recente de preço e possíveis causas sazonais, " +
    "(2) fatores climáticos típicos desse período para as regiões produtoras brasileiras, " +
    "(3) dinâmica de câmbio (dólar) e exportações, " +
    "(4) estoques e demanda interna/internacional, " +
    "(5) perspectiva de curto prazo para o produtor. " +
    "Escreva um parágrafo coeso de 5 a 7 frases em português, direto e sem jargão excessivo. " +
    "Não invente números de preço além dos fornecidos abaixo.\n\n" +
    "Dados de referência:\n" +
    "Cultura: " + nomeCultura + "\n" +
    "Variação de preço nas últimas 2 semanas: " + variacaoPercentual + "%\n" +
    "Preço atual: R$ " + precoAtual + " (" + historico.unidade + ")";

  try {
    const { texto } = await chamarClaude(prompt);

    return {
      cultura,
      variacaoPercentual: Number(variacaoPercentual),
      precoAtual,
      unidade: historico.unidade,
      resumo: texto || "Não foi possível gerar a análise. Tente novamente.",
      fontes: [],
      fatoresConsiderados: noticias,
      gerarPor: "ia",
      geradoEm: new Date().toISOString(),
    };
  } catch (erro) {
    const ia = anthropic.estadoFalha(erro);
    console.error("[market] IA indisponível:", ia.codigo);
    return { ...gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, noticias), ia };
  }
}

function gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, noticias) {
  const tendencia = variacaoPercentual >= 0 ? "alta" : "queda";
  const resumo =
    "Nas últimas duas semanas, o preço de " +
    (NOMES_CULTURA[cultura] || cultura) +
    " apresentou tendência de " +
    tendencia +
    " (" +
    variacaoPercentual +
    "%).";

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
  };
}

module.exports = { obterHistorico, gerarAnaliseTendencia, chamarClaude };
