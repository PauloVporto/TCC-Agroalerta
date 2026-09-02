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
      poligono JSONB,
      area_ha DOUBLE PRECISION,
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

    CREATE TABLE IF NOT EXISTS ofertas_insumos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      insumo_catalogo_id TEXT,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL,
      unidade TEXT NOT NULL,
      preco DOUBLE PRECISION NOT NULL,
      cidade TEXT NOT NULL,
      telefone TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alertas_gerados (
      id SERIAL PRIMARY KEY,
      talhao_id INTEGER NOT NULL REFERENCES talhoes(id) ON DELETE CASCADE,
      regra_id TEXT NOT NULL,
      nivel TEXT NOT NULL,
      titulo TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      recomendacao TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS mensagens_produtor (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      talhao_id INTEGER REFERENCES talhoes(id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      nivel TEXT NOT NULL,
      titulo TEXT NOT NULL,
      corpo TEXT NOT NULL,
      recomendacao TEXT NOT NULL DEFAULT '',
      lida BOOLEAN NOT NULL DEFAULT FALSE,
      enviado_email_em TIMESTAMPTZ,
      enviado_sms_em TIMESTAMPTZ,
      status_email TEXT,
      status_sms TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (usuario_id, talhao_id, chave)
    );

    CREATE TABLE IF NOT EXISTS envios_alerta (
      id SERIAL PRIMARY KEY,
      mensagem_id INTEGER REFERENCES mensagens_produtor(id) ON DELETE SET NULL,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      canal TEXT NOT NULL,
      destino TEXT NOT NULL,
      modo TEXT NOT NULL,
      sucesso BOOLEAN NOT NULL DEFAULT FALSE,
      detalhe TEXT NOT NULL DEFAULT '',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE sessoes
      ADD COLUMN IF NOT EXISTS expira_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');
    ALTER TABLE talhoes ADD COLUMN IF NOT EXISTS poligono JSONB;
    ALTER TABLE talhoes ADD COLUMN IF NOT EXISTS area_ha DOUBLE PRECISION;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS papel TEXT NOT NULL DEFAULT 'produtor';
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade TEXT;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
    ALTER TABLE mensagens_produtor ADD COLUMN IF NOT EXISTS enviado_email_em TIMESTAMPTZ;
    ALTER TABLE mensagens_produtor ADD COLUMN IF NOT EXISTS enviado_sms_em TIMESTAMPTZ;
    ALTER TABLE mensagens_produtor ADD COLUMN IF NOT EXISTS status_email TEXT;
    ALTER TABLE mensagens_produtor ADD COLUMN IF NOT EXISTS status_sms TEXT;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_talhoes_usuario ON talhoes (usuario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leituras_clima_talhao ON leituras_clima (talhao_id, criado_em DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cotacoes_cultura ON cotacoes_mercado (cultura, data DESC);`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_mensagens_usuario ON mensagens_produtor (usuario_id, lida, atualizado_em DESC);`
  );
  await pool.query(`DELETE FROM sessoes WHERE expira_em < NOW();`);
}

module.exports = { pool, inicializarBanco };
