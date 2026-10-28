#!/usr/bin/env node
/**
 * Gera o relatório PDF de metodologia e assertividade da IA a partir de uma pasta de resultados.
 *
 *   npm run ia:relatorio-pdf                       usa a execução completa mais recente
 *   npm run ia:relatorio-pdf -- --pasta=<caminho>  usa uma pasta específica
 *
 * Todos os percentuais são calculados dos dados (respostas.json), não digitados.
 */
const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const L = require("../services/pdfLayout");
const M = require("./metricas");
const { RUBRICA } = require("./criterios");

const { COR, num } = L;
const pct = (v, c = 1) => (v == null ? "-" : num(v, c) + "%");
const ROTULO = { coerencia: "Coerência", clareza: "Clareza", relevancia: "Relevância", ausenciaInvencao: "Ausência de informações inventadas", consistencia: "Consistência" };
const NOME_MODULO = { clima: "Monitoramento climático", mercado: "Mercado" };

function pastaMaisRecente() {
  const base = path.join(__dirname, "resultados");
  const pastas = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => !d.endsWith("_piloto") && fs.existsSync(path.join(base, d, "resumo.json"))).sort()
    : [];
  if (!pastas.length) throw new Error("Nenhuma execução completa encontrada em avaliacao-ia/resultados. Rode: npm run ia:avaliar");
  return path.join(base, pastas[pastas.length - 1]);
}

