/**
 * Consultas e ações do painel do administrador sobre agricultores e notificações.
 *
 * Toda ação na fila fica em dois lugares: na linha do tempo do envio
 * (notificacao_eventos) e na auditoria da administração (administracao_eventos),
 * com o administrador que a executou.
 */

const { pool, emTransacao } = require("../db");
const { registrarEvento } = require("./eventos");
const { registrarEventoAdmin } = require("./controle");
const { COLUNAS_ENVIO, formatarEnvio } = require("./historico");
const { autorizacaoVigente } = require("./consentimentos");
const { formatarTelefone } = require("../contato");

const STATUS = [
  "pendente", "processando", "simulado", "enviado", "confirmado_servidor", "entregue",
  "lido", "falhou", "bloqueado", "incerto", "cancelado", "expirado",
];
const TIPOS = ["boas_vindas", "alerta_climatico", "teste","boletim_diario","alerta_meteorologico"];
const CANAIS = ["email", "sms", "whatsapp"];

class AcaoRecusada extends Error {}

// Situação do WhatsApp a partir da última decisão do produtor (ou null) e do celular atual.
function situacaoDoWhatsapp(decisao, telefone) {
  if (!decisao) return "nao_autorizado";
  if (!decisao.concedido) return "revogado";
  return autorizacaoVigente("whatsapp", decisao, telefone) ? "autorizado" : "autorizado_outro_numero";
}

/** Contadores do WhatsApp para o painel. "Aceitas" inclui as que já avançaram (entregues, lidas). */
async function resumoDoWhatsapp() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM usuarios u
        JOIN LATERAL (
          SELECT c.concedido, c.destino FROM notificacao_consentimentos c
          WHERE c.usuario_id = u.id AND c.canal = 'whatsapp'
          ORDER BY c.criado_em DESC, c.id DESC LIMIT 1) d ON TRUE
        WHERE d.concedido AND d.destino = u.telefone)::int AS "autorizados",
       COUNT(*) FILTER (WHERE status IN ('pendente', 'processando'))::int AS "pendentes",
       COUNT(*) FILTER (WHERE status IN ('enviado', 'confirmado_servidor', 'entregue', 'lido'))::int AS "aceitas",
       COUNT(*) FILTER (WHERE status IN ('confirmado_servidor', 'entregue', 'lido'))::int AS "confirmadasServidor",
       COUNT(*) FILTER (WHERE status IN ('entregue', 'lido'))::int AS "entregues",
       COUNT(*) FILTER (WHERE status = 'lido')::int AS "lidas",
       COUNT(*) FILTER (WHERE status = 'falhou')::int AS "falhas",
       COUNT(*) FILTER (WHERE status = 'incerto')::int AS "incertas",
       COUNT(*) FILTER (WHERE status = 'bloqueado')::int AS "bloqueadas",
       COUNT(*) FILTER (WHERE status IN ('cancelado', 'expirado'))::int AS "descartadas"
     FROM notificacao_envios WHERE canal = 'whatsapp'`
  );
  return rows[0];
}

async function listarAgricultores(limite) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email, u.telefone, u.cidade, u.criado_em AS "criadoEm",
            (SELECT COUNT(*) FROM talhoes t WHERE t.usuario_id = u.id)::int AS "talhoes",
            d.concedido, d.destino, d.criado_em AS "decisaoEm"
     FROM usuarios u
     LEFT JOIN LATERAL (
       SELECT c.concedido, c.destino, c.criado_em FROM notificacao_consentimentos c
       WHERE c.usuario_id = u.id AND c.canal = 'whatsapp'
       ORDER BY c.criado_em DESC, c.id DESC LIMIT 1) d ON TRUE
     WHERE u.papel = 'produtor'
     ORDER BY u.criado_em DESC, u.id DESC
     LIMIT $1`,
    [limite]
  );
  return rows.map(({ concedido, destino, decisaoEm, ...agricultor }) => ({
    ...agricultor,
    telefone: agricultor.telefone ? formatarTelefone(agricultor.telefone) : null,
    whatsapp: situacaoDoWhatsapp(concedido === null ? null : { concedido, destino }, agricultor.telefone),
    whatsappDecididoEm: decisaoEm,
  }));
}

