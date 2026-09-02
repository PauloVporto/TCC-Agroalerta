/**
 * Mensagens para o produtor a partir de alertas e previsão do tempo.
 * Cada risco (chuva forte, seca, geada…) vira um recado legível na caixa de entrada
 * e é despachado por e-mail + SMS para o contato cadastrado.
 */

const { pool } = require("./db");
const { buscarClimaAtual } = require("./weather");
const { avaliarAlertas } = require("./rules");
const { despacharMensagensPendentes } = require("./notificar");

function mensagensDaPrevisao(talhao, clima) {
  const previsao = clima.previsao || [];
  const msgs = [];
  const diasChuva = previsao.filter((d) => d.condicao === "chuva");
  const diasSeco = previsao.filter((d) => d.condicao === "seco");
  const chuvaForte = previsao.filter((d) => (d.chuvaMm || 0) >= 15);
  const nome = talhao.nome || "seu talhão";

  if (chuvaForte.length > 0) {
    const pico = chuvaForte.reduce((a, b) => ((b.chuvaMm || 0) > (a.chuvaMm || 0) ? b : a));
    msgs.push({
      chave: "previsao_chuva_forte",
      nivel: pico.chuvaMm >= 25 ? "alto" : "medio",
      titulo: "Chuva forte prevista",
      corpo:
        "No talhão " +
        nome +
        " há previsão de chuva forte (" +
        pico.chuvaMm +
        " mm) em " +
        formatarDataCurta(pico.data) +
        ". Em " +
        chuvaForte.length +
        " dia(s) da semana a precipitação passa de 15 mm.",
      recomendacao:
        "Evite pulverização e colheita nesses dias; confira drenagem e risco de doenças foliares.",
    });
  } else if (diasChuva.length >= 3) {
    msgs.push({
      chave: "previsao_chuva",
      nivel: "medio",
      titulo: "Semana chuvosa",
      corpo:
        "No talhão " +
        nome +
        " a previsão indica " +
        diasChuva.length +
        " dia(s) chuvoso(s) nesta semana. Umidade alta favorece fungos e dificulta operações de campo.",
      recomendacao: "Planeje janelas secas para aplicação e acompanhamento fitossanitário.",
    });
  }

  if (diasSeco.length >= 4 || (clima.diasSemChuva || 0) >= 8) {
    const nivel = (clima.diasSemChuva || 0) >= 12 || diasSeco.length >= 5 ? "alto" : "medio";
    msgs.push({
      chave: "previsao_seca",
      nivel,
      titulo: "Risco de seca",
      corpo:
        "No talhão " +
        nome +
        " há " +
        (clima.diasSemChuva || 0) +
        " dia(s) sem chuva e a previsão mostra " +
        diasSeco.length +
        " dia(s) seco(s) à frente. Estresse hídrico pode reduzir produtividade.",
      recomendacao: "Priorize irrigação, se houver, e acompanhe a umidade do solo.",
    });
  }

  if ((clima.temperaturaMinima || 99) <= 5) {
    msgs.push({
      chave: "previsao_frio",
      nivel: clima.temperaturaMinima <= 2 ? "alto" : "medio",
      titulo: "Noite fria / risco de geada",
      corpo:
        "Temperatura mínima prevista de " +
        clima.temperaturaMinima +
        "°C na área de " +
        nome +
        ". Frio intenso pode danificar cultura sensível.",
      recomendacao: "Monitore as madrugadas e avalie proteção (aspersão, cobertura) se disponível.",
    });
  }

  if ((clima.ventoMaximoKmh || 0) >= 45) {
    msgs.push({
      chave: "previsao_vento",
      nivel: clima.ventoMaximoKmh >= 60 ? "alto" : "medio",
      titulo: "Vento forte",
      corpo:
        "Rajadas de até " +
        clima.ventoMaximoKmh +
        " km/h previstas perto de " +
        nome +
        ". Risco de tombamento e deriva de defensivos.",
      recomendacao: "Evite pulverização com vento forte e confira estruturas e plantas jovens.",
    });
  }

  return msgs;
}

