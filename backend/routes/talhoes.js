const express = require("express");
const router = express.Router();
const { geocodificarEndereco } = require("../services/geocoding");
const { culturasSuportadas } = require("../services/rules");
const { exigirAutenticacao } = require("../services/auth");

// Store em memória (reinicia ao reiniciar o servidor).
// Para o TCC isso é suficiente para demonstrar o fluxo; uma evolução
// natural seria trocar por SQLite/Postgres.
let talhoes = [];
let proximoId = 1;

// Todas as rotas de talhão exigem usuário autenticado, e cada usuário
// só enxerga/mexe nos próprios talhões.
router.use(exigirAutenticacao);

// GET /api/talhoes - lista os talhões do usuário logado
router.get("/", (req, res) => {
  const doUsuario = talhoes.filter((t) => t.usuarioId === req.usuario.id);
  res.json(doUsuario);
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

  const novoTalhao = {
    id: proximoId++,
    usuarioId: req.usuario.id,
    nome,
    cultura,
    fase,
    endereco,
    latitude: coordenadas.latitude,
    longitude: coordenadas.longitude,
    enderecoFormatado: coordenadas.enderecoFormatado,
    criadoEm: new Date().toISOString(),
  };

  talhoes.push(novoTalhao);
  res.status(201).json(novoTalhao);
});

// DELETE /api/talhoes/:id - remove um talhão (só o dono pode remover)
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const talhao = talhoes.find((t) => t.id === id);

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para remover este talhão." });
  }

  talhoes = talhoes.filter((t) => t.id !== id);
  res.status(204).send();
});

// PATCH /api/talhoes/:id - atualiza fase/nome de um talhão (só o dono)
router.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const talhao = talhoes.find((t) => t.id === id);

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para editar este talhão." });
  }

  const { nome, fase } = req.body;
  if (nome) talhao.nome = nome;
  if (fase) talhao.fase = fase;

  res.json(talhao);
});

function buscarTalhaoPorId(id) {
  return talhoes.find((t) => t.id === Number(id));
}

function seedTalhaoExemplo(usuarioId) {
  talhoes.push({
    id: proximoId++,
    usuarioId,
    nome: "Talhão exemplo - Sítio Boa Esperança",
    cultura: "cafe",
    fase: "floracao",
    endereco: "Santa Rita do Sapucaí, MG",
    latitude: -22.2461,
    longitude: -45.7008,
    criadoEm: new Date().toISOString(),
  });
}

module.exports = { router, buscarTalhaoPorId, seedTalhaoExemplo };
