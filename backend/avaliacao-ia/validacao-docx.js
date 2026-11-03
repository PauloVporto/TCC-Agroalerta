/**
 * Documento Word para a validação humana da IA.
 *
 * Para cada cenário da amostra mostra os dados enviados, as DUAS respostas que o Claude deu
 * (as duas execuções) e uma tabela para o avaliador digitar as notas de 1 a 5. As notas do juiz
 * não aparecem (avaliação cega). O mesmo arquivo preenchido é lido de volta por lerRespostas().
 *
 *   npm run ia:docx-validacao                     gera <pasta mais recente>/validacao-humana.docx
 *   npm run ia:docx-validacao -- --pasta=<dir>    pasta específica
 *   npm run ia:docx-validacao -- --forcar         sobrescreve um arquivo já existente
 */
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const D = require("docx");
const { RUBRICA } = require("./criterios");

const LARGURA = 9638; // A4 com margens de 2 cm, em twips
const COLUNAS = [4238, 2700, 2700];
const VERDE = "1F3D2B";
const CRITERIOS = [
  { chave: "coerencia", rotulo: "Coerência" },
  { chave: "clareza", rotulo: "Clareza" },
  { chave: "relevancia", rotulo: "Relevância" },
  { chave: "ausenciaInvencao", rotulo: "Ausência de informações inventadas" },
];
const ROTULO_CONSISTENCIA = "Consistência entre as duas respostas (1 a 5)";
const ROTULO_OBS = "Observações (opcional)";
const ROTULO_NOME = "Nome do avaliador";
const ROTULO_DATA = "Data";

const BORDA = { style: D.BorderStyle.SINGLE, size: 4, color: "C9C3B0" };
const BORDAS = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
const SEM_BORDA = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };

const texto = (t, o = {}) => new D.TextRun({ text: t, size: o.tamanho || 21, bold: o.negrito, italics: o.italico, color: o.cor, font: "Calibri" });
const par = (t, o = {}) => new D.Paragraph({
  children: [texto(t, o)],
  spacing: { before: o.antes ?? 0, after: o.depois ?? 80, line: o.linha },
  alignment: o.alinhamento,
  keepNext: o.manterJunto,
  pageBreakBefore: o.quebraAntes,
  indent: o.recuo ? { left: o.recuo } : undefined,
});
// Texto com várias linhas vira um parágrafo por linha (Word não quebra linhas dentro de um TextRun).
const linhas = (t, o = {}) => String(t || "").split("\n").map((l) => par(l || " ", { depois: 20, ...o }));

function celula(filhos, { largura, preenchimento, colunas, altura, vertical } = {}) {
  return new D.TableCell({
    children: filhos,
    width: largura ? { size: largura, type: D.WidthType.DXA } : undefined,
    columnSpan: colunas,
    verticalAlign: vertical || D.VerticalAlign.CENTER,
    shading: preenchimento ? { type: D.ShadingType.CLEAR, color: "auto", fill: preenchimento } : undefined,
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    borders: BORDAS,
  });
}

function linha(celulas, altura) {
  return new D.TableRow({ children: celulas, cantSplit: true, height: altura ? { value: altura, rule: D.HeightRule.ATLEAST } : undefined });
}

function tabela(linhasTabela, colunas = COLUNAS) {
  return new D.Table({
    width: { size: colunas.reduce((a, b) => a + b, 0), type: D.WidthType.DXA },
    columnWidths: colunas,
    layout: D.TableLayoutType.FIXED,
    rows: linhasTabela,
  });
}

// Caixa colorida de uma célula só, com título e o conteúdo (usada para dados e respostas).
function caixa(titulo, conteudo, fundo, corTitulo) {
  return tabela([linha([celula([par(titulo, { negrito: true, tamanho: 20, cor: corTitulo, depois: 60 }), ...linhas(conteudo, { tamanho: 19 })], { largura: LARGURA, preenchimento: fundo, vertical: D.VerticalAlign.TOP })])], [LARGURA]);
}

const espaco = (pt = 6) => new D.Paragraph({ children: [], spacing: { before: 0, after: pt * 20 } });
const ENTRADA = "FFF8DC"; // célula onde o avaliador digita

