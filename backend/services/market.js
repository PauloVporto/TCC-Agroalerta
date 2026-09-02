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

const { montarSerieMercado, projetarAnos, aplicarAjustesMensaisIa, remontarAgregadosProjecao, ANO_PROJECAO, ANO_PROJECAO_FIM, ANO_HISTORICO_FIM, ANO_INICIO, ANOS_PROJECAO } = require("./marketHistoryExtend");

function serieInterna(cultura) {
  const base = mercadoData[cultura];
  if (!base) return null;
  const serie = montarSerieMercado(base.historico, cultura);
  return { ...base, ...serie };
}

const SUL_DE_MINAS = { latitude: -22.2461, longitude: -45.7008 };

function resumoSerie(historico) {
  const pts = historico.historico.filter((p) => p.tipo !== "projecao");
  const ultimosPrecos = pts.slice(-14);
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
    anosDisponiveis: base.anosDisponiveis,
    anosProjecao: base.anosProjecao,
    anoInicio: base.anoInicio,
    anoHistoricoFim: base.anoHistoricoFim,
    anoProjecao: base.anoProjecao,
    anoProjecaoFim: base.anoProjecaoFim,
    historicoAnual: base.historicoAnual,
    projecao2027: base.projecao2027,
    projecao2028: base.projecao2028,
    projecaoMensal: base.projecaoMensal,
    projecaoPorAno: base.projecaoPorAno,
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

function extrairJsonAjustes(texto) {
  if (!texto) return null;
  const candidatos = [];
  const fence = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidatos.push(fence[1]);
  const brace = texto.match(/\{[\s\S]*"ajustes"[\s\S]*\}/);
  if (brace) candidatos.push(brace[0]);
  candidatos.push(texto);
  for (const raw of candidatos) {
    try {
      const parsed = JSON.parse(raw.trim());
      if (parsed && typeof parsed === "object") {
        return parsed.ajustes || parsed.meses || parsed;
      }
    } catch (_) {
      /* tenta próximo */
    }
  }
  return null;
}

function textoSemJson(texto) {
  if (!texto) return "";
  return texto
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*"ajustes"[\s\S]*\}/, "")
    .trim();
}

async function gerarProjecao(cultura) {
  const historico = await obterHistorico(cultura);
  if (!historico) throw new Error("Cultura não suportada: " + cultura);
  const base = serieInterna(cultura);
  const interno = resumoSerie(base);
  let proj = projetarAnos(base.historico, cultura, ANOS_PROJECAO);
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
      const out = await chamarClaudeComBusca(promptProjecaoMercado(contexto, proj.mensal), 900);
      const ajustes = extrairJsonAjustes(out.texto);
      if (ajustes && Object.keys(ajustes).length) {
        const mensalAjustado = aplicarAjustesMensaisIa(proj.mensal, ajustes, "projecao-ia");
        proj = remontarAgregadosProjecao(mensalAjustado, ANOS_PROJECAO);
      }
      resumo = textoSemJson(out.texto) || out.texto;
      fontes = out.fontes;
      gerarPor = "ia_projecao";
    } catch (erro) {
      console.error("[market] Projeção IA falhou:", erro.message);
    }
  }
  if (!resumo) {
    const medias = (proj.anuais || []).map((a) => a.ano + ": R$ " + a.preco.toFixed(2)).join(" · ");
    resumo =
      "Histórico mensal interno de " +
      ANO_INICIO +
      " a " +
      ANO_HISTORICO_FIM +
      " e projeção mensal para " +
      ANOS_PROJECAO.join("–") +
      " (" +
      (NOMES_CULTURA[cultura] || cultura) +
      "). Médias anuais projetadas — " +
      medias +
      ". " +
      (ancora
        ? "Paridade/bolsa internacional hoje: " +
          (historico.paridade
            ? "R$ " + historico.paridade.preco
            : historico.internacional.preco + " " + historico.internacional.unidade) +
          ". "
        : "Mercado essencialmente interno. ") +
      "Cenário estatístico com sazonalidade mensal — não é garantia de preço. Ative a chave de IA para narrativa e refinamentos mensais.";
  }

  const historicoAnual = [...agregarAnualLocal(base.historico), ...(proj.anuais || [])];

  return {
    cultura,
    unidade: historico.unidade,
    precoAtual: interno.precoAtual,
    anoProjecao: ANO_PROJECAO,
    anoProjecaoFim: ANO_PROJECAO_FIM,
    anosProjecao: ANOS_PROJECAO,
    anoHistoricoFim: ANO_HISTORICO_FIM,
    anoInicio: ANO_INICIO,
    historicoAnual,
    pontos: proj.trimestres,
    pontosMensais: proj.mensal,
    pontosPorAno: proj.porAno,
    pontoAnual: proj.anual,
    pontosAnuais: proj.anuais,
    ancora,
    resumo,
    gerarPor,
    fontes,
    geradoEm: new Date().toISOString(),
  };
}

function agregarAnualLocal(historico) {
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
  obterContextoIntegracao,
  chamarClaudeComBusca,
  resumoMercadoInterno: (cultura) => {
    const base = serieInterna(cultura);
    return base ? resumoSerie(base) : null;
  },
};
