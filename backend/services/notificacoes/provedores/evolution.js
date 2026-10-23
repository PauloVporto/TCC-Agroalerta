/**
 * Cliente da Evolution API v2.3.7 (WhatsApp Web via Baileys).
 *
 * Endpoints, corpos e respostas conferidos no código-fonte da versão 2.3.7
 * (src/api/routes, controllers, dto e integrations/event/webhook):
 *   POST   /instance/create                      cria a instância (integration "WHATSAPP-BAILEYS")
 *   GET    /instance/connectionState/{nome}      { instance: { instanceName, state: open | connecting | close } }
 *   GET    /instance/fetchInstances?instanceName= dados da instância — inclui o token dela, que nunca sai daqui
 *   GET    /instance/connect/{nome}              inicia o pareamento e devolve o QR { base64, code, count };
 *                                                já conectada, devolve o estado
 *   POST   /instance/restart/{nome}              reconecta uma instância aberta ou conectando
 *   DELETE /instance/logout/{nome}               desconecta o número (a instância continua existindo)
 *   POST   /webhook/set/{nome}                   { webhook: { enabled, url, headers, byEvents, base64, events } }
 *   GET    /webhook/find/{nome}                  configuração atual — os headers trazem o segredo, que nunca sai daqui
 *   POST   /message/sendText/{nome}              { number, text } → 201 { key: { id, remoteJid, fromMe }, status: "PENDING" }
 *
 * Autenticação: cabeçalho "apikey" com a chave global (AUTHENTICATION_API_KEY).
 * Erros: { status, error, response: { message: [...] } }. GET /instance/connect e
 * POST /instance/restart respondem 200 com { error: true, message } quando falham.
 *
 * Webhook autenticado por JWT: com "jwt_key" nos headers configurados, a Evolution
 * assina a cada chamada um JWT HS256 (validade de 10 min) com essa chave e o envia
 * em "Authorization: Bearer" (conferido em assinaturas.js).
 *
 * Envio sem idempotência: a API não aceita chave de idempotência nem id próprio da
 * mensagem. Por isso todo erro de envio em que a mensagem pode ter saído é marcado
 * `incerto` — só falhas que comprovadamente aconteceram antes do envio são temporárias.
 */

const { ErroProvedor, erroDeConfiguracao, lerCorpo } = require("./comum");

const EVENTOS_WEBHOOK = ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"];

// Erros de rede em que a requisição comprovadamente não chegou à Evolution API.
const SEM_CONEXAO = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
]);

function erro(codigo, mensagem, { temporario = false, incerto = false, status = null } = {}) {
  return new ErroProvedor({ provedor: "evolution", codigo, mensagem: "Evolution API: " + mensagem, temporario, incerto, status });
}

function mensagensDoCorpo(corpo) {
  const lista = corpo && corpo.response && corpo.response.message;
  if (Array.isArray(lista)) return lista;
  if (corpo && typeof corpo === "object" && corpo.message !== undefined) return [corpo.message];
  return typeof corpo === "string" && corpo ? [corpo] : [];
}

function descrever(mensagens, status) {
  const textos = mensagens.map((m) => (typeof m === "string" ? m : JSON.stringify(m)));
  return textos.length ? textos.join("; ") : "HTTP " + status;
}

// `envio` = a chamada entrega uma mensagem: o que não é comprovadamente anterior ao envio é incerto.
function erroDaResposta(status, corpo, envio) {
  const mensagens = mensagensDoCorpo(corpo);
  const detalhe = descrever(mensagens, status);
  if (status === 401) return erro("credencial_invalida", "a chave da API foi recusada.", { temporario: true, status });
  if (status === 403 && /already in use/i.test(detalhe)) return erro("instancia_existente", detalhe, { status });
  if (status === 403) return erro("credencial_invalida", detalhe, { temporario: true, status });
  if (status === 404) return erro("instancia_inexistente", detalhe, { temporario: true, status });
  if (status === 400 && mensagens.some((m) => m && typeof m === "object" && m.exists === false)) {
    return erro("numero_sem_whatsapp", "o número não tem conta no WhatsApp.", { status });
  }
  if (envio) {
    return erro("resultado_incerto", `o envio falhou sem garantia de que a mensagem não saiu (${detalhe}).`, { incerto: true, status });
  }
  if (status >= 500) return erro("erro_provedor", detalhe, { temporario: true, status });
  return erro("requisicao_invalida", detalhe, { status });
}

async function chamar(cfg, metodo, caminho, { dados, envio = false } = {}) {
  if (!cfg.url || !cfg.apiKey) {
    throw erroDeConfiguracao("evolution", "EVOLUTION_API_URL e EVOLUTION_API_KEY são obrigatórias.");
  }
  const headers = { apikey: cfg.apiKey, Accept: "application/json" };
  if (dados) headers["Content-Type"] = "application/json";

  let resposta;
  try {
    resposta = await fetch(cfg.url + caminho, {
      method: metodo,
      headers,
      body: dados ? JSON.stringify(dados) : undefined,
      signal: AbortSignal.timeout(cfg.tempoLimiteMs),
    });
  } catch (falha) {
    const codigoRede = (falha.cause && falha.cause.code) || falha.code;
    if (SEM_CONEXAO.has(codigoRede)) throw erro("falha_conexao", `sem conexão (${codigoRede}).`, { temporario: true });
    const motivo = falha.name === "TimeoutError" ? "tempo esgotado" : codigoRede || falha.message;
    throw erro("sem_resposta", `sem resposta (${motivo}).`, { temporario: !envio, incerto: envio });
  }

  let corpo;
  try {
    corpo = await lerCorpo(resposta);
  } catch (falha) {
    throw erro("sem_resposta", `resposta interrompida (${falha.message}).`, { temporario: !envio, incerto: envio });
  }
  if (!resposta.ok) throw erroDaResposta(resposta.status, corpo, envio);
  return corpo;
}