function celulaEntrada(valor, opcoes = {}) {
  return celula([par(valor == null ? "" : String(valor), { alinhamento: D.AlignmentType.CENTER, depois: 0, manterJunto: true })], { preenchimento: ENTRADA, ...opcoes });
}

function tabelaNotas(c, preenchida) {
  const p = preenchida || {};
  const r = (n) => (p[n] ? p[n] : {});
  const cab = (t, l) => celula([par(t, { negrito: true, cor: "FFFFFF", depois: 0, alinhamento: D.AlignmentType.CENTER, manterJunto: true })], { largura: l, preenchimento: VERDE });
  return tabela([
    linha([cab(c.id, COLUNAS[0]), cab("Resposta 1", COLUNAS[1]), cab("Resposta 2", COLUNAS[2])]),
    ...CRITERIOS.map((k) => linha([
      celula([par(k.rotulo, { depois: 0, manterJunto: true })], { largura: COLUNAS[0], preenchimento: "F7F5EF" }),
      celulaEntrada(r("r1")[k.chave], { largura: COLUNAS[1] }),
      celulaEntrada(r("r2")[k.chave], { largura: COLUNAS[2] }),
    ], 400)),
    linha([
      celula([par(ROTULO_CONSISTENCIA, { depois: 0, manterJunto: true })], { largura: COLUNAS[0], preenchimento: "F7F5EF" }),
      celulaEntrada(p.consistencia, { largura: COLUNAS[1] + COLUNAS[2], colunas: 2 }),
    ], 400),
    linha([
      celula([par(ROTULO_OBS, { depois: 0 })], { largura: COLUNAS[0], preenchimento: "F7F5EF" }),
      celula([par(p.observacoes || "", { depois: 0 })], { largura: COLUNAS[1] + COLUNAS[2], colunas: 2, preenchimento: ENTRADA }),
    ], 700),
  ]);
}

function secaoIntro(meta, total) {
  const passo = (n, t) => par(n + ".  " + t, { recuo: 280, depois: 60 });
  return [
    par("Validação humana da IA do AgroAlerta", { tamanho: 40, negrito: true, cor: VERDE, depois: 40 }),
    par("Avaliação cega · rodada " + meta.rodada + " · " + total + " cenários (" + meta.clima + " de clima e " + meta.mercado + " de mercado)", { cor: "6B4A34", depois: 200 }),
    tabela([
      linha([celula([par(ROTULO_NOME, { negrito: true, depois: 0 })], { largura: 2800, preenchimento: "F7F5EF" }), celula([par(meta.nome || "", { depois: 0 })], { largura: LARGURA - 2800, preenchimento: ENTRADA })], 440),
      linha([celula([par(ROTULO_DATA, { negrito: true, depois: 0 })], { largura: 2800, preenchimento: "F7F5EF" }), celula([par(meta.data || "", { depois: 0 })], { largura: LARGURA - 2800, preenchimento: ENTRADA })], 440),
    ], [2800, LARGURA - 2800]),
    espaco(10),
    par("Como responder", { tamanho: 26, negrito: true, cor: VERDE, antes: 120 }),
    passo(1, "Para cada cenário, leia os dados enviados ao Claude e as duas respostas que ele deu (Resposta 1 e Resposta 2)."),
    passo(2, "Na tabela de notas, digite um número inteiro de 1 a 5 em cada célula amarela, para cada resposta. Em “Consistência”, dê uma nota única para o quanto as duas respostas chegam à mesma conclusão."),
    passo(3, "Use as observações para anotar o motivo das notas baixas (opcional, mas ajuda a escrever o artigo)."),
    passo(4, "Salve o arquivo, no mesmo formato .docx, e avise para rodar a comparação com o juiz."),
    par("Importante: a avaliação é cega. Enquanto estiver pontuando, não abra relatorio.md, resultados.csv, respostas.json nem os PDFs de resultado, pois eles mostram as notas do avaliador automático. Faça a avaliação sozinho(a), sem comparar com outros avaliadores.", { cor: "A33A22", antes: 120, depois: 160 }),
    par("Escala e critérios (notas inteiras de 1 a 5)", { tamanho: 26, negrito: true, cor: VERDE, antes: 120 }),
    tabela([
      linha(["Critério", "O que avaliar", "5", "3", "1"].map((t, i) => celula([par(t, { negrito: true, cor: "FFFFFF", depois: 0, tamanho: 19 })], { largura: [1500, 2538, 1900, 1900, 1800][i], preenchimento: VERDE }))),
      ...CRITERIOS.map((k) => {
        const r = RUBRICA[k.chave];
        return linha([r.titulo, r.pergunta, r.ancoras[5], r.ancoras[3], r.ancoras[1]].map((t, i) => celula([par(t, { depois: 0, tamanho: 18, negrito: i === 0 })], { largura: [1500, 2538, 1900, 1900, 1800][i], preenchimento: i === 0 ? "F7F5EF" : undefined, vertical: D.VerticalAlign.TOP })));
      }),
      linha([celula([par("Consistência", { depois: 0, tamanho: 18, negrito: true })], { largura: 1500, preenchimento: "F7F5EF", vertical: D.VerticalAlign.TOP }), celula([par("As duas respostas do mesmo cenário chegam à mesma conclusão?", { depois: 0, tamanho: 18 })], { largura: 2538, vertical: D.VerticalAlign.TOP }), celula([par("5: mesma conclusão (mesmo nível e riscos, ou mesma tendência)", { depois: 0, tamanho: 18 })], { largura: 1900, vertical: D.VerticalAlign.TOP }), celula([par("3: conclusões parecidas, com diferença de nível ou de um risco", { depois: 0, tamanho: 18 })], { largura: 1900, vertical: D.VerticalAlign.TOP }), celula([par("1: conclusões opostas", { depois: 0, tamanho: 18 })], { largura: 1800, vertical: D.VerticalAlign.TOP })]),
    ], [1500, 2538, 1900, 1900, 1800]),
    espaco(10),
    par("Referências para conferir as respostas", { tamanho: 26, negrito: true, cor: VERDE, antes: 120 }),
    par("Clima: os alertas calculados pelo sistema aparecem nos dados enviados. A resposta correta mantém o nível e os riscos desses alertas e não inventa risco que não está lá.", { recuo: 280, depois: 60 }),
    par("Mercado: a tendência é “alta” se a variação do período for de +2% ou mais, “queda” se for de −2% ou menos, e “estável” entre os dois. Confira também se os números citados (preços e datas) existem na série.", { recuo: 280, depois: 60 }),
  ];
}

