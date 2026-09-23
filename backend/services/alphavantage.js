/**
 * Alpha Vantage – cotações internacionais de commodities agrícolas.
 * Requer ALPHA_VANTAGE_KEY no .env. Plano gratuito: 25 requisições/dia.
 * Documentação: https://www.alphavantage.co/documentation/#commodities
 */

const API_KEY = (process.env.ALPHA_VANTAGE_KEY || "").trim() || undefined;
const BASE_URL = "https://www.alphavantage.co/query";

// Funções da API por cultura (Alpha Vantage não tem soybeans direto)
const FUNCOES = {
  cafe: "COFFEE",
  milho: "CORN",
  cana: "SUGAR",
};

const _cache = {};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

async function buscarCotacaoAV(cultura) {
  if (!API_KEY) return null;

  const funcao = FUNCOES[cultura];
  if (!funcao) return null;

  const agora = Date.now();
  if (_cache[funcao] && agora - _cache[funcao].ts < CACHE_TTL_MS) {
    return _cache[funcao].dados;
  }

  try {
    const url = `${BASE_URL}?function=${funcao}&interval=monthly&apikey=${API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const json = await resp.json();

    // Limite de requisições excedido
    if (json.Note || json.Information) {
      console.warn("[alphavantage] Limite de requisições atingido.");
      return null;
    }

    if (!Array.isArray(json.data) || json.data.length === 0) return null;

    const serie = json.data
      .slice(0, 12)
      .map((d) => ({ data: d.date, valor: parseFloat(d.value) }))
      .filter((d) => !isNaN(d.valor));

    if (serie.length === 0) return null;

    const resultado = {
      fonte: "Alpha Vantage",
      funcao,
      unidade: json.unit || "—",
      valorAtual: serie[0].valor,
      serie,
    };

    _cache[funcao] = { ts: agora, dados: resultado };
    return resultado;
  } catch (e) {
    console.error("[alphavantage] Erro:", e.message);
    return null;
  }
}

module.exports = { buscarCotacaoAV };
