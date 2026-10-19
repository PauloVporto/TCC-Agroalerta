const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { gerarInsightCompra } = require("../services/insumosIA");
const { MAPA_ALERTA_CATEGORIA } = require("../services/alertaInsumos");

const db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "insumos.json"), "utf-8"));

// GET /api/insumos - lista todos os insumos, com ofertas ordenadas por menor preço
// Query opcional: ?categoria=fungicida
router.get("/", (req, res) => {
  const { categoria } = req.query;

  let insumos = db.insumos;
  if (categoria) {
    insumos = insumos.filter((i) => i.categoria === categoria);
  }

  const resultado = insumos.map((insumo) => {
    const ofertasOrdenadas = [...insumo.ofertas].sort((a, b) => a.preco - b.preco);
    return {
      ...insumo,
      ofertas: ofertasOrdenadas,
      melhorPreco: ofertasOrdenadas[0],
    };
  });

  res.json(resultado);
});

// GET /api/insumos/recomendados/:alertaId
// Recomenda insumos com base no id de uma regra de alerta (ex: "cafe_geada")
router.get("/recomendados/:alertaId", (req, res) => {
  const categorias = MAPA_ALERTA_CATEGORIA[req.params.alertaId];

  if (!categorias) {
    return res.status(404).json({ erro: "Regra de alerta desconhecida" });
  }

  if (categorias.length === 0) {
    return res.json([]);
  }

  const insumos = db.insumos
    .filter((i) => categorias.includes(i.categoria))
    .map((insumo) => {
      const ofertasOrdenadas = [...insumo.ofertas].sort((a, b) => a.preco - b.preco);
      return { ...insumo, ofertas: ofertasOrdenadas, melhorPreco: ofertasOrdenadas[0] };
    });

  res.json(insumos);
});

// GET /api/insumos/analise/:categoria
// Gera (via IA + busca na web) uma recomendação de compra para a categoria
router.get("/analise/:categoria", async (req, res) => {
  try {
    const analise = await gerarInsightCompra(req.params.categoria);
    res.json(analise);
  } catch (erro) {
    console.error("[insumos] Erro ao gerar análise de compra:", erro);
    res.status(400).json({ erro: erro.message });
  }
});

module.exports = router;
