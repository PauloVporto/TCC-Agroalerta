const fs = require("fs");
const path = require("path");
const { buscarNoticiasCultura } = require("./noticias");

const mercadoData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "mercado.json"), "utf-8")
);

const anthropic = require("./anthropic");
const { extrairJson } = require("./jsonIA");

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
    model: anthropic.MODELO_ANALISE,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return { texto, modelo: dados.model, respostaId: dados.id, requestId };
}

// Gabarito único da tendência: compara o preço final com o inicial da janela analisada.
const LIMIAR_TENDENCIA_PCT = 2;
const PROMPT_MERCADO_VERSAO = "mercado-v2";

function classificarTendencia(variacaoPct) {
  if (variacaoPct >= LIMIAR_TENDENCIA_PCT) return "alta";
  if (variacaoPct <= -LIMIAR_TENDENCIA_PCT) return "queda";
  return "estavel";
}

function resumirSerie(serie) {
  const pontos = serie.map((p) => ({ data: p.data, preco: Number(p.preco) }));
  const menor = pontos.reduce((m, p) => (p.preco < m.preco ? p : m), pontos[0]);
  const maior = pontos.reduce((m, p) => (p.preco > m.preco ? p : m), pontos[0]);
  const ini = pontos[0].preco;
  const fim = pontos[pontos.length - 1].preco;
  return {
    n: pontos.length,
    dataInicio: pontos[0].data,
    dataFim: pontos[pontos.length - 1].data,
    precoInicio: ini,
    precoFim: fim,
    minimo: menor,
    maximo: maior,
    variacaoPercentual: Number((((fim - ini) / ini) * 100).toFixed(2)),
    pontos,
  };
}

function montarPromptTendencia({ cultura, unidade, serie }) {
  const r = resumirSerie(serie);
  const nome = NOMES_CULTURA[cultura] || cultura;
  const L = LIMIAR_TENDENCIA_PCT;
  return (
    "Você é um analista de mercado agrícola brasileiro, escrevendo para um produtor rural do Sul de Minas Gerais. " +
    "Analise SOMENTE a série de preços abaixo.\n\n" +
    "Regra de classificação da tendência do período (use exatamente esta): compare o preço final com o inicial; " +
    "variação de +" + L + "% ou mais = \"alta\"; variação de -" + L + "% ou menos = \"queda\"; " +
    "entre -" + L + "% e +" + L + "% = \"estavel\".\n\n" +
    "Responda APENAS com JSON válido, sem markdown: {\"tendencia\":\"alta|queda|estavel\",\"resumo\":\"...\"}.\n" +
    "No resumo (3 a 5 frases, português simples): diga primeiro se o preço está em alta, queda ou estável e quanto variou; " +
    "cite preço inicial, final, mínimo e máximo quando útil; se houve reversão no meio do período, diga; " +
    "termine com uma orientação prudente de curto prazo para o produtor.\n" +
    "Use apenas os números dos dados. Não cite eventos, países, estoques, câmbio, clima ou notícias que não estejam nos dados. " +
    "Se quiser mencionar fatores gerais do mercado, use linguagem condicional (\"pode\", \"costuma\") e deixe claro que é contexto geral, não dado da série.\n\n" +
    "Dados:\n" +
    "Cultura: " + nome + "\n" +
    "Unidade: " + unidade + "\n" +
    "Observações: " + r.n + " (de " + r.dataInicio + " a " + r.dataFim + ")\n" +
    "Preço inicial: " + r.precoInicio + "; preço final: " + r.precoFim + "; variação: " + r.variacaoPercentual + "%\n" +
    "Mínimo: " + r.minimo.preco + " em " + r.minimo.data + "; máximo: " + r.maximo.preco + " em " + r.maximo.data + "\n" +
    "Série: " + r.pontos.map((p) => p.data + "=" + p.preco).join("; ")
  );
}

/**
 * Interpreta a série com Claude. LANÇA erro se a API falhar (não há fallback aqui),
 * para que a avaliação de assertividade nunca confunda resposta simulada com resposta do modelo.
 */
async function interpretarSerieComIA({ cultura, unidade, serie }) {
  const prompt = montarPromptTendencia({ cultura, unidade, serie });
  const { texto, dados, requestId } = await anthropic.mensagens({
    model: anthropic.MODELO_ANALISE,
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  });
  const json = extrairJson(texto);
  const formatoValido = Boolean(
    json && ["alta", "queda", "estavel"].includes(json.tendencia) && typeof json.resumo === "string" && json.resumo.trim()
  );
  return {
    tendencia: formatoValido ? json.tendencia : null,
    resumo: formatoValido ? json.resumo.trim() : texto,
    textoBruto: texto,
    formatoValido,
    modelo: dados.model,
    respostaId: dados.id,
    requestId,
    uso: dados.usage || null,
    promptVersao: PROMPT_MERCADO_VERSAO,
    prompt,
  };
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

  try {
    const ia = await interpretarSerieComIA({ cultura, unidade: historico.unidade, serie: ultimosPrecos });

    return {
      cultura,
      variacaoPercentual: Number(variacaoPercentual),
      precoAtual,
      unidade: historico.unidade,
      tendencia: ia.tendencia || classificarTendencia(Number(variacaoPercentual)),
      resumo: ia.resumo || "Não foi possível gerar a análise. Tente novamente.",
      fontes: [],
      fatoresConsiderados: noticias,
      gerarPor: "ia",
      modelo: ia.modelo,
      respostaId: ia.respostaId,
      requestId: ia.requestId,
      promptVersao: ia.promptVersao,
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
    tendencia: classificarTendencia(Number(variacaoPercentual)),
    resumo,
    fontes: [],
    fatoresConsiderados: noticias,
    gerarPor: "simulado",
    geradoEm: new Date().toISOString(),
  };
}

module.exports = {
  obterHistorico, gerarAnaliseTendencia, chamarClaude,
  classificarTendencia, resumirSerie, montarPromptTendencia, interpretarSerieComIA,
  LIMIAR_TENDENCIA_PCT, PROMPT_MERCADO_VERSAO,
};
