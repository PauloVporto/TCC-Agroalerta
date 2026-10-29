const express = require("express");

/** Monta um app Express mínimo com o router sob teste montado em `base`. */
function montarApp(base, router) {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  return app;
}

/**
 * Implementação falsa do middleware de autenticação. Cada token representa um
 * papel, para que as rotas protegidas por `exigirPapel` possam ser testadas:
 *   "Bearer ok"         -> produtor (usuário 1)
 *   "Bearer outro"      -> produtor (usuário 2), para checar isolamento entre contas
 *   "Bearer fornecedor" -> fornecedor (usuário 3)
 *   "Bearer admin"      -> administrador (usuário 4)
 * Qualquer outra coisa responde 401 como o middleware original.
 */
const USUARIOS_FALSOS = {
  ok: { id: 1, nome: "Ana", email: "ana@x.com", papel: "produtor" },
  outro: { id: 2, nome: "Beto", email: "b@x.com", papel: "produtor" },
  fornecedor: { id: 3, nome: "Carla", email: "c@x.com", papel: "fornecedor" },
  admin: { id: 4, nome: "Diego", email: "d@x.com", papel: "admin" },
};

function autenticacaoFalsa(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ erro: "Token de autenticação ausente." });
  const usuario = USUARIOS_FALSOS[h.slice(7)];
  if (!usuario) return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  req.usuario = usuario;
  next();
}

module.exports = { montarApp, autenticacaoFalsa, USUARIOS_FALSOS };
