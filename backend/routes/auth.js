const express = require("express");
const router = express.Router();
const { criarUsuario, autenticar, encerrarSessao, exigirAutenticacao } = require("../services/auth");

// POST /api/auth/registrar
// body: { nome, email, senha }
router.post("/registrar", (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Campos obrigatórios: nome, email, senha" });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
  }

  try {
    const usuario = criarUsuario({ nome, email, senha });
    // Já loga o usuário automaticamente após o cadastro
    const { token } = autenticar({ email, senha });
    res.status(201).json({ usuario, token });
  } catch (erro) {
    res.status(409).json({ erro: erro.message });
  }
});

// POST /api/auth/login
// body: { email, senha }
router.post("/login", (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: "Informe e-mail e senha." });
  }

  try {
    const { token, usuario } = autenticar({ email, senha });
    res.json({ usuario, token });
  } catch (erro) {
    res.status(401).json({ erro: erro.message });
  }
});

// POST /api/auth/logout
router.post("/logout", exigirAutenticacao, (req, res) => {
  const token = req.headers.authorization.slice(7);
  encerrarSessao(token);
  res.status(204).send();
});

// GET /api/auth/me - retorna o usuário logado (útil para o frontend checar a sessão)
router.get("/me", exigirAutenticacao, (req, res) => {
  res.json(req.usuario);
});

module.exports = router;
