/**
 * Ritmo de envio do WhatsApp.
 *
 * O remetente é um WhatsApp comum conectado como aparelho (Baileys): rajadas de
 * mensagens podem levar o WhatsApp a restringir ou banir o número. Antes de cada
 * envio são conferidos, no próprio histórico (tentativa_iniciada_em):
 *   1. limite por produtor por dia (WHATSAPP_PER_USER_DAILY_LIMIT);
 *   2. limite diário de todos os produtores juntos (WHATSAPP_DAILY_LIMIT);
 *   3. limite da última hora (WHATSAPP_HOURLY_LIMIT);
 *   4. intervalo mínimo desde a última tentativa (WHATSAPP_MIN_INTERVAL_MS).
 * Limite atingido não descarta a mensagem: ela é adiada até haver vaga (e expira se
 * a validade acabar antes). Os dias seguem o fuso de Brasília.
 */

const { pool } = require("../db");

const FUSO = "America/Sao_Paulo";
const HORA_MS = 60 * 60 * 1000;

async function consumoAtual(envio) {
  const { rows } = await pool.query(
    `WITH periodo AS (
       SELECT date_trunc('day', NOW() AT TIME ZONE '${FUSO}') AT TIME ZONE '${FUSO}' AS inicio_dia
     )
     SELECT
       COUNT(e.id) FILTER (WHERE e.usuario_id = $1 AND e.tentativa_iniciada_em >= p.inicio_dia)::int AS "produtorHoje",
       COUNT(e.id) FILTER (WHERE e.tentativa_iniciada_em >= p.inicio_dia)::int AS "hoje",
       COUNT(e.id) FILTER (WHERE e.tentativa_iniciada_em > NOW() - INTERVAL '1 hour')::int AS "ultimaHora",
       MIN(e.tentativa_iniciada_em) FILTER (WHERE e.tentativa_iniciada_em > NOW() - INTERVAL '1 hour') AS "primeiraDaHora",
       MAX(e.tentativa_iniciada_em) AS "ultima",
       p.inicio_dia + INTERVAL '1 day' AS "amanha"
     FROM periodo p
     LEFT JOIN notificacao_envios e
       ON e.canal = 'whatsapp' AND e.id <> $2 AND e.tentativa_iniciada_em IS NOT NULL
     GROUP BY p.inicio_dia`,
    [envio.usuario_id, envio.id]
  );
  return rows[0];
}

/**
 * @returns {{ ok: true, esperaMs } | { ok: false, ate: Date, codigo, mensagem, global }}
 *   global = o limite vale para todos (não adianta tentar outro envio agora).
 */
async function verificarRitmo(envio, limites) {
  const consumo = await consumoAtual(envio);
  if (envio.usuario_id !== null && consumo.produtorHoje >= limites.limitePorProdutorDia) {
    return {
      ok: false, global: false, ate: consumo.amanha, codigo: "limite_produtor_diario",
      mensagem: `Limite de ${limites.limitePorProdutorDia} mensagens por produtor por dia atingido (WHATSAPP_PER_USER_DAILY_LIMIT); adiada para amanhã.`,
    };
  }
  if (consumo.hoje >= limites.limiteDiario) {
    return {
      ok: false, global: true, ate: consumo.amanha, codigo: "limite_diario",
      mensagem: `Limite diário de ${limites.limiteDiario} mensagens atingido (WHATSAPP_DAILY_LIMIT); adiada para amanhã.`,
    };
  }
  if (consumo.ultimaHora >= limites.limitePorHora) {
    return {
      ok: false, global: true, ate: new Date(consumo.primeiraDaHora.getTime() + HORA_MS), codigo: "limite_por_hora",
      mensagem: `Limite de ${limites.limitePorHora} mensagens por hora atingido (WHATSAPP_HOURLY_LIMIT); adiada.`,
    };
  }
  const esperaMs = consumo.ultima ? consumo.ultima.getTime() + limites.intervaloMinimoMs - Date.now() : 0;
  return { ok: true, esperaMs: Math.min(Math.max(esperaMs, 0), limites.intervaloMinimoMs) };
}

module.exports = { verificarRitmo };
