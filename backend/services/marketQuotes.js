/**
 * Cotações de mercado agrícola.
 *
 * APIs comerciais levantadas no planejamento (SAFRAS, Cedro, Agrolink)
 * exigem contrato/pagamento e não cabem no escopo gratuito do TCC.
 *
 * Escolha adotada (fontes públicas, sem chave):
 * - Yahoo Finance: futuros de café, soja, milho e açúcar (proxy da cana).
 * - Banco Central (PTAX): dólar comercial, fator relevante para o agro.
 * - Feijão: não há futuro líquido equivalente; usa a série interna.
 */

const { pool } = require("./db");
const { SIMBOLOS } = require("./marketSymbols");

const HEADERS = {
  "User-Agent": "AgroAlerta-TCC/1.0 (trabalho acadêmico)",
  Accept: "application/json",
};

let cacheDolar = { em: 0, valor: null };

async function buscarDolarPtax() {
  if (cacheDolar.valor && Date.now() - cacheDolar.em < 30 * 60 * 1000) {
    return cacheDolar.valor;
  }
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(fim.getDate() - 7);

  const fmt = (d) =>
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0") +
    "-" +
    d.getFullYear();

  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@d1,dataFinalCotacao=@d2)" +
    "?@d1='" +
    fmt(inicio) +
    "'&@d2='" +
    fmt(fim) +
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

async function buscarFuturoYahoo(cultura) {
  const meta = SIMBOLOS[cultura];
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
    unidade: meta.unidade,
    preco: Number((metaQuote.regularMarketPrice || (ultimo && ultimo.preco) || 0).toFixed(2)),
    data: ultimo ? ultimo.data : new Date().toISOString().slice(0, 10),
    moeda: metaQuote.currency || "USD",
    historico,
    fonte: "yahoo-finance",
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
      [cotacao.cultura, cotacao.data, cotacao.preco, cotacao.unidade, cotacao.fonte, cotacao.ticker]
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
    console.error("[marketQuotes] Falha na cotação ao vivo de " + cultura + ":", erro.message);
    return null;
  }
}

async function buscarContextoMercado(cultura) {
  const [dolar, cotacao] = await Promise.allSettled([buscarDolarPtax(), buscarCotacaoAoVivo(cultura)]);

  return {
    dolar: dolar.status === "fulfilled" ? dolar.value : null,
    cotacaoAoVivo: cotacao.status === "fulfilled" ? cotacao.value : null,
    fonteMercado: cotacao.status === "fulfilled" && cotacao.value ? "yahoo-finance" : "serie-interna",
  };
}

module.exports = {
  SIMBOLOS,
  buscarDolarPtax,
  buscarFuturoYahoo,
  buscarCotacaoAoVivo,
  buscarContextoMercado,
};
