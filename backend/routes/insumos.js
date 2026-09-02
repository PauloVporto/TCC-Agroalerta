const express = require("express");
const router = express.Router();
const { gerarInsightCompra } = require("../services/insumosIA");
const { listarInsumos, insumosParaAlerta, catalogo } = require("../services/insumosCatalog");
const { exigirAutenticacao, exigirPapel } = require("../services/auth");
const { pool } = require("../services/db");

router.get("/", async (req, res) => {
  try {
    res.json(await listarInsumos(req.query.categoria));
  } catch (erro) {
    console.error("[insumos] listar:", erro);
    res.status(500).json({ erro: "Não foi possível listar os insumos." });
  }
});

router.get("/recomendados/:alertaId", async (req, res) => {
  const insumos = await insumosParaAlerta(req.params.alertaId);
  if (insumos === null) {
    return res.status(404).json({ erro: "Regra de alerta desconhecida" });
  }
  res.json(insumos);
});

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
