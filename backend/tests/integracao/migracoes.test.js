const banco = require("./helpers/banco");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");
const { aplicarMigracoes } = require("../../services/migracoes");

const MIGRACAO = fs.readFileSync(path.join(__dirname, "..", "..", "migrations", "001_notificacoes.sql"), "utf8");
const BANCO_LEGADO = "agroalerta_legado_teste";

before(() => banco.prepararBanco());
after(async () => {
  await banco.pool.query(`DROP DATABASE IF EXISTS ${BANCO_LEGADO}`);
  await banco.pool.end();
});

test("migrations já aplicadas não rodam de novo", async () => {
  assert.deepEqual(await aplicarMigracoes({ log: () => {} }), []);
  const { rows } = await banco.pool.query("SELECT versao FROM schema_migrations ORDER BY versao");
  assert.deepEqual(rows.map((r) => r.versao), ["001_notificacoes.sql"]);
});

test("migration com erro é desfeita por inteiro e não fica registrada", async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "agroalerta-migracoes-"));
  fs.writeFileSync(path.join(pasta, "999_quebrada.sql"), "CREATE TABLE tabela_parcial (id INT); SELECT * FROM tabela_inexistente;");
  fs.writeFileSync(path.join(pasta, "LEIAME.txt"), "arquivos que não são .sql são ignorados");
  await assert.rejects(aplicarMigracoes({ pasta, log: () => {} }), /Falha na migration 999_quebrada\.sql: .*tabela_inexistente/);
  const { rows } = await banco.pool.query("SELECT to_regclass('tabela_parcial') AS tabela, (SELECT COUNT(*)::int FROM schema_migrations WHERE versao = '999_quebrada.sql') AS registrada");
  assert.deepEqual(rows[0], { tabela: null, registrada: 0 });
  fs.rmSync(pasta, { recursive: true });
});

// Esquema que o banco local já tinha antes desta migration (criado pela branch LuizHenrique).
const ESQUEMA_LEGADO = `
  CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL,
    salt TEXT NOT NULL, cidade TEXT, cidade_formatada TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), papel TEXT NOT NULL DEFAULT 'produtor', telefone TEXT);
  CREATE TABLE talhoes (
    id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, cultura TEXT NOT NULL, fase TEXT NOT NULL, endereco TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL, endereco_formatado TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), poligono JSONB, area_ha DOUBLE PRECISION, variedade TEXT,
    area_unidade TEXT NOT NULL DEFAULT 'ha');
  CREATE TABLE leituras_clima (
    id SERIAL PRIMARY KEY, talhao_id INTEGER REFERENCES talhoes(id) ON DELETE CASCADE, fonte TEXT NOT NULL,
    temperatura_minima DOUBLE PRECISION, chuva_acumulada_7d DOUBLE PRECISION, dias_sem_chuva INTEGER,
    probabilidade_chuva INTEGER, vento_maximo_kmh DOUBLE PRECISION, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE alertas_gerados (
    id SERIAL PRIMARY KEY, talhao_id INTEGER NOT NULL REFERENCES talhoes(id) ON DELETE CASCADE,
    regra_id TEXT NOT NULL, nivel TEXT NOT NULL, titulo TEXT NOT NULL, mensagem TEXT NOT NULL,
    recomendacao TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE envios_alerta (
    id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    canal TEXT NOT NULL, destino TEXT NOT NULL, modo TEXT NOT NULL, sucesso BOOLEAN NOT NULL DEFAULT FALSE,
    detalhe TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW());

  INSERT INTO usuarios (nome, email, senha_hash, salt, cidade, telefone) VALUES
    ('Ana', 'ana@fazenda.com.br', 'h', 's', 'Lavras - MG', '(35) 99999-0001'),
    ('Bruno', 'bruno@sitio.com.br', 'h', 's', NULL, NULL),
    ('Carla', 'carla@fazenda.com.br', 'h', 's', 'Lavras - MG', NULL);
  INSERT INTO talhoes (usuario_id, nome, cultura, fase, endereco, latitude, longitude, endereco_formatado) VALUES
    (1, 'Encosta', 'cafe', 'plantio', 'Lavras, Região Geográfica Imediata de Lavras, Minas Gerais, Brasil', -21.2, -45.0,
     'Lavras, Região Geográfica Imediata de Lavras, Minas Gerais, Brasil'),
    (2, 'Baixada', 'soja', 'plantio', 'Rua A, Centro, Varginha - MG', -21.5, -45.4, NULL),
    (3, 'Vizinho', 'cafe', 'plantio', 'Perdões, Região Geográfica Imediata de Lavras, Minas Gerais, Brasil', -21.1, -45.1,
     'Perdões, Região Geográfica Imediata de Lavras, Minas Gerais, Brasil');
  INSERT INTO alertas_gerados (talhao_id, regra_id, nivel, titulo, mensagem, recomendacao)
    VALUES (1, 'cafe_geada', 'alto', 'Risco de geada', 'm', 'r');
  INSERT INTO envios_alerta (usuario_id, canal, destino, modo) VALUES (1, 'sms', '+5535999990001', 'simulado');
`;

test("a migration roda sobre o banco local já existente, preserva os dados e preenche a região dos talhões", async () => {
  await banco.pool.query(`DROP DATABASE IF EXISTS ${BANCO_LEGADO}`);
  await banco.pool.query(`CREATE DATABASE ${BANCO_LEGADO}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = "/" + BANCO_LEGADO;
  const legado = new Pool({ connectionString: url.toString() });
  try {
    await legado.query(ESQUEMA_LEGADO);
    await legado.query(MIGRACAO);
    // Reaplicar o mesmo SQL também é inofensivo (tudo é IF NOT EXISTS ou só preenche vazios).
    await legado.query(MIGRACAO);

    const talhoes = await legado.query("SELECT nome, regiao FROM talhoes ORDER BY id");
    assert.deepEqual(talhoes.rows, [
      { nome: "Encosta", regiao: "Lavras - MG" },
      { nome: "Baixada", regiao: "Varginha - MG" },
      { nome: "Vizinho", regiao: "Perdões" },
    ]);
    const usuarios = await legado.query("SELECT telefone, papel FROM usuarios ORDER BY id");
    assert.deepEqual(usuarios.rows.map((u) => u.telefone), ["(35) 99999-0001", null, null]);
    assert.ok(usuarios.rows.every((u) => u.papel === "produtor"));

    const alerta = await legado.query("SELECT regra_id, janela, regiao, leitura_id, ultima_deteccao_em IS NOT NULL AS tem_deteccao FROM alertas_gerados");
    assert.deepEqual(alerta.rows, [{ regra_id: "cafe_geada", janela: null, regiao: null, leitura_id: null, tem_deteccao: true }]);
    assert.equal((await legado.query("SELECT COUNT(*)::int AS total FROM envios_alerta")).rows[0].total, 1);

    const tabelas = await legado.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'notificacao_%' ORDER BY table_name`
    );
    assert.deepEqual(tabelas.rows.map((t) => t.table_name), [
      "notificacao_consentimentos",
      "notificacao_envios",
      "notificacao_eventos",
      "notificacao_preferencias",
      "notificacao_webhooks",
    ]);
  } finally {
    await legado.end();
  }
});
