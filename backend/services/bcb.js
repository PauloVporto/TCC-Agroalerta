/**
 * Banco Central do Brasil – PTAX e Índice de Commodities Agropecuárias (IC-Br).
 * Sem necessidade de chave de API. Dados abertos do BCB.
 * PTAX: https://olinda.bcb.gov.br
 * SGS (séries temporais): https://api.bcb.gov.br
 */

const fs = require("fs");
const path = require("path");
const ARQ_ICBR = path.join(__dirname, "..", "data", "cache-icbr.json");

const _cache = {};
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas

function formatarDataBCB(d) {
  // Formato exigido pela API PTAX: MM-DD-YYYY
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

async function buscarPtax() {
  const chave = "ptax";
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) {
    return _cache[chave].dados;
  }

  try {
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - 10 * 24 * 60 * 60 * 1000);
    const di = encodeURIComponent("'" + formatarDataBCB(inicio) + "'");
    const df = encodeURIComponent("'" + formatarDataBCB(hoje) + "'");

    const url =
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
      "CotacaoDolarPeriodo(dataInicial=@di,dataFinalCotacao=@df)" +
      `?@di=${di}&@df=${df}` +
      "&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao" +
      "&$orderby=dataHoraCotacao%20desc&$top=5";

    const resp = await fetch(url);
    if (!resp.ok) return null;

    const json = await resp.json();
    if (!json.value || json.value.length === 0) return null;

    const ultimo = json.value[0];
    const resultado = {
      cotacaoCompra: ultimo.cotacaoCompra,
      cotacaoVenda: ultimo.cotacaoVenda,
      dataHora: ultimo.dataHoraCotacao,
      fonte: "Banco Central do Brasil (PTAX)",
    };

    _cache[chave] = { ts: agora, dados: resultado };
    return resultado;
  } catch (e) {
    console.error("[bcb] Erro ao buscar PTAX:", e.message);
    return null;
  }
}

// Códigos SGS candidatos do IC-Br Agropecuário. Pode ser fixado via BCB_ICBR_SERIE no .env.
const SERIES_ICBR = [process.env.BCB_ICBR_SERIE, 27575, 29039].filter(Boolean);

async function lerSerieSGS(codigo) {
  const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs." + codigo + "/dados/ultimos/13?formato=json";
  const resp = await fetch(url, {
    headers: { "User-Agent": "AgroAlerta/1.0 (TCC Academico)", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  // Lê como texto e tenta JSON independente do content-type (o BCB já respondeu HTML de erro com status 200).
  const texto = await resp.text();
  let json;
  try { json = JSON.parse(texto); } catch { throw new Error("série " + codigo + ": resposta é HTML/texto, não JSON (status " + resp.status + ")"); }
  if (!Array.isArray(json) || json.length < 2) throw new Error("série " + codigo + ": sem dados na resposta");
  return { codigo, json };
}

async function buscarIndiceCommoditiesAgro() {
  const chave = "icbr";
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) {
    return _cache[chave].dados;
  }

  try {
    const { codigo, json } = await Promise.any(SERIES_ICBR.map(lerSerieSGS));
    const serie = json
      .map((d) => ({ data: d.data, valor: parseFloat(String(d.valor).replace(",", ".")) }))
      .filter((d) => !isNaN(d.valor));
    if (serie.length < 2) return null;

    const primeiro = serie[0].valor;
    const ultimo = serie[serie.length - 1].valor;
    const resultado = {
      fonte: "Banco Central do Brasil (IC-Br Agropecuário · SGS " + codigo + ")",
      valorAtual: ultimo,
      variacao12m: primeiro > 0 ? (((ultimo - primeiro) / primeiro) * 100).toFixed(1) : null,
      serie: serie.slice(-12),
    };
    _cache[chave] = { ts: agora, dados: resultado };
    try { fs.writeFileSync(ARQ_ICBR, JSON.stringify({ salvoEm: new Date().toISOString(), dados: resultado })); } catch { /* sem disco */ }
    return resultado;
  } catch (e) {
    const motivo = e instanceof AggregateError ? e.errors.map((x) => x.message).join("; ") : e.message;
    console.warn("[bcb] IC-Br Agropecuário indisponível:", motivo);
    // Durante quedas do BCB, mostra o último valor obtido com sucesso (se houver).
    let ultimo = null;
    try {
      const salvo = JSON.parse(fs.readFileSync(ARQ_ICBR, "utf-8"));
      ultimo = Object.assign({}, salvo.dados, { desatualizado: true, obtidoEm: salvo.salvoEm });
    } catch { /* nenhum valor salvo ainda */ }
    _cache[chave] = { ts: agora - CACHE_TTL_MS + 10 * 60 * 1000, dados: ultimo };
    return ultimo;
  }
}

module.exports = { buscarPtax, buscarIndiceCommoditiesAgro, SERIES_ICBR };
