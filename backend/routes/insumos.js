const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { gerarInsightCompra } = require("../services/insumosIA");

const db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "insumos.json"), "utf-8"));

/**
 * @swagger
 * /insumos:
 *   get:
 *     summary: Lista os insumos, com ofertas ordenadas por menor preço
 *     tags: [Insumos]
 *     parameters:
 *       - in: query
 *         name: categoria
 *         required: false
 *         schema: { type: string, example: fungicida }
 *         description: Filtra por categoria (fungicida, irrigacao, hidrogel, protecao_termica, fertilizante)
 *     responses:
 *       200:
 *         description: Lista de insumos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Insumo' }
 */
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

/**
 * @swagger
 * /insumos/recomendados/{alertaId}:
 *   get:
 *     summary: Recomenda insumos com base no id de uma regra de alerta
 *     description: 'Ex: "cafe_geada" recomenda insumos da categoria protecao_termica.'
 *     tags: [Insumos]
 *     parameters:
 *       - in: path
 *         name: alertaId
 *         required: true
 *         schema: { type: string, example: cafe_geada }
 *     responses:
 *       200:
 *         description: Insumos recomendados (pode ser uma lista vazia)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Insumo' }
 *       404: { description: Regra de alerta desconhecida, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/recomendados/:alertaId", (req, res) => {
  const mapaAlertaCategoria = {
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

  const categorias = mapaAlertaCategoria[req.params.alertaId];

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

/**
 * @swagger
 * /insumos/analise/{categoria}:
 *   get:
 *     summary: Gera uma recomendação de compra para a categoria de insumo
 *     description: >
 *       Usa IA (Anthropic Claude) quando ANTHROPIC_API_KEY está configurada; caso contrário,
 *       retorna uma recomendação simulada baseada apenas nos preços coletados localmente.
 *     tags: [Insumos]
 *     parameters:
 *       - in: path
 *         name: categoria
 *         required: true
 *         schema: { type: string, example: fungicida }
 *     responses:
 *       200:
 *         description: Recomendação de compra
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categoria: { type: string }
 *                 nomeCategoria: { type: string }
 *                 recomendacao: { type: string }
 *                 fontes: { type: array, items: { type: object } }
 *                 gerarPor: { type: string, enum: [ia, simulado] }
 *                 geradoEm: { type: string, format: date-time }
 *       400: { description: Categoria de insumo não encontrada, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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
