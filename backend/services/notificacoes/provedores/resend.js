/**
 * Integração com a API REST do Resend (https://resend.com/docs/api-reference).
 *
 * POST /emails envia; o cabeçalho Idempotency-Key faz o Resend descartar uma
 * repetição do mesmo envio por 24 h (proteção contra duplicidade em retentativas).
 * GET /emails/{id} devolve `last_event`, usado para confirmar a entrega.
 */

const { ErroProvedor, erroDeConfiguracao, requisitar, lerCorpo, segundosDeEspera } = require("./comum");

const URL_BASE = "https://api.resend.com";

function erroDaResposta(resposta, corpo) {
  const status = resposta.status;
  const tipo = corpo && typeof corpo === "object" ? String(corpo.name || "") : "";
  const original = corpo && typeof corpo === "object" ? String(corpo.message || "") : String(corpo || "");
  const erro = (codigo, temporario, mensagem) =>
    new ErroProvedor({
      provedor: "resend",
      codigo,
      temporario,
      status,
      mensagem: mensagem || `Resend: ${original || "HTTP " + status}`,
      aguardarSegundos: temporario ? segundosDeEspera(resposta) : null,
    });

  if (status === 401 || ["restricted_api_key", "suspended_api_key", "invalid_api_key"].includes(tipo)) {
    return erro("credencial_invalida", false);
  }
  if (status === 403 && /testing emails|own email/i.test(original)) {
    return erro(
      "remetente_de_teste",
      false,
      "Resend: com o remetente de teste (resend.dev) só é possível enviar para o e-mail dono da conta. " +
        "Verifique um domínio próprio e use-o em EMAIL_FROM."
    );
  }
  if (status === 403 && /domain/i.test(original)) return erro("dominio_nao_verificado", false);
  if (status === 429 && /quota/.test(tipo)) return erro("cota_excedida", false);
  if (status === 429) return erro("limite_taxa", true);
  if (status === 409 && tipo === "concurrent_idempotent_requests") return erro("requisicao_em_andamento", true);
  if (status >= 500) return erro("erro_provedor", true);
  return erro("requisicao_invalida", false);
}

async function chamar(apiKey, metodo, caminho, { dados, cabecalhos = {} } = {}) {
  const headers = { Authorization: "Bearer " + apiKey, ...cabecalhos };
  if (dados) headers["Content-Type"] = "application/json";
  const resposta = await requisitar("resend", URL_BASE + caminho, {
    method: metodo,
    headers,
    body: dados ? JSON.stringify(dados) : undefined,
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw erroDaResposta(resposta, corpo);
  return corpo;
}

async function enviarEmail({ apiKey, remetente, para, assunto, html, texto, chaveIdempotencia, tags = [] }) {
  if (!apiKey) throw erroDeConfiguracao("resend", "RESEND_API_KEY não configurada.");
  if (!remetente) throw erroDeConfiguracao("resend", "EMAIL_FROM não configurado.");
  const corpo = await chamar(apiKey, "POST", "/emails", {
    cabecalhos: { "Idempotency-Key": chaveIdempotencia },
    dados: { from: remetente, to: [para], subject: assunto, html, text: texto, tags },
  });
  return { provedorId: corpo.id };
}

async function consultarEmail({ apiKey, id }) {
  const corpo = await chamar(apiKey, "GET", "/emails/" + encodeURIComponent(id));
  return { ultimoEvento: corpo.last_event || null };
}

async function listarDominios({ apiKey }) {
  const corpo = await chamar(apiKey, "GET", "/domains");
  return Array.isArray(corpo.data) ? corpo.data : [];
}

module.exports = { enviarEmail, consultarEmail, listarDominios };
