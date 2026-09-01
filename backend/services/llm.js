/**
 * Camada de LLM do AgroAlerta.
 *
 * O modelo não busca clima/preço "no vazio": recebe um contexto montado
 * a partir das APIs do sistema (Open-Meteo + Yahoo Finance + PTAX) e,
 * quando há chave, complementar pesquisa na web.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY;

const NOMES_CULTURA = {
  cafe: "café arábica",
  soja: "soja",
  milho: "milho",
  cana: "cana-de-açúcar / açúcar",
  feijao: "feijão carioca",
};

function montarContextoLlm({ cultura, clima, mercado, historicoInterno }) {
  const nome = NOMES_CULTURA[cultura] || cultura;
  const linhas = ["Cultura: " + nome];

  if (clima) {
    linhas.push(
      "Clima (fonte " +
        (clima.fonte || "desconhecida") +
        "): temp. mínima " +
        clima.temperaturaMinima +
        "°C; chuva 7 dias " +
        clima.chuvaAcumulada7dias +
        " mm; " +
        clima.diasSemChuva +
        " dias sem chuva; probabilidade de chuva " +
        clima.probabilidadeChuva7dias +
        "%; vento máx. " +
        clima.ventoMaximoKmh +
        " km/h."
    );
  }

  if (mercado && mercado.dolar) {
    linhas.push(
      "Câmbio PTAX: US$ 1 = R$ " + mercado.dolar.valor + " em " + mercado.dolar.data + "."
    );
  }

  if (mercado && mercado.cotacaoAoVivo) {
    const c = mercado.cotacaoAoVivo;
    linhas.push(
      "Cotação internacional (" +
        c.fonte +
        ", " +
        c.ticker +
        "): " +
        c.preco +
        " " +
        c.unidade +
        " em " +
        c.data +
        "."
    );
  } else {
    linhas.push("Cotação internacional indisponível para esta cultura (série interna apenas).");
  }

  if (historicoInterno) {
    linhas.push(
      "Série interna de referência: " +
        historicoInterno.precoAtual +
        " " +
        historicoInterno.unidade +
        ", variação 14 dias " +
        historicoInterno.variacaoPercentual +
        "%."
    );
  }

  return linhas.join("\n");
}

function promptAnaliseMercado(contexto) {
  return (
    "Você é um analista de mercado agrícola brasileiro, escrevendo para um produtor rural do Sul de Minas Gerais. " +
    "Use PRIMEIRO o contexto abaixo (clima da região via Open-Meteo e cotações via Yahoo Finance / Banco Central). " +
    "Se precisar, pesquise na web fatos recentes para complementar — não substitua os números do contexto. " +
    "Cubra, quando fizer sentido: clima nas regiões produtoras, câmbio, demanda internacional, frete e política agrícola. " +
    "Escreva em português, até 6 frases, direto, sem inventar preços que não estejam no contexto.\n\n" +
    "Contexto do sistema:\n" +
    contexto
  );
}

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
  const texto = dados.content
    .filter((bloco) => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("\n")
    .trim();

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
  return fontes
    .filter((f) => {
      if (vistos.has(f.url)) return false;
      vistos.add(f.url);
      return true;
    })
    .slice(0, 6);
}

function temChaveLlm() {
  return Boolean(API_KEY);
}

module.exports = {
  NOMES_CULTURA,
  montarContextoLlm,
  promptAnaliseMercado,
  chamarClaudeComBusca,
  temChaveLlm,
};
