const express = require("express");
const router = express.Router();
const { gerarInsightCompra } = require("../services/insumosIA");
const { listarInsumos, insumosParaAlerta, catalogo } = require("../services/insumosCatalog");
const { exigirAutenticacao, exigirPapel } = require("../services/auth");
const { pool } = require("../services/db");

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
router.get("/", async (req, res) => {
  try {
    res.json(await listarInsumos(req.query.categoria));
  } catch (erro) {
    console.error("[insumos] listar:", erro);
    res.status(500).json({ erro: "Não foi possível listar os insumos." });
  }
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
// GET /api/insumos/recomendados/:alertaId
// Recomenda insumos com base no id de uma regra de alerta (ex: "cafe_geada")
router.get("/recomendados/:alertaId", async (req, res) => {
  const insumos = await insumosParaAlerta(req.params.alertaId);
  if (insumos === null) {
    return res.status(404).json({ erro: "Regra de alerta desconhecida" });
  }
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

router.get("/meus", exigirAutenticacao, exigirPapel("fornecedor"), async (req, res) => {
  const resultado = await pool.query(
    `SELECT id, insumo_catalogo_id AS "insumoCatalogoId", nome, categoria, unidade,
            preco, cidade, telefone, criado_em AS "criadoEm"
     FROM ofertas_insumos WHERE usuario_id = $1 ORDER BY criado_em DESC`,
    [req.usuario.id]
  );
  res.json(resultado.rows);
});

router.post("/", exigirAutenticacao, exigirPapel("fornecedor"), async (req, res) => {
  const { nome, categoria, unidade, preco, cidade, telefone, insumoCatalogoId } = req.body;
  const precoNum = Number(preco);
  if (!nome || !categoria || !unidade || !Number.isFinite(precoNum) || precoNum <= 0 || !cidade) {
    return res.status(400).json({ erro: "Informe nome, categoria, unidade, preço e cidade." });
  }

  const catalogoMatch = catalogo.insumos.find((i) => i.id === insumoCatalogoId);
  const resultado = await pool.query(
    `INSERT INTO ofertas_insumos
       (usuario_id, insumo_catalogo_id, nome, categoria, unidade, preco, cidade, telefone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, insumo_catalogo_id AS "insumoCatalogoId", nome, categoria, unidade,
               preco, cidade, telefone, criado_em AS "criadoEm"`,
    [
      req.usuario.id,
      catalogoMatch ? catalogoMatch.id : null,
      catalogoMatch ? catalogoMatch.nome : nome,
      catalogoMatch ? catalogoMatch.categoria : categoria,
      catalogoMatch ? catalogoMatch.unidade : unidade,
      precoNum,
      cidade,
      telefone || req.usuario.telefone || null,
    ]
  );
  res.status(201).json(resultado.rows[0]);
});

router.delete("/:id", exigirAutenticacao, exigirPapel("fornecedor"), async (req, res) => {
  const resultado = await pool.query(
    "DELETE FROM ofertas_insumos WHERE id = $1 AND usuario_id = $2",
    [Number(req.params.id), req.usuario.id]
  );
  if (!resultado.rowCount) {
    return res.status(404).json({ erro: "Oferta não encontrada." });
  }
  res.status(204).send();
});

module.exports = router;