/** Histórico de todos os produtores, mais recentes primeiro, com filtros opcionais. */
async function listarEnvios({ status, tipo, canal, limite }) {
  const filtros = [];
  const valores = [];
  for (const [coluna, valor] of [["status", status], ["tipo", tipo], ["canal", canal]]) {
    if (valor) {
      valores.push(valor);
      filtros.push(`e.${coluna} = $${valores.length}`);
    }
  }
  valores.push(limite);
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_ENVIO}, e.usuario_id AS "usuarioId", u.nome AS "agricultor"
     FROM notificacao_envios e LEFT JOIN usuarios u ON u.id = e.usuario_id
     ${filtros.length ? "WHERE " + filtros.join(" AND ") : ""}
     ORDER BY e.criado_em DESC, e.id DESC
     LIMIT $${valores.length}`,
    valores
  );
  return rows.map((envio) => ({ ...formatarEnvio(envio), usuarioId: envio.usuarioId }));
}

/** Cancela um envio que ainda está na fila. */
function cancelarEnvio(envioId, admin) {
  return emTransacao(async (cliente) => {
    const motivo = `Cancelado pelo administrador ${admin.nome}.`;
    const { rowCount } = await cliente.query(
      `UPDATE notificacao_envios
       SET status = 'cancelado', erro_codigo = 'cancelado', erro_mensagem = $2, atualizado_em = NOW()
       WHERE id = $1 AND status = 'pendente'`,
      [envioId, motivo]
    );
    if (!rowCount) throw new AcaoRecusada("Só é possível cancelar um envio que ainda está na fila.");
    await registrarEvento(cliente, envioId, "cancelado", "cancelado", motivo);
    await registrarEventoAdmin(cliente, { categoria: "fila", tipo: "envio_cancelado", detalhe: `Envio ${envioId} cancelado.`, usuarioId: admin.id });
  });
}

/** Cancela, de uma vez, tudo o que está na fila de um canal (ex.: antes da primeira liberação). */
function cancelarPendentes(canal, admin) {
  return emTransacao(async (cliente) => {
    const motivo = `Cancelado em lote pelo administrador ${admin.nome}.`;
    const { rows } = await cliente.query(
      `UPDATE notificacao_envios
       SET status = 'cancelado', erro_codigo = 'cancelado', erro_mensagem = $2, atualizado_em = NOW()
       WHERE canal = $1 AND status = 'pendente'
       RETURNING id`,
      [canal, motivo]
    );
    for (const { id } of rows) await registrarEvento(cliente, id, "cancelado", "cancelado", motivo);
    await registrarEventoAdmin(cliente, {
      categoria: "fila",
      tipo: "pendentes_cancelados",
      detalhe: `${rows.length} envio(s) pendente(s) de ${canal} cancelado(s).`,
      usuarioId: admin.id,
    });
    return rows.length;
  });
}

/**
 * Devolve à fila um envio de resultado incerto. É a única forma de reenviá-lo: o
 * administrador decide depois de conferir (ex.: no celular do remetente) que a
 * mensagem não saiu.
 */
function reenfileirarIncerto(envioId, admin) {
  return emTransacao(async (cliente) => {
    const detalhe = `Reenvio autorizado pelo administrador ${admin.nome} após resultado incerto.`;
    const { rows } = await cliente.query(
      `UPDATE notificacao_envios
       SET status = 'pendente', proxima_tentativa_em = NOW(), erro_codigo = NULL, erro_mensagem = NULL,
           max_tentativas = GREATEST(max_tentativas, tentativas + 1), atualizado_em = NOW()
       WHERE id = $1 AND status = 'incerto' AND usuario_id IS NOT NULL
         AND (expira_em IS NULL OR expira_em > NOW())
       RETURNING id`,
      [envioId]
    );
    if (!rows[0]) throw new AcaoRecusada("Só é possível reenviar um envio incerto de produtor que ainda esteja dentro da validade.");
    await registrarEvento(cliente, envioId, "reenfileirado", "pendente", detalhe);
    await registrarEventoAdmin(cliente, { categoria: "fila", tipo: "incerto_reenfileirado", detalhe: `Envio ${envioId}: ${detalhe}`, usuarioId: admin.id });
  });
}

module.exports = {
  STATUS,
  TIPOS,
  CANAIS,
  AcaoRecusada,
  resumoDoWhatsapp,
  listarAgricultores,
  listarEnvios,
  cancelarEnvio,
  cancelarPendentes,
  reenfileirarIncerto,
};
