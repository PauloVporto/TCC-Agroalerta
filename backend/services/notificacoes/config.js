/**
 * Configuração das notificações, lida das variáveis de ambiente.
 *
 * Cada canal opera em um de três modos:
 *   simulado — *_SENDING_ENABLED=false (padrão): a fila roda e o histórico é
 *              gravado, mas nenhuma chamada externa é feita, sem custo;
 *   sandbox  — SMS pela API real da SMSGo com a chave de teste (test_…), que não
 *              cobra nem entrega a mensagem;
 *   real     — envio de verdade, com custo.
 */

function texto(valor) {
  return String(valor ?? "").trim();
}

function verdadeiro(valor) {
  return texto(valor).toLowerCase() === "true";
}

function numero(valor, padrao) {
  if (texto(valor) === "") return padrao;
  const convertido = Number(texto(valor).replace(",", "."));
  return Number.isFinite(convertido) ? convertido : padrao;
}

function lerConfiguracao(env = process.env) {
  return {
    email: {
      provedor: texto(env.EMAIL_PROVIDER) || "resend",
      envioAtivo: verdadeiro(env.EMAIL_SENDING_ENABLED),
      resendApiKey: texto(env.RESEND_API_KEY),
      remetente: texto(env.EMAIL_FROM),
      resendWebhookSecret: texto(env.RESEND_WEBHOOK_SECRET),
    },
    sms: {
      provedor: texto(env.SMS_PROVIDER) || "smsgo",
      envioAtivo: verdadeiro(env.SMS_SENDING_ENABLED),
      smsgo: {
        chaveProducao: texto(env.SMSGO_API_KEY),
        chaveTeste: texto(env.SMSGO_TEST_API_KEY),
        // Só sai do sandbox com SMSGO_SANDBOX=false explícito.
        sandbox: texto(env.SMSGO_SANDBOX).toLowerCase() !== "false",
        tipoSmsId: numero(env.SMSGO_SMS_TYPE_ID, null),
        webhookSecret: texto(env.SMSGO_WEBHOOK_SECRET),
      },
      twilio: {
        accountSid: texto(env.TWILIO_ACCOUNT_SID),
        authToken: texto(env.TWILIO_AUTH_TOKEN),
        remetente: texto(env.TWILIO_FROM),
      },
      custoPorSegmento: numero(env.SMS_COST_PER_SEGMENT, null),
      orcamentoMensal: numero(env.SMS_MONTHLY_BUDGET, null),
      limiteDiario: numero(env.SMS_DAILY_LIMIT, 20),
      limiteMensal: numero(env.SMS_MONTHLY_LIMIT, 200),
      limitePorProdutorDia: numero(env.SMS_PER_USER_DAILY_LIMIT, 3),
      maxSegmentos: numero(env.SMS_MAX_SEGMENTS, 1),
    },
    fila: {
      intervaloMs: numero(env.NOTIFICATION_QUEUE_INTERVAL_MS, 15000),
      maxTentativas: numero(env.NOTIFICATION_MAX_ATTEMPTS, 5),
    },
    monitoramento: {
      ativo: texto(env.WEATHER_MONITOR_ENABLED).toLowerCase() !== "false",
      intervaloMin: numero(env.WEATHER_MONITOR_INTERVAL_MINUTES, 60),
    },
  };
}

function chaveSmsgoAtiva(configSms) {
  return configSms.smsgo.sandbox ? configSms.smsgo.chaveTeste : configSms.smsgo.chaveProducao;
}

function modoDoCanal(config, canal) {
  if (canal === "email") return config.email.envioAtivo ? "real" : "simulado";
  if (!config.sms.envioAtivo) return "simulado";
  return config.sms.provedor === "smsgo" && config.sms.smsgo.sandbox ? "sandbox" : "real";
}

// Problemas que impedem ou restringem envios, para mostrar na inicialização e no diagnóstico.
function avisosDeConfiguracao(config) {
  const avisos = [];
  const { email, sms } = config;

  if (email.envioAtivo) {
    if (email.provedor !== "resend") {
      avisos.push(`EMAIL_PROVIDER="${email.provedor}" não é suportado; use "resend".`);
    }
    if (!email.resendApiKey) avisos.push("EMAIL_SENDING_ENABLED=true, mas RESEND_API_KEY está vazia.");
    if (!email.remetente) {
      avisos.push("EMAIL_SENDING_ENABLED=true, mas EMAIL_FROM está vazio.");
    } else if (/@resend\.dev>?$/i.test(email.remetente)) {
      avisos.push(
        "EMAIL_FROM usa o domínio de teste resend.dev: o Resend só entrega para o e-mail " +
          "dono da conta até um domínio próprio ser verificado."
      );
    }
  }

  if (sms.envioAtivo) {
    if (sms.provedor === "smsgo" && !chaveSmsgoAtiva(sms)) {
      avisos.push(
        sms.smsgo.sandbox
          ? "SMSGO_SANDBOX=true, mas SMSGO_TEST_API_KEY está vazia."
          : "SMSGO_SANDBOX=false, mas SMSGO_API_KEY está vazia."
      );
    } else if (sms.provedor === "twilio") {
      const { accountSid, authToken, remetente } = sms.twilio;
      if (!accountSid || !authToken || !remetente) {
        avisos.push("SMS_PROVIDER=twilio, mas TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ou TWILIO_FROM está vazio.");
      }
    } else if (sms.provedor !== "smsgo") {
      avisos.push(`SMS_PROVIDER="${sms.provedor}" não é suportado; use "smsgo" (ou "twilio", legado).`);
    }
    if (modoDoCanal(config, "sms") === "real" && (sms.custoPorSegmento === null || sms.orcamentoMensal === null)) {
      avisos.push(
        "Envio real de SMS sem SMS_COST_PER_SEGMENT e SMS_MONTHLY_BUDGET: todo SMS será " +
          "bloqueado até os dois serem definidos."
      );
    }
  }

  return avisos;
}

module.exports = { lerConfiguracao, modoDoCanal, chaveSmsgoAtiva, avisosDeConfiguracao };
