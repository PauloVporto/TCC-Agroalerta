/**
 * Juiz LLM: um modelo diferente do que gera as respostas pontua os critérios julgados.
 * Lança erro se a API falhar ou se a nota vier fora do formato; nunca inventa nota.
 */
const anthropic = require("../services/anthropic");
const { extrairJson } = require("../services/jsonIA");
const { CRITERIOS_JULGADOS, promptJuiz } = require("./criterios");

const MODELO_JUIZ_PADRAO = "claude-sonnet-4-6";
const modeloJuiz = () => (process.env.IA_AVALIACAO_JUIZ || "").trim() || MODELO_JUIZ_PADRAO;

function validarNotas(json) {
  if (!json) return null;
  const notas = {}, justificativas = {};
  for (const c of CRITERIOS_JULGADOS) {
    const item = json[c];
    if (!item || !Number.isInteger(item.nota) || item.nota < 1 || item.nota > 5) return null;
    notas[c] = item.nota;
    justificativas[c] = typeof item.justificativa === "string" ? item.justificativa.trim() : "";
  }
  return { notas, justificativas };
}

async function julgar(entrada) {
  const modelo = modeloJuiz();
  const { texto, dados, requestId } = await anthropic.mensagens({
    model: modelo,
    max_tokens: 900,
    temperature: 0,
    messages: [{ role: "user", content: promptJuiz(entrada) }],
  });
  const validado = validarNotas(extrairJson(texto));
  const proveniencia = { modelo: dados.model, requestId, respostaId: dados.id, uso: dados.usage || null };
  if (!validado) {
    const erro = new Error("O juiz respondeu fora do formato esperado.");
    throw Object.assign(erro, { codigo: "juiz_formato_invalido", proveniencia });
  }
  return { ...validado, proveniencia };
}

module.exports = { julgar, modeloJuiz, validarNotas, MODELO_JUIZ_PADRAO };
