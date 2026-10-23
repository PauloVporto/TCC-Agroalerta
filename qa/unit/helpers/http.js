const path = require("path");

const BACKEND = path.resolve(__dirname, "..", "..", "..", "backend");

/** Monta uma resposta falsa compatível com o que os serviços usam de fetch(). */
function resposta({ ok = true, status = 200, json, text } = {}) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(json),
    text: jest.fn().mockResolvedValue(text !== undefined ? text : JSON.stringify(json)),
  };
}

/** Substitui o fetch global por um mock e devolve o mock. */
function mockFetch(...respostas) {
  const fn = jest.fn();
  respostas.forEach((r) => (r instanceof Error ? fn.mockRejectedValueOnce(r) : fn.mockResolvedValueOnce(r)));
  global.fetch = fn;
  return fn;
}

/** Carrega um módulo do backend com cache de módulo zerado (os serviços guardam cache interno). */
function carregar(relativo) {
  jest.resetModules();
  return require(path.join(BACKEND, relativo));
}

module.exports = { resposta, mockFetch, carregar, BACKEND };
