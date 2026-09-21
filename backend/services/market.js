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

/**
 * Chama a API da Anthropic com a ferramenta de busca na web habilitada,
 * processando os blocos de resposta (texto + resultados de busca) e
 * retornando o texto final junto das fontes usadas.
 *
 * Essa é a peça central do "modo real" do módulo de mercado: em vez de
 * depender só de notícias fixas cadastradas manualmente, a IA busca
 * informação atual sobre clima, câmbio, comércio internacional etc.
 */
async function chamarClaudeComBusca(prompt, maxTokens = 900) {
  const resposta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 6,
        },
      ],
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error("Erro na API de IA: " + resposta.status + " - " + corpo.slice(0, 200));
  }

  const dados = await resposta.json();

  // A resposta pode ter vários blocos: texto, uso de ferramenta (busca) e
  // resultados de busca. Juntamos apenas o texto final gerado pelo modelo.
  const texto = dados.content
    .filter((bloco) => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("\n")
    .trim();

  // Coleta as fontes (URLs) usadas nas buscas, quando disponíveis, para
  // exibir de forma transparente de onde veio a informação.
  const fontes = [];
  for (const bloco of dados.content) {
    if (bloco.type === "web_search_tool_result" && Array.isArray(bloco.content)) {
      for (const item of bloco.content) {
        if (item.url && item.title) {
          fontes.push({ titulo: item.title, url: item.url });
        }
      }
    }
  }

  return { texto, fontes: dedupFontes(fontes) };
}

function dedupFontes(fontes) {
  const vistos = new Set();
  return fontes.filter((f) => {
    if (vistos.has(f.url)) return false;
    vistos.add(f.url);
    return true;
  }).slice(0, 6);
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
    "Você é um analista de mercado agrícola brasileiro, escrevendo para um produtor rural do Sul de Minas Gerais. " +
    "Pesquise na web informações ATUAIS e relevantes sobre o mercado de " + nomeCultura + " e escreva uma análise " +
    "qualitativa cobrindo, sempre que encontrar informação relevante: " +
    "(1) condições climáticas nas principais regiões produtoras (Brasil e, se aplicável, outros grandes players como EUA/China/países vizinhos), " +
    "(2) câmbio (dólar) e seu efeito sobre exportação/importação, " +
    "(3) estoques mundiais e nível de demanda internacional, " +
    "(4) custos de frete/logística, " +
    "(5) políticas agrícolas, tarifas ou subsídios relevantes no momento. " +
    "Priorize fatos recentes (últimas semanas). " +
    "Ao final, escreva um resumo qualitativo de tendência em até 6 frases, em português, direto e sem jargão excessivo, " +
    "citando os fatores mais relevantes que você encontrou. Não invente números específicos de preço - " +
    "use apenas os dados de preço que eu forneço abaixo.\n\n" +
    "Dado de referência (nosso próprio histórico, não precisa buscar isso):\n" +
    "Variação de preço nas últimas 2 semanas: " + variacaoPercentual + "%\n" +
    "Preço atual: " + precoAtual + " (" + historico.unidade + ")";

  try {
    const { texto, fontes } = await chamarClaudeComBusca(prompt);

    return {
      cultura,
      variacaoPercentual: Number(variacaoPercentual),
      precoAtual,
      unidade: historico.unidade,
      resumo: texto || "Não foi possível gerar a análise a partir da busca. Tente novamente.",
      fontes,
      fatoresConsiderados: fontes.length > 0 ? fontes.map((f) => f.titulo) : NOTICIAS_CURADAS_FALLBACK[cultura] || [],
      gerarPor: "ia_com_busca",
      geradoEm: new Date().toISOString(),
    };
  } catch (erro) {
    console.error("[market] Falha ao gerar análise via IA com busca, usando fallback simulado:", erro.message);
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

module.exports = { obterHistorico, gerarAnaliseTendencia, chamarClaudeComBusca };
