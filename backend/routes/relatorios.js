const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { exigirAutenticacao, obterConfiguracoes } = require("../services/auth");
const { pool } = require("../services/db");
const { buscarClimaOpenMeteo, buscarSerieDiaria } = require("../services/openmeteo");
const { buscarClimaAtual } = require("../services/weather");
const { buscarAlertasINMET, extrairUF } = require("../services/inmet");
const { avaliarAlertas } = require("../services/rules");
const { obterHistorico, gerarAnaliseTendencia } = require("../services/market");
const { buscarHistoricoMensalStooq, buscarCotacaoStooq } = require("../services/stooq");
const { buscarCotacaoAV } = require("../services/alphavantage");
const { buscarPtax, buscarIndiceCommoditiesAgro } = require("../services/bcb");
const { MAPA_ALERTA_CATEGORIA } = require("../services/alertaInsumos");

router.use(exigirAutenticacao);

const insumosDb = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "insumos.json"), "utf-8")
);

const X0 = 50;
const W = 495;
const COR = {
  verde: "#1F3D2B", bege: "#F7F5EF", marrom: "#6B4A34", cinza: "#4A4A42", azul: "#2F6E8F",
  vermelho: "#A33A22", ambar: "#B8861B", linha: "#DDD8C9", faixa: "#EFEBDF", texto: "#1A1A18",
};
const NIVEL_COR = { alto: COR.vermelho, medio: COR.ambar, baixo: COR.verde };
const NIVEL_PT = { alto: "Alto", medio: "Médio", baixo: "Baixo" };
const NOME_CULTURA = { cafe: "Café arábica", soja: "Soja", milho: "Milho", cana: "Cana-de-açúcar", feijao: "Feijão" };
const NOME_CATEGORIA = { fungicida: "Fungicida", irrigacao: "Irrigação", hidrogel: "Hidrogel", protecao_termica: "Proteção térmica", fertilizante: "Fertilizante" };

// ── Utilitários de formatação e datas ─────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const diffDias = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
const br = (s) => s.split("-").reverse().join("/");
const hoje = () => iso(new Date());
const ontem = () => addDias(hoje(), -1);
const agora = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const num = (v, c = 1) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const brl = (v) => "R$ " + num(v, 2);
const comLimite = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), ms))]);
const soma = (a) => a.reduce((s, v) => s + v, 0);
const media = (a) => (a.length ? soma(a) / a.length : null);

function variacao(a, b) {
  if (a == null || b == null || b === 0) return "-";
  const p = Math.round(((a - b) / Math.abs(b)) * 100);
  return (p > 0 ? "+" : "") + p + "%";
}

// Período pedido pelo usuário (?de=&ate=). Se ausente, usa os últimos `diasPadrao` dias até `fimMax`.
function obterPeriodo(query, diasPadrao, fimMax) {
  let ate = ISO.test(query.ate || "") ? query.ate : null;
  let de = ISO.test(query.de || "") ? query.de : null;
  if (!ate) ate = fimMax;
  if (ate > fimMax) ate = fimMax;
  if (!de) de = addDias(ate, -(diasPadrao - 1));
  if (de > ate) { const t = de; de = ate; ate = t; }
  if (diffDias(de, ate) > 365) de = addDias(ate, -365);
  return { de, ate, dias: diffDias(de, ate) + 1 };
}

// ── Componentes de layout (PDFKit) ────────────────────────────────────────────
// O cursor vertical fica em doc._y. A margem inferior do documento é 0 e a
// paginação é controlada manualmente por garantir()/novaPagina().

