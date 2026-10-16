const fs = require("fs");
const path = require("path");
const { buscarNoticiasCultura } = require("./googlenews");

const mercadoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "mercado.json"), "utf-8")
);

const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim() || undefined;

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
  const resposta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error("Erro na API: " + resposta.status + " - " + corpo.slice(0, 200));
  }

  const dados = await resposta.json();
  const texto = dados.content
    .filter((bloco) => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("\n")
    .trim();

  return { texto };
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

  // Sempre busca notícias reais do Google News RSS — independente de ter API Key ou não
  let noticias = [];
  try {
    noticias = await buscarNoticiasCultura(cultura);
  } catch (_) {}
  if (noticias.length === 0) {
    noticias = NOTICIAS_FALLBACK[cultura] || [];
  }

  if (!API_KEY) {
    return gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, noticias);
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
    console.error("[market] Falha ao chamar Claude, usando fallback simulado:", erro.message);
    return gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, noticias);
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
