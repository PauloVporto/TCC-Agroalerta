const banco = require("./helpers/banco");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");
const { aplicarMigracoes } = require("../../services/migracoes");

const PASTA = path.join(__dirname, "..", "..", "migrations");
const MIGRACAO = fs.readFileSync(path.join(PASTA, "001_notificacoes.sql"), "utf8");
const MIGRACAO_WHATSAPP = fs.readFileSync(path.join(PASTA, "002_whatsapp_evolution.sql"), "utf8");
const DESFAZER_WHATSAPP = fs.readFileSync(path.join(PASTA, "rollback", "002_whatsapp_evolution.down.sql"), "utf8");
const BANCO_LEGADO = "agroalerta_legado_teste";

before(() => banco.prepararBanco());
after(async () => {
  await banco.pool.query(`DROP DATABASE IF EXISTS ${BANCO_LEGADO}`);
  await banco.pool.end();
});

test("migrations já aplicadas não rodam de novo; o rollback fica fora da pasta lida na subida", async () => {
  assert.deepEqual(await aplicarMigracoes({ log: () => {} }), []);
  const { rows } = await banco.pool.query("SELECT versao FROM schema_migrations ORDER BY versao");
  assert.deepEqual(rows.map((r) => r.versao), ["001_notificacoes.sql", "002_whatsapp_evolution.sql"]);
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

// ---- 002: WhatsApp pela Evolution API -------------------------------------------------

// O que o SMS deixou no banco: consentimentos, preferências, histórico, eventos e webhook.
const DADOS_DO_SMS = `
  CREATE TABLE schema_migrations (versao TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW());
  INSERT INTO schema_migrations (versao) VALUES ('001_notificacoes.sql');
  INSERT INTO notificacao_consentimentos (usuario_id, canal, concedido, destino, origem)
    VALUES (1, 'sms', TRUE, '+5535999990001', 'cadastro'), (1, 'email', TRUE, 'ana@fazenda.com.br', 'cadastro');
  INSERT INTO notificacao_preferencias (usuario_id, email_nivel_minimo, sms_nivel_minimo) VALUES (1, 'alto', 'medio');
  INSERT INTO notificacao_envios (usuario_id, canal, tipo, chave_idempotencia, destino, conteudo, resumo, status, modo, provedor, provedor_id)
    VALUES (1, 'sms', 'teste', 'teste:sms:1', '+5535999990001', 'Agro Alerta: teste', 'Teste manual de SMS', 'entregue', 'sandbox', 'smsgo', 'uuid-1');
  INSERT INTO notificacao_eventos (envio_id, tipo, status, detalhe) VALUES (1, 'aceito', 'enviado', 'Aceito pelo provedor (id uuid-1).');
  INSERT INTO notificacao_webhooks (provedor, evento_id, tipo, payload) VALUES ('smsgo', 'evt-1', 'sms.status', '{"status":"delivered"}');
`;

async function bancoLegadoComSms() {
  await banco.pool.query(`DROP DATABASE IF EXISTS ${BANCO_LEGADO}`);
  await banco.pool.query(`CREATE DATABASE ${BANCO_LEGADO}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = "/" + BANCO_LEGADO;
  const legado = new Pool({ connectionString: url.toString() });
  await legado.query(ESQUEMA_LEGADO);
  await legado.query(MIGRACAO);
  await legado.query(DADOS_DO_SMS);
  return legado;
}

async function aplicarWhatsapp(legado) {
  await legado.query(MIGRACAO_WHATSAPP);
  await legado.query("INSERT INTO schema_migrations (versao) VALUES ('002_whatsapp_evolution.sql') ON CONFLICT DO NOTHING");
}

// Retrato do esquema (colunas, restrições e índices) para comparar antes e depois.
async function esquema(db) {
  const colunas = await db.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`
  );
  const restricoes = await db.query(
    `SELECT conrelid::regclass::text AS tabela, conname, pg_get_constraintdef(oid) AS definicao
     FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`
  );
  const indices = await db.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2");
  return { colunas: colunas.rows, restricoes: restricoes.rows, indices: indices.rows };
}

async function dadosDoSms(db) {
  const consultas = {
    consentimentos: "SELECT usuario_id, canal, concedido, destino, origem, criado_em FROM notificacao_consentimentos ORDER BY id",
    preferencias: "SELECT usuario_id, email_nivel_minimo, sms_nivel_minimo, atualizado_em FROM notificacao_preferencias ORDER BY usuario_id",
    envios: "SELECT id, canal, tipo, status, modo, provedor, provedor_id, destino, conteudo, criado_em FROM notificacao_envios ORDER BY id",
    eventos: "SELECT envio_id, tipo, status, detalhe, criado_em FROM notificacao_eventos ORDER BY id",
    webhooks: "SELECT provedor, evento_id, tipo, payload FROM notificacao_webhooks ORDER BY id",
  };
  const dados = {};
  for (const [nome, sql] of Object.entries(consultas)) dados[nome] = (await db.query(sql)).rows;
  return dados;
}

test("a 002 roda sobre o banco com SMS: preserva histórico e consentimentos e não converte SMS em WhatsApp", async () => {
  const legado = await bancoLegadoComSms();
  try {
    const antes = await dadosDoSms(legado);
    await aplicarWhatsapp(legado);
    // Reaplicar o mesmo SQL também é inofensivo (restrições recriadas, tabelas e colunas IF NOT EXISTS).
    await legado.query(MIGRACAO_WHATSAPP);

    assert.deepEqual(await dadosDoSms(legado), antes, "nenhuma linha antiga mudou");
    const whatsapp = await legado.query("SELECT COUNT(*)::int AS total FROM notificacao_consentimentos WHERE canal = 'whatsapp'");
    assert.equal(whatsapp.rows[0].total, 0, "o canal novo começa sem autorização nenhuma");
    const preferencia = await legado.query("SELECT whatsapp_nivel_minimo FROM notificacao_preferencias");
    assert.deepEqual(preferencia.rows, [{ whatsapp_nivel_minimo: "medio" }]);
    const controle = await legado.query("SELECT id, envios_bloqueados, boas_vindas_ativas, alertas_ativos FROM whatsapp_controle");
    assert.deepEqual(controle.rows, [{ id: 1, envios_bloqueados: true, boas_vindas_ativas: true, alertas_ativos: true }]);

    // O vocabulário novo é aceito; valores fora dele continuam recusados.
    await legado.query(`
      INSERT INTO notificacao_consentimentos (usuario_id, canal, concedido, destino, origem) VALUES (1, 'whatsapp', TRUE, '+5535999990001', 'painel');
      INSERT INTO notificacao_envios (usuario_id, canal, tipo, chave_idempotencia, destino, conteudo, resumo, status, expira_em)
        VALUES (1, 'whatsapp', 'boas_vindas', 'boas_vindas:whatsapp:usuario:1', '+5535999990001', 'x', 'x', 'incerto', NOW());
      INSERT INTO notificacao_webhooks (provedor, evento_id, tipo, payload, referencia) VALUES ('evolution', 'e1', 'messages.update', '{}', 'MSG-1');
      INSERT INTO administracao_eventos (categoria, tipo) VALUES ('conexao', 'conectado');
    `);
    await assert.rejects(legado.query("UPDATE notificacao_envios SET status = 'inventado' WHERE id = 1"), /violates check constraint/);
    await assert.rejects(legado.query("INSERT INTO whatsapp_controle (id) VALUES (2)"), /violates check constraint/);
    await assert.rejects(legado.query("INSERT INTO administracao_eventos (categoria, tipo) VALUES ('outra', 'x')"), /violates check constraint/);
  } finally {
    await legado.end();
  }
});

test("rollback da 002: sem dados do WhatsApp volta exatamente ao esquema anterior; com dados, recusa sem mudar nada", async () => {
  const legado = await bancoLegadoComSms();
  try {
    const anterior = await esquema(legado);
    const dadosAnteriores = await dadosDoSms(legado);
    await aplicarWhatsapp(legado);
    assert.notDeepEqual(await esquema(legado), anterior);

    await legado.query(DESFAZER_WHATSAPP);
    assert.deepEqual(await esquema(legado), anterior, "colunas, restrições e índices como antes da 002");
    assert.deepEqual(await dadosDoSms(legado), dadosAnteriores);
    const versoes = await legado.query("SELECT versao FROM schema_migrations ORDER BY versao");
    assert.deepEqual(versoes.rows.map((r) => r.versao), ["001_notificacoes.sql"]);

    // Com a 002 de volta e uma autorização de WhatsApp gravada, desfazer apagaria dados: é recusado.
    await aplicarWhatsapp(legado);
    await legado.query(
      "INSERT INTO notificacao_consentimentos (usuario_id, canal, concedido, destino, origem) VALUES (1, 'whatsapp', TRUE, '+5535999990001', 'painel')"
    );
    const comDados = await esquema(legado);
    await assert.rejects(legado.query(DESFAZER_WHATSAPP), /restaure o backup feito antes dela/);
    assert.deepEqual(await esquema(legado), comDados, "a recusa não mudou nada");
  } finally {
    await legado.end();
  }
});
