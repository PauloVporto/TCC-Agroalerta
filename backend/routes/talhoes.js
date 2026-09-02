const express = require("express");
const router = express.Router();
const { geocodificarEndereco, geocodificarReverso, areaHectares } = require("../services/geocoding");
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
            poligono, area_ha AS "areaHa",
            criado_em AS "criadoEm"
     FROM talhoes WHERE usuario_id = $1 ORDER BY id`,
    [req.usuario.id]
  );
  res.json(resultado.rows);
});

// GET /api/talhoes/geocodificar?endereco=... - localiza endereço para o mapa de cadastro
router.get("/geocodificar", async (req, res) => {
  const endereco = String(req.query.endereco || "").trim();
  if (!endereco) {
    return res.status(400).json({ erro: "Informe o endereço para localizar no mapa." });
  }

  try {
    const coords = await geocodificarEndereco(endereco);
    res.json(coords);
  } catch (erro) {
    console.error("[talhoes] Geocodificação falhou:", erro.message);
    res.status(400).json({ erro: "Não foi possível localizar esse endereço. Tente cidade, bairro ou referência mais específica." });
  }
});

router.get("/geocodificar-reverso", async (req, res) => {
  try {
    const coords = await geocodificarReverso(req.query.lat, req.query.lng);
    res.json(coords);
  } catch (erro) {
    res.status(400).json({ erro: erro.message || "Não foi possível identificar o endereço desse ponto." });
  }
});

// POST /api/talhoes - cadastra um novo talhão para o usuário logado
// body: { nome, cultura, fase, endereco }
router.post("/", async (req, res) => {
  const { nome, cultura, fase, endereco, latitude, longitude, poligono } = req.body;

  if (!nome || !cultura || !fase) {
    return res.status(400).json({
      erro: "Campos obrigatórios: nome, cultura, fase",
    });
  }

  if (!culturasSuportadas().includes(cultura)) {
    return res.status(400).json({
      erro: "Cultura não suportada. Use uma de: " + culturasSuportadas().join(", "),
    });
  }

  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  let coords;
  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    coords = {
      latitude: latNum,
      longitude: lngNum,
      enderecoFormatado: endereco || "Área marcada no mapa",
      fonte: "mapa",
    };
  } else if (endereco) {
    coords = await geocodificarEndereco(endereco);
  } else {
    return res.status(400).json({ erro: "Marque o talhão no mapa ou informe um endereço." });
  }

  const areaHa = areaHectares(poligono);

  const resultado = await pool.query(
    `INSERT INTO talhoes
       (usuario_id, nome, cultura, fase, endereco, latitude, longitude, endereco_formatado, poligono, area_ha)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
               latitude, longitude, endereco_formatado AS "enderecoFormatado",
               poligono, area_ha AS "areaHa",
               criado_em AS "criadoEm"`,
    [
      req.usuario.id,
      nome,
      cultura,
      fase,
      endereco || coords.enderecoFormatado,
      coords.latitude,
      coords.longitude,
      coords.enderecoFormatado,
      poligono ? JSON.stringify(poligono) : null,
      areaHa,
    ]
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

// PATCH /api/talhoes/:id - atualiza nome, cultura e fase (só o dono)
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId", nome, cultura, fase FROM talhoes WHERE id = $1`,
    [id]
  );
  const talhao = resultado.rows[0];

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para editar este talhão." });
  }

  const nome = req.body.nome != null ? String(req.body.nome).trim() : talhao.nome;
  const cultura = req.body.cultura != null ? String(req.body.cultura).trim() : talhao.cultura;
  const fase = req.body.fase != null ? String(req.body.fase).trim() : talhao.fase;

  if (!nome) {
    return res.status(400).json({ erro: "Informe o nome do talhão." });
  }
  if (!culturasSuportadas().includes(cultura)) {
    return res.status(400).json({
      erro: "Cultura não suportada. Use uma de: " + culturasSuportadas().join(", "),
    });
  }
  if (!fase) {
    return res.status(400).json({ erro: "Informe a fase da cultura." });
  }

  const atualizado = await pool.query(
    `UPDATE talhoes SET nome = $1, cultura = $2, fase = $3 WHERE id = $4
     RETURNING id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
               latitude, longitude, endereco_formatado AS "enderecoFormatado",
               poligono, area_ha AS "areaHa",
               criado_em AS "criadoEm"`,
    [nome, cultura, fase, id]
  );

  res.json(atualizado.rows[0]);
});

async function buscarTalhaoPorId(id) {
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId", nome, cultura, fase, endereco,
            latitude, longitude, endereco_formatado AS "enderecoFormatado",
            poligono, area_ha AS "areaHa",
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
