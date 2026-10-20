/**
 * Histórico de notificações de um produtor, para o painel. Só devolve os envios
 * do próprio produtor; os testes manuais de provedor (sem produtor) não aparecem.
 */

const { pool } = require("../db");
const { formatarTelefone } = require("../contato");

async function listarHistorico(usuarioId, limite) {
  const { rows } = await pool.query(
    `SELECT id, tipo, canal, destino, status, modo, regiao, nivel, resumo, tentativas,
            erro_codigo AS "erroCodigo", erro_mensagem AS "erroMensagem",
            criado_em AS "criadoEm", enviado_em AS "enviadoEm",
            entregue_em AS "entregueEm", atualizado_em AS "atualizadoEm"
     FROM notificacao_envios
     WHERE usuario_id = $1
     ORDER BY criado_em DESC, id DESC
     LIMIT $2`,
    [usuarioId, limite]
  );
  return rows.map((envio) => ({
    ...envio,
    id: Number(envio.id),
    destino: envio.canal === "sms" && envio.destino ? formatarTelefone(envio.destino) : envio.destino,
  }));
}

module.exports = { listarHistorico };
