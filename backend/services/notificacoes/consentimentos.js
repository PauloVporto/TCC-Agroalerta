/**
 * Consentimento do produtor por canal e preferência de gravidade por canal.
 *
 * Cada decisão (autorizar ou revogar) vira uma linha nova em
 * notificacao_consentimentos: o histórico fica disponível para auditoria e o
 * estado atual de um canal é sempre a decisão mais recente. Sem nenhuma linha,
 * o canal está desautorizado — a autorização nunca é presumida.
 */

const { pool } = require("../db");
const { modoDoCanal } = require("./config");
const { ehCelular, formatarTelefone } = require("../contato");

const CANAIS = ["email", "sms"];
const NIVEIS_MINIMOS = ["medio", "alto"];
const PREFERENCIAS_PADRAO = { emailNivelMinimo: "medio", smsNivelMinimo: "alto" };

async function obterConsentimentos(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (canal) canal, concedido, criado_em AS "atualizadoEm"
     FROM notificacao_consentimentos
     WHERE usuario_id = $1
     ORDER BY canal, criado_em DESC, id DESC`,
    [usuarioId]
  );
  const estado = {};
  for (const canal of CANAIS) estado[canal] = { concedido: false, atualizadoEm: null };
  for (const linha of rows) estado[linha.canal] = { concedido: linha.concedido, atualizadoEm: linha.atualizadoEm };
  return estado;
}

async function registrarConsentimento(db, { usuarioId, canal, concedido, destino, origem }) {
  await db.query(
    `INSERT INTO notificacao_consentimentos (usuario_id, canal, concedido, destino, origem)
     VALUES ($1, $2, $3, $4, $5)`,
    [usuarioId, canal, concedido, destino || null, origem]
  );
}

async function obterPreferencias(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT email_nivel_minimo AS "emailNivelMinimo", sms_nivel_minimo AS "smsNivelMinimo"
     FROM notificacao_preferencias WHERE usuario_id = $1`,
    [usuarioId]
  );
  return rows[0] || { ...PREFERENCIAS_PADRAO };
}

async function contatoDoProdutor(usuarioId, db = pool) {
  const { rows } = await db.query("SELECT nome, email, telefone FROM usuarios WHERE id = $1", [usuarioId]);
  return rows[0] || null;
}

// O que o painel mostra em "Notificações": autorização, gravidade, destino e modo de cada canal.
async function resumoDasPreferencias(usuarioId, config) {
  const [consentimentos, preferencias, contato] = await Promise.all([
    obterConsentimentos(usuarioId),
    obterPreferencias(usuarioId),
    contatoDoProdutor(usuarioId),
  ]);
  return {
    email: {
      consentido: consentimentos.email.concedido,
      atualizadoEm: consentimentos.email.atualizadoEm,
      nivelMinimo: preferencias.emailNivelMinimo,
      destino: contato.email,
      modo: modoDoCanal(config, "email"),
    },
    sms: {
      consentido: consentimentos.sms.concedido,
      atualizadoEm: consentimentos.sms.atualizadoEm,
      nivelMinimo: preferencias.smsNivelMinimo,
      destino: contato.telefone ? formatarTelefone(contato.telefone) : null,
      celularValido: ehCelular(contato.telefone),
      modo: modoDoCanal(config, "sms"),
    },
  };
}

/**
 * Grava as escolhas do painel numa transação. O consentimento só ganha linha
 * nova quando a decisão muda, para a trilha registrar decisões, não cliques.
 * @param escolhas { email: { consentido, nivelMinimo }, sms: { consentido, nivelMinimo } }
 */
async function atualizarNotificacoes(usuarioId, escolhas) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const [atuais, contato] = await Promise.all([
      obterConsentimentos(usuarioId, cliente),
      contatoDoProdutor(usuarioId, cliente),
    ]);
    for (const canal of CANAIS) {
      if (escolhas[canal].consentido !== atuais[canal].concedido) {
        await registrarConsentimento(cliente, {
          usuarioId,
          canal,
          concedido: escolhas[canal].consentido,
          destino: canal === "email" ? contato.email : contato.telefone,
          origem: "painel",
        });
      }
    }
    await cliente.query(
      `INSERT INTO notificacao_preferencias (usuario_id, email_nivel_minimo, sms_nivel_minimo, atualizado_em)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET
         email_nivel_minimo = EXCLUDED.email_nivel_minimo,
         sms_nivel_minimo = EXCLUDED.sms_nivel_minimo,
         atualizado_em = NOW()`,
      [usuarioId, escolhas.email.nivelMinimo, escolhas.sms.nivelMinimo]
    );
    await cliente.query("COMMIT");
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
}

module.exports = {
  NIVEIS_MINIMOS,
  obterConsentimentos,
  registrarConsentimento,
  obterPreferencias,
  contatoDoProdutor,
  resumoDasPreferencias,
  atualizarNotificacoes,
};
