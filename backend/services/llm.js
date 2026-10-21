/**
 * Camada de LLM do AgroAlerta.
 *
 * O modelo não busca clima/preço "no vazio": recebe um contexto montado
 * a partir das APIs (Open-Meteo, mercado interno, ICE/CBOT e PTAX) e,
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
  const linhas = ["Cultura: " + nome, "Compare sempre o mercado interno brasileiro com o internacional."];

  if (clima) {
    linhas.push(
      "Clima no Sul de Minas (fonte " +
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
      "Câmbio Brasil (PTAX): US$ 1 = R$ " + mercado.dolar.valor + " em " + mercado.dolar.data + "."
    );
  }

  if (mercado && mercado.icBrAgro) {
    linhas.push(
      "Índice IC-Br Agropecuária (BCB): " + mercado.icBrAgro.valor + " em " + mercado.icBrAgro.data + "."
    );
  }

  if (historicoInterno) {
    linhas.push(
      "Mercado interno Brasil (referência Cepea, R$/saca): " +
        historicoInterno.precoAtual +
        " " +
        historicoInterno.unidade +
        ", variação 14 dias " +
        historicoInterno.variacaoPercentual +
        "%."
    );
  }

  const intern = mercado && (mercado.internacional || mercado.cotacaoAoVivo);
  if (intern) {
    linhas.push(
      "Bolsa internacional (" +
        (intern.bolsa || intern.fonte) +
        ", " +
        intern.ticker +
        "): " +
        intern.preco +
        " " +
        intern.unidade +
        " em " +
        intern.data +
        "."
    );
  } else {
    linhas.push("Sem contrato internacional líquido para esta cultura (típico do feijão). Use só o mercado interno.");
  }

  if (mercado && mercado.paridade) {
    linhas.push(
      "Paridade internacional em reais (contrato × PTAX): " +
        mercado.paridade.preco +
        " " +
        mercado.paridade.unidade +
        ". Compare com o preço interno e comente prêmio ou desconto do Brasil."
    );
  }

  return linhas.join("\n");
}

function promptAnaliseMercado(contexto) {
  return (
    "Você é um analista de mercado agrícola brasileiro, escrevendo para um produtor do Sul de Minas Gerais. " +
    "Use PRIMEIRO o contexto (clima local, mercado interno em R$/saca, bolsa internacional e paridade cambial). " +
    "Fale dos DOIS mercados: o que o produtor recebe no Brasil e o que a bolsa internacional + dólar estão sinalizando. " +
    "Se fizer sentido, cite exportação, China/EUA, prêmio porto, frete e política agrícola. " +
    "Não invente preços fora do contexto. Português, até 6 frases.\n\n" +
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

function promptAlertaProdutor({ talhao, clima, previsao, alertas }) {
  const dias = (previsao || [])
    .slice(0, 7)
    .map((d) => d.data + ": " + d.condicao + ", " + d.chuvaMm + " mm, min " + d.temperaturaMinima + "°C")
    .join("; ");
  const lista = (alertas || []).map((a) => a.titulo + " (" + a.nivel + "): " + a.mensagem).join(" | ") || "nenhum alerta do motor de regras";
  return (
    "Você é o AgroAlerta, assistente do produtor rural no Sul de Minas. " +
    "Talhão mapeado: " +
    talhao.nome +
    " (" +
    (NOMES_CULTURA[talhao.cultura] || talhao.cultura) +
    ", fase " +
    talhao.fase +
    "). " +
    "Clima agregado: mínima " +
    clima.temperaturaMinima +
    "°C, " +
    clima.diasSemChuva +
    " dias secos, chuva 7d " +
    clima.chuvaAcumulada7dias +
    " mm. " +
    "Previsão diária: " +
    dias +
    ". Alertas agronômicos: " +
    lista +
    ". Escreva um recado de até 5 frases, em português, direto, sobre chuva, seca, geada e o que fazer agora. Não invente números fora do contexto."
  );
}

function promptProjecaoMercado(contexto, pontos) {
  const lista = (pontos || [])
    .map((p) => (p.horizonteRotulo || p.data) + ": R$ " + p.preco)
    .join("; ");
  const anos = [...new Set((pontos || []).map((p) => p.ano || String(p.data).slice(0, 4)))].join(" e ");
  return (
    "Você projeta preço agrícola mensal para o produtor brasileiro. " +
    "Baseline estatística (regressão 2018–2026 + sazonalidade) mês a mês para " +
    (anos || "2027–2028") +
    ": " +
    lista +
    ". " +
    contexto +
    "\nResponda em português com DUAS partes:\n" +
    "1) Até 6 frases explicando o cenário 2027 e 2028 (Brasil × internacional, tendência desde 2010). Não invente preços fora da lista.\n" +
    "2) Em seguida, um bloco JSON puro (sem markdown) no formato " +
    '{"ajustes":{"2027-01":1710.5,"2027-02":1720,...}} ' +
    "somente se quiser refinar algum mês (±18% da baseline). Se não houver ajuste, use {\"ajustes\":{}}."
  );
}

module.exports = {
  NOMES_CULTURA,
  montarContextoLlm,
  promptAnaliseMercado,
  promptAlertaProdutor,
  promptProjecaoMercado,
  chamarClaudeComBusca,
  temChaveLlm,
};
