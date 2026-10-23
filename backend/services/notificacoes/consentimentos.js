/**
 * Consentimento do produtor por canal e preferência de gravidade por canal.
 *
 * Cada decisão (autorizar ou revogar) vira uma linha nova em
 * notificacao_consentimentos: o histórico fica disponível para auditoria e o
 * estado atual de um canal é sempre a decisão mais recente. Sem nenhuma linha,
 * o canal está desautorizado — a autorização nunca é presumida.
 *
 * WhatsApp: a autorização vale para o número informado nela (coluna destino). Se o
 * produtor trocar de celular, ela deixa de valer até ser dada de novo. Decisões
 * antigas de SMS ficam no histórico, mas nunca contam como autorização de WhatsApp.
 */

const { pool } = require("../db");
const { modoDoCanal } = require("./config");
const { ehCelular, formatarTelefone, normalizarTelefone } = require("../contato");

const CANAIS = ["email", "whatsapp"];
const NIVEIS_MINIMOS = ["medio", "alto"];
const PREFERENCIAS_PADRAO = { emailNivelMinimo: "medio", whatsappNivelMinimo: "medio" };

/**
 * A última decisão autoriza o canal agora? No WhatsApp, só se foi dada para o
 * celular cadastrado hoje.
 * @param decisao { concedido, destino } — última linha do canal (ou null)
 */
function autorizacaoVigente(canal, decisao, telefoneAtual) {
  if (!decisao || decisao.concedido !== true) return false;
  if (canal !== "whatsapp") return true;
  const autorizado = normalizarTelefone(decisao.destino);
  return autorizado !== null && autorizado === normalizarTelefone(telefoneAtual);
}

async function obterConsentimentos(usuarioId, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (canal) canal, concedido, destino, criado_em AS "atualizadoEm"
     FROM notificacao_consentimentos
     WHERE usuario_id = $1 AND canal = ANY($2)
     ORDER BY canal, criado_em DESC, id DESC`,
    [usuarioId, CANAIS]
  );
  const estado = {};
  for (const canal of CANAIS) estado[canal] = { concedido: false, destino: null, atualizadoEm: null };
  for (const linha of rows) {
    estado[linha.canal] = { concedido: linha.concedido, destino: linha.destino, atualizadoEm: linha.atualizadoEm };
  }
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
    `SELECT email_nivel_minimo AS "emailNivelMinimo", whatsapp_nivel_minimo AS "whatsappNivelMinimo"
     FROM notificacao_preferencias WHERE usuario_id = $1`,
    [usuarioId]
  );
  return rows[0] || { ...PREFERENCIAS_PADRAO };
}

async function salvarPreferencias(db, usuarioId, { emailNivelMinimo, whatsappNivelMinimo }) {
  await db.query(
    `INSERT INTO notificacao_preferencias (usuario_id, email_nivel_minimo, whatsapp_nivel_minimo, atualizado_em)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (usuario_id) DO UPDATE SET
       email_nivel_minimo = EXCLUDED.email_nivel_minimo,
       whatsapp_nivel_minimo = EXCLUDED.whatsapp_nivel_minimo,
       atualizado_em = NOW()`,
    [usuarioId, emailNivelMinimo, whatsappNivelMinimo]
  );
}

async function contatoDoProdutor(usuarioId, db = pool) {
  const { rows } = await db.query("SELECT nome, email, telefone FROM usuarios WHERE id = $1", [usuarioId]);
  return rows[0] || null;
}

// O que o painel mostra em "Notificações": autorização, gravidade, destino e modo de cada canal.
async function resumoDasPreferencias(usuarioId, config) {
  const [decisoes, preferencias, contato] = await Promise.all([
    obterConsentimentos(usuarioId),
    obterPreferencias(usuarioId),
    contatoDoProdutor(usuarioId),
  ]);
  const whatsappVigente = autorizacaoVigente("whatsapp", decisoes.whatsapp, contato.telefone);
  return {
    email: {
      consentido: decisoes.email.concedido,
      atualizadoEm: decisoes.email.atualizadoEm,
      nivelMinimo: preferencias.emailNivelMinimo,
      destino: contato.email,
      modo: modoDoCanal(config, "email"),
    },
    whatsapp: {
      consentido: whatsappVigente,
      // Autorizou um número que não é mais o cadastrado: precisa autorizar de novo.
      autorizadoOutroNumero: decisoes.whatsapp.concedido && !whatsappVigente,
      atualizadoEm: decisoes.whatsapp.atualizadoEm,
      nivelMinimo: preferencias.whatsappNivelMinimo,
      destino: contato.telefone ? formatarTelefone(contato.telefone) : null,
      celularValido: ehCelular(contato.telefone),
      remetenteFinal: config.whatsapp.remetenteEsperado ? config.whatsapp.remetenteEsperado.slice(-4) : null,
      modo: modoDoCanal(config, "whatsapp"),
    },
  };
}

module.exports = {
  CANAIS,
  NIVEIS_MINIMOS,
  autorizacaoVigente,
  obterConsentimentos,
  registrarConsentimento,
  obterPreferencias,
  salvarPreferencias,
  contatoDoProdutor,
  resumoDasPreferencias,
};