function caminho(acao, cfg) {
  return `/${acao}/${encodeURIComponent(cfg.instancia)}`;
}

// ---- Mensagens -------------------------------------------------------------------

/** @param numero dígitos com DDI, ex.: "5535999990000" (a Evolution resolve o nono dígito) */
async function enviarTexto(cfg, { numero, texto }) {
  const corpo = await chamar(cfg, "POST", caminho("message/sendText", cfg), {
    dados: { number: numero, text: texto },
    envio: true,
  });
  const id = corpo && corpo.key && corpo.key.id;
  if (!id) throw erro("resultado_incerto", "a resposta do envio não trouxe o id da mensagem.", { incerto: true });
  return { provedorId: String(id) };
}

// ---- Instância ---------------------------------------------------------------------

// Estado em memória da conexão: "open" | "connecting" | "close" | null. existe=false sem a instância.
async function estadoDaConexao(cfg) {
  try {
    const corpo = await chamar(cfg, "GET", caminho("instance/connectionState", cfg));
    return { existe: true, estado: (corpo && corpo.instance && corpo.instance.state) || null };
  } catch (falha) {
    if (falha.codigo === "instancia_inexistente") return { existe: false, estado: null };
    throw falha;
  }
}

// Só os campos que o painel pode mostrar: o token da instância nunca sai deste módulo.
async function dadosDaInstancia(cfg) {
  try {
    const corpo = await chamar(cfg, "GET", "/instance/fetchInstances?instanceName=" + encodeURIComponent(cfg.instancia));
    const instancia = (Array.isArray(corpo) ? corpo : []).find((i) => i && i.name === cfg.instancia);
    if (!instancia) return null;
    return {
      numero: instancia.ownerJid || null,
      perfil: instancia.profileName || null,
      motivoDesconexao: instancia.disconnectionReasonCode ?? null,
      desconectadaEm: instancia.disconnectionAt || null,
    };
  } catch (falha) {
    if (falha.codigo === "instancia_inexistente") return null;
    throw falha;
  }
}

/** Cria a instância; devolve false se ela já existia. */
async function criarInstancia(cfg) {
  try {
    await chamar(cfg, "POST", "/instance/create", {
      dados: {
        instanceName: cfg.instancia,
        integration: "WHATSAPP-BAILEYS",
        qrcode: false,
        // O número é de uma pessoa: nada de recusar ligações, marcar conversas como
        // lidas, aparecer sempre "online" ou importar o histórico do celular.
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
      },
    });
    return true;
  } catch (falha) {
    if (falha.codigo === "instancia_existente") return false;
    throw falha;
  }
}

function webhookEsperado(cfg) {
  return {
    enabled: true,
    url: cfg.webhookUrl,
    headers: { jwt_key: cfg.webhookSecret },
    byEvents: false,
    base64: false,
    events: EVENTOS_WEBHOOK,
  };
}

async function configurarWebhook(cfg) {
  if (!cfg.webhookUrl || !cfg.webhookSecret) {
    throw erroDeConfiguracao("evolution", "EVOLUTION_WEBHOOK_URL e EVOLUTION_WEBHOOK_SECRET são obrigatórios para receber os eventos.");
  }
  await chamar(cfg, "POST", caminho("webhook/set", cfg), { dados: { webhook: webhookEsperado(cfg) } });
}

/** O webhook da instância está como o backend espera? (o segredo é conferido, nunca devolvido) */
async function webhookEmDia(cfg) {
  const atual = await chamar(cfg, "GET", caminho("webhook/find", cfg));
  if (!atual || typeof atual !== "object") return false;
  const eventos = Array.isArray(atual.events) ? atual.events : [];
  return (
    atual.enabled === true &&
    atual.url === cfg.webhookUrl &&
    EVENTOS_WEBHOOK.every((e) => eventos.includes(e)) &&
    Boolean(atual.headers) &&
    atual.headers.jwt_key === cfg.webhookSecret
  );
}

/** Pede o pareamento. Conectando: { estado: "connecting", qrCode } (data URL do PNG, ou null enquanto é gerado). */
async function conectar(cfg) {
  const corpo = await chamar(cfg, "GET", caminho("instance/connect", cfg));
  if (corpo && corpo.error) throw erro("erro_provedor", String(corpo.message || "falha ao conectar."), { temporario: true });
  if (corpo && corpo.instance && corpo.instance.state === "open") return { estado: "open", qrCode: null };
  return { estado: "connecting", qrCode: (corpo && corpo.base64) || null };
}

async function reiniciar(cfg) {
  const corpo = await chamar(cfg, "POST", caminho("instance/restart", cfg));
  if (corpo && corpo.error) throw erro("erro_provedor", String(corpo.message || "falha ao reiniciar."), { temporario: true });
}

async function desconectar(cfg) {
  await chamar(cfg, "DELETE", caminho("instance/logout", cfg));
}

// GET / responde sem autenticação, mas consulta web.whatsapp.com a cada chamada: só no diagnóstico.
async function versaoDoServidor(cfg) {
  const corpo = await chamar(cfg, "GET", "/");
  return corpo && corpo.version ? String(corpo.version) : null;
}

module.exports = {
  EVENTOS_WEBHOOK,
  enviarTexto,
  estadoDaConexao,
  dadosDaInstancia,
  criarInstancia,
  configurarWebhook,
  webhookEmDia,
  conectar,
  reiniciar,
  desconectar,
  versaoDoServidor,
};
