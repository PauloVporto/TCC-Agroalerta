const express = require("express");
const router = express.Router();
const { resolverLocalizacaoPorCep } = require("../services/localizacao");
const { culturasSuportadas } = require("../services/rules");
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");

// Todas as rotas de talhão exigem usuário autenticado, e cada usuário
// só enxerga/mexe nos próprios talhões.
router.use(exigirAutenticacao);

/**
 * @swagger
 * /talhoes:
 *   get:
 *     summary: Lista os talhões do usuário autenticado
 *     tags: [Talhões]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Lista de talhões
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Talhao' }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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

/**
 * @swagger
 * /talhoes:
 *   post:
 *     summary: Cadastra um novo talhão para o usuário autenticado
 *     description: O CEP é validado via ViaCEP e geocodificado via Nominatim antes de salvar.
 *     tags: [Talhões]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, cultura, fase, cep]
 *             properties:
 *               nome: { type: string, example: "Talhão 02 - encosta" }
 *               cultura: { type: string, enum: [cafe, soja, milho, cana, feijao] }
 *               fase: { type: string, example: floracao }
 *               cep: { type: string, example: "37540-000" }
 *     responses:
 *       201:
 *         description: Talhão criado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Talhao' }
 *       400: { description: Campos obrigatórios ausentes, cultura inválida ou CEP não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.post("/", async (req, res) => {
  const { nome, cultura, fase, cep } = req.body;

  if (!nome || !cultura || !fase || !cep) {
    return res.status(400).json({
      erro: "Campos obrigatórios: nome, cultura, fase, cep",
    });
  }

  if (!culturasSuportadas().includes(cultura)) {
    return res.status(400).json({
      erro: "Cultura não suportada. Use uma de: " + culturasSuportadas().join(", "),
    });
  }

  const local = await resolverLocalizacaoPorCep(cep);
  if (!local.valido) {
    return res.status(400).json({ erro: local.erro });
  }

  const talhao = await criarTalhao(req.usuario.id, {
    nome, cultura, fase, endereco: local.enderecoFormatado, coordenadas: local,
  });
  res.status(201).json(talhao);
});

async function criarTalhao(usuarioId, { nome, cultura, fase, endereco, coordenadas }) {
  const resultado = await pool.query(
    `INSERT INTO talhoes
       (usuario_id, nome, cultura, fase, endereco, latitude, longitude, endereco_formatado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
               latitude, longitude, endereco_formatado AS "enderecoFormatado",
               criado_em AS "criadoEm"`,
    [usuarioId, nome, cultura, fase, endereco, coordenadas.latitude,
      coordenadas.longitude, coordenadas.enderecoFormatado]
  );
  return resultado.rows[0];
}

/**
 * @swagger
 * /talhoes/{id}:
 *   delete:
 *     summary: Remove um talhão (só o dono pode remover)
 *     tags: [Talhões]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204: { description: Talhão removido }
 *       403: { description: Talhão pertence a outro usuário, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       404: { description: Talhão não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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

/**
 * @swagger
 * /talhoes/{id}:
 *   patch:
 *     summary: Atualiza nome e/ou fase de um talhão (só o dono)
 *     tags: [Talhões]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nome: { type: string }
 *               fase: { type: string }
 *     responses:
 *       200:
 *         description: Talhão atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Talhao' }
 *       403: { description: Talhão pertence a outro usuário, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       404: { description: Talhão não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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

module.exports = { router, buscarTalhaoPorId, criarTalhao };
