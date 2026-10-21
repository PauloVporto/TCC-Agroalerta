/**
 * Diagnóstico das notificações — somente leitura: nenhuma mensagem é enviada e
 * nenhuma chave é exibida.
 *
 * Confere a configuração local e as condições reais das contas:
 *   Resend: chave, domínios cadastrados e se o domínio de EMAIL_FROM está verificado;
 *   SMSGo:  chaves de produção e de teste, saldo, preço por tipo de SMS e webhook;
 *   fila:   envios por status, motivos de falha/bloqueio e consumo de SMS no mês.
 *
 * Uso: docker compose exec backend npm run notificacoes:diagnostico
 */

require("dotenv").config();
const { lerConfiguracao, modoDoCanal, avisosDeConfiguracao } = require("../services/notificacoes/config");
const resend = require("../services/notificacoes/provedores/resend");
const smsgo = require("../services/notificacoes/provedores/smsgo");
const { pool } = require("../services/db");

function titulo(texto) {
  console.log("\n" + texto + "\n" + "-".repeat(texto.length));
}

function reais(valor, casas = 2) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function dominioDoRemetente(remetente) {
  const encontrado = /@([^>\s]+)>?\s*$/.exec(remetente || "");
  return encontrado ? encontrado[1].toLowerCase() : null;
}

async function diagnosticarResend(config) {
  titulo("E-mail · Resend");
  console.log(`modo: ${modoDoCanal(config, "email")} (EMAIL_SENDING_ENABLED=${config.email.envioAtivo})`);
  console.log("remetente (EMAIL_FROM): " + (config.email.remetente || "não definido"));
  if (!config.email.resendApiKey) {
    console.log("RESEND_API_KEY: não definida");
    return;
  }
  try {
    const dominios = await resend.listarDominios({ apiKey: config.email.resendApiKey });
    console.log("RESEND_API_KEY: válida (acesso total)");
    if (dominios.length === 0) console.log("domínios: nenhum cadastrado");
    for (const d of dominios) console.log(`domínio ${d.name}: ${d.status}`);

    const dominio = dominioDoRemetente(config.email.remetente);
    if (dominio === "resend.dev") {
      console.log("ATENÇÃO: remetente de teste — o Resend só entrega para o e-mail dono da conta.");
    } else if (dominio) {
      const cadastrado = dominios.find((d) => d.name === dominio);
      console.log(
        cadastrado && cadastrado.status === "verified"
          ? `domínio do remetente (${dominio}): verificado`
          : `ATENÇÃO: domínio do remetente (${dominio}) não está verificado — o Resend recusará os envios.`
      );
    }
  } catch (erro) {
    console.log("não foi possível consultar a conta: " + erro.message);
  }
}

async function diagnosticarSmsgo(config) {
  const { sms } = config;
  titulo("SMS · SMSGo");
  console.log(
    `modo: ${modoDoCanal(config, "sms")} (SMS_PROVIDER=${sms.provedor}, SMS_SENDING_ENABLED=${sms.envioAtivo}, ` +
      `SMSGO_SANDBOX=${sms.smsgo.sandbox})`
  );
  const chaves = [
    ["SMSGO_API_KEY (produção)", sms.smsgo.chaveProducao],
    ["SMSGO_TEST_API_KEY (sandbox)", sms.smsgo.chaveTeste],
  ];
  for (const [rotulo, chave] of chaves) {
    if (!chave) {
      console.log(`${rotulo}: não definida`);
      continue;
    }
    try {
      console.log(`${rotulo}: válida, modo ${await smsgo.obterModo({ apiKey: chave })}`);
    } catch (erro) {
      console.log(`${rotulo}: ${erro.message}`);
    }
  }

  const chaveConta = sms.smsgo.chaveProducao || sms.smsgo.chaveTeste;
  if (chaveConta) {
    try {
      const { saldo, moeda } = await smsgo.consultarSaldo({ apiKey: chaveConta });
      console.log(`saldo da conta: ${moeda === "BRL" ? reais(saldo) : `${moeda} ${saldo}`}`);
      for (const tipo of await smsgo.listarTiposSms({ apiKey: chaveConta })) {
        console.log(
          `tipo ${tipo.id} (${tipo.label || tipo.name}): ${reais(tipo.sale ?? tipo.price, 4)} por SMS` +
            (tipo.deliveryTime ? `, entrega ${tipo.deliveryTime}` : "")
        );
      }
      const webhook = await smsgo.consultarWebhook({ apiKey: chaveConta });
      console.log("webhook na SMSGo: " + (webhook.url ? webhook.url + (webhook.temSegredo ? " (com segredo)" : "") : "não configurado"));
    } catch (erro) {
      console.log("não foi possível consultar a conta: " + erro.message);
    }
  }

  console.log("SMSGO_SMS_TYPE_ID: " + (sms.smsgo.tipoSmsId ?? "não definido (a SMSGo usa o tipo padrão)"));
  console.log("SMS_COST_PER_SEGMENT: " + (sms.custoPorSegmento ?? "não definido"));
  console.log("SMS_MONTHLY_BUDGET: " + (sms.orcamentoMensal ?? "não definido"));
  console.log(
    `limites: ${sms.limitePorProdutorDia} por produtor/dia · ${sms.limiteDiario} por dia · ` +
      `${sms.limiteMensal} por mês · ${sms.maxSegmentos} segmento(s) por SMS`
  );
}

async function diagnosticarFila() {
  titulo("Fila de notificações (PostgreSQL)");
  const porStatus = await pool.query(
    `SELECT canal, status, COUNT(*)::int AS total FROM notificacao_envios
     GROUP BY canal, status ORDER BY canal, status`
  );
  if (porStatus.rows.length === 0) console.log("nenhum envio registrado");
  for (const linha of porStatus.rows) console.log(`${linha.canal} · ${linha.status}: ${linha.total}`);

  const motivos = await pool.query(
    `SELECT canal, status, erro_codigo, COUNT(*)::int AS total FROM notificacao_envios
     WHERE status IN ('falhou', 'bloqueado', 'pendente') AND erro_codigo IS NOT NULL
       AND atualizado_em > NOW() - INTERVAL '7 days'
     GROUP BY canal, status, erro_codigo ORDER BY total DESC LIMIT 10`
  );
  for (const linha of motivos.rows) {
    console.log(`motivo (7 dias) ${linha.canal} · ${linha.status} · ${linha.erro_codigo}: ${linha.total}`);
  }

  const consumo = await pool.query(
    `SELECT modo, COUNT(*)::int AS total, COALESCE(SUM(custo_estimado), 0)::float AS custo
     FROM notificacao_envios
     WHERE canal = 'sms' AND enviado_em >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
     GROUP BY modo ORDER BY modo`
  );
  for (const linha of consumo.rows) {
    console.log(`SMS no mês · ${linha.modo}: ${linha.total} (custo estimado ${reais(linha.custo, 4)})`);
  }
}

async function main() {
  const config = lerConfiguracao();
  const avisos = avisosDeConfiguracao(config);
  if (avisos.length) titulo("Avisos de configuração");
  for (const aviso of avisos) console.log("- " + aviso);

  await diagnosticarResend(config);
  await diagnosticarSmsgo(config);
  try {
    await diagnosticarFila();
  } catch (erro) {
    console.log("banco indisponível: " + erro.message);
    console.log("rode dentro do container: docker compose exec backend npm run notificacoes:diagnostico");
  }
  await pool.end();
}

main().catch((erro) => {
  console.error("Falha no diagnóstico:", erro.message);
  process.exit(1);
});
