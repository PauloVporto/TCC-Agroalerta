/**
 * Serviço de autenticação simples, adequado para um protótipo de TCC.
 *
 * - Senhas armazenadas com hash (scrypt, nativo do Node - não precisa de
 *   dependência extra como bcrypt).
 * - Sessão via token opaco (não é um JWT de verdade, mas cumpre o mesmo
 *   papel para o escopo do projeto: identificar o usuário nas próximas
 *   requisições).
 * - Usuários e sessões ficam no PostgreSQL, mantendo a interface usada pelas rotas.
 */

const crypto = require("crypto");
const { pool } = require("./db");

function hashSenha(senha, salt) {
  return crypto.scryptSync(senha, salt, 64).toString("hex");
}

async function criarUsuario({ nome, email, senha }) {
  const salt = crypto.randomBytes(16).toString("hex");
  try {
    const resultado = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, salt)
       VALUES ($1, LOWER($2), $3, $4)
       RETURNING id, nome, email, salt, criado_em AS "criadoEm"`,
      [nome, email, hashSenha(senha, salt), salt]
    );
    const usuario = sanitizar(resultado.rows[0]);
    await pool.query("INSERT INTO preferencias_usuario (usuario_id) VALUES ($1)", [usuario.id]);
    return usuario;
  } catch (erro) {
    if (erro.code === "23505") throw new Error("Já existe uma conta com esse e-mail.");
    throw erro;
  }
}

async function autenticar({ email, senha }) {
  const resultado = await pool.query(
    `SELECT id, nome, email, senha_hash AS "senhaHash", salt, criado_em AS "criadoEm"
     FROM usuarios WHERE email = LOWER($1)`,
    [email]
  );
  const usuario = resultado.rows[0];
  if (!usuario) {
    throw new Error("E-mail ou senha inválidos.");
  }

  const hashInformado = hashSenha(senha, usuario.salt);
  if (hashInformado !== usuario.senhaHash) {
    throw new Error("E-mail ou senha inválidos.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO sessoes (token, usuario_id) VALUES ($1, $2)", [token, usuario.id]);

  return { token, usuario: sanitizar(usuario) };
}

async function encerrarSessao(token) {
  await pool.query("DELETE FROM sessoes WHERE token = $1", [token]);
}

async function usuarioPorToken(token) {
  const resultado = await pool.query(
    `SELECT u.id, u.nome, u.email, u.criado_em AS "criadoEm"
     FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = $1`,
    [token]
  );
  return resultado.rows[0] ? sanitizar(resultado.rows[0]) : null;
}

async function obterConfiguracoes(usuarioId) {
  const resultado = await pool.query(
    `SELECT u.id, u.nome, u.email, u.criado_em AS "criadoEm",
            COALESCE(p.cultura_favorita, 'cafe') AS "culturaFavorita",
            COALESCE(p.unidade_temperatura, 'celsius') AS "unidadeTemperatura",
            COALESCE(p.notificacoes, TRUE) AS notificacoes
     FROM usuarios u
     LEFT JOIN preferencias_usuario p ON p.usuario_id = u.id
     WHERE u.id = $1`,
    [usuarioId]
  );
  return resultado.rows[0] || null;
}

async function atualizarPerfil(usuarioId, { nome, email }) {
  try {
    const resultado = await pool.query(
      `UPDATE usuarios SET nome = $1, email = LOWER($2) WHERE id = $3
       RETURNING id, nome, email, criado_em AS "criadoEm"`,
      [nome, email, usuarioId]
    );
    return resultado.rows[0] ? sanitizar(resultado.rows[0]) : null;
  } catch (erro) {
    if (erro.code === "23505") throw new Error("Já existe uma conta com esse e-mail.");
    throw erro;
  }
}

async function atualizarPreferencias(usuarioId, preferencias) {
  const resultado = await pool.query(
    `INSERT INTO preferencias_usuario
       (usuario_id, cultura_favorita, unidade_temperatura, notificacoes, atualizado_em)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (usuario_id) DO UPDATE SET
       cultura_favorita = EXCLUDED.cultura_favorita,
       unidade_temperatura = EXCLUDED.unidade_temperatura,
       notificacoes = EXCLUDED.notificacoes,
       atualizado_em = NOW()
     RETURNING cultura_favorita AS "culturaFavorita",
               unidade_temperatura AS "unidadeTemperatura", notificacoes`,
    [usuarioId, preferencias.culturaFavorita, preferencias.unidadeTemperatura, preferencias.notificacoes]
  );
  return resultado.rows[0];
}

async function alterarSenha(usuarioId, senhaAtual, novaSenha) {
  const resultado = await pool.query(
    `SELECT senha_hash AS "senhaHash", salt FROM usuarios WHERE id = $1`, [usuarioId]
  );
  const usuario = resultado.rows[0];
  if (!usuario || hashSenha(senhaAtual, usuario.salt) !== usuario.senhaHash) {
    throw new Error("A senha atual está incorreta.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  await pool.query(
    "UPDATE usuarios SET senha_hash = $1, salt = $2 WHERE id = $3",
    [hashSenha(novaSenha, salt), salt, usuarioId]
  );
}

async function excluirConta(usuarioId) {
  await pool.query("DELETE FROM usuarios WHERE id = $1", [usuarioId]);
}

function sanitizar(usuario) {
  const { senhaHash, salt, ...resto } = usuario;
  return resto;
}

/**
 * Middleware Express: exige um token válido no header Authorization.
 * Formato esperado: "Authorization: Bearer <token>"
 */
async function exigirAutenticacao(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: "Token de autenticação ausente." });
  }

  const usuario = await usuarioPorToken(token);
  if (!usuario) {
    return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  }

  req.usuario = usuario;
  next();
}

module.exports = {
  criarUsuario,
  autenticar,
  encerrarSessao,
  usuarioPorToken,
  obterConfiguracoes,
  atualizarPerfil,
  atualizarPreferencias,
  alterarSenha,
  excluirConta,
  exigirAutenticacao,
};
