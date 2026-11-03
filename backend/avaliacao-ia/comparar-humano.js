#!/usr/bin/env node
/**
 * Compara as notas dos avaliadores humanos (validacao-humana.csv preenchido) com as do juiz.
 *
 *   npm run ia:comparar-humano                                  pasta mais recente, planilha padrão
 *   npm run ia:comparar-humano -- --pasta=<resultados>          pasta específica
 *   npm run ia:comparar-humano -- --planilha=a.docx,b.docx      um ou mais avaliadores (Word ou CSV)
 *
 * A planilha mostra a resposta de uma execução; as notas do juiz são buscadas na MESMA execução
 * (e não na média das duas), para a comparação ser justa.
 * Aceita CSV separado por ";", "," ou tabulação (o Excel/Planilhas salvam de formas diferentes).
 */
const fs = require("node:fs");
const path = require("node:path");
const M = require("./metricas");
const { pastaMaisRecente } = require("./gerar-pdf");

const CRITERIOS = [
  { coluna: "coerencia_1a5", chave: "coerencia", rotulo: "Coerência" },
  { coluna: "clareza_1a5", chave: "clareza", rotulo: "Clareza" },
  { coluna: "relevancia_1a5", chave: "relevancia", rotulo: "Relevância" },
  { coluna: "ausencia_invencao_1a5", chave: "ausenciaInvencao", rotulo: "Ausência de informações inventadas" },
];

function detectarSeparador(cabecalho) {
  const cont = (c) => (cabecalho.match(new RegExp(c === "\t" ? "\\t" : c, "g")) || []).length;
  return [";", "\t", ","].map((s) => [s, cont(s)]).sort((a, b) => b[1] - a[1])[0][0];
}

function lerCsv(texto) {
  const t = texto.replace(/^﻿/, "");
  const sep = detectarSeparador(t.split("\n")[0]);
  const linhas = [];
  let linha = [], atual = "", aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"') { if (t[i + 1] === '"') { atual += '"'; i++; } else aspas = false; } else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(atual); atual = ""; }
    else if (ch === "\n") { linha.push(atual); linhas.push(linha); linha = []; atual = ""; }
    else if (ch !== "\r") atual += ch;
  }
  if (atual || linha.length) { linha.push(atual); linhas.push(linha); }
  const cab = linhas[0].map((c) => c.trim());
  return { separador: sep, cabecalho: cab, linhas: linhas.slice(1).filter((l) => l.some((c) => c.trim())) };
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