function lerDados(pasta) {
  const ler = (nome) => JSON.parse(fs.readFileSync(path.join(pasta, nome), "utf8"));
  const resumo = ler("resumo.json");
  const cenarios = ler("respostas.json");
  const registro = fs.readFileSync(path.join(pasta, "registro-chamadas.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { resumo, cenarios, registro };
}

function distribuicao(cenarios) {
  const por = {};
  for (const c of cenarios) por[c.categoria] = (por[c.categoria] || 0) + 1;
  return Object.entries(por).map(([k, v]) => k + " (" + v + ")").join(", ");
}

// A fonte padrão do PDF (WinAnsi) não tem estes símbolos; troca por equivalentes simples.
function limpar(texto) {
  return String(texto == null ? "" : texto).replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/−/g, "-").replace(/→/g, "->").replace(/≈/g, "~");
}

function trecho(texto, max) {
  const t = limpar(texto).replace(/\s+\n/g, "\n").trim();
  return t.length > max ? t.slice(0, max) + "..." : t;
}

function exemploCenario(doc, titulo, c) {
  const e = c.execucoes.find((x) => !x.excluida);
  L.paragrafo(doc, titulo + " - " + c.id + " (" + c.categoria + "): " + c.descricao, { negrito: true, cor: COR.verde, tamanho: 9 });
  L.paragrafo(doc, "Dados enviados ao modelo:\n" + trecho(c.dadosEntrada, 780), { fundo: COR.bege, cor: COR.cinza, tamanho: 7.5 });
  L.paragrafo(doc, "Resposta do Claude (requestId " + e.proveniencia.requestId + "):\n" + trecho(e.textoAvaliado || e.textoBruto, 620), { fundo: "#EEF5F8", cor: "#24505F", tamanho: 8 });
  const j = e.juiz.justificativas;
  L.paragrafo(doc,
    "Gabarito: " + limpar(c.gabarito) + "\n" +
    "Notas: coerência " + num(c.notas.coerencia) + ", clareza " + num(c.notas.clareza) + ", relevância " + num(c.notas.relevancia) +
    ", ausência de invenção " + num(c.notas.ausenciaInvencao) + ", consistência " + num(c.notas.consistencia) + " (média " + num(c.notas.media) + ").\n" +
    "Observação do avaliador: " + trecho(j.ausenciaInvencao || j.coerencia, 260),
    { tamanho: 8, cor: COR.cinza });
}

function montarPdf(dados) {
  const { resumo, cenarios, registro } = dados;
  const meta = resumo.meta;
  const clima = cenarios.filter((c) => c.modulo === "clima");
  const mercado = cenarios.filter((c) => c.modulo === "mercado");
  const A = M.calcularAssertividade({ clima, mercado });
  const geral = A.geral;
  const ordenar = (lista) => [...lista.filter((c) => !c.excluido)].sort((a, b) => b.notas.media - a.notas.media || a.id.localeCompare(b.id));

  const doc = new PDFDocument({ margins: { top: 50, bottom: 0, left: 50, right: 50 }, size: "A4", bufferPages: true });
  doc._tituloRel = "Relatório de assertividade da IA";
  const partes = [];
  doc.on("data", (c) => partes.push(c));
  const fim = new Promise((r) => doc.on("end", r));

  L.capa(doc, "Relatório de assertividade da IA (Claude)",
    "Como a IA foi testada e quanto acertou nos módulos de monitoramento climático e de mercado", "AgroAlerta · TCC");

  // 1. Resumo
  L.secao(doc, "1. Resumo do resultado");
  L.kpis(doc, [
    { rotulo: "Índice de assertividade", valor: pct(geral.indice), nota: "média das notas ÷ 5" },
    { rotulo: "Acerto objetivo", valor: pct(geral.acertoObjetivo.pct, 0), nota: geral.acertoObjetivo.k + " de " + geral.acertoObjetivo.n + " respostas" },
    { rotulo: "Respostas satisfatórias", valor: pct(geral.satisfatorios.pct, 0), nota: geral.satisfatorios.k + " de " + geral.satisfatorios.n + " cenários" },
    { rotulo: "Respostas da API", valor: String(meta.respostasComprovadas), nota: "0 simuladas · " + meta.respostasExcluidas + " excluídas" },
  ]);
  L.paragrafo(doc,
    "Em " + geral.cenarios + " cenários (" + A.modulos.clima.cenarios + " de clima e " + A.modulos.mercado.cenarios + " de mercado), com " + geral.respostas +
    " respostas reais da API da Anthropic, o Claude acertou " + pct(geral.acertoObjetivo.pct, 0) + " das classificações objetivas (nível geral e riscos no clima; alta, queda ou estável no mercado) " +
    "e obteve nota média de cerca de " + num(geral.indice / 20, 1) + " em 5 nos critérios de qualidade, o que corresponde ao índice de assertividade de " + pct(geral.indice) + ".",
    { fundo: "#EAEFE9", cor: COR.verde });
  L.tabela(doc, ["Módulo", "Cenários", "Índice de assertividade", "Acerto objetivo (IC 95%)", "Satisfatórias"], [120, 55, 105, 130, 85],
    ["clima", "mercado"].map((k) => {
      const m = A.modulos[k];
      return [NOME_MODULO[k], m.cenarios, pct(m.indice) + " (média " + num(m.mediaGeral) + ")", pct(m.acertoObjetivo.pct, 0) + " (" + pct(m.acertoObjetivo.ic95[0]) + " a " + pct(m.acertoObjetivo.ic95[1], 0) + ")", m.satisfatorios.k + "/" + m.satisfatorios.n];
    }));

  // 2. Objetivo
  L.secao(doc, "2. Objetivo da avaliação");
  L.paragrafo(doc,
    "O orientador pediu a avaliação da assertividade da IA. O objetivo é medir, com resultados mensuráveis, se o Claude interpreta corretamente (a) os dados do monitoramento climático " +
    "(temperatura, chuva, vento e os alertas do motor de regras) e (b) as séries de preços do mercado (altas, quedas e estabilidade), produzindo respostas coerentes, claras, relevantes, " +
    "sem informações inventadas e consistentes entre repetições.");

  // 3. Metodologia
  L.secao(doc, "3. Como a IA foi testada");
  L.tabela(doc, ["Etapa", "O que foi feito"], [110, 385], [
    ["Cenários", "30 de clima (15 café e 15 soja) e 30 de mercado (15 café e 15 soja), controlados e reproduzíveis. Clima: " + distribuicao(clima) + ". Mercado: " + distribuicao(mercado) + "."],
    ["Gabarito (clima)", "Calculado pelo motor de regras real do sistema (limiares de geada, estiagem, excesso de chuva, vento e chuva na colheita). Inclui casos-limite (por exemplo 2,0 e 5,5 °C; 149 mm; 59 e 60 km/h) para testar falsos alarmes e omissões."],
    ["Gabarito (mercado)", "Regra única de tendência sobre a variação líquida do período: alta se maior ou igual a +2%, queda se menor ou igual a -2%, estável entre os dois. Séries de 14 observações geradas com semente fixa; variações a pelo menos 1 ponto percentual do limiar."],
    ["Execução", "Cada cenário foi enviado ao Claude duas vezes, com o mesmo prompt (" + meta.promptVersoes.join(" e ") + "). Modelo avaliado: " + meta.modeloAvaliado + ". A resposta é um JSON, validado e convertido no texto que o produtor lê."],
    ["Avaliação", "Um modelo diferente e mais forte, " + meta.modeloJuiz + " (temperatura 0), pontuou de 1 a 5 quatro critérios, recebendo os dados enviados, o gabarito e os pontos-chave esperados. A consistência não passa pelo juiz: é calculada entre as duas execuções."],
    ["Checagens automáticas", "Comparação com o gabarito (nível geral, conjunto de riscos, tendência), validade do JSON e verificação de números citados que não existem nos dados enviados."],
    ["Proveniência", "Cada resposta tem requestId (req_...) e respostaId (msg_...) devolvidos pela API da Anthropic, gravados em registro-chamadas.jsonl. A avaliação não possui fallback simulado: respostas sem esses identificadores seriam excluídas e contadas."],
  ]);

  L.garantir(doc, 170);
  L.paragrafo(doc, "Critérios de avaliação (escala inteira de 1 a 5)", { negrito: true, cor: COR.verde });
  L.tabela(doc, ["Critério", "Pergunta", "5 = ... | 3 = ... | 1 = ..."], [95, 205, 195], [
    ...["coerencia", "clareza", "relevancia", "ausenciaInvencao"].map((k) => [RUBRICA[k].titulo, RUBRICA[k].pergunta, "5: " + RUBRICA[k].ancoras[5] + " | 3: " + RUBRICA[k].ancoras[3] + " | 1: " + RUBRICA[k].ancoras[1]]),
    ["Consistência", "As duas execuções do mesmo cenário chegam à mesma conclusão?", "Calculada: nota = 1 + 4 x concordância (clima: nível geral e conjunto de riscos; mercado: mesma tendência)"],
  ]);

  // 4. Cálculo
  L.secao(doc, "4. Como a porcentagem é calculada");
  L.tabela(doc, ["Indicador", "Fórmula", "Resultado"], [130, 245, 120], [
    ["Índice de assertividade", "média das 5 notas de cada cenário, dividida por 5 (por módulo; geral ponderado pelo número de cenários)", "Clima " + pct(A.modulos.clima.indice) + " | Mercado " + pct(A.modulos.mercado.indice) + " | Geral " + pct(geral.indice)],
    ["Acerto objetivo", "respostas corretas dividido pelas respostas. Clima: nível geral e conjunto de riscos idênticos ao gabarito. Mercado: tendência igual ao gabarito", pct(geral.acertoObjetivo.pct, 0) + " (" + geral.acertoObjetivo.k + "/" + geral.acertoObjetivo.n + "), IC 95%: " + pct(geral.acertoObjetivo.ic95[0]) + " a " + pct(geral.acertoObjetivo.ic95[1], 0)],
    ["Respostas satisfatórias", "cenários com média das 5 notas maior ou igual a " + num(M.LIMITE_MEDIA_SATISFATORIO, 1) + " e nenhum critério abaixo de " + M.LIMITE_NOTA_MINIMA, pct(geral.satisfatorios.pct, 0) + " (" + geral.satisfatorios.k + "/" + geral.satisfatorios.n + "), IC 95%: " + pct(geral.satisfatorios.ic95[0]) + " a " + pct(geral.satisfatorios.ic95[1], 0)],
  ]);
  L.paragrafo(doc, "Os intervalos de confiança são de Wilson (95%) e mostram a incerteza de uma amostra pequena: com 30 cenários por módulo, 100% observado é compatível com um valor verdadeiro a partir de cerca de 94%.", { tamanho: 8 });

  // 5. Resultados
  L.secao(doc, "5. Resultados por módulo");
  for (const k of ["clima", "mercado"]) {
    const m = A.modulos[k];
    const obj = k === "clima" ? resumo.clima.objetivo : resumo.mercado.objetivo;
    L.paragrafo(doc, NOME_MODULO[k] + " (" + m.cenarios + " cenários, " + m.respostas + " respostas)", { negrito: true, cor: COR.verde });
    L.tabela(doc, ["Critério", "Média (1 a 5)", "Desvio-padrão", "% nota 4 ou mais"], [215, 85, 85, 110],
      ["coerencia", "clareza", "relevancia", "ausenciaInvencao", "consistencia"].map((c) => [ROTULO[c], num(m.criterios[c].media), num(m.criterios[c].desvio), pct(m.criterios[c].pctNota4ouMais)]));
    L.barrasH(doc, ["coerencia", "clareza", "relevancia", "ausenciaInvencao", "consistencia"].map((c) => ({ rotulo: ROTULO[c], valor: m.criterios[c].media, texto: num(m.criterios[c].media) })), k === "clima" ? COR.verde : COR.azul);
    if (k === "clima") {
      L.tabela(doc, ["Métrica objetiva (contra o motor de regras)", "Valor"], [395, 100], [
        ["Respostas em JSON válido", pct(obj.jsonValidoPct)], ["Nível geral correto", pct(obj.nivelGeralCorretoPct)],
        ["Conjunto de riscos idêntico ao do motor", pct(obj.conjuntoDeRiscosExatoPct)], ["Precisão dos riscos citados", pct(obj.precisaoRiscosPct)],
        ["Cobertura dos riscos do motor (recall)", pct(obj.recallRiscosPct)], ["Respostas com falso alarme", pct(obj.comFalsoAlarmePct)],
        ["Respostas citando número fora dos dados", pct(obj.comNumeroForaDoContextoPct)],
      ]);
    } else {
      const mc = obj.matrizConfusao;
      L.tabela(doc, ["Métrica objetiva (contra a regra de ±2%)", "Valor"], [395, 100], [
        ["Respostas em JSON válido", pct(obj.jsonValidoPct)], ["Tendência correta (alta, queda ou estável)", pct(obj.tendenciaCorretaPct)],
        ["Respostas citando número fora dos dados", pct(obj.comNumeroForaDoContextoPct)],
      ]);
      L.tabela(doc, ["Gabarito \\ Claude", "alta", "estável", "queda", "sem formato"], [155, 85, 85, 85, 85],
        ["alta", "estavel", "queda"].map((esp) => [esp === "estavel" ? "estável" : esp, ...["alta", "estavel", "queda", "sem_formato"].map((p) => (mc[esp] && mc[esp][p]) || 0)]));
    }
    const porCat = {};
    for (const c of cenarios.filter((x) => x.modulo === k && !x.excluido)) (porCat[c.categoria] = porCat[c.categoria] || []).push(c);
    L.tabela(doc, ["Categoria de cenário", "Cenários", "Média geral", "Satisfatórios"], [215, 85, 90, 105],
      Object.entries(porCat).map(([cat, ls]) => [cat, ls.length, num(ls.reduce((s, c) => s + c.notas.media, 0) / ls.length), ls.filter((c) => c.satisfatorio).length + " de " + ls.length]));
  }

  // 6. Exemplos reais
  L.secao(doc, "6. Exemplos reais de respostas");
  for (const k of ["clima", "mercado"]) {
    const ord = ordenar(k === "clima" ? clima : mercado);
    if (!ord.length) continue;
    L.paragrafo(doc, NOME_MODULO[k], { negrito: true, cor: COR.verde });
    exemploCenario(doc, "Maior nota", ord[0]);
    if (ord.length > 1) exemploCenario(doc, "Menor nota", ord[ord.length - 1]);
  }

  // 7. Proveniência e consumo
  L.secao(doc, "7. Proveniência e consumo da API");
  L.tabela(doc, ["Papel", "Modelo", "Chamadas ok", "Falhas", "Tokens de entrada", "Tokens de saída"], [60, 150, 70, 50, 85, 80],
    meta.chamadas.map((c) => [c.papel, c.modelo, c.ok, c.falhas, c.tokensEntrada.toLocaleString("pt-BR"), c.tokensSaida.toLocaleString("pt-BR")]));
  L.paragrafo(doc, "Total de chamadas registradas: " + registro.length + " (inclui o diagnóstico de autenticação). Execução em " + meta.executadoEm + ".", { tamanho: 8 });

  // 8. Limitações
  L.secao(doc, "8. Como interpretar e limitações");
  L.paragrafo(doc, [
    "- O índice de assertividade (" + pct(geral.indice) + ") resume a qualidade das respostas pelos cinco critérios; o acerto objetivo (" + pct(geral.acertoObjetivo.pct, 0) + ") mede apenas se a conclusão bate com o gabarito. São números diferentes e devem ser citados juntos.",
    "- O resultado está próximo do teto: a medição discrimina pouco entre respostas boas. O módulo climático é uma tarefa fácil porque o modelo recebe os alertas já calculados; o resultado mede fidelidade ao motor de regras, não verdade agronômica.",
    "- A menor média nos dois módulos foi a de 'ausência de informações inventadas' (" + num(A.modulos.clima.criterios.ausenciaInvencao.media) + " no clima e " + num(A.modulos.mercado.criterios.ausenciaInvencao.media) + " no mercado): detalhes sem base nos dados, como 'tutoragem', 'resistência técnica' ou 'mercado ainda busca direção'. Em seguida vêm relevância e clareza.",
    "- O avaliador é outro modelo de linguagem e pode ter vieses. O arquivo validacao-humana.csv traz uma amostra para a equipe pontuar à mão e comparar com o juiz.",
    "- São 30 cenários por módulo e duas execuções por cenário (amostra pequena). Os prompts foram refinados antes da medição; os números valem para as versões e o modelo indicados.",
    "- Cenários agronomicamente ambíguos ficaram de fora para o gabarito ser inequívoco. Para um teste mais exigente: incluí-los e retirar os alertas do contexto da IA climática.",
  ].join("\n"), { tamanho: 8.5 });

  L.rodapes(doc);
  doc.end();
  return fim.then(() => ({ buffer: Buffer.concat(partes), assertividade: A }));
}

async function principal() {
  const arg = process.argv.find((a) => a.startsWith("--pasta="));
  const pasta = arg ? path.resolve(arg.split("=")[1]) : pastaMaisRecente();
  const dados = lerDados(pasta);
  const { buffer, assertividade } = await montarPdf(dados);
  const saidaPasta = path.join(pasta, "relatorio-assertividade-ia.pdf");
  const docsDir = path.join(__dirname, "..", "..", "docs");
  fs.writeFileSync(saidaPasta, buffer);
  if (fs.existsSync(docsDir)) fs.writeFileSync(path.join(docsDir, "AVALIACAO_IA_RELATORIO.pdf"), buffer);
  const g = assertividade.geral;
  console.log("PDF gerado: " + saidaPasta);
  if (fs.existsSync(docsDir)) console.log("Cópia em: " + path.join(docsDir, "AVALIACAO_IA_RELATORIO.pdf"));
  console.log("Índice de assertividade: " + g.indice + "% | acerto objetivo: " + g.acertoObjetivo.pct + "% (" + g.acertoObjetivo.k + "/" + g.acertoObjetivo.n + ") | satisfatórias: " + g.satisfatorios.pct + "%");
}

if (require.main === module) {
  principal().catch((erro) => {
    console.error("Falha ao gerar o PDF:", erro.message);
    process.exit(1);
  });
}

module.exports = { montarPdf, lerDados, pastaMaisRecente };
