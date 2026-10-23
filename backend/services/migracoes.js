/**
 * Aplica, em ordem, os arquivos .sql de backend/migrations que ainda não rodaram
 * neste banco. Cada arquivo roda numa transação própria e fica registrado em
 * schema_migrations, então reiniciar o backend nunca reaplica uma migration.
 */

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const PASTA_PADRAO = path.join(__dirname, "..", "migrations");

async function aplicarMigracoes({ pasta = PASTA_PADRAO, log = console.log } = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      versao TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const { rows } = await pool.query("SELECT versao FROM schema_migrations");
  const aplicadas = new Set(rows.map((r) => r.versao));
  const pendentes = fs
    .readdirSync(pasta)
    .filter((arquivo) => arquivo.endsWith(".sql") && !aplicadas.has(arquivo))
    .sort();

  for (const arquivo of pendentes) {
    const sql = fs.readFileSync(path.join(pasta, arquivo), "utf8");
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query(sql);
      await cliente.query("INSERT INTO schema_migrations (versao) VALUES ($1)", [arquivo]);
      await cliente.query("COMMIT");
      log("[migracoes] aplicada: " + arquivo);
    } catch (erro) {
      await cliente.query("ROLLBACK");
      throw new Error("Falha na migration " + arquivo + ": " + erro.message);
    } finally {
      cliente.release();
    }
  }
  return pendentes;
}

module.exports = { aplicarMigracoes };