function blocoCenario(c, preenchida, primeiro) {
  const r1 = c.execucoes.find((e) => e.execucao === 1) || c.execucoes[0];
  const r2 = c.execucoes.find((e) => e.execucao === 2) || c.execucoes[1];
  const rotuloModulo = c.modulo === "clima" ? "Monitoramento climático" : "Mercado";
  return [
    par("Cenário " + c.id + " · " + rotuloModulo, { tamanho: 30, negrito: true, cor: VERDE, depois: 20, quebraAntes: true, manterJunto: true }),
    par(c.descricao, { italico: true, cor: "6B4A34", depois: 100, manterJunto: true }),
    par("Referência objetiva: " + c.gabarito.replace(/ Formato da série: .*/, ""), { tamanho: 19, cor: "4A4A42", depois: 100 }),
    caixa("Dados enviados ao Claude", c.dadosEntrada, "F7F5EF", "4A4A42"),
    espaco(6),
    caixa("Resposta 1", r1.textoAvaliado || r1.textoBruto, "EEF5F8", "24505F"),
    espaco(6),
    caixa("Resposta 2", r2.textoAvaliado || r2.textoBruto, "EAEFE9", VERDE),
    espaco(8),
    par("Suas notas (1 a 5)", { negrito: true, cor: VERDE, depois: 60, manterJunto: true }),
    tabelaNotas(c, preenchida),
  ];
}

/** Monta o Document. `preenchidas` ({ID: {r1, r2, consistencia, observacoes}}) serve a testes e exemplos. */
function montarDocumento(amostra, { rodada = "", avaliador = "", data = "", preenchidas = {} } = {}) {
  const meta = {
    rodada, nome: avaliador, data,
    clima: amostra.filter((c) => c.modulo === "clima").length,
    mercado: amostra.filter((c) => c.modulo === "mercado").length,
  };
  const filhos = [...secaoIntro(meta, amostra.length)];
  amostra.forEach((c, i) => filhos.push(...blocoCenario(c, preenchidas[c.id], i === 0)));
  return new D.Document({
    creator: "AgroAlerta",
    title: "Validação humana da IA",
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: ["Validação humana da IA · AgroAlerta · página ", D.PageNumber.CURRENT], size: 16, color: "6B4A34" })] })] }) },
      children: filhos,
    }],
  });
}

