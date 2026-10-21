/**
 * Histórico de notificações de um produtor, para o painel. Só devolve os envios
 * do próprio produtor; os testes manuais de provedor (sem produtor) não aparecem.
 */

const { pool } = require("../db");
const { formatarTelefone } = require("../contato");

// Colunas comuns ao histórico do produtor e ao do administrador.
const COLUNAS_ENVIO = `e.id, e.tipo, e.canal, e.destino, e.status, e.modo, e.regiao, e.nivel, e.resumo,
  e.tentativas, e.remetente, e.erro_codigo AS "erroCodigo", e.erro_mensagem AS "erroMensagem",
  e.criado_em AS "criadoEm", e.enviado_em AS "enviadoEm",
  e.confirmado_servidor_em AS "confirmadoServidorEm", e.entregue_em AS "entregueEm",
  e.lido_em AS "lidoEm", e.expira_em AS "expiraEm", e.atualizado_em AS "atualizadoEm"`;

// Telefones (SMS e WhatsApp) em "(35) 99999-0000"; e-mails como estão.
function formatarEnvio(envio) {
  const telefonico = envio.canal === "sms" || envio.canal === "whatsapp";
  return {
    ...envio,
    id: Number(envio.id),
    destino: telefonico && envio.destino ? formatarTelefone(envio.destino) : envio.destino,
    remetente: envio.remetente ? formatarTelefone(envio.remetente) : null,
  };
}

async function listarHistorico(usuarioId, limite) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_ENVIO}
     FROM notificacao_envios e
     WHERE e.usuario_id = $1
     ORDER BY e.criado_em DESC, e.id DESC
     LIMIT $2`,
    [usuarioId, limite]
  );
  return rows.map(formatarEnvio);
}

module.exports = { COLUNAS_ENVIO, formatarEnvio, listarHistorico };