function formatarDataCurta(iso) {
  if (!iso) return "breve";
  try {
    const d = new Date(iso + (String(iso).includes("T") ? "" : "T12:00:00"));
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  } catch (_) {
    return String(iso);
  }
}

function mensagensDosAlertas(talhao, alertas) {
  const nome = talhao.nome || "seu talhão";
  return (alertas || []).map((a) => ({
    chave: "regra_" + a.id,
    nivel: a.nivel,
    titulo: a.titulo,
    corpo: "Talhão " + nome + ": " + a.mensagem,
    recomendacao: a.recomendacao || "",
  }));
}

async function salvarMensagens(usuarioId, talhaoId, mensagens) {
  if (!usuarioId || !talhaoId || !mensagens.length) return [];
  const salvas = [];
  for (const m of mensagens) {
    const resultado = await pool.query(
      `INSERT INTO mensagens_produtor
         (usuario_id, talhao_id, chave, nivel, titulo, corpo, recomendacao, lida, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW())
       ON CONFLICT (usuario_id, talhao_id, chave) DO UPDATE SET
         nivel = EXCLUDED.nivel,
         titulo = EXCLUDED.titulo,
         corpo = EXCLUDED.corpo,
         recomendacao = EXCLUDED.recomendacao,
         atualizado_em = NOW(),
         lida = CASE
           WHEN mensagens_produtor.corpo IS DISTINCT FROM EXCLUDED.corpo
             OR mensagens_produtor.nivel IS DISTINCT FROM EXCLUDED.nivel
           THEN FALSE
           ELSE mensagens_produtor.lida
         END,
         enviado_email_em = CASE
           WHEN mensagens_produtor.corpo IS DISTINCT FROM EXCLUDED.corpo
             OR mensagens_produtor.nivel IS DISTINCT FROM EXCLUDED.nivel
           THEN NULL
           ELSE mensagens_produtor.enviado_email_em
         END,
         enviado_sms_em = CASE
           WHEN mensagens_produtor.corpo IS DISTINCT FROM EXCLUDED.corpo
             OR mensagens_produtor.nivel IS DISTINCT FROM EXCLUDED.nivel
           THEN NULL
           ELSE mensagens_produtor.enviado_sms_em
         END,
         status_email = CASE
           WHEN mensagens_produtor.corpo IS DISTINCT FROM EXCLUDED.corpo
             OR mensagens_produtor.nivel IS DISTINCT FROM EXCLUDED.nivel
           THEN NULL
           ELSE mensagens_produtor.status_email
         END,
         status_sms = CASE
           WHEN mensagens_produtor.corpo IS DISTINCT FROM EXCLUDED.corpo
             OR mensagens_produtor.nivel IS DISTINCT FROM EXCLUDED.nivel
           THEN NULL
           ELSE mensagens_produtor.status_sms
         END
       RETURNING id, usuario_id AS "usuarioId", talhao_id AS "talhaoId", chave, nivel,
                 titulo, corpo, recomendacao, lida,
                 enviado_email_em AS "enviadoEmailEm",
                 enviado_sms_em AS "enviadoSmsEm",
                 status_email AS "statusEmail",
                 status_sms AS "statusSms",
                 criado_em AS "criadoEm",
                 atualizado_em AS "atualizadoEm"`,
      [usuarioId, talhaoId, m.chave, m.nivel, m.titulo, m.corpo, m.recomendacao || ""]
    );
    salvas.push(resultado.rows[0]);
  }

  try {
    await despacharMensagensPendentes(usuarioId, salvas);
  } catch (erro) {
    console.error("[mensagens] despacho e-mail/SMS:", erro.message);
  }

  // Recarrega status de envio após despacho
  const ids = salvas.map((s) => s.id).filter(Boolean);
  if (ids.length) {
    const atualizadas = await pool.query(
      `SELECT id, usuario_id AS "usuarioId", talhao_id AS "talhaoId", chave, nivel,
              titulo, corpo, recomendacao, lida,
              enviado_email_em AS "enviadoEmailEm",
              enviado_sms_em AS "enviadoSmsEm",
              status_email AS "statusEmail",
              status_sms AS "statusSms",
              criado_em AS "criadoEm",
              atualizado_em AS "atualizadoEm"
       FROM mensagens_produtor WHERE id = ANY($1::int[])`,
      [ids]
    );
    return atualizadas.rows;
  }
  return salvas;
}

