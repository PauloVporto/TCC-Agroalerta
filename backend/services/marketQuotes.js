/**
 * Cotações de mercado agrícola — Brasil e internacional.
 *
 * Internacionais: futuros ICE/CBOT via Yahoo Finance.
 * Brasil: série interna calibrada ao Cepea (R$/saca) + paridade de
 * exportação (contrato internacional × PTAX do Banco Central).
 * Macro: IC-Br Agropecuária (SGS 27575) e dólar PTAX (SGS 1 / Olinda).
 */

const { pool } = require("./db");
const { INTERNACIONAL } = require("./marketSymbols");
const { internacionalParaReais, converterHistorico, unidadeBrasil } = require("./marketParity");

const HEADERS = {
  "User-Agent": "AgroAlerta-TCC/1.0 (trabalho acadêmico)",
  Accept: "application/json",
};

let cacheDolar = { em: 0, valor: null };
let cacheSerieDolar = { em: 0, mapa: null };
let cacheIcBr = { em: 0, valor: null };

function fmtPtax(d) {
  return (
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0") +
    "-" +
    d.getFullYear()
  );
}

function isoDeDataBr(dataBr) {
  const [dia, mes, ano] = String(dataBr).split("/");
  if (!ano) return null;
  return ano + "-" + mes.padStart(2, "0") + "-" + dia.padStart(2, "0");
}

async function buscarDolarPtax() {
  if (cacheDolar.valor && Date.now() - cacheDolar.em < 30 * 60 * 1000) {
    return cacheDolar.valor;
  }
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(fim.getDate() - 7);

  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@d1,dataFinalCotacao=@d2)" +
    "?@d1='" +
    fmtPtax(inicio) +
    "'&@d2='" +
    fmtPtax(fim) +
    "'&$top=5&$orderby=dataHoraCotacao%20desc&$format=json";

  const resposta = await fetch(url, { headers: HEADERS });
  if (!resposta.ok) throw new Error("Erro PTAX: " + resposta.status);
  const dados = await resposta.json();
  const item = (dados.value || [])[0];
  if (!item) throw new Error("PTAX sem cotação no período");

  const resultado = {
    valor: Number(item.cotacaoVenda),
    data: String(item.dataHoraCotacao).slice(0, 10),
    fonte: "bcb-ptax",
  };
  cacheDolar = { em: Date.now(), valor: resultado };
  return resultado;
}

async function buscarSerieDolar() {
  if (cacheSerieDolar.mapa && Date.now() - cacheSerieDolar.em < 30 * 60 * 1000) {
    return cacheSerieDolar.mapa;
  }
  const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/180?formato=json";
  const resposta = await fetch(url, { headers: HEADERS });
  if (!resposta.ok) throw new Error("Erro SGS dólar: " + resposta.status);
  const lista = await resposta.json();
  const mapa = {};
  for (const item of lista || []) {
    const iso = isoDeDataBr(item.data);
    if (iso) mapa[iso] = Number(item.valor);
  }
  cacheSerieDolar = { em: Date.now(), mapa };
  return mapa;
}

async function buscarIcBrAgro() {
  if (cacheIcBr.valor && Date.now() - cacheIcBr.em < 6 * 60 * 60 * 1000) {
    return cacheIcBr.valor;
  }
  try {
    const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.27575/dados/ultimos/6?formato=json";
    const resposta = await fetch(url, { headers: HEADERS });
    if (!resposta.ok) throw new Error("Erro IC-Br: " + resposta.status);
    const lista = await resposta.json();
    const ultimo = (lista || [])[lista.length - 1];
    if (!ultimo) return null;
    const resultado = {
      valor: Number(ultimo.valor),
      data: isoDeDataBr(ultimo.data),
      fonte: "bcb-icbr-agro",
      nome: "IC-Br Agropecuária",
    };
    cacheIcBr = { em: Date.now(), valor: resultado };
    return resultado;
  } catch (erro) {
    console.error("[marketQuotes] IC-Br indisponível:", erro.message);
    return null;
  }
}

