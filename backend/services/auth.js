/**
 * Serviço de autenticação simples, adequado para um protótipo de TCC.
 *
 * - Senhas armazenadas com hash (scrypt, nativo do Node - não precisa de
 *   dependência extra como bcrypt).
 * - Sessão via token opaco (não é um JWT de verdade, mas cumpre o mesmo
 *   papel para o escopo do projeto: identificar o usuário nas próximas
 *   requisições).
 * - Tudo em memória. Numa evolução futura, trocar por um banco real
 *   (ex: SQLite) mantendo essa mesma interface.
 */

const crypto = require("crypto");

const usuarios = []; // { id, nome, email, senhaHash, salt, criadoEm }
const sessoes = new Map(); // token -> usuarioId
let proximoId = 1;

function hashSenha(senha, salt) {
  return crypto.scryptSync(senha, salt, 64).toString("hex");
}

function criarUsuario({ nome, email, senha }) {
  const existente = usuarios.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existente) {
    throw new Error("Já existe uma conta com esse e-mail.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const novoUsuario = {
    id: proximoId++,
    nome,
    email,
    salt,
    senhaHash: hashSenha(senha, salt),
    criadoEm: new Date().toISOString(),
  };

  usuarios.push(novoUsuario);
  return sanitizar(novoUsuario);
}

function autenticar({ email, senha }) {
  const usuario = usuarios.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!usuario) {
    throw new Error("E-mail ou senha inválidos.");
  }

  const hashInformado = hashSenha(senha, usuario.salt);
  if (hashInformado !== usuario.senhaHash) {
    throw new Error("E-mail ou senha inválidos.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessoes.set(token, usuario.id);

  return { token, usuario: sanitizar(usuario) };
}

function encerrarSessao(token) {
  sessoes.delete(token);
}

function usuarioPorToken(token) {
  const usuarioId = sessoes.get(token);
  if (!usuarioId) return null;
  const usuario = usuarios.find((u) => u.id === usuarioId);
  return usuario ? sanitizar(usuario) : null;
}

function sanitizar(usuario) {
  const { senhaHash, salt, ...resto } = usuario;
  return resto;
}

/**
 * Middleware Express: exige um token válido no header Authorization.
 * Formato esperado: "Authorization: Bearer <token>"
 */
function exigirAutenticacao(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: "Token de autenticação ausente." });
  }

  const usuario = usuarioPorToken(token);
  if (!usuario) {
    return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  }

  req.usuario = usuario;
  next();
}

module.exports = { criarUsuario, autenticar, encerrarSessao, usuarioPorToken, exigirAutenticacao };
