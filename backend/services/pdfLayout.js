/**
 * Componentes de layout do PDFKit usados pelos relatórios do app e pelo relatório de assertividade da IA.
 * O cursor vertical fica em doc._y; a margem inferior do documento é 0 e a paginação é manual
 * (garantir/novaPagina). Cada documento deve ser criado com bufferPages: true para os rodapés.
 */
const num = (v, c = 1) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const soma = (a) => a.reduce((s, v) => s + v, 0);
const br = (s) => s.split("-").reverse().join("/");
const agora = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const X0 = 50;
const W = 495;
const COR = {
  verde: "#1F3D2B", bege: "#F7F5EF", marrom: "#6B4A34", cinza: "#4A4A42", azul: "#2F6E8F",
  vermelho: "#A33A22", ambar: "#B8861B", linha: "#DDD8C9", faixa: "#EFEBDF", texto: "#1A1A18",
};

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

module.exports = {
  X0, W, COR, num, soma, br, agora,
  novaPagina, garantir, capa, rodapes, secao, paragrafo, proposito, kpis, tabela, grafico, barrasH,
};