async function buscarFuturoYahoo(cultura) {
  const meta = INTERNACIONAL[cultura];
  if (!meta) return null;

  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(meta.ticker) +
    "?interval=1d&range=6mo";

  const resposta = await fetch(url, { headers: HEADERS });
  if (!resposta.ok) throw new Error("Erro Yahoo Finance: " + resposta.status);
  const dados = await resposta.json();
  const result = dados.chart && dados.chart.result && dados.chart.result[0];
  if (!result) throw new Error("Yahoo Finance sem resultado para " + meta.ticker);

  const timestamps = result.timestamp || [];
  const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0].close) || [];
  const historico = [];
  for (let i = 0; i < timestamps.length; i++) {
    const preco = closes[i];
    if (preco == null) continue;
    historico.push({
      data: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      preco: Number(preco.toFixed(2)),
    });
  }

  const ultimo = historico[historico.length - 1];
  const metaQuote = result.meta || {};

  return {
    cultura,
    ticker: meta.ticker,
    nome: meta.nome,
    bolsa: meta.bolsa,
    unidade: meta.unidade,
    preco: Number((metaQuote.regularMarketPrice || (ultimo && ultimo.preco) || 0).toFixed(2)),
    data: ultimo ? ultimo.data : new Date().toISOString().slice(0, 10),
    moeda: metaQuote.currency || "USD",
    historico,
    fonte: "yahoo-finance",
    mercado: "internacional",
  };
}

async function persistirCotacao(cotacao) {
  if (!cotacao) return;
  try {
    await pool.query(
      `INSERT INTO cotacoes_mercado (cultura, data, preco, unidade, fonte, ticker)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cultura, data, fonte) DO UPDATE SET
         preco = EXCLUDED.preco,
         unidade = EXCLUDED.unidade,
         ticker = EXCLUDED.ticker,
         atualizado_em = NOW()`,
      [cotacao.cultura, cotacao.data, cotacao.preco, cotacao.unidade, cotacao.fonte, cotacao.ticker || null]
    );
  } catch (erro) {
    console.error("[marketQuotes] Não foi possível persistir cotação:", erro.message);
  }
}

async function buscarCotacaoAoVivo(cultura) {
  try {
    const cotacao = await buscarFuturoYahoo(cultura);
    if (cotacao) await persistirCotacao(cotacao);
    return cotacao;
  } catch (erro) {
    console.error("[marketQuotes] Falha na cotação internacional de " + cultura + ":", erro.message);
    return null;
  }
}

function montarParidade(cultura, internacional, dolar, dolarPorData) {
  if (!internacional || !dolar) return null;
  const preco = internacionalParaReais(cultura, internacional.preco, dolar.valor);
  if (preco == null) return null;

  const historico = converterHistorico(cultura, internacional.historico, dolarPorData, dolar.valor);
  const paridade = {
    cultura,
    mercado: "brasil-paridade",
    nome: "Paridade internacional em reais",
    preco,
    unidade: unidadeBrasil(cultura),
    data: internacional.data,
    fonte: "paridade-ptax",
    ticker: internacional.ticker,
    historico,
    dolarUsado: dolar.valor,
  };
  persistirCotacao(paridade);
  return paridade;
}

async function buscarContextoMercado(cultura) {
  const [dolarP, internP, serieP, icP] = await Promise.allSettled([
    buscarDolarPtax(),
    buscarCotacaoAoVivo(cultura),
    buscarSerieDolar(),
    buscarIcBrAgro(),
  ]);

  const dolar = dolarP.status === "fulfilled" ? dolarP.value : null;
  const internacional = internP.status === "fulfilled" ? internP.value : null;
  const dolarPorData = serieP.status === "fulfilled" ? serieP.value : {};
  const icBrAgro = icP.status === "fulfilled" ? icP.value : null;
  const paridade = montarParidade(cultura, internacional, dolar, dolarPorData);

  return {
    dolar,
    icBrAgro,
    cotacaoAoVivo: internacional,
    internacional,
    paridade,
    fonteMercado: internacional ? "brasil+internacional" : "serie-interna",
  };
}

module.exports = {
  INTERNACIONAL,
  SIMBOLOS: INTERNACIONAL,
  buscarDolarPtax,
  buscarFuturoYahoo,
  buscarCotacaoAoVivo,
  buscarContextoMercado,
  buscarIcBrAgro,
};
