/**
 * Controle de despacho do WhatsApp (linha única em whatsapp_controle) e trilha de
 * auditoria da administração (administracao_eventos).
 *
 * O controle é lido do banco a cada envio: o administrador bloqueia ou libera sem
 * reiniciar nenhum container. Sem a linha (banco sem a migration 002), tudo fica
 * bloqueado — a liberação nunca é presumida.
 */

const { pool, emTransacao } = require("../db");

const CONTROLE_PADRAO = {
  enviosBloqueados: true,
  boasVindasAtivas: false,
  alertasAtivos: false,
  atualizadoEm: null,
  atualizadoPor: null,
};

// Campo da API → coluna e textos do registro de auditoria.
const CAMPOS = {
  enviosBloqueados: { coluna: "envios_bloqueados", ligado: "Envios do WhatsApp bloqueados", desligado: "Envios do WhatsApp liberados" },
  boasVindasAtivas: { coluna: "boas_vindas_ativas", ligado: "Boas-vindas habilitadas", desligado: "Boas-vindas bloqueadas" },
  alertasAtivos: { coluna: "alertas_ativos", ligado: "Alertas automáticos habilitados", desligado: "Alertas automáticos bloqueados" },
};

async function lerControle(db = pool) {
  const { rows } = await db.query(
    `SELECT envios_bloqueados AS "enviosBloqueados", boas_vindas_ativas AS "boasVindasAtivas",
            alertas_ativos AS "alertasAtivos", atualizado_em AS "atualizadoEm", atualizado_por AS "atualizadoPor"
     FROM whatsapp_controle WHERE id = 1`
  );
  return rows[0] || { ...CONTROLE_PADRAO };
}

async function registrarEventoAdmin(db, { categoria, tipo, detalhe = null, usuarioId = null }) {
  await db.query(
    "INSERT INTO administracao_eventos (categoria, tipo, detalhe, usuario_id) VALUES ($1, $2, $3, $4)",
    [categoria, tipo, detalhe, usuarioId]
  );
}

/**
 * Aplica as alterações ({ enviosBloqueados?, boasVindasAtivas?, alertasAtivos? })
 * numa transação; cada valor que muda vira um registro de auditoria com o autor.
 */
function atualizarControle(alteracoes, usuarioId) {
  return emTransacao(async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT envios_bloqueados AS "enviosBloqueados", boas_vindas_ativas AS "boasVindasAtivas",
              alertas_ativos AS "alertasAtivos"
       FROM whatsapp_controle WHERE id = 1 FOR UPDATE`
    );
    const atual = rows[0];
    const mudancas = Object.keys(CAMPOS).filter((campo) => typeof alteracoes[campo] === "boolean" && alteracoes[campo] !== atual[campo]);
    for (const campo of mudancas) {
      await cliente.query(
        `UPDATE whatsapp_controle SET ${CAMPOS[campo].coluna} = $1, atualizado_por = $2, atualizado_em = NOW() WHERE id = 1`,
        [alteracoes[campo], usuarioId]
      );
      await registrarEventoAdmin(cliente, {
        categoria: "controle",
        tipo: campo,
        detalhe: alteracoes[campo] ? CAMPOS[campo].ligado : CAMPOS[campo].desligado,
        usuarioId,
      });
    }
    return mudancas.length;
  });
}

async function listarEventosAdmin(limite) {
  const { rows } = await pool.query(
    `SELECT e.id, e.categoria, e.tipo, e.detalhe, e.criado_em AS "criadoEm", u.nome AS "autor"
     FROM administracao_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id
     ORDER BY e.criado_em DESC, e.id DESC
     LIMIT $1`,
    [limite]
  );
  return rows.map((e) => ({ ...e, id: Number(e.id) }));
}

module.exports = { CAMPOS, lerControle, atualizarControle, registrarEventoAdmin, listarEventosAdmin };
