/**
 * Linha do tempo de cada envio (notificacao_eventos): enfileirado, tentativas,
 * aceite, confirmações, falhas e decisões do administrador.
 */

const { pool } = require("../db");

async function registrarEvento(db, envioId, tipo, status, detalhe = null) {
  await db.query(
    "INSERT INTO notificacao_eventos (envio_id, tipo, status, detalhe) VALUES ($1, $2, $3, $4)",
    [envioId, tipo, status, detalhe]
  );
}

async function eventosDoEnvio(envioId, db = pool) {
  const { rows } = await db.query(
    `SELECT tipo, status, detalhe, criado_em AS "criadoEm"
     FROM notificacao_eventos WHERE envio_id = $1 ORDER BY criado_em, id`,
    [envioId]
  );
  return rows;
}

module.exports = { registrarEvento, eventosDoEnvio };
