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
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expira_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
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

    CREATE TABLE IF NOT EXISTS leituras_clima (
      id SERIAL PRIMARY KEY,
      talhao_id INTEGER REFERENCES talhoes(id) ON DELETE CASCADE,
      fonte TEXT NOT NULL,
      temperatura_minima DOUBLE PRECISION,
      chuva_acumulada_7d DOUBLE PRECISION,
      dias_sem_chuva INTEGER,
      probabilidade_chuva INTEGER,
      vento_maximo_kmh DOUBLE PRECISION,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cotacoes_mercado (
      id SERIAL PRIMARY KEY,
      cultura TEXT NOT NULL,
      data DATE NOT NULL,
      preco DOUBLE PRECISION NOT NULL,
      unidade TEXT NOT NULL,
      fonte TEXT NOT NULL,
      ticker TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (cultura, data, fonte)
    );

    CREATE TABLE IF NOT EXISTS analises_ia (
      id SERIAL PRIMARY KEY,
      cultura TEXT NOT NULL,
      resumo TEXT NOT NULL,
      gerar_por TEXT NOT NULL,
      fontes JSONB NOT NULL DEFAULT '[]'::jsonb,
      contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE sessoes
      ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_talhoes_usuario ON talhoes (usuario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leituras_clima_talhao ON leituras_clima (talhao_id, criado_em DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cotacoes_cultura ON cotacoes_mercado (cultura, data DESC);`);
  await pool.query(`DELETE FROM sessoes WHERE expira_em < NOW();`);
}

module.exports = { pool, inicializarBanco };