async function gerarBuffer(amostra, opcoes) {
  return D.Packer.toBuffer(montarDocumento(amostra, opcoes));
}

// ── Leitura do documento preenchido ──────────────────────────────────────────

const decodificar = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function textoDaCelula(xmlCelula) {
  const paragrafos = [...xmlCelula.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) =>
    decodificar([...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")));
  return paragrafos.join("\n").trim();
}

function linhasDaTabela(xmlTabela) {
  return [...xmlTabela.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) =>
    [...tr[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map((tc) => textoDaCelula(tc[0])));
}

/**
 * Lê o .docx preenchido. Devolve textos crus (a validação das notas fica com quem compara):
 * { avaliador: {nome, data}, itens: [{cenario, respostas:[{execucao, notas}], consistencia, observacoes}] }
 */
async function lerRespostas(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const arquivo = zip.file("word/document.xml");
  if (!arquivo) throw new Error("O arquivo não parece um documento Word (.docx) válido.");
  const xml = await arquivo.async("string");
  const tabelas = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => linhasDaTabela(m[0]));
  // "contém" em vez de "começa com": um caractere digitado por engano no rótulo (ex.: "6Consistência...")
  // não pode fazer a linha de notas desaparecer.
  const achar = (tab, rotulo) => tab.find((l) => l[0] && semAcento(l[0]).includes(semAcento(rotulo)));

  const intro = tabelas.find((t) => achar(t, ROTULO_NOME));
  const avaliador = intro ? { nome: (achar(intro, ROTULO_NOME) || [])[1] || "", data: (achar(intro, ROTULO_DATA) || [])[1] || "" } : { nome: "", data: "" };

  const itens = tabelas.filter((t) => t[0] && /^[A-Z]{1,2}\d{2}$/.test(t[0][0].trim())).map((t) => {
    const respostas = [1, 2].map((n) => ({ execucao: n, notas: {} }));
    for (const k of CRITERIOS) {
      const l = achar(t, k.rotulo) || [];
      respostas[0].notas[k.chave] = l[1] || "";
      respostas[1].notas[k.chave] = l[2] || "";
    }
    return {
      cenario: t[0][0].trim(),
      respostas,
      consistencia: (achar(t, "Consistência entre") || [])[1] || "",
      observacoes: (achar(t, "Observações") || [])[1] || "",
    };
  });
  return { avaliador, itens };
}

module.exports = { montarDocumento, gerarBuffer, lerRespostas, ROTULO_CONSISTENCIA, CRITERIOS };

// ── CLI ──────────────────────────────────────────────────────────────────────

async function principal() {
  const { pastaMaisRecente } = require("./gerar-pdf");
  const { selecionarAmostra } = require("./relatorio");
  const arg = (n) => (process.argv.find((a) => a.startsWith("--" + n + "=")) || "").split("=").slice(1).join("=");
  const pasta = arg("pasta") ? path.resolve(arg("pasta")) : pastaMaisRecente();
  const destino = path.join(pasta, "validacao-humana.docx");
  if (fs.existsSync(destino) && !process.argv.includes("--forcar")) {
    console.error("Já existe " + destino + ".\nPara não apagar notas já digitadas, nada foi feito. Use --forcar para sobrescrever.");
    process.exit(1);
  }
  const cenarios = JSON.parse(fs.readFileSync(path.join(pasta, "respostas.json"), "utf8"));
  const amostra = selecionarAmostra(cenarios);
  fs.writeFileSync(destino, await gerarBuffer(amostra, { rodada: path.basename(pasta) }));
  console.log("Documento gerado: " + destino + "\n" + amostra.length + " cenários, com as duas respostas do Claude em cada um.");
}

if (require.main === module) {
  principal().catch((erro) => { console.error("Falha ao gerar o documento:", erro.message); process.exit(1); });
}