function nota(valor) {
  const n = Number(String(valor || "").trim().replace(",", "."));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

// O Excel salva CSV em Windows-1252 por padrão; tenta UTF-8 estrito e cai para Windows-1252.
function lerTexto(arquivo) {
  const buf = fs.readFileSync(arquivo);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const CRITERIO_CONSISTENCIA = { chave: "consistencia", rotulo: "Consistência entre as duas respostas" };
const TODOS_CRITERIOS = [...CRITERIOS, CRITERIO_CONSISTENCIA];

function notasDe(colunas) {
  return Object.fromEntries(CRITERIOS.map((c) => [c.chave, nota(colunas[c.chave])]));
}

function lerAvaliadorCsv(arquivo) {
  const { separador, cabecalho, linhas } = lerCsv(lerTexto(arquivo));
  const col = (nome) => cabecalho.indexOf(nome);
  const faltando = ["cenario", "resposta_do_claude", ...CRITERIOS.map((c) => c.coluna)].filter((n) => col(n) < 0);
  if (faltando.length) throw new Error(path.basename(arquivo) + ": colunas ausentes: " + faltando.join(", "));
  const itens = linhas.map((l) => ({
    cenario: l[col("cenario")].trim(),
    observacoes: col("observacoes") >= 0 ? (l[col("observacoes")] || "").trim() : "",
    consistencia: null,
    respostas: [{ execucao: null, texto: norm(l[col("resposta_do_claude")]), notas: notasDe(Object.fromEntries(CRITERIOS.map((c) => [c.chave, l[col(c.coluna)]]))) }],
  }));
  return { arquivo: path.basename(arquivo), formato: "csv", avaliador: "", separador, itens };
}

// Documento Word (validacao-humana.docx): duas respostas por cenário, mais a nota de consistência.
async function lerAvaliadorDocx(arquivo) {
  const { lerRespostas } = require("./validacao-docx");
  const lido = await lerRespostas(fs.readFileSync(arquivo));
  const itens = lido.itens.map((i) => ({
    cenario: i.cenario,
    observacoes: i.observacoes,
    consistencia: nota(i.consistencia),
    respostas: i.respostas.map((r) => ({ execucao: r.execucao, texto: null, notas: notasDe(r.notas) })),
  }));
  return { arquivo: path.basename(arquivo), formato: "docx", avaliador: lido.avaliador.nome, separador: null, itens };
}

async function lerAvaliador(arquivo) {
  return /\.docx$/i.test(arquivo) ? lerAvaliadorDocx(arquivo) : lerAvaliadorCsv(arquivo);
}

function temNotas(avaliador) {
  return avaliador.itens.some((i) => i.consistencia != null || i.respostas.some((r) => Object.values(r.notas).some((n) => n != null)));
}

function encontrarExecucao(cenario, respostaPlanilha) {
  const validas = cenario.execucoes.filter((e) => !e.excluida);
  const igual = validas.find((e) => norm(e.textoAvaliado || e.textoBruto) === respostaPlanilha);
  return { execucao: igual || validas[0], casou: Boolean(igual) };
}

function comparar(cenarios, avaliador) {
  const pares = [];
  const avisos = [];
  const vazios = [];
  for (const item of avaliador.itens) {
    const c = cenarios.find((x) => x.id === item.cenario);
    if (!c) { avisos.push("Cenário " + item.cenario + " não existe na rodada."); continue; }
    const algumaNota = item.consistencia != null || item.respostas.some((r) => Object.values(r.notas).some((n) => n != null));
    if (!algumaNota) { vazios.push(item.cenario); continue; }
    for (const resp of item.respostas) {
      const rotulo = "Cenário " + item.cenario + (resp.execucao != null ? ", resposta " + resp.execucao : "");
      if (CRITERIOS.some((k) => resp.notas[k.chave] == null)) {
        if (Object.values(resp.notas).some((n) => n != null)) avisos.push(rotulo + ": nota ausente ou fora de 1 a 5; resposta ignorada.");
        continue;
      }
      let execucao, casou = true;
      if (resp.execucao != null) {
        execucao = c.execucoes.find((e) => e.execucao === resp.execucao && !e.excluida);
        if (!execucao) { avisos.push(rotulo + ": a execução não existe na rodada; ignorada."); continue; }
      } else {
        ({ execucao, casou } = encontrarExecucao(c, resp.texto));
        if (!casou) avisos.push(rotulo + ": o texto da planilha não casou com nenhuma execução; usada a execução 1.");
      }
      for (const k of CRITERIOS) {
        pares.push({ cenario: c.id, modulo: c.modulo, criterio: k.chave, humano: resp.notas[k.chave], juiz: execucao.juiz.notas[k.chave], execucao: execucao.execucao });
      }
    }
    if (item.consistencia != null && c.notas) {
      // O juiz não pontua a consistência: é calculada entre as duas execuções do cenário.
      pares.push({ cenario: c.id, modulo: c.modulo, criterio: "consistencia", humano: item.consistencia, juiz: c.notas.consistencia, execucao: null });
    }
  }
  if (vazios.length) avisos.unshift(vazios.length + " cenário(s) sem nenhuma nota preenchida, ignorados: " + vazios.join(", ") + ".");
  for (const k of TODOS_CRITERIOS) {
    const valores = new Set(pares.filter((p) => p.criterio === k.chave).map((p) => p.humano));
    if (valores.size === 1) {
      avisos.push("Critério '" + k.rotulo + "': o avaliador deu a mesma nota (" + [...valores][0] + ") em todos os cenários; a correlação fica indefinida e a comparação diz pouco sobre a capacidade de discriminar.");
    }
  }
  const resumo = (lista) => M.compararNotas(lista.map((p) => p.humano), lista.map((p) => p.juiz));
  const porCriterio = Object.fromEntries(TODOS_CRITERIOS.map((k) => [k.chave, resumo(pares.filter((p) => p.criterio === k.chave))]));
  const porModulo = Object.fromEntries(["clima", "mercado"].map((m) => [m, resumo(pares.filter((p) => p.modulo === m))]));
  const porExecucao = Object.fromEntries([1, 2].map((n) => [n, resumo(pares.filter((p) => p.execucao === n))]));
  // Média por cenário (um ponto por cenário).
  const ids = [...new Set(pares.map((p) => p.cenario))];
  const mediaCen = (campo) => ids.map((id) => M.media(pares.filter((p) => p.cenario === id).map((p) => p[campo])));
  const porCenario = M.compararNotas(mediaCen("humano"), mediaCen("juiz"));
  const maiores = ids.map((id) => {
    const ps = pares.filter((p) => p.cenario === id);
    return { cenario: id, humano: M.arred(M.media(ps.map((p) => p.humano))), juiz: M.arred(M.media(ps.map((p) => p.juiz))), obs: avaliador.itens.find((i) => i.cenario === id).observacoes };
  }).map((x) => ({ ...x, dif: M.arred(x.humano - x.juiz) })).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, 5);
  return {
    avaliador: avaliador.arquivo, nomeAvaliador: avaliador.avaliador, formato: avaliador.formato,
    cenarios: ids.length, notas: pares.length, geral: resumo(pares), porCriterio, porModulo, porExecucao, porCenario,
    maioresDiferencas: maiores, avisos, pares,
  };
}

const fmt = (v, c = 2) => (v == null ? "-" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }));
const linhaMetrica = (nome, m) => "| " + nome + " | " + m.n + " | " + fmt(m.diffMediaAbs) + " | " + fmt(m.vies) + " | " + fmt(m.concordanciaExata, 1) + "% | " + fmt(m.dentroDe1, 1) + "% | " + fmt(m.spearman) + " |";
const CAB = ["| Recorte | Notas | Diferença média absoluta | Viés (humano − juiz) | Concordância exata | Dentro de ±1 ponto | Spearman |", "|---|---:|---:|---:|---:|---:|---:|"];

