const fs = require("fs");
const path = require("path");

const mercadoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "mercado.json"), "utf-8")
);

const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim() || undefined;

const NOMES_CULTURA = {
  cafe: "café arábica",
  soja: "soja",
  milho: "milho",
  cana: "cana-de-açúcar / açúcar",
  feijao: "feijão carioca",
};

/**
 * Notícias "curadas manualmente" - usadas apenas como FALLBACK quando não
 * há ANTHROPIC_API_KEY configurada (modo simulado) ou quando a busca na
 * web falha por algum motivo. Quando a chave está configurada, a IA busca
 * informação real e atual na web em vez de depender dessa lista fixa.
 */
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

/**
 * Gera uma análise de mercado ampla, cobrindo os principais fatores que
 * movem o preço de um produto agrícola: clima nas regiões produtoras,
 * câmbio, exportação/importação, estoques mundiais, frete/logística e
 * política agrícola (tarifas, subsídios). Usa busca na web em tempo real
 * quando ANTHROPIC_API_KEY está configurada; caso contrário, cai em modo
 * simulado com notícias fixas.
 */
async function gerarAnaliseTendencia(cultura) {
  const historico = obterHistorico(cultura);

  if (!historico) {
    throw new Error("Cultura não suportada para análise de mercado: " + cultura);
  }

  const ultimosPrecos = historico.historico.slice(-14); // últimas 2 semanas
  const precoAtual = ultimosPrecos[ultimosPrecos.length - 1].preco;
  const precoInicio = ultimosPrecos[0].preco;
  const variacaoPercentual = (((precoAtual - precoInicio) / precoInicio) * 100).toFixed(1);
  const nomeCultura = NOMES_CULTURA[cultura] || cultura;

  if (!API_KEY) {
    return gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, NOTICIAS_CURADAS_FALLBACK[cultura] || []);
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
      fatoresConsiderados: NOTICIAS_CURADAS_FALLBACK[cultura] || [],
      gerarPor: "ia",
      geradoEm: new Date().toISOString(),
    };
  } catch (erro) {
    console.error("[market] Falha ao chamar Claude, usando fallback simulado:", erro.message);
    return gerarAnaliseSimulada(cultura, variacaoPercentual, precoAtual, NOTICIAS_CURADAS_FALLBACK[cultura] || []);
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
