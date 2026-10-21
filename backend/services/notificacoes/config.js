/**
 * Configuração das notificações, lida das variáveis de ambiente.
 *
 * E-mail (Resend): simulado com EMAIL_SENDING_ENABLED=false (padrão) — a fila roda
 * e o histórico é gravado, sem chamada externa — ou real.
 *
 * WhatsApp (Evolution API): uma única instância, conectada ao número do Agro
 * Alerta, envia para todos os produtores. Uma mensagem só sai quando todas as
 * travas estão abertas:
 *   1. WHATSAPP_SENDING_ENABLED=true — trava da implantação (padrão: false);
 *   2. o administrador liberou os envios no painel (tabela whatsapp_controle);
 *   3. a instância está conectada e o número conectado é o remetente esperado
 *      (WHATSAPP_EXPECTED_SENDER).
 * Enquanto alguma trava estiver fechada, as mensagens esperam na fila, até a
 * própria validade — nada é simulado nem descartado em silêncio.
 *
 * Os segredos da Evolution podem vir de um arquivo (NOME_FILE), como os
 * montados pelo Docker em /run/secrets, para não ficarem nas variáveis do container.
 */

const fs = require("fs");

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

// NOME_FILE (caminho de um arquivo com o segredo) tem precedência sobre NOME.
function segredo(env, nome) {
  const arquivo = texto(env[nome + "_FILE"]);
  if (!arquivo) return texto(env[nome]);
  try {
    return fs.readFileSync(arquivo, "utf8").trim();
  } catch {
    return "";
  }
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
    whatsapp: {
      envioAtivo: verdadeiro(env.WHATSAPP_SENDING_ENABLED),
      // Número completo ou só o final (ex.: "9503") do WhatsApp que deve estar conectado.
      remetenteEsperado: texto(env.WHATSAPP_EXPECTED_SENDER).replace(/\D/g, ""),
      intervaloMinimoMs: numero(env.WHATSAPP_MIN_INTERVAL_MS, 4000),
      limitePorHora: numero(env.WHATSAPP_HOURLY_LIMIT, 30),
      limiteDiario: numero(env.WHATSAPP_DAILY_LIMIT, 100),
      limitePorProdutorDia: numero(env.WHATSAPP_PER_USER_DAILY_LIMIT, 5),
      evolution: {
        url: texto(env.EVOLUTION_API_URL).replace(/\/+$/, ""),
        apiKey: segredo(env, "EVOLUTION_API_KEY"),
        instancia: texto(env.EVOLUTION_INSTANCE) || "agroalerta",
        webhookUrl: texto(env.EVOLUTION_WEBHOOK_URL),
        webhookSecret: segredo(env, "EVOLUTION_WEBHOOK_SECRET"),
        tempoLimiteMs: numero(env.EVOLUTION_REQUEST_TIMEOUT_MS, 30000),
      },
    },
    fila: {
      intervaloMs: numero(env.NOTIFICATION_QUEUE_INTERVAL_MS, 15000),
      maxTentativas: numero(env.NOTIFICATION_MAX_ATTEMPTS, 5),
    },
    monitoramento: {
      // Desligado por padrão: o monitoramento automático só roda com autorização explícita.
      ativo: verdadeiro(env.WEATHER_MONITOR_ENABLED),
      intervaloMin: numero(env.WEATHER_MONITOR_INTERVAL_MINUTES, 60),
    },
  };
}

function evolutionConfigurada(config) {
  return Boolean(config.whatsapp.evolution.url && config.whatsapp.evolution.apiKey);
}

/**
 * email:    "simulado" | "real"
 * whatsapp: "desativado" (trava da implantação fechada) | "nao_configurado" | "real"
 */
function modoDoCanal(config, canal) {
  if (canal === "email") return config.email.envioAtivo ? "real" : "simulado";
  if (!config.whatsapp.envioAtivo) return "desativado";
  return evolutionConfigurada(config) ? "real" : "nao_configurado";
}

// Problemas que impedem ou restringem envios, para mostrar na inicialização e no diagnóstico.
function avisosDeConfiguracao(config) {
  const avisos = [];
  const { email, whatsapp } = config;

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

  if (whatsapp.envioAtivo) {
    const { evolution } = whatsapp;
    if (!evolution.url) avisos.push("WHATSAPP_SENDING_ENABLED=true, mas EVOLUTION_API_URL está vazia.");
    if (!evolution.apiKey) {
      avisos.push("WHATSAPP_SENDING_ENABLED=true, mas EVOLUTION_API_KEY (ou o arquivo EVOLUTION_API_KEY_FILE) está vazia.");
    }
    if (!whatsapp.remetenteEsperado) {
      avisos.push(
        "WHATSAPP_EXPECTED_SENDER está vazio: sem saber qual número deve estar conectado, " +
          "nenhuma mensagem de WhatsApp é enviada."
      );
    }
    if (!evolution.webhookUrl || !evolution.webhookSecret) {
      avisos.push(
        "EVOLUTION_WEBHOOK_URL ou EVOLUTION_WEBHOOK_SECRET vazio: as confirmações de servidor, " +
          "entrega e leitura do WhatsApp não serão recebidas."
      );
    }
  }

  return avisos;
}

module.exports = { lerConfiguracao, modoDoCanal, evolutionConfigurada, avisosDeConfiguracao };
