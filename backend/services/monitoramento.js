/**
 * Monitoramento climático automático (desligado por padrão: WEATHER_MONITOR_ENABLED=true liga).
 *
 * A cada ciclo, para cada talhão de produtor que autorizou algum canal:
 *   1. busca previsão (7 dias) e histórico (30 dias) no Open-Meteo;
 *   2. grava a leitura em leituras_clima;
 *   3. roda o motor de regras da cultura e fase do talhão;
 *   4. registra cada risco como episódio em alertas_gerados.
 * Só episódio novo gera notificação: o mesmo risco ainda ativo nas últimas 24 h
 * apenas atualiza ultima_deteccao_em; risco que sobe de nível, ou que volta
 * depois de cessar, avisa de novo.
 *
 * Usa apenas dados reais: se o Open-Meteo falhar, o talhão fica sem leitura
 * neste ciclo — não há recurso a dados simulados.
 */

const { pool } = require("./db");
const { buscarClimaOpenMeteo } = require("./openmeteo");
const { avaliarAlertas } = require("./rules");
const { notificarAlertas } = require("./notificacoes/alertas");

const RESFRIAMENTO_HORAS = 24;
const ORDEM_NIVEL = { baixo: 0, medio: 1, alto: 2 };
const ESPERA_PRIMEIRO_CICLO_MS = 60 * 1000;

// Talhões de produtores com algum canal autorizado agora (no WhatsApp, para o
// celular cadastrado hoje). Decisões antigas de SMS não contam.
async function talhoesMonitorados() {
  const { rows } = await pool.query(
    `SELECT t.id, t.usuario_id AS "usuarioId", t.nome, t.cultura, t.fase,
            t.latitude, t.longitude, t.regiao, t.endereco, t.endereco_formatado AS "enderecoFormatado"
     FROM talhoes t
     JOIN usuarios u ON u.id = t.usuario_id
     WHERE EXISTS (
       SELECT 1 FROM (
         SELECT DISTINCT ON (c.canal) c.canal, c.concedido, c.destino
         FROM notificacao_consentimentos c
         WHERE c.usuario_id = t.usuario_id AND c.canal IN ('email', 'whatsapp')
         ORDER BY c.canal, c.criado_em DESC, c.id DESC
       ) atual
       WHERE atual.concedido AND (atual.canal = 'email' OR atual.destino = u.telefone))
     ORDER BY t.id`
  );
  return rows;
}

async function salvarLeitura(talhaoId, clima) {
  const { rows } = await pool.query(
    `INSERT INTO leituras_clima
       (talhao_id, fonte, temperatura_minima, chuva_acumulada_7d, dias_sem_chuva,
        probabilidade_chuva, vento_maximo_kmh, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      talhaoId, clima.fonte, clima.temperaturaMinima, clima.chuvaAcumulada7dias, clima.diasSemChuva,
      clima.probabilidadeChuva7dias, clima.ventoMaximoKmh, clima,
    ]
  );
  return rows[0].id;
}

// Devolve o id do episódio quando ele é novo; null quando o risco já estava ativo.
async function registrarEpisodio(talhao, alerta, leituraId) {
  const { rows } = await pool.query(
    `SELECT id, nivel FROM alertas_gerados
     WHERE talhao_id = $1 AND regra_id = $2
       AND ultima_deteccao_em > NOW() - make_interval(hours => $3)
     ORDER BY ultima_deteccao_em DESC, id DESC
     LIMIT 1`,
    [talhao.id, alerta.id, RESFRIAMENTO_HORAS]
  );
  const ativo = rows[0];
  if (ativo && ORDEM_NIVEL[ativo.nivel] >= ORDEM_NIVEL[alerta.nivel]) {
    await pool.query(
      "UPDATE alertas_gerados SET ultima_deteccao_em = NOW(), leitura_id = $2 WHERE id = $1",
      [ativo.id, leituraId]
    );
    return null;
  }
  const { rows: inseridos } = await pool.query(
    `INSERT INTO alertas_gerados
       (talhao_id, regra_id, nivel, titulo, mensagem, recomendacao, janela, regiao, leitura_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [talhao.id, alerta.id, alerta.nivel, alerta.titulo, alerta.mensagem, alerta.recomendacao, alerta.janela, talhao.regiao, leituraId]
  );
  return inseridos[0].id;
}

// A trava no PostgreSQL também protege quando há dois processos do backend.
// Só a trava em memória do temporizador não impediria episódios duplicados.
async function executarCiclo(opcoes) {
  const cliente = await pool.connect();
  let travado = false;
  try {
    const { rows } = await cliente.query("SELECT pg_try_advisory_lock(hashtext($1)) AS livre", ["agroalerta_monitoramento"]);
    travado = rows[0].livre;
    if (!travado) return { talhoes: 0, semDados: 0, alertasNovos: 0, enfileirados: 0, ignorado: true };
    return await executarCicloExclusivo(opcoes);
  } finally {
    try {
      if (travado) await cliente.query("SELECT pg_advisory_unlock(hashtext($1))", ["agroalerta_monitoramento"]);
    } finally {
      cliente.release();
    }
  }
}

async function executarCicloExclusivo({ config, buscarClima = buscarClimaOpenMeteo, log = console.log }) {
  const talhoes = await talhoesMonitorados();
  const episodios = [];
  let semDados = 0;

  for (const talhao of talhoes) {
    let clima;
    try {
      clima = await buscarClima(talhao.latitude, talhao.longitude);
    } catch (erro) {
      semDados++;
      log(`[monitoramento] Open-Meteo indisponível para o talhão ${talhao.id}: ${erro.message}`);
      continue;
    }
    const consultadoEm = new Date();
    const leituraId = await salvarLeitura(talhao.id, clima);
    for (const alerta of avaliarAlertas(talhao.cultura, talhao.fase, clima)) {
      const alertaId = await registrarEpisodio(talhao, alerta, leituraId);
      if (alertaId) episodios.push({ alertaId, alerta, talhao, clima, consultadoEm });
    }
  }

  const enfileirados = await notificarAlertas(episodios, config, log);
  const resumo = { talhoes: talhoes.length, semDados, alertasNovos: episodios.length, enfileirados };
  log(
    `[monitoramento] ciclo concluído: ${resumo.talhoes} talhão(ões), ${resumo.alertasNovos} risco(s) novo(s), ` +
      `${resumo.enfileirados} mensagem(ns) na fila` + (semDados ? `, ${semDados} sem dados do Open-Meteo` : "")
  );
  return resumo;
}

let temporizadores = [];
let cicloAtual = null;

function iniciarMonitoramento({ config, log = console.log }) {
  if (temporizadores.length) return;
  const rodar = () => {
    if (cicloAtual) return;
    cicloAtual = executarCiclo({ config, log })
      .catch((erro) => log("[monitoramento] falha no ciclo: " + erro.message))
      .finally(() => {
        cicloAtual = null;
      });
  };
  temporizadores = [
    setTimeout(rodar, ESPERA_PRIMEIRO_CICLO_MS),
    setInterval(rodar, config.monitoramento.intervaloMin * 60 * 1000),
  ];
  temporizadores.forEach((t) => t.unref());
}

function pararMonitoramento() {
  temporizadores.forEach((t) => clearTimeout(t));
  temporizadores = [];
  return cicloAtual || Promise.resolve();
}

module.exports = { executarCiclo, iniciarMonitoramento, pararMonitoramento };
