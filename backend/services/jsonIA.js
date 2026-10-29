// Extrai um objeto JSON da resposta de um LLM, tolerando cerca de markdown e texto ao redor.
function extrairJson(texto) {
  if (typeof texto !== "string") return null;
  const limpo = texto.replace(/```(?:json)?/gi, "").trim();
  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) return null;
  try {
    const obj = JSON.parse(limpo.slice(inicio, fim + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

module.exports = { extrairJson };
