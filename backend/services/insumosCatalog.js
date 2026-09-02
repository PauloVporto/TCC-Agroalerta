const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "insumos.json"), "utf-8"));

const MAPA_ALERTA_CATEGORIA = {
  cafe_geada: ["protecao_termica"],
  cafe_estiagem: ["irrigacao", "hidrogel"],
  cafe_excesso_chuva: ["fungicida"],
  soja_estiagem: ["irrigacao", "hidrogel"],
  soja_chuva_colheita: [],
  soja_vento_forte: [],
  milho_estiagem: ["irrigacao", "hidrogel"],
  milho_vento_forte: [],
  milho_excesso_chuva: ["fungicida"],
  cana_estiagem_prolongada: ["irrigacao"],
  cana_geada: ["protecao_termica"],
  cana_chuva_colheita: [],
  feijao_estiagem: ["irrigacao", "hidrogel"],
  feijao_excesso_chuva: ["fungicida"],
  feijao_chuva_colheita: [],
};

function chaveInsumo(nome, categoria) {
  return (categoria + "|" + nome).toLowerCase();
}

async function listarOfertasDb() {
  const resultado = await pool.query(
    `SELECT o.id, o.usuario_id AS "usuarioId", o.insumo_catalogo_id AS "insumoCatalogoId",
            o.nome, o.categoria, o.unidade, o.preco, o.cidade, o.telefone,
            u.nome AS fornecedor
     FROM ofertas_insumos o
     JOIN usuarios u ON u.id = o.usuario_id
     ORDER BY o.preco ASC`
  );
  return resultado.rows;
}

async function listarInsumos(categoria) {
  const ofertasDb = await listarOfertasDb();
  const mapa = new Map();

  catalogo.insumos.forEach((insumo) => {
    mapa.set(insumo.id, {
      ...insumo,
      ofertas: [...insumo.ofertas],
    });
  });

  ofertasDb.forEach((oferta) => {
    const item = {
      fornecedor: oferta.fornecedor,
      cidade: oferta.cidade,
      preco: Number(oferta.preco),
      telefone: oferta.telefone || null,
      ofertaId: oferta.id,
      usuarioId: oferta.usuarioId,
      fonte: "cadastro",
    };
    const alvo = oferta.insumoCatalogoId && mapa.get(oferta.insumoCatalogoId);
    if (alvo) {
      alvo.ofertas.push(item);
      return;
    }
    const chave = chaveInsumo(oferta.nome, oferta.categoria);
    let extra = [...mapa.values()].find((i) => chaveInsumo(i.nome, i.categoria) === chave);
    if (!extra) {
      extra = {
        id: "user-" + oferta.id,
        categoria: oferta.categoria,
        nome: oferta.nome,
        unidade: oferta.unidade,
        ofertas: [],
      };
      mapa.set(extra.id, extra);
    }
    extra.ofertas.push(item);
  });

  let insumos = [...mapa.values()];
  if (categoria) insumos = insumos.filter((i) => i.categoria === categoria);

  return insumos.map((insumo) => {
    const ofertas = [...insumo.ofertas].sort((a, b) => a.preco - b.preco);
    return { ...insumo, ofertas, melhorPreco: ofertas[0] || null };
  });
}

async function insumosParaAlerta(alertaId) {
  const categorias = MAPA_ALERTA_CATEGORIA[alertaId];
  if (!categorias) return null;
  if (categorias.length === 0) return [];
  const todos = await listarInsumos();
  return todos.filter((i) => categorias.includes(i.categoria));
}

module.exports = {
  catalogo,
  MAPA_ALERTA_CATEGORIA,
  listarInsumos,
  insumosParaAlerta,
};
