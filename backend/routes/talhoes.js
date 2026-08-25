const express = require("express");
const router = express.Router();
const { geocodificarEndereco } = require("../services/geocoding");
const { culturasSuportadas } = require("../services/rules");
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");

// Todas as rotas de talhão exigem usuário autenticado, e cada usuário
// só enxerga/mexe nos próprios talhões.
router.use(exigirAutenticacao);

// GET /api/talhoes - lista os talhões do usuário logado
router.get("/", async (req, res) => {
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
            latitude, longitude, endereco_formatado AS "enderecoFormatado",
            criado_em AS "criadoEm"
     FROM talhoes WHERE usuario_id = $1 ORDER BY id`,
    [req.usuario.id]
  );
  res.json(resultado.rows);
});

// POST /api/talhoes - cadastra um novo talhão para o usuário logado
// body: { nome, cultura, fase, endereco }
router.post("/", async (req, res) => {
  const { nome, cultura, fase, endereco } = req.body;

  if (!nome || !cultura || !fase || !endereco) {
    return res.status(400).json({
      erro: "Campos obrigatórios: nome, cultura, fase, endereco",
    });
  }

  if (!culturasSuportadas().includes(cultura)) {
    return res.status(400).json({
      erro: "Cultura não suportada. Use uma de: " + culturasSuportadas().join(", "),
    });
  }

  const coordenadas = await geocodificarEndereco(endereco);

  const resultado = await pool.query(
    `INSERT INTO talhoes
       (usuario_id, nome, cultura, fase, endereco, latitude, longitude, endereco_formatado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
               latitude, longitude, endereco_formatado AS "enderecoFormatado",
               criado_em AS "criadoEm"`,
    [req.usuario.id, nome, cultura, fase, endereco, coordenadas.latitude,
      coordenadas.longitude, coordenadas.enderecoFormatado]
  );
  res.status(201).json(resultado.rows[0]);
});

// DELETE /api/talhoes/:id - remove um talhão (só o dono pode remover)
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId" FROM talhoes WHERE id = $1`, [id]
  );
  const talhao = resultado.rows[0];

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para remover este talhão." });
  }

  await pool.query("DELETE FROM talhoes WHERE id = $1", [id]);
  res.status(204).send();
});

// PATCH /api/talhoes/:id - atualiza fase/nome de um talhão (só o dono)
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId", nome, fase FROM talhoes WHERE id = $1`, [id]
  );
  const talhao = resultado.rows[0];

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para editar este talhão." });
  }

  const { nome, fase } = req.body;
  if (nome) talhao.nome = nome;
  if (fase) talhao.fase = fase;

  const atualizado = await pool.query(
    `UPDATE talhoes SET nome = $1, fase = $2 WHERE id = $3
     RETURNING id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
               latitude, longitude, endereco_formatado AS "enderecoFormatado",
               criado_em AS "criadoEm"`,
    [talhao.nome, talhao.fase, id]
  );

  res.json(atualizado.rows[0]);
});

async function buscarTalhaoPorId(id) {
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
            latitude, longitude, endereco_formatado AS "enderecoFormatado",
            criado_em AS "criadoEm"
     FROM talhoes WHERE id = $1`,
    [Number(id)]
  );
  return resultado.rows[0] || null;
}

async function seedTalhaoExemplo(usuarioId) {
  await pool.query(
    `INSERT INTO talhoes
      (usuario_id, nome, cultura, fase, endereco, latitude, longitude)
     VALUES ($1, 'Talhão exemplo - Sítio Boa Esperança', 'cafe', 'floracao',
             'Santa Rita do Sapucaí, MG', -22.2461, -45.7008)`,
    [usuarioId]
  );
}

module.exports = { router, buscarTalhaoPorId, seedTalhaoExemplo };