async function gerarESalvarParaTalhao(usuarioId, talhao, clima = null, alertas = null) {
  const climaAtual = clima || (await buscarClimaAtual(talhao.latitude, talhao.longitude));
  const alertasAtual =
    alertas || avaliarAlertas(talhao.cultura, talhao.fase || talhao.faseAtual, climaAtual);
  const mensagens = [
    ...mensagensDosAlertas(talhao, alertasAtual),
    ...mensagensDaPrevisao(talhao, climaAtual),
  ];
  // Evita duplicar seca/chuva se a regra já cobriu o mesmo tema
  const chaves = new Set();
  const unicas = [];
  for (const m of mensagens) {
    if (chaves.has(m.chave)) continue;
    chaves.add(m.chave);
    unicas.push(m);
  }
  return salvarMensagens(usuarioId, talhao.id, unicas);
}

async function sincronizarMensagensDoUsuario(usuarioId) {
  const talhoes = await pool.query(
    `SELECT id, nome, cultura, fase, latitude, longitude
     FROM talhoes WHERE usuario_id = $1 ORDER BY id`,
    [usuarioId]
  );
  const todas = [];
  for (const talhao of talhoes.rows) {
    try {
      const salvas = await gerarESalvarParaTalhao(usuarioId, talhao);
      todas.push(...salvas);
    } catch (erro) {
      console.error("[mensagens] sync talhão", talhao.id, erro.message);
    }
  }
  return todas;
}

async function listarMensagens(usuarioId, { apenasNaoLidas = false, limite = 40 } = {}) {
  const filtro = apenasNaoLidas ? "AND m.lida = FALSE" : "";
  const resultado = await pool.query(
    `SELECT m.id, m.talhao_id AS "talhaoId", m.chave, m.nivel, m.titulo, m.corpo,
            m.recomendacao, m.lida, m.criado_em AS "criadoEm", m.atualizado_em AS "atualizadoEm",
            m.enviado_email_em AS "enviadoEmailEm",
            m.enviado_sms_em AS "enviadoSmsEm",
            m.status_email AS "statusEmail",
            m.status_sms AS "statusSms",
            t.nome AS "talhaoNome", t.cultura
     FROM mensagens_produtor m
     LEFT JOIN talhoes t ON t.id = m.talhao_id
     WHERE m.usuario_id = $1 ${filtro}
     ORDER BY m.lida ASC, m.atualizado_em DESC
     LIMIT $2`,
    [usuarioId, limite]
  );
  return resultado.rows;
}

async function contarNaoLidas(usuarioId) {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS total FROM mensagens_produtor WHERE usuario_id = $1 AND lida = FALSE",
    [usuarioId]
  );
  return r.rows[0].total;
}

async function marcarLidas(usuarioId, ids = null) {
  if (Array.isArray(ids) && ids.length) {
    await pool.query(
      `UPDATE mensagens_produtor SET lida = TRUE
       WHERE usuario_id = $1 AND id = ANY($2::int[])`,
      [usuarioId, ids]
    );
  } else {
    await pool.query(
      "UPDATE mensagens_produtor SET lida = TRUE WHERE usuario_id = $1 AND lida = FALSE",
      [usuarioId]
    );
  }
  return contarNaoLidas(usuarioId);
}

async function notificacoesHabilitadas(usuarioId) {
  const r = await pool.query(
    "SELECT COALESCE(notificacoes, TRUE) AS notificacoes FROM preferencias_usuario WHERE usuario_id = $1",
    [usuarioId]
  );
  if (!r.rows[0]) return true;
  return Boolean(r.rows[0].notificacoes);
}

module.exports = {
  mensagensDaPrevisao,
  mensagensDosAlertas,
  salvarMensagens,
  gerarESalvarParaTalhao,
  sincronizarMensagensDoUsuario,
  listarMensagens,
  contarNaoLidas,
  marcarLidas,
  notificacoesHabilitadas,
};