function novaPagina(doc) {
  doc.addPage();
  doc.rect(0, 0, doc.page.width, 30).fill(COR.verde);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(9).text("AgroAlerta", X0, 11, { lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor("#B8D4BE")
    .text(doc._tituloRel || "", X0 + 70, 12, { width: W - 70, align: "right", lineBreak: false });
  doc._y = 48;
}

function garantir(doc, h) {
  if (doc._y + h > doc.page.height - 50) novaPagina(doc);
}

function capa(doc, titulo, subtitulo, usuario) {
  doc.rect(0, 0, doc.page.width, 94).fill(COR.verde);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(10).text("AgroAlerta", X0, 18, { lineBreak: false });
  doc.fontSize(18).text(titulo, X0, 34, { width: W, lineBreak: false });
  doc.font("Helvetica").fontSize(8.5).fillColor("#B8D4BE").text(subtitulo, X0, 62, { width: W, lineBreak: false });
  doc.fontSize(7.5).fillColor("#8AB89A")
    .text("Emitido em " + agora() + (usuario ? " · " + usuario : ""), X0, 77, { width: W, lineBreak: false });
  doc._y = 112;
}

function rodapes(doc) {
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(r.start + i);
    const y = doc.page.height - 34;
    doc.moveTo(X0, y).lineTo(X0 + W, y).strokeColor(COR.linha).lineWidth(0.5).stroke();
    doc.fillColor(COR.cinza).font("Helvetica").fontSize(7)
      .text("AgroAlerta · Protótipo acadêmico · Dados conforme as fontes consultadas no momento da emissão", X0, y + 8, { width: W - 70, lineBreak: false });
    doc.text("Página " + (i + 1) + " de " + r.count, X0 + W - 70, y + 8, { width: 70, align: "right", lineBreak: false });
  }
}

function secao(doc, texto) {
  garantir(doc, 90);
  doc.rect(X0, doc._y, W, 22).fill(COR.faixa);
  doc.rect(X0, doc._y, 3, 22).fill(COR.verde);
  doc.fillColor(COR.verde).font("Helvetica-Bold").fontSize(10).text(texto, X0 + 10, doc._y + 6, { width: W - 20, lineBreak: false, ellipsis: true });
  doc._y += 30;
}

function paragrafo(doc, texto, o = {}) {
  const pad = o.fundo ? 8 : 0;
  doc.font(o.negrito ? "Helvetica-Bold" : "Helvetica").fontSize(o.tamanho || 9);
  const h = doc.heightOfString(texto, { width: W - 2 * pad, lineGap: 2 });
  garantir(doc, h + 2 * pad + 8);
  if (o.fundo) doc.rect(X0, doc._y, W, h + 2 * pad).fill(o.fundo);
  doc.fillColor(o.cor || COR.cinza).text(texto, X0 + pad, doc._y + pad, { width: W - 2 * pad, lineGap: 2 });
  doc._y += h + 2 * pad + 8;
}

function proposito(doc, texto) {
  paragrafo(doc, "Para que serve: " + texto, { fundo: "#EEF5F8", cor: "#24505F" });
}

function kpis(doc, itens) {
  garantir(doc, 66);
  const gap = 8;
  const w = (W - gap * (itens.length - 1)) / itens.length;
  itens.forEach((k, i) => {
    const x = X0 + i * (w + gap);
    doc.roundedRect(x, doc._y, w, 56, 4).lineWidth(0.6).fillAndStroke("#FFFFFF", COR.linha);
    doc.fillColor(COR.marrom).font("Helvetica").fontSize(7).text(String(k.rotulo).toUpperCase(), x + 8, doc._y + 7, { width: w - 16, lineBreak: false, ellipsis: true });
    doc.fillColor(k.cor || COR.verde).font("Helvetica-Bold").fontSize(15).text(String(k.valor), x + 8, doc._y + 19, { width: w - 16, lineBreak: false, ellipsis: true });
    if (k.nota) doc.fillColor(COR.cinza).font("Helvetica").fontSize(7).text(k.nota, x + 8, doc._y + 40, { width: w - 16, lineBreak: false, ellipsis: true });
  });
  doc._y += 66;
}

function tabela(doc, cab, larg, linhas, o = {}) {
  const total = soma(larg);
  const pad = 5;
  const desenharCab = () => {
    doc.rect(X0, doc._y, total, 22).fill(COR.verde);
    let cx = X0;
    cab.forEach((h, i) => {
      doc.fillColor("white").font("Helvetica-Bold").fontSize(8).text(h, cx + pad, doc._y + 7, { width: larg[i] - 2 * pad, lineBreak: false, ellipsis: true });
      cx += larg[i];
    });
    doc._y += 22;
  };
  garantir(doc, 50);
  desenharCab();
  linhas.forEach((lin, ri) => {
    doc.font("Helvetica").fontSize(8);
    const h = Math.max(...lin.map((c, i) => doc.heightOfString(String(c == null ? "-" : c), { width: larg[i] - 2 * pad }))) + 10;
    if (doc._y + h > doc.page.height - 50) { novaPagina(doc); desenharCab(); }
    doc.rect(X0, doc._y, total, h).fill(ri % 2 === 0 ? COR.bege : "#FFFFFF");
    let cx = X0;
    lin.forEach((c, i) => {
      const cor = o.cor ? o.cor(ri, i, c) : null;
      doc.fillColor(cor || COR.texto).font(cor ? "Helvetica-Bold" : "Helvetica").fontSize(8)
        .text(String(c == null ? "-" : c), cx + pad, doc._y + 5, { width: larg[i] - 2 * pad });
      cx += larg[i];
    });
    doc.moveTo(X0, doc._y + h).lineTo(X0 + total, doc._y + h).strokeColor(COR.linha).lineWidth(0.3).stroke();
    doc._y += h;
  });
  doc._y += 12;
}

// Gráfico de barras ou linha. o: { titulo, valores, datas, tipo, cor, limite, casas, altura }
function grafico(doc, o) {
  const h = o.altura || 62;
  garantir(doc, h + 36);
  doc.fillColor(COR.cinza).font("Helvetica-Bold").fontSize(8).text(o.titulo, X0, doc._y, { width: W, lineBreak: false });
  const y0 = doc._y + 13;
  const gx = X0 + 36;
  const gw = W - 36;
  const vals = o.valores.map((v) => (v == null ? 0 : v));
  if (vals.length === 0) { doc._y += 20; return; }
  let min = Math.min(...vals, o.limite ? o.limite.valor : Infinity);
  let max = Math.max(...vals, o.limite ? o.limite.valor : -Infinity);
  if (o.tipo === "barras") min = Math.min(0, min);
  if (max === min) max = min + 1;
  const folga = (max - min) * 0.08;
  max += folga;
  if (o.tipo !== "barras") min -= folga;
  const sy = (v) => y0 + h - ((v - min) / (max - min)) * h;
  const casas = o.casas == null ? 0 : o.casas;

  doc.rect(gx, y0, gw, h).lineWidth(0.4).strokeColor(COR.linha).stroke();
  doc.fillColor(COR.cinza).font("Helvetica").fontSize(6.5);
  doc.text(num(max, casas), X0, y0 - 2, { width: 32, align: "right", lineBreak: false });
  doc.text(num(min, casas), X0, y0 + h - 6, { width: 32, align: "right", lineBreak: false });

  const n = vals.length;
  if (o.tipo === "barras") {
    const bw = gw / n;
    const base = sy(Math.max(min, 0));
    vals.forEach((v, i) => {
      const yy = sy(v);
      doc.rect(gx + i * bw + Math.min(0.5, bw * 0.1), Math.min(yy, base), Math.max(bw - 1, 0.6), Math.abs(base - yy)).fill(o.cor);
    });
  } else {
    doc.lineWidth(1.2).strokeColor(o.cor);
    vals.forEach((v, i) => {
      const x = gx + (n === 1 ? gw / 2 : (i * gw) / (n - 1));
      if (i === 0) doc.moveTo(x, sy(v)); else doc.lineTo(x, sy(v));
    });
    doc.stroke();
    if (n <= 24) {
      vals.forEach((v, i) => {
        const x = gx + (n === 1 ? gw / 2 : (i * gw) / (n - 1));
        doc.circle(x, sy(v), 1.8).fill(o.cor);
      });
    }
  }
  if (o.limite) {
    const yl = sy(o.limite.valor);
    const cor = o.limite.cor || COR.vermelho;
    doc.lineWidth(0.7).strokeColor(cor).dash(3, { space: 2 }).moveTo(gx, yl).lineTo(gx + gw, yl).stroke().undash();
    doc.fillColor(cor).font("Helvetica").fontSize(6.5).text(o.limite.rotulo, gx + gw - 150, yl - 8, { width: 148, align: "right", lineBreak: false });
  }
  if (o.datas && o.datas.length) {
    doc.fillColor(COR.cinza).font("Helvetica").fontSize(6.5);
    doc.text(br(o.datas[0]), gx, y0 + h + 3, { width: 80, lineBreak: false });
    doc.text(br(o.datas[o.datas.length - 1]), gx + gw - 80, y0 + h + 3, { width: 80, align: "right", lineBreak: false });
  }
  doc._y = y0 + h + 18;
}

function barrasH(doc, itens, cor) {
  const rowH = 15;
  garantir(doc, itens.length * rowH + 10);
  const lw = 190;
  const bx = X0 + lw;
  const bw = W - lw - 56;
  const max = Math.max(...itens.map((i) => i.valor), 0.0001);
  itens.forEach((it) => {
    const w = Math.max((bw * it.valor) / max, 1);
    doc.fillColor(COR.texto).font("Helvetica").fontSize(8).text(it.rotulo, X0, doc._y + 3, { width: lw - 8, lineBreak: false, ellipsis: true });
    doc.rect(bx, doc._y + 3, w, 8).fill(cor || COR.azul);
    doc.fillColor(COR.cinza).text(it.texto, bx + w + 5, doc._y + 3, { width: 52, lineBreak: false });
    doc._y += rowH;
  });
  doc._y += 8;
}

// ── Dados compartilhados ──────────────────────────────────────────────────────

async function buscarTalhoesUsuario(usuarioId) {
  const r = await pool.query(
    `SELECT id, nome, cultura, fase, latitude, longitude,
            endereco_formatado AS "enderecoFormatado", endereco
     FROM talhoes WHERE usuario_id = $1 ORDER BY id`,
    [usuarioId]
  );
  return r.rows;
}

async function avaliarTalhao(t) {
  let clima = null;
  try { clima = await buscarClimaOpenMeteo(t.latitude, t.longitude); }
  catch { try { clima = await buscarClimaAtual(t.latitude, t.longitude); } catch { /* sem clima */ } }
  const alertas = clima ? avaliarAlertas(t.cultura, t.fase, clima) : [];
  return { clima, alertas };
}

function ofertasOrdenadas(insumo) {
  return [...insumo.ofertas].sort((a, b) => a.preco - b.preco);
}

// Insumos sugeridos para um alerta, já com a melhor oferta de cada um.
function insumosParaAlerta(alertaId) {
  const cats = MAPA_ALERTA_CATEGORIA[alertaId] || [];
  return insumosDb.insumos
    .filter((i) => cats.includes(i.categoria))
    .map((i) => {
      const of = ofertasOrdenadas(i);
      const med = media(of.map((o) => o.preco));
      return { insumo: i, melhor: of[0], media: med, economia: ((med - of[0].preco) / med) * 100 };
    });
}

function metricasClima(dias) {
  const chuvas = dias.map((d) => (d.chuva == null ? 0 : d.chuva));
  let seq = 0, maxSeq = 0;
  chuvas.forEach((c) => { if (c < 1) { seq++; maxSeq = Math.max(maxSeq, seq); } else seq = 0; });
  const tmins = dias.map((d) => d.tmin).filter((v) => v != null);
  const tmaxs = dias.map((d) => d.tmax).filter((v) => v != null);
  const chuvaTotal = soma(chuvas);
  const et0 = soma(dias.map((d) => (d.et0 == null ? 0 : d.et0)));
  return {
    n: dias.length,
    chuvaTotal,
    diasChuva: chuvas.filter((c) => c >= 1).length,
    maxSeq,
    tminAbs: tmins.length ? Math.min(...tmins) : null,
    diasFrio: tmins.filter((t) => t <= 5).length,
    tmaxMedia: media(tmaxs),
    et0,
    balanco: chuvaTotal - et0,
  };
}

function nomeUsuario(config) {
  return config && config.nome ? config.nome : "";
}

// ── RELATÓRIO 1: Risco climático por talhão ───────────────────────────────────

async function relatorioClima(doc, req, usuarioId) {
  const per = obterPeriodo(req.query, 30, ontem());
  const ant = { de: addDias(per.de, -per.dias), ate: addDias(per.de, -1) };
  const config = await obterConfiguracoes(usuarioId);
  capa(doc, "Relatório de risco climático", "Período: " + br(per.de) + " a " + br(per.ate) + "  ·  comparado a " + br(ant.de) + " a " + br(ant.ate), nomeUsuario(config));

  proposito(doc,
    "mostrar, para cada talhão, como o clima do período se comportou em relação ao período imediatamente anterior " +
    "(chuva, seca, frio e balanço hídrico) e quais alertas estão ativos para os próximos 7 dias. Ajuda a decidir " +
    "irrigação, proteção contra geada e manejo fitossanitário, e a priorizar o talhão que exige atenção primeiro.");

  const talhoes = await buscarTalhoesUsuario(usuarioId);
  if (talhoes.length === 0) { paragrafo(doc, "Nenhum talhão cadastrado.", {}); return; }

  const dados = await Promise.all(talhoes.map(async (t) => {
    const [a, p, av, of] = await Promise.allSettled([
      buscarSerieDiaria(t.latitude, t.longitude, per.de, per.ate),
      buscarSerieDiaria(t.latitude, t.longitude, ant.de, ant.ate),
      avaliarTalhao(t),
      buscarAlertasINMET(extrairUF(t.enderecoFormatado || t.endereco || "")),
    ]);
    const atual = a.status === "fulfilled" ? a.value : null;
    const anterior = p.status === "fulfilled" ? p.value : null;
    const aval = av.status === "fulfilled" ? av.value : { clima: null, alertas: [] };
    return {
      t, atual, anterior,
      mAtual: atual && atual.length ? metricasClima(atual) : null,
      mAnt: anterior && anterior.length ? metricasClima(anterior) : null,
      clima: aval.clima, alertas: aval.alertas,
      oficiais: of.status === "fulfilled" ? of.value : [],
    };
  }));

  const pontos = (d) => d.alertas.reduce((s, a) => s + (a.nivel === "alto" ? 3 : a.nivel === "medio" ? 1 : 0), 0);
  const totalAlertas = soma(dados.map((d) => d.alertas.length));
  const totalAltos = soma(dados.map((d) => d.alertas.filter((a) => a.nivel === "alto").length));
  const totalOficiais = soma(dados.map((d) => d.oficiais.length));

  secao(doc, "Resumo executivo");
  kpis(doc, [
    { rotulo: "Talhões monitorados", valor: dados.length },
    { rotulo: "Alertas ativos (7 dias)", valor: totalAlertas, cor: totalAlertas ? COR.ambar : COR.verde },
    { rotulo: "Risco alto", valor: totalAltos, cor: totalAltos ? COR.vermelho : COR.verde },
    { rotulo: "Avisos INMET", valor: totalOficiais, cor: totalOficiais ? COR.ambar : COR.verde, nota: "oficiais na UF" },
  ]);

  const ranking = [...dados].sort((a, b) => pontos(b) - pontos(a));
  const situ = (d) => (d.alertas.some((a) => a.nivel === "alto") ? "Atenção" : d.alertas.length ? "Monitorar" : "Normal");
  tabela(doc,
    ["Talhão · cultura", "Alto / Médio", "Chuva", "vs. anterior", "Seca máx. (d)", "Situação"],
    [150, 70, 70, 70, 70, 65],
    ranking.map((d) => [
      d.t.nome + " · " + (NOME_CULTURA[d.t.cultura] || d.t.cultura),
      d.alertas.filter((a) => a.nivel === "alto").length + " / " + d.alertas.filter((a) => a.nivel === "medio").length,
      d.mAtual ? num(d.mAtual.chuvaTotal, 0) + " mm" : "-",
      d.mAtual && d.mAnt ? variacao(d.mAtual.chuvaTotal, d.mAnt.chuvaTotal) : "-",
      d.mAtual ? d.mAtual.maxSeq : "-",
      situ(d),
    ]),
    { cor: (ri, ci, c) => (ci === 5 ? (c === "Atenção" ? COR.vermelho : c === "Monitorar" ? COR.ambar : COR.verde) : null) });

  for (const d of dados) {
    secao(doc, d.t.nome + "  ·  " + (NOME_CULTURA[d.t.cultura] || d.t.cultura) + "  ·  fase: " + String(d.t.fase).replace(/_/g, " "));
    paragrafo(doc, "Localização: " + (d.t.enderecoFormatado || d.t.endereco || "-"), { tamanho: 8 });

    if (!d.mAtual) {
      paragrafo(doc, "Série histórica indisponível para este talhão no período (fonte Open-Meteo).", { fundo: "#F8F1DE", cor: COR.marrom });
    } else {
      const a = d.mAtual, p = d.mAnt;
      const linhas = [
        ["Chuva acumulada (mm)", num(a.chuvaTotal, 1), p ? num(p.chuvaTotal, 1) : "-", p ? variacao(a.chuvaTotal, p.chuvaTotal) : "-"],
        ["Dias com chuva (>= 1 mm)", a.diasChuva, p ? p.diasChuva : "-", p ? variacao(a.diasChuva, p.diasChuva) : "-"],
        ["Maior sequência sem chuva (dias)", a.maxSeq, p ? p.maxSeq : "-", p ? variacao(a.maxSeq, p.maxSeq) : "-"],
        ["Temperatura mínima absoluta (°C)", a.tminAbs == null ? "-" : num(a.tminAbs, 1), p && p.tminAbs != null ? num(p.tminAbs, 1) : "-", "-"],
        ["Dias com mínima <= 5 °C (risco de geada)", a.diasFrio, p ? p.diasFrio : "-", p ? variacao(a.diasFrio, p.diasFrio) : "-"],
        ["Temperatura máxima média (°C)", a.tmaxMedia == null ? "-" : num(a.tmaxMedia, 1), p && p.tmaxMedia != null ? num(p.tmaxMedia, 1) : "-", "-"],
        ["Evapotranspiração ET0 (mm)", num(a.et0, 1), p ? num(p.et0, 1) : "-", p ? variacao(a.et0, p.et0) : "-"],
        ["Balanço hídrico: chuva - ET0 (mm)", num(a.balanco, 1), p ? num(p.balanco, 1) : "-", "-"],
      ];
      tabela(doc, ["Indicador", "Período atual", "Período anterior", "Variação"], [235, 90, 90, 80], linhas);

      grafico(doc, { titulo: "Chuva diária (mm)", tipo: "barras", valores: d.atual.map((x) => x.chuva), datas: d.atual.map((x) => x.data), cor: COR.azul, casas: 0 });
      grafico(doc, { titulo: "Temperatura mínima diária (°C) · linha tracejada: limiar de geada (5 °C)", tipo: "linha", valores: d.atual.map((x) => x.tmin), datas: d.atual.map((x) => x.data), cor: COR.marrom, casas: 0, limite: { valor: 5, rotulo: "limiar geada 5 °C" } });

      const leituras = [];
      if (p && p.chuvaTotal > 0) {
        const pc = ((a.chuvaTotal - p.chuvaTotal) / p.chuvaTotal) * 100;
        leituras.push("- Choveu " + num(a.chuvaTotal, 0) + " mm, " + num(Math.abs(pc), 0) + "% " + (pc < 0 ? "abaixo" : "acima") + " do período anterior (" + num(p.chuvaTotal, 0) + " mm).");
      } else {
        leituras.push("- Choveu " + num(a.chuvaTotal, 0) + " mm no período.");
      }
      leituras.push(a.balanco < 0
        ? "- Déficit hídrico de " + num(Math.abs(a.balanco), 0) + " mm: a evapotranspiração superou a chuva. Avalie irrigação conforme a fase da cultura."
        : "- Saldo hídrico positivo de " + num(a.balanco, 0) + " mm: a chuva cobriu a demanda de água das plantas.");
      leituras.push("- Maior período seco: " + a.maxSeq + " dia(s) consecutivos com menos de 1 mm.");
      if (a.diasFrio > 0) leituras.push("- " + a.diasFrio + " dia(s) com mínima igual ou inferior a 5 °C (menor valor: " + num(a.tminAbs, 1) + " °C).");
      paragrafo(doc, leituras.join("\n"), { fundo: "#F7F5EF", cor: COR.texto });
    }

    paragrafo(doc, "Previsão e regras para os próximos 7 dias", { negrito: true, cor: COR.verde });
    if (!d.clima) {
      paragrafo(doc, "Previsão indisponível no momento.", {});
    } else {
      paragrafo(doc,
        "Mínima prevista: " + num(d.clima.temperaturaMinima, 1) + " °C  ·  Chuva prevista: " + num(d.clima.chuvaAcumulada7dias, 0) +
        " mm  ·  Dias sem chuva recentes: " + d.clima.diasSemChuva + "  ·  Vento máx.: " + d.clima.ventoMaximoKmh + " km/h", { tamanho: 8 });
      if (d.alertas.length === 0) {
        paragrafo(doc, "Nenhuma regra disparada para este talhão.", { fundo: "#EAEFE9", cor: COR.verde });
      } else {
        tabela(doc, ["Nível", "Risco", "Regra disparada", "Janela"], [50, 110, 255, 80],
          d.alertas.map((al) => [NIVEL_PT[al.nivel] || al.nivel, al.titulo, al.mensagem, al.janela || "-"]),
          { cor: (ri, ci) => (ci === 0 ? NIVEL_COR[d.alertas[ri].nivel] : null) });
      }
    }
    if (d.oficiais.length) {
      tabela(doc, ["INMET", "Aviso oficial", "Validade"], [60, 295, 140],
        d.oficiais.slice(0, 6).map((o) => [{ alto: "Vermelho", medio: "Laranja", baixo: "Amarelo" }[o.nivel] || o.nivel, o.descricao, o.janela]),
        { cor: (ri, ci) => (ci === 0 ? NIVEL_COR[d.oficiais[ri].nivel] : null) });
    }
  }
}

// ── RELATÓRIO 2: Compras e economia de insumos ────────────────────────────────

async function relatorioInsumos(doc, req, usuarioId) {
  const config = await obterConfiguracoes(usuarioId);
  capa(doc, "Relatório de compras e economia de insumos", "Preços de referência vigentes em " + br(hoje()), nomeUsuario(config));

  proposito(doc,
    "comparar fornecedores de cada insumo, mostrar quanto é possível economizar comprando do menor preço e indicar quais " +
    "insumos fazem sentido agora, de acordo com os alertas ativos nos seus talhões. Apoia a decisão de onde e o que comprar.");

  const analise = insumosDb.insumos.map((i) => {
    const of = ofertasOrdenadas(i);
    const precos = of.map((o) => o.preco);
    const med = media(precos);
    return { i, of, min: of[0], max: of[of.length - 1], med, economia: ((med - precos[0]) / med) * 100, spread: ((precos[precos.length - 1] - precos[0]) / precos[0]) * 100 };
  });

  const maior = [...analise].sort((a, b) => b.spread - a.spread)[0];
  const fornecedores = new Set(insumosDb.insumos.flatMap((i) => i.ofertas.map((o) => o.fornecedor)));
  secao(doc, "Resumo");
  kpis(doc, [
    { rotulo: "Insumos comparados", valor: analise.length },
    { rotulo: "Fornecedores", valor: fornecedores.size },
    { rotulo: "Economia média", valor: num(media(analise.map((a) => a.economia)), 1) + "%", nota: "menor preço vs. média" },
    { rotulo: "Maior diferença", valor: num(maior.spread, 0) + "%", nota: maior.i.nome.slice(0, 26), cor: COR.ambar },
  ]);

  secao(doc, "Comparação de preços por insumo");
  tabela(doc, ["Insumo", "Menor preço", "Fornecedor", "Média", "Maior", "Diferença"], [130, 62, 135, 55, 55, 58],
    analise.map((a) => [
      a.i.nome + " (" + a.i.unidade + ")",
      brl(a.min.preco),
      a.min.fornecedor + " · " + a.min.cidade,
      brl(a.med),
      brl(a.max.preco),
      "+" + num(a.spread, 0) + "%",
    ]));

  paragrafo(doc, "Economia ao comprar do menor preço em relação ao preço médio do mercado", { negrito: true, cor: COR.verde, tamanho: 8 });
  barrasH(doc, [...analise].sort((a, b) => b.economia - a.economia).map((a) => ({ rotulo: a.i.nome, valor: a.economia, texto: num(a.economia, 1) + "%" })), COR.verde);

  // Competitividade dos fornecedores: índice 100 = preço médio do insumo
  const forn = {};
  analise.forEach((a) => {
    a.of.forEach((o, idx) => {
      const f = (forn[o.fornecedor] = forn[o.fornecedor] || { cidade: o.cidade, n: 0, menor: 0, indices: [] });
      f.n++;
      if (idx === 0) f.menor++;
      f.indices.push((o.preco / a.med) * 100);
    });
  });
  secao(doc, "Ranking de fornecedores");
  tabela(doc, ["Fornecedor", "Cidade", "Ofertas", "Menor preço em", "Índice (100 = média)"], [150, 115, 50, 80, 100],
    Object.entries(forn)
      .map(([nome, f]) => ({ nome, f, idx: media(f.indices) }))
      .sort((a, b) => a.idx - b.idx)
      .map((x) => [x.nome, x.f.cidade, x.f.n, x.f.menor + " insumo(s)", num(x.idx, 1)]),
    { cor: (ri, ci, c) => (ci === 4 ? (parseFloat(String(c).replace(",", ".")) <= 100 ? COR.verde : COR.vermelho) : null) });
  paragrafo(doc, "Índice abaixo de 100 indica fornecedor, em média, mais barato que o mercado; acima de 100, mais caro.", { tamanho: 7.5 });

  secao(doc, "Compras indicadas pelos alertas ativos");
  const talhoes = await buscarTalhoesUsuario(usuarioId);
  const linhas = [];
  for (const t of talhoes) {
    const { alertas } = await avaliarTalhao(t);
    alertas.forEach((al) => {
      insumosParaAlerta(al.id).forEach((s) => {
        linhas.push([
          t.nome + " · " + (NOME_CULTURA[t.cultura] || t.cultura),
          NIVEL_PT[al.nivel] + " · " + al.titulo,
          s.insumo.nome,
          s.melhor.fornecedor + " · " + brl(s.melhor.preco) + "/" + s.insumo.unidade,
          num(s.economia, 1) + "%",
        ]);
      });
    });
  }
  if (linhas.length === 0) {
    paragrafo(doc, "Nenhum alerta ativo exige compra de insumos neste momento. Use o comparativo acima para planejar compras futuras.", { fundo: "#EAEFE9", cor: COR.verde });
  } else {
    tabela(doc, ["Talhão", "Alerta", "Insumo sugerido", "Melhor oferta", "Economia"], [105, 105, 115, 120, 50], linhas);
  }
}

// ── RELATÓRIO 3: Mercado e momento de venda ───────────────────────────────────

async function serieMercado(cultura) {
  try {
    const h = await buscarHistoricoMensalStooq(cultura);
    if (h && Array.isArray(h.historico) && h.historico.length) return h;
  } catch { /* usa base local */ }
  const l = obterHistorico(cultura);
  return l ? { historico: l.historico, unidade: l.unidade, fonte: l.fonte || "Base local (Cepea)" } : null;
}

function estatisticas(serie) {
  if (serie.length < 2) return null;
  const precos = serie.map((s) => s.preco);
  const min = serie.reduce((m, s) => (s.preco < m.preco ? s : m), serie[0]);
  const max = serie.reduce((m, s) => (s.preco > m.preco ? s : m), serie[0]);
  const retornos = [];
  for (let i = 1; i < precos.length; i++) retornos.push(((precos[i] - precos[i - 1]) / precos[i - 1]) * 100);
  const mr = media(retornos);
  const desvio = Math.sqrt(media(retornos.map((r) => (r - mr) ** 2)));
  const ini = precos[0], fim = precos[precos.length - 1];
  return {
    ini, fim, variacao: ((fim - ini) / ini) * 100, media: media(precos), min, max, desvio,
    posicao: max.preco === min.preco ? 0.5 : (fim - min.preco) / (max.preco - min.preco),
  };
}

async function relatorioMercado(doc, req, usuarioId) {
  const config = await obterConfiguracoes(usuarioId);
  const pedida = String(req.query.cultura || "");
  const cultura = obterHistorico(pedida) ? pedida : (config && obterHistorico(config.culturaFavorita) ? config.culturaFavorita : "cafe");
  const nomeC = NOME_CULTURA[cultura] || cultura;

  const per = obterPeriodo(req.query, 365, hoje());
  const ant = { de: addDias(per.de, -per.dias), ate: addDias(per.de, -1) };

  const fonte = await serieMercado(cultura);
  if (!fonte) {
    capa(doc, "Relatório de mercado – " + nomeC, "Período: " + br(per.de) + " a " + br(per.ate), nomeUsuario(config));
    paragrafo(doc, "Não há série de preços disponível para esta cultura.", {});
    return;
  }
  const todos = fonte.historico.filter((s) => s.data && !isNaN(s.preco)).sort((a, b) => (a.data < b.data ? -1 : 1));
  let serie = todos.filter((s) => s.data >= per.de && s.data <= per.ate);
  let avisoPeriodo = "";
  if (serie.length < 2) {
    serie = todos;
    avisoPeriodo = "A fonte não tem pontos suficientes no período escolhido; exibindo toda a série disponível (" + br(todos[0].data) + " a " + br(todos[todos.length - 1].data) + ").";
  }
  const serieAnt = avisoPeriodo ? [] : todos.filter((s) => s.data >= ant.de && s.data <= ant.ate);
  const e = estatisticas(serie);
  const eAntReal = estatisticas(serieAnt);

  // Sem dados no período anterior, compara a 2ª metade do período com a 1ª.
  const meio = Math.floor(serie.length / 2);
  const metades = !eAntReal && serie.length >= 8
    ? { cur: estatisticas(serie.slice(meio)), prev: estatisticas(serie.slice(0, meio)) }
    : null;
  const cur = eAntReal ? e : metades && metades.cur;
  const eAnt = eAntReal || (metades && metades.prev);
  const rotCur = eAntReal ? "Período atual" : "2ª metade";
  const rotAnt = eAntReal ? "Período anterior" : "1ª metade";

  capa(doc, "Relatório de mercado – " + nomeC, "Período: " + br(serie[0].data) + " a " + br(serie[serie.length - 1].data) + (eAntReal ? "  ·  comparado a " + br(ant.de) + " a " + br(ant.ate) : ""), nomeUsuario(config));
  proposito(doc,
    "mostrar como o preço de " + nomeC.toLowerCase() + " evoluiu no período, comparar com o período anterior, indicar onde o preço atual " +
    "está dentro da faixa observada e reunir câmbio e referências internacionais. Apoia a decisão de quando vender, " +
    "fixar preço ou estocar.");
  if (avisoPeriodo) paragrafo(doc, avisoPeriodo, { fundo: "#F8F1DE", cor: COR.marrom, tamanho: 8 });

  const un = fonte.unidade || "";
  secao(doc, "Resumo do período");
  kpis(doc, [
    { rotulo: "Preço atual", valor: num(e.fim, 2), nota: un },
    { rotulo: "Variação no período", valor: (e.variacao >= 0 ? "+" : "") + num(e.variacao, 1) + "%", cor: e.variacao >= 0 ? COR.verde : COR.vermelho },
    { rotulo: "Faixa do período", valor: num(e.posicao * 100, 0) + "%", nota: "0% = mínimo · 100% = máximo" },
    { rotulo: "Volatilidade", valor: num(e.desvio, 1) + "%", nota: "desvio-padrão dos retornos", cor: COR.ambar },
  ]);

  if (cur && eAnt) {
    secao(doc, eAntReal ? "Comparação com o período anterior" : "Comparação entre as metades do período");
    const p2 = (v) => num(v, 2);
    const pct = (v) => (v >= 0 ? "+" : "") + num(v, 1) + "%";
    tabela(doc, ["Indicador", rotCur, rotAnt, "Variação"], [195, 110, 110, 80], [
      ["Preço inicial", p2(cur.ini), p2(eAnt.ini), variacao(cur.ini, eAnt.ini)],
      ["Preço final", p2(cur.fim), p2(eAnt.fim), variacao(cur.fim, eAnt.fim)],
      ["Preço médio", p2(cur.media), p2(eAnt.media), variacao(cur.media, eAnt.media)],
      ["Preço mínimo", p2(cur.min.preco) + " (" + br(cur.min.data) + ")", p2(eAnt.min.preco) + " (" + br(eAnt.min.data) + ")", variacao(cur.min.preco, eAnt.min.preco)],
      ["Preço máximo", p2(cur.max.preco) + " (" + br(cur.max.data) + ")", p2(eAnt.max.preco) + " (" + br(eAnt.max.data) + ")", variacao(cur.max.preco, eAnt.max.preco)],
      ["Variação dentro do intervalo", pct(cur.variacao), pct(eAnt.variacao), "-"],
      ["Volatilidade (desvio-padrão)", num(cur.desvio, 2) + "%", num(eAnt.desvio, 2) + "%", "-"],
    ]);
  } else {
    paragrafo(doc, "Pontos insuficientes na fonte para comparar períodos.", { tamanho: 8 });
  }

  grafico(doc, { titulo: "Evolução do preço (" + un + ")", tipo: "linha", valores: serie.map((s) => s.preco), datas: serie.map((s) => s.data), cor: COR.azul, casas: 0, altura: 90, limite: { valor: e.media, rotulo: "média do período", cor: COR.ambar } });

  const porMes = {};
  serie.forEach((s) => { const m = s.data.slice(0, 7); (porMes[m] = porMes[m] || []).push(s.preco); });
  paragrafo(doc, "Fonte da série: " + fonte.fonte, { tamanho: 7.5 });
  const meses = Object.keys(porMes).sort().slice(-12);
  if (meses.length > 1) {
    secao(doc, "Média mensal");
    tabela(doc, ["Mês", "Preço médio", "Variação vs. mês anterior"], [120, 150, 225],
      meses.map((m, i) => [m.split("-").reverse().join("/"), num(media(porMes[m]), 2), i === 0 ? "-" : variacao(media(porMes[m]), media(porMes[meses[i - 1]]))]),
      { cor: (ri, ci, c) => (ci === 2 && c !== "-" ? (String(c).startsWith("+") ? COR.verde : COR.vermelho) : null) });
  }

  // Contexto externo
  const [ptax, icbr, av, st] = await Promise.allSettled([
    comLimite(buscarPtax(), 8000), comLimite(buscarIndiceCommoditiesAgro(), 8000),
    comLimite(buscarCotacaoAV(cultura), 8000), comLimite(buscarCotacaoStooq(cultura), 8000),
  ]);
  const val = (r) => (r.status === "fulfilled" ? r.value : null);
  const intl = val(av) || val(st);
  const ctx = [];
  if (val(ptax)) ctx.push(["Dólar PTAX (venda)", "R$ " + num(val(ptax).cotacaoVenda, 4), "Banco Central do Brasil"]);
  if (intl) ctx.push(["Cotação internacional", num(intl.valorAtual, 2) + " " + (intl.unidade || ""), intl.fonte || "Alpha Vantage / Stooq"]);
  if (val(icbr) && val(icbr).variacao12m != null) ctx.push(["IC-Br Agropecuário (12 meses)", (parseFloat(val(icbr).variacao12m) >= 0 ? "+" : "") + val(icbr).variacao12m + "%", "Banco Central do Brasil"]);
  if (ctx.length) {
    secao(doc, "Contexto externo (câmbio e referências)");
    tabela(doc, ["Indicador", "Valor atual", "Fonte"], [200, 150, 145], ctx);
  }

  // Leitura do momento
  const leit = [];
  if (e.posicao >= 0.75) leit.push("- O preço atual está na faixa superior do período (" + num(e.posicao * 100, 0) + "% entre o mínimo e o máximo): momento historicamente favorável para comercialização ou fixação parcial.");
  else if (e.posicao <= 0.25) leit.push("- O preço atual está na faixa inferior do período (" + num(e.posicao * 100, 0) + "% entre o mínimo e o máximo): considere escalonar as vendas ou aguardar recuperação, se houver capacidade de armazenagem.");
  else leit.push("- O preço atual está na faixa intermediária do período (" + num(e.posicao * 100, 0) + "% entre o mínimo e o máximo).");
  leit.push("- Tendência no período: " + (e.variacao >= 0 ? "alta" : "queda") + " de " + num(Math.abs(e.variacao), 1) + "%.");
  if (cur && eAnt) leit.push("- Na " + rotCur.toLowerCase() + " a volatilidade foi " + (cur.desvio > eAnt.desvio ? "maior" : "menor") + " que na " + rotAnt.toLowerCase() + " (" + num(cur.desvio, 2) + "% contra " + num(eAnt.desvio, 2) + "%)" + (cur.desvio > eAnt.desvio ? ", indicando preço mais instável: vendas escalonadas reduzem o risco." : "."));
  if (val(ptax)) leit.push("- Com o dólar a R$ " + num(val(ptax).cotacaoVenda, 2) + ", lembre que o câmbio influencia o preço das commodities cotadas em dólar.");
  secao(doc, "Leitura do momento");
  paragrafo(doc, leit.join("\n"), { fundo: "#F7F5EF", cor: COR.texto });

  let analise = null;
  try { analise = await comLimite(gerarAnaliseTendencia(cultura), 15000); } catch { /* sem análise */ }
  if (analise && analise.resumo) {
    secao(doc, analise.gerarPor === "ia" ? "Análise de tendência (gerada por IA · Claude)" : "Análise de tendência");
    paragrafo(doc, analise.resumo, { fundo: "#EEF5F8", cor: "#24505F" });
  }
  paragrafo(doc, "Aviso: este relatório é informativo e não constitui recomendação de investimento. Os preços dependem da fonte e da unidade indicadas.", { tamanho: 7.5 });
}

// ── RELATÓRIO 4: Laudo técnico para validação do agrônomo ─────────────────────

function cartaoValidacao(doc, al, sugestoes) {
  const larg = W - 24;
  const blocos = [
    { t: "Evidência: " + al.mensagem },
    { t: "Recomendação do sistema: " + al.recomendacao },
    { t: "Insumo sugerido: " + (sugestoes.length ? sugestoes.map((s) => s.insumo.nome + " — " + s.melhor.fornecedor + ", " + brl(s.melhor.preco) + "/" + s.insumo.unidade).join("; ") : "nenhum insumo associado a esta regra") },
  ];
  doc.font("Helvetica").fontSize(8.5);
  const alturas = blocos.map((b) => doc.heightOfString(b.t, { width: larg, lineGap: 1.5 }));
  const h = 30 + soma(alturas) + blocos.length * 4 + 22 + 40;
  garantir(doc, h + 10);
  const y0 = doc._y;
  doc.rect(X0, y0, W, h).lineWidth(0.6).fillAndStroke("#FFFFFF", COR.linha);
  doc.rect(X0, y0, 4, h).fill(NIVEL_COR[al.nivel] || COR.verde);
  doc.fillColor(NIVEL_COR[al.nivel] || COR.verde).font("Helvetica-Bold").fontSize(10)
    .text((NIVEL_PT[al.nivel] || al.nivel).toUpperCase() + " · " + al.titulo, X0 + 12, y0 + 9, { width: W - 150, lineBreak: false, ellipsis: true });
  doc.fillColor(COR.cinza).font("Helvetica").fontSize(8).text("Janela: " + (al.janela || "-"), X0 + W - 130, y0 + 11, { width: 120, align: "right", lineBreak: false });
  let y = y0 + 28;
  blocos.forEach((b, i) => {
    doc.fillColor(COR.texto).font("Helvetica").fontSize(8.5).text(b.t, X0 + 12, y, { width: larg, lineGap: 1.5 });
    y += alturas[i] + 4;
  });
  doc.fillColor(COR.marrom).font("Helvetica-Bold").fontSize(8).text("Decisão do agrônomo:", X0 + 12, y + 4, { lineBreak: false });
  ["Concordo", "Concordo com ajustes", "Discordo"].forEach((rot, i) => {
    const bx = X0 + 120 + i * 120;
    doc.rect(bx, y + 3, 9, 9).lineWidth(0.7).strokeColor(COR.cinza).stroke();
    doc.fillColor(COR.texto).font("Helvetica").fontSize(8).text(rot, bx + 14, y + 4, { lineBreak: false });
  });
  doc.fillColor(COR.marrom).font("Helvetica-Bold").fontSize(8).text("Observações:", X0 + 12, y + 24, { lineBreak: false });
  doc.moveTo(X0 + 80, y + 33).lineTo(X0 + W - 12, y + 33).strokeColor(COR.linha).lineWidth(0.5).stroke();
  doc._y = y0 + h + 10;
}

async function relatorioValidacoes(doc, req, usuarioId) {
  const per = obterPeriodo(req.query, 30, ontem());
  const config = await obterConfiguracoes(usuarioId);
  const ano = Number(per.ate.slice(0, 4));
  capa(doc, "Laudo técnico para validação do agrônomo", "Safra " + ano + "/" + (ano + 1) + "  ·  condições avaliadas de " + br(per.de) + " a " + br(per.ate), nomeUsuario(config));

  proposito(doc,
    "registrar, por talhão, os alertas emitidos pelo sistema, os dados que os justificam, as medidas recomendadas e a decisão " +
    "técnica do agrônomo responsável. É o histórico de rastreabilidade da safra, útil em assistência técnica, crédito rural e seguro agrícola.");

  const talhoes = await buscarTalhoesUsuario(usuarioId);
  const avaliados = [];
  for (const t of talhoes) {
    const [aval, serie] = await Promise.all([
      avaliarTalhao(t),
      buscarSerieDiaria(t.latitude, t.longitude, per.de, per.ate).catch(() => null),
    ]);
    avaliados.push({ t, alertas: aval.alertas, m: serie && serie.length ? metricasClima(serie) : null });
  }
  const totalAlertas = soma(avaliados.map((a) => a.alertas.length));

  secao(doc, "Identificação");
  tabela(doc, ["Campo", "Informação"], [140, 355], [
    ["Produtor", (config && config.nome) || "-"],
    ["Emissão", agora()],
    ["Safra", ano + "/" + (ano + 1)],
    ["Talhões avaliados", avaliados.length],
    ["Alertas a validar", totalAlertas],
  ]);

  if (avaliados.length === 0) { paragrafo(doc, "Nenhum talhão cadastrado.", {}); }

  for (const a of avaliados) {
    secao(doc, a.t.nome + "  ·  " + (NOME_CULTURA[a.t.cultura] || a.t.cultura) + "  ·  fase: " + String(a.t.fase).replace(/_/g, " "));
    paragrafo(doc, "Localização: " + (a.t.enderecoFormatado || a.t.endereco || "-") + "  ·  Coordenadas: " + num(a.t.latitude, 4) + ", " + num(a.t.longitude, 4), { tamanho: 8 });
    if (a.m) {
      tabela(doc, ["Chuva (mm)", "Maior seca (dias)", "Mínima abs. (°C)", "ET0 (mm)", "Balanço hídrico (mm)"], [95, 100, 100, 90, 110],
        [[num(a.m.chuvaTotal, 0), a.m.maxSeq, a.m.tminAbs == null ? "-" : num(a.m.tminAbs, 1), num(a.m.et0, 0), num(a.m.balanco, 0)]]);
    }
    if (a.alertas.length === 0) {
      paragrafo(doc, "Sem alertas ativos. Monitoramento normal; nenhuma validação pendente.", { fundo: "#EAEFE9", cor: COR.verde });
    } else {
      a.alertas.forEach((al) => cartaoValidacao(doc, al, insumosParaAlerta(al.id)));
    }
  }

  garantir(doc, 130);
  secao(doc, "Declaração e assinatura");
  paragrafo(doc, "Declaro ter analisado os alertas acima e registrado, em cada um, a minha decisão técnica.", {});
  const y = doc._y + 28;
  doc.moveTo(X0, y).lineTo(X0 + 230, y).strokeColor(COR.cinza).lineWidth(0.6).stroke();
  doc.moveTo(X0 + 265, y).lineTo(X0 + W, y).stroke();
  doc.fillColor(COR.cinza).font("Helvetica").fontSize(8)
    .text("Agrônomo responsável (nome e assinatura)", X0, y + 4, { lineBreak: false })
    .text("CREA / ART", X0 + 265, y + 4, { lineBreak: false })
    .text("Data: ____ / ____ / ________", X0, y + 24, { lineBreak: false });
  doc._y = y + 40;
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

const TIPOS = {
  alertas: { arquivo: "Risco-Climatico", titulo: "Relatório de risco climático", gerar: relatorioClima },
  insumos: { arquivo: "Compras-de-Insumos", titulo: "Relatório de compras de insumos", gerar: relatorioInsumos },
  mercado: { arquivo: "Mercado", titulo: "Relatório de mercado", gerar: relatorioMercado },
  validacoes: { arquivo: "Laudo-Tecnico", titulo: "Laudo técnico para validação", gerar: relatorioValidacoes },
};

router.get("/:tipo", async (req, res) => {
  const tipo = TIPOS[req.params.tipo];
  if (!tipo) return res.status(404).json({ erro: "Tipo de relatório desconhecido." });

  const doc = new PDFDocument({ margins: { top: 50, bottom: 0, left: 50, right: 50 }, size: "A4", bufferPages: true });
  doc._tituloRel = tipo.titulo;
  const partes = [];
  doc.on("data", (c) => partes.push(c));
  const terminou = new Promise((resolve) => doc.on("end", resolve));

  try {
    await tipo.gerar(doc, req, req.usuario.id);
    rodapes(doc);
    doc.end();
    await terminou;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="AgroAlerta-' + tipo.arquivo + "-" + hoje() + '.pdf"');
    res.send(Buffer.concat(partes));
  } catch (erro) {
    console.error("[relatorios] Erro ao gerar '" + req.params.tipo + "':", erro);
    try { doc.end(); } catch { /* já finalizado */ }
    res.status(500).json({ erro: "Não foi possível gerar o relatório." });
  }
});

module.exports = router;
