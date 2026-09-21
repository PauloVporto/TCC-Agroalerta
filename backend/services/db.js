const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://agroalerta:agroalerta@localhost:5432/agroalerta",
});

async function inicializarBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      cidade TEXT,
      cidade_formatada TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade_formatada TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS talhoes (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      cultura TEXT NOT NULL,
      fase TEXT NOT NULL,
      endereco TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      endereco_formatado TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS preferencias_usuario (
      usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
      cultura_favorita TEXT NOT NULL DEFAULT 'cafe',
      unidade_temperatura TEXT NOT NULL DEFAULT 'celsius',
      notificacoes BOOLEAN NOT NULL DEFAULT TRUE,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { pool, inicializarBanco };