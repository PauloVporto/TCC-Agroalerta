/**
 * Limites de frequência e orçamento do SMS, verificados antes de cada envio.
 *
 * O consumo sai do próprio histórico (notificacao_envios): cada SMS aceito pelo
 * provedor no período, mais os que estão saindo neste momento (reservados).
 * Verificação e reserva acontecem sob um advisory lock do PostgreSQL, então dois
 * envios simultâneos não ultrapassam um limite juntos. Cada modo (simulado,
 * sandbox, real) tem sua conta: testes simulados não consomem o orçamento real.
 *
 * O SMS real só sai com custo por segmento e orçamento mensal definidos — os
 * preços vêm da conta SMSGo (GET /v1/sms-types), nunca de um valor embutido.
 */

const { pool } = require("../db");
const { contarSegmentos } = require("./textoSms");

const TRAVA_ORCAMENTO = "agroalerta_orcamento_sms";
const FUSO = "America/Sao_Paulo";

// SMS custa frações de centavo: mostra até 4 casas ("R$ 0,075").
function reais(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

async function consumoAtual(cliente, envio, modo) {
  const { rows } = await cliente.query(
    `WITH periodo AS (
       SELECT date_trunc('day', NOW() AT TIME ZONE '${FUSO}') AT TIME ZONE '${FUSO}' AS inicio_dia,
              date_trunc('month', NOW() AT TIME ZONE '${FUSO}') AT TIME ZONE '${FUSO}' AS inicio_mes
     ), consumo AS (
       SELECT usuario_id, custo_estimado, COALESCE(enviado_em, NOW()) AS momento
       FROM notificacao_envios
       WHERE canal = 'sms' AND modo = $2 AND id <> $3
         AND (enviado_em IS NOT NULL OR (status = 'processando' AND segmentos IS NOT NULL))
     )
     SELECT
       COUNT(*) FILTER (WHERE c.usuario_id = $1 AND c.momento >= p.inicio_dia)::int AS "produtorHoje",
       COUNT(*) FILTER (WHERE c.momento >= p.inicio_dia)::int AS "hoje",
       COUNT(*) FILTER (WHERE c.momento >= p.inicio_mes)::int AS "mes",
       COALESCE(SUM(c.custo_estimado) FILTER (WHERE c.momento >= p.inicio_mes), 0)::float AS "custoMes"
     FROM periodo p LEFT JOIN consumo c ON TRUE`,
    [envio.usuario_id, modo, envio.id]
  );
  return rows[0];
}

function motivoDeBloqueio(consumo, { usuarioId, modo, custo }, limites) {
  if (usuarioId !== null && consumo.produtorHoje >= limites.limitePorProdutorDia) {
    return {
      codigo: "limite_produtor_diario",
      mensagem: `Limite de ${limites.limitePorProdutorDia} SMS por produtor por dia atingido (SMS_PER_USER_DAILY_LIMIT).`,
    };
  }
  if (consumo.hoje >= limites.limiteDiario) {
    return { codigo: "limite_diario", mensagem: `Limite diário de ${limites.limiteDiario} SMS atingido (SMS_DAILY_LIMIT).` };
  }
  if (consumo.mes >= limites.limiteMensal) {
    return { codigo: "limite_mensal", mensagem: `Limite mensal de ${limites.limiteMensal} SMS atingido (SMS_MONTHLY_LIMIT).` };
  }
  if (modo === "real" && consumo.custoMes + custo > limites.orcamentoMensal + 1e-9) {
    return {
      codigo: "orcamento_esgotado",
      mensagem:
        `Orçamento mensal de SMS esgotado: ${reais(consumo.custoMes)} já usados de ` +
        `${reais(limites.orcamentoMensal)} (SMS_MONTHLY_BUDGET).`,
    };
  }
  return null;
}

/**
 * Confere limites e orçamento e, se couber, reserva o SMS (grava modo, segmentos
 * e custo estimado na linha, que passa a contar no consumo).
 * @returns {{ ok: true, segmentos, custo } | { ok: false, codigo, mensagem }}
 */
async function reservarSms(envio, modo, limites) {
  const segmentos = contarSegmentos(envio.conteudo);
  const custo = limites.custoPorSegmento === null ? null : Number((segmentos * limites.custoPorSegmento).toFixed(4));

  if (segmentos > limites.maxSegmentos) {
    return {
      ok: false,
      codigo: "mensagem_longa",
      mensagem: `A mensagem ocupa ${segmentos} segmentos; o máximo configurado é ${limites.maxSegmentos} (SMS_MAX_SEGMENTS).`,
    };
  }
  if (modo === "real" && custo === null) {
    return {
      ok: false,
      codigo: "custo_nao_configurado",
      mensagem: "Defina SMS_COST_PER_SEGMENT com o preço da sua conta SMSGo antes de enviar SMS reais.",
    };
  }
  if (modo === "real" && limites.orcamentoMensal === null) {
    return { ok: false, codigo: "orcamento_nao_configurado", mensagem: "Defina SMS_MONTHLY_BUDGET antes de enviar SMS reais." };
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT pg_advisory_xact_lock(hashtext($1))", [TRAVA_ORCAMENTO]);
    const consumo = await consumoAtual(cliente, envio, modo);
    const motivo = motivoDeBloqueio(consumo, { usuarioId: envio.usuario_id, modo, custo }, limites);
    if (!motivo) {
      await cliente.query(
        `UPDATE notificacao_envios SET modo = $2, segmentos = $3, custo_estimado = $4, atualizado_em = NOW()
         WHERE id = $1`,
        [envio.id, modo, segmentos, custo]
      );
    }
    await cliente.query("COMMIT");
    return motivo ? { ok: false, ...motivo } : { ok: true, segmentos, custo };
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
}

module.exports = { reservarSms };
