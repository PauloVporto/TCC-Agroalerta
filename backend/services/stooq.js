/**
 * Stooq.com – cotações de futuros agrícolas internacionais via CSV público.
 * Sem necessidade de chave de API. Fonte alternativa ao Alpha Vantage.
 * Documentação: https://stooq.com
 */

const SIMBOLOS = {
  cafe: "KC.F",  // Coffee C futures (ICE)
  soja: "ZS.F",  // Soybean futures (CBOT)
};

const UNIDADES = {
  cafe: "cents/lb",
  soja: "cents/bushel",
};

const _cache = {};
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas

function formatarDataStooq(d) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}${mes}${dia}`;
}

async function buscarCotacaoStooq(cultura) {
  const simbolo = SIMBOLOS[cultura];
  if (!simbolo) return null;

  const agora = Date.now();
  if (_cache[simbolo] && agora - _cache[simbolo].ts < CACHE_TTL_MS) {
    return _cache[simbolo].dados;
  }

  try {
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - 90 * 24 * 60 * 60 * 1000);
    const d1 = formatarDataStooq(inicio);
    const d2 = formatarDataStooq(hoje);

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(simbolo)}&d1=${d1}&d2=${d2}&i=d`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "AgroAlerta/1.0 (TCC Academico)" },
    });
    if (!resp.ok) return null;

    const csv = await resp.text();
    if (!csv || csv.startsWith("<!") || csv.includes("No data") || csv.trim() === "") {
      return null;
    }

    const linhas = csv.trim().split("\n").slice(1); // Remove cabeçalho
    const dados = linhas
      .map((linha) => {
        const cols = linha.split(",");
        return { data: (cols[0] || "").trim(), valor: parseFloat(cols[4]) };
      })
      .filter((d) => d.data && !isNaN(d.valor));

    if (dados.length === 0) return null;

    const resultado = {
      fonte: "Stooq",
      simbolo,
      unidade: UNIDADES[cultura] || "—",
      valorAtual: dados[dados.length - 1].valor,
      data: dados[dados.length - 1].data,
      serie: dados.slice(-30),
    };

    _cache[simbolo] = { ts: agora, dados: resultado };
    return resultado;
  } catch (e) {
    console.error("[stooq] Erro ao buscar " + simbolo + ":", e.message);
    return null;
  }
}

const _cacheHist = {};
const CACHE_HIST_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

async function buscarHistoricoMensalStooq(cultura) {
  const simbolo = SIMBOLOS[cultura];
  if (!simbolo) return null;

  const cacheKey = simbolo + "_hist";
  const agora = Date.now();
  if (_cacheHist[cacheKey] && agora - _cacheHist[cacheKey].ts < CACHE_HIST_TTL_MS) {
    return _cacheHist[cacheKey].dados;
  }

  try {
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear() - 1, hoje.getMonth() - 1, 1);
    const d1 = formatarDataStooq(inicio);
    const d2 = formatarDataStooq(hoje);

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(simbolo)}&d1=${d1}&d2=${d2}&i=m`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "AgroAlerta/1.0 (TCC Academico)" },
    });
    if (!resp.ok) return null;

    const csv = await resp.text();
    if (!csv || csv.startsWith("<!") || csv.includes("No data") || csv.trim() === "") {
      return null;
    }

    const linhas = csv.trim().split("\n").slice(1);
    const dados = linhas
      .map((linha) => {
        const cols = linha.split(",");
        const fechamento = parseFloat(cols[4]);
        return { data: (cols[0] || "").trim(), preco: isNaN(fechamento) ? parseFloat(cols[1]) : fechamento };
      })
      .filter((d) => d.data && !isNaN(d.preco));

    if (dados.length === 0) return null;

    const resultado = {
      historico: dados,
      unidade: UNIDADES[cultura] || "—",
      fonte: "Stooq",
      simbolo,
    };

    _cacheHist[cacheKey] = { ts: agora, dados: resultado };
    return resultado;
  } catch (e) {
    console.error("[stooq] Erro ao buscar histórico de " + simbolo + ":", e.message);
    return null;
  }
}

module.exports = { buscarCotacaoStooq, buscarHistoricoMensalStooq };
