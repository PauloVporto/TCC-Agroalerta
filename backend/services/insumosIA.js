const fs = require("fs");
const path = require("path");
const { chamarClaude } = require("./market");

const db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "insumos.json"), "utf-8"));

const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim() || undefined;

const NOMES_CATEGORIA = {
  fungicida: "fungicidas",
  irrigacao: "equipamentos de irrigação",
  hidrogel: "hidrogel / polímeros hidroretentores",
  protecao_termica: "proteção térmica contra geada",
  fertilizante: "fertilizantes (NPK)",
};

function obterInsumosPorCategoria(categoria) {
  return db.insumos.filter((i) => i.categoria === categoria);
}

/**
 * Gera uma recomendação de compra para uma categoria de insumo,
 * combinando (a) os preços atuais coletados na nossa base local e
 * (b) uma pesquisa na web sobre o cenário atual daquele tipo de insumo
 * no mercado agrícola (custo de matéria-prima, câmbio, safra, etc.),
 * para orientar o produtor se vale a pena comprar agora ou esperar.
 */
async function gerarInsightCompra(categoria) {
  const insumos = obterInsumosPorCategoria(categoria);

  if (insumos.length === 0) {
    throw new Error("Categoria de insumo não encontrada: " + categoria);
  }

  const nomeCategoria = NOMES_CATEGORIA[categoria] || categoria;

  const resumoPrecos = insumos
    .map((i) => {
      const ofertas = [...i.ofertas].sort((a, b) => a.preco - b.preco);
      const menor = ofertas[0];
      const maior = ofertas[ofertas.length - 1];
      return (
        "- " + i.nome + " (" + i.unidade + "): entre R$ " + menor.preco.toFixed(2) +
        " (" + menor.fornecedor + ") e R$ " + maior.preco.toFixed(2) + " (" + maior.fornecedor + ")"
      );
    })
    .join("\n");

  if (!API_KEY) {
    return gerarInsightSimulado(categoria, nomeCategoria, insumos);
  }

  const prompt =
    "Você é um consultor agrícola ajudando um produtor rural do Sul de Minas Gerais a decidir sobre a compra de " +
    nomeCategoria + ". Com base nos preços coletados de fornecedores regionais abaixo, elabore uma recomendação " +
    "considerando: variação típica de preço de matéria-prima para esse insumo (ex: petróleo/gás para fertilizantes, " +
    "câmbio para insumos importados), sazonalidade da demanda agrícola no Sul de Minas e perspectiva geral do setor. " +
    "\n\nPreços coletados de fornecedores regionais:\n" + resumoPrecos +
    "\n\nEscreva uma recomendação curta (até 5 frases) sobre se é um bom momento para comprar agora ou esperar, " +
    "e por quê. Seja direto, prático e sem jargão técnico excessivo.";

  try {
    const { texto } = await chamarClaude(prompt, 600);

    return {
      categoria,
      nomeCategoria,
      recomendacao: texto || "Não foi possível gerar a recomendação. Tente novamente.",
      fontes: [],
      gerarPor: "ia",
      geradoEm: new Date().toISOString(),
    };
  } catch (erro) {
    console.error("[insumosIA] Falha ao chamar Claude, usando fallback simulado:", erro.message);
    return gerarInsightSimulado(categoria, nomeCategoria, insumos);
  }
}

function gerarInsightSimulado(categoria, nomeCategoria, insumos) {
  const menorPrecoGeral = Math.min(
    ...insumos.flatMap((i) => i.ofertas.map((o) => o.preco))
  );

  const recomendacao =
    "Entre os fornecedores da região, o melhor preço encontrado para " + nomeCategoria +
    " está em torno de R$ " + menorPrecoGeral.toFixed(2) + ". " +
    "Recomenda-se comparar as ofertas disponíveis e considerar comprar em volume caso o insumo seja utilizado " +
    "com frequência, aproveitando os melhores preços listados.";

  return {
    categoria,
    nomeCategoria,
    recomendacao,
    fontes: [],
    gerarPor: "simulado",
    geradoEm: new Date().toISOString(),
  };
}

module.exports = { gerarInsightCompra };