function relatorioMd(r, pasta) {
  const dois = r.formato === "docx";
  return [
    "# Comparação humano × juiz — " + r.avaliador + (r.nomeAvaliador ? " (" + r.nomeAvaliador + ")" : ""),
    "",
    "Rodada: `" + path.basename(pasta) + "` · " + r.cenarios + " cenários · " + r.notas + " notas · juiz: Claude Sonnet 4.6, comparado na mesma execução que o avaliador viu" +
      (dois ? " (Resposta 1 × execução 1, Resposta 2 × execução 2; a consistência é comparada com a calculada entre as duas execuções)." : "."),
    "",
    ...CAB,
    linhaMetrica("**Todas as notas**", r.geral),
    ...TODOS_CRITERIOS.filter((k) => r.porCriterio[k.chave].n > 0).map((k) => linhaMetrica(k.rotulo, r.porCriterio[k.chave])),
    linhaMetrica("Clima", r.porModulo.clima),
    linhaMetrica("Mercado", r.porModulo.mercado),
    ...(dois ? [linhaMetrica("Resposta 1", r.porExecucao[1]), linhaMetrica("Resposta 2", r.porExecucao[2])] : []),
    linhaMetrica("Média por cenário", r.porCenario),
    "",
    "Viés positivo = o humano deu notas mais altas que o juiz; negativo = o juiz foi mais benevolente.",
    "",
    "## Cenários com maior diferença",
    "",
    "| Cenário | Humano (média) | Juiz (média) | Diferença | Observação do avaliador |",
    "|---|---:|---:|---:|---|",
    ...r.maioresDiferencas.map((x) => "| " + x.cenario + " | " + fmt(x.humano) + " | " + fmt(x.juiz) + " | " + fmt(x.dif) + " | " + (x.obs || "-").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 160) + " |"),
    ...(r.avisos.length ? ["", "## Avisos", "", ...r.avisos.map((a) => "- " + a)] : []),
    "",
  ].join("\n");
}

// Sem --planilha: usa o Word preenchido, se existir e tiver notas; senão o CSV.
async function escolherPlanilhas(pasta, argPlanilha) {
  if (argPlanilha) return argPlanilha.split(",").map((p) => path.resolve(p));
  const docx = path.join(pasta, "validacao-humana.docx");
  if (fs.existsSync(docx) && temNotas(await lerAvaliadorDocx(docx))) return [docx];
  return [path.join(pasta, "validacao-humana.csv")];
}

async function principal() {
  const arg = (nome) => (process.argv.find((a) => a.startsWith("--" + nome + "=")) || "").split("=").slice(1).join("=");
  const pasta = arg("pasta") ? path.resolve(arg("pasta")) : pastaMaisRecente();
  const planilhas = await escolherPlanilhas(pasta, arg("planilha"));
  const cenarios = JSON.parse(fs.readFileSync(path.join(pasta, "respostas.json"), "utf8"));

  const resultados = [];
  for (const p of planilhas) resultados.push(comparar(cenarios, await lerAvaliador(p)));
  resultados.forEach((r, i) => {
    const sufixo = resultados.length > 1 ? "-" + (i + 1) : "";
    const { pares, ...enxuto } = r;
    fs.writeFileSync(path.join(pasta, "comparacao-humano" + sufixo + ".json"), JSON.stringify(enxuto, null, 2));
    fs.writeFileSync(path.join(pasta, "comparacao-humano" + sufixo + ".md"), relatorioMd(r, pasta));
    console.log("\n" + relatorioMd(r, pasta));
  });

  if (resultados.length > 1) {
    // Concordância entre os humanos, nos itens que todos pontuaram.
    const chave = (p) => p.cenario + "|" + p.criterio + "|" + p.execucao;
    const [A, B] = resultados;
    const mapaB = new Map(B.pares.map((p) => [chave(p), p.humano]));
    const comuns = A.pares.filter((p) => mapaB.has(chave(p)));
    const m = M.compararNotas(comuns.map((p) => p.humano), comuns.map((p) => mapaB.get(chave(p))));
    console.log("Concordância entre os avaliadores 1 e 2: diferença média " + fmt(m.diffMediaAbs) + " · exata " + fmt(m.concordanciaExata, 1) + "% · ±1 " + fmt(m.dentroDe1, 1) + "% · Spearman " + fmt(m.spearman) + " (n=" + m.n + ")");
  }
}

if (require.main === module) {
  principal().catch((erro) => { console.error("Falha na comparação:", erro.message); process.exit(1); });
}

module.exports = { lerCsv, lerTexto, detectarSeparador, nota, comparar, lerAvaliador, lerAvaliadorCsv, lerAvaliadorDocx, encontrarExecucao, temNotas };
