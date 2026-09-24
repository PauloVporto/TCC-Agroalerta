/**
 * Banco Central do Brasil – PTAX e Índice de Commodities Agropecuárias (IC-Br).
 * Sem necessidade de chave de API. Dados abertos do BCB.
 * PTAX: https://olinda.bcb.gov.br
 * SGS (séries temporais): https://api.bcb.gov.br
 */

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

async function buscarIndiceCommoditiesAgro() {
  // Série 29039: IC-Br Agropecuário (Índice de Commodities Brasil – componente agropecuário)
  const chave = "icbr";
  const agora = Date.now();
  if (_cache[chave] && agora - _cache[chave].ts < CACHE_TTL_MS) {
    return _cache[chave].dados;
  }

  try {
    const url =
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.29039/dados/ultimos/13?formato=json";
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const json = await resp.json();
    if (!Array.isArray(json) || json.length === 0) return null;

    const serie = json
      .map((d) => ({
        data: d.data,
        valor: parseFloat(String(d.valor).replace(",", ".")),
      }))
      .filter((d) => !isNaN(d.valor));

    if (serie.length === 0) return null;

    const primeiro = serie[0].valor;
    const ultimo = serie[serie.length - 1].valor;
    const variacao12m =
      primeiro > 0
        ? (((ultimo - primeiro) / primeiro) * 100).toFixed(1)
        : null;

    const resultado = {
      fonte: "Banco Central do Brasil (IC-Br Agropecuário)",
      valorAtual: ultimo,
      variacao12m,
      serie: serie.slice(-12),
    };

    _cache[chave] = { ts: agora, dados: resultado };
    return resultado;
  } catch (e) {
    console.error("[bcb] Erro ao buscar IC-Br Agropecuário:", e.message);
    return null;
  }
}

module.exports = { buscarPtax, buscarIndiceCommoditiesAgro };
