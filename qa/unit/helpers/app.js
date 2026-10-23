const express = require("express");

/** Monta um app Express mínimo com o router sob teste montado em `base`. */
function montarApp(base, router) {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  return app;
}

/**
 * Implementação falsa do middleware de autenticação: aceita "Bearer ok" (usuário 1)
 * e "Bearer outro" (usuário 2); qualquer outra coisa responde 401 como o original.
 */
function autenticacaoFalsa(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ erro: "Token de autenticação ausente." });
  const token = h.slice(7);
  const usuarios = { ok: { id: 1, nome: "Ana", email: "ana@x.com" }, outro: { id: 2, nome: "Beto", email: "b@x.com" } };
  if (!usuarios[token]) return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  req.usuario = usuarios[token];
  next();
}

module.exports = { montarApp, autenticacaoFalsa };
