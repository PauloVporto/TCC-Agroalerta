const { emTransacao } = require("../db");
const { registrarEvento } = require("./eventos");
const { registrarEventoAdmin } = require("./controle");

// Chamado com os envios bloqueados ANTES da liberação da implantação. Somente
// pendências já existentes são retidas; novos cadastros entram na fila normalmente.
function reterPendenciasAnteriores(usuarioId) {
  return emTransacao(async (db) => {
    const { rows: controles } = await db.query("SELECT envios_bloqueados FROM whatsapp_controle WHERE id=1 FOR UPDATE");
    if (!controles[0]?.envios_bloqueados) throw new Error("Bloqueie os envios antes de preparar a ativação.");
    const { rows: admins } = await db.query("SELECT id FROM usuarios WHERE id=$1 AND papel='admin'", [usuarioId]);
    if (!admins.length) throw new Error("Ativação exige administrador autorizado.");
    const motivo = "Pendência anterior à ativação: retida por autorização administrativa, sem envio automático.";
    const { rows } = await db.query(
      `UPDATE notificacao_envios SET retido_em=NOW(), retencao_motivo=$1, atualizado_em=NOW()
       WHERE canal='whatsapp' AND status='pendente' AND retido_em IS NULL RETURNING id`, [motivo]);
    for (const envio of rows) await registrarEvento(db, envio.id, "retido_ativacao", "pendente", motivo);
    await registrarEventoAdmin(db, { categoria: "controle", tipo: "pendencias_retidas_ativacao",
      detalhe: `${rows.length} pendência(s) antiga(s) retida(s); novos cadastros não são retidos.`, usuarioId });
    return rows.map((r) => Number(r.id));
  });
}

module.exports = { reterPendenciasAnteriores };
