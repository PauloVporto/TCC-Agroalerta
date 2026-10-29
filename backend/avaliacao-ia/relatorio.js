/**
 * Geração do relatório (Markdown) e das planilhas (CSV) da avaliação de assertividade.
 */
const { CRITERIOS, LIMITE_MEDIA_SATISFATORIO, LIMITE_NOTA_MINIMA, arred } = require("./metricas");
const { RUBRICA } = require("./criterios");

const ROTULO = {
  coerencia: "Coerência",
  clareza: "Clareza",
  relevancia: "Relevância",
  ausenciaInvencao: "Ausência de informações inventadas",
  consistencia: "Consistência (entre 2 execuções)",
};

const num = (v, c = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }));
const pct = (v) => (v == null ? "—" : num(v, 1) + "%");

function csv(colunas, linhas) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "﻿" + [colunas.join(";"), ...linhas.map((l) => colunas.map((c) => esc(l[c])).join(";"))].join("\n") + "\n";
}

function tabelaCriterios(resumo) {
  const linhas = CRITERIOS.map((c) => {
    const r = resumo.criterios[c];
    return "| " + ROTULO[c] + " | " + num(r.media) + " | " + num(r.desvio) + " | " + pct(r.pctNota4ouMais) + " |";
  });
  return [
    "| Critério | Média (1–5) | Desvio-padrão | % de cenários com nota ≥ 4 |",
    "|---|---:|---:|---:|",
    ...linhas,
    "| **Média geral** | **" + num(resumo.mediaGeral) + "** | | |",
  ].join("\n");
}

function linhaSatisfatorias(resumo) {
  const s = resumo.satisfatorios;
  return "**Respostas satisfatórias:** " + s.k + " de " + s.n + " cenários (**" + pct(s.pct) + "**; IC 95%: " + pct(s.ic95[0]) + " a " + pct(s.ic95[1]) + "). " +
    "Critério: média dos cinco critérios ≥ " + num(LIMITE_MEDIA_SATISFATORIO, 1) + " e nenhum critério abaixo de " + LIMITE_NOTA_MINIMA + ".";
}

function tabelaCategorias(cenarios) {
  const por = {};
  for (const c of cenarios) (por[c.categoria] = por[c.categoria] || []).push(c);
  const linhas = Object.entries(por).map(([cat, lista]) => {
    const m = lista.reduce((s, c) => s + c.notas.media, 0) / lista.length;
    return "| " + cat + " | " + lista.length + " | " + num(m) + " | " + lista.filter((c) => c.satisfatorio).length + " de " + lista.length + " |";
  });
  return ["| Categoria | Cenários | Média geral | Satisfatórios |", "|---|---:|---:|---:|", ...linhas].join("\n");
}

function citacao(texto, max = 700) {
  const t = String(texto || "").replace(/\s+\n/g, "\n").trim();
  const corte = t.length > max ? t.slice(0, max) + "…" : t;
  return corte.split("\n").map((l) => "> " + l).join("\n");
}

function exemplo(c, titulo) {
  const e = c.execucoes.find((x) => !x.excluida);
  const j = e.juiz;
  const linhasNotas = ["coerencia", "clareza", "relevancia", "ausenciaInvencao"]
    .map((k) => "  - " + ROTULO[k] + ": **" + c.notas[k] + "** — " + (j.justificativas[k] || "sem justificativa"))
    .join("\n");
  return [
    "**" + titulo + " — " + c.id + "** (" + c.categoria + "): " + c.descricao,
    "",
    "Dados enviados ao modelo:",
    citacao(c.dadosEntrada, 900),
    "",
    "Resposta do Claude (execução " + e.execucao + "; requestId `" + e.proveniencia.requestId + "`):",
    citacao(e.textoAvaliado || e.textoBruto),
    "",
    "- Gabarito: " + c.gabarito,
    "- Notas (média " + num(c.notas.media) + (c.satisfatorio ? ", satisfatória" : ", não satisfatória") + "):",
    linhasNotas,
    "  - " + ROTULO.consistencia + ": **" + num(c.notas.consistencia) + "** (concordância " + pct(c.consistencia.concordancia * 100) + ")",
    "",
  ].join("\n");
}

function exemplos(cenarios) {
  if (!cenarios.length) return "_Sem cenários válidos._\n";
  const ordenados = [...cenarios].sort((a, b) => b.notas.media - a.notas.media || a.id.localeCompare(b.id));
  const melhores = ordenados.slice(0, 3);
  const piores = ordenados.slice(-3).reverse().filter((c) => !melhores.includes(c));
  return [
    ...melhores.map((c, i) => exemplo(c, "Melhor " + (i + 1))),
    ...piores.map((c, i) => exemplo(c, "Pior " + (i + 1))),
  ].join("\n");
}

function secaoClima({ resumo, objetivo, cenarios, excluidos }) {
  return [
    "## 2. Monitoramento climático (n = " + resumo.n + " cenários, " + objetivo.respostas + " respostas)",
    "",
    "### Notas por critério",
    "",
    tabelaCriterios(resumo),
    "",
    linhaSatisfatorias(resumo),
    "",
    "### Métricas objetivas (contra o gabarito do motor de regras)",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    "| Respostas em JSON válido | " + pct(objetivo.jsonValidoPct) + " |",
    "| Nível geral correto | " + pct(objetivo.nivelGeralCorretoPct) + " |",
    "| Conjunto de riscos idêntico ao do motor | " + pct(objetivo.conjuntoDeRiscosExatoPct) + " |",
    "| Precisão dos riscos citados | " + pct(objetivo.precisaoRiscosPct) + " |",
    "| Cobertura (recall) dos riscos do motor | " + pct(objetivo.recallRiscosPct) + " |",
    "| Respostas com falso alarme (risco sem alerta) | " + pct(objetivo.comFalsoAlarmePct) + " |",
    "| Respostas citando número fora dos dados | " + pct(objetivo.comNumeroForaDoContextoPct) + " |",
    "",
    "### Por categoria de cenário",
    "",
    tabelaCategorias(cenarios),
    "",
    excluidos.length ? "Cenários excluídos (não entram nas médias): " + excluidos.map((c) => c.id + " (" + c.motivoExclusao + ")").join(", ") + ".\n" : "Nenhum cenário excluído.\n",
    "### Exemplos reais",
    "",
    exemplos(cenarios),
  ].join("\n");
}

function secaoMercado({ resumo, objetivo, cenarios, excluidos }) {
  const matriz = objetivo.matrizConfusao;
  const previstos = ["alta", "estavel", "queda", "sem_formato"];
  const linhasMatriz = ["alta", "estavel", "queda"].map((esp) =>
    "| " + esp + " | " + previstos.map((p) => (matriz[esp] && matriz[esp][p]) || 0).join(" | ") + " |");
  return [
    "## 3. Mercado (n = " + resumo.n + " cenários, " + objetivo.respostas + " respostas)",
    "",
    "### Notas por critério",
    "",
    tabelaCriterios(resumo),
    "",
    linhaSatisfatorias(resumo),
    "",
    "### Métricas objetivas (contra a regra de classificação ±" + 2 + "%)",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    "| Respostas em JSON válido | " + pct(objetivo.jsonValidoPct) + " |",
    "| Tendência correta (alta, queda ou estável) | " + pct(objetivo.tendenciaCorretaPct) + " |",
    "| Respostas citando número fora dos dados | " + pct(objetivo.comNumeroForaDoContextoPct) + " |",
    "",
    "Matriz de confusão (linhas = gabarito; colunas = resposta do Claude):",
    "",
    "| Gabarito \\ Claude | alta | estável | queda | sem formato |",
    "|---|---:|---:|---:|---:|",
    ...linhasMatriz,
    "",
    "### Por categoria de cenário",
    "",
    tabelaCategorias(cenarios),
    "",
    excluidos.length ? "Cenários excluídos (não entram nas médias): " + excluidos.map((c) => c.id + " (" + c.motivoExclusao + ")").join(", ") + ".\n" : "Nenhum cenário excluído.\n",
    "### Exemplos reais",
    "",
    exemplos(cenarios),
  ].join("\n");
}

function secaoProveniencia(meta) {
  const linhas = meta.chamadas.map((c) =>
    "| " + c.papel + " | " + c.modelo + " | " + c.ok + " | " + c.falhas + " | " + c.tokensEntrada.toLocaleString("pt-BR") + " | " + c.tokensSaida.toLocaleString("pt-BR") + " |");
  return [
    "## 1. Proveniência das respostas",
    "",
    "Cada resposta avaliada tem `requestId` (`req_…`) e `respostaId` (`msg_…`) devolvidos pela API da Anthropic, gravados em `registro-chamadas.jsonl`. " +
      "A avaliação chama as funções que lançam erro quando a API falha: **não existe caminho de fallback simulado**, então nenhuma resposta simulada foi avaliada como se fosse do Claude. " +
      "Respostas sem identificadores válidos ou com falha da API são excluídas e contadas abaixo.",
    "",
    "| Papel | Modelo | Chamadas bem-sucedidas | Falhas da API | Tokens de entrada | Tokens de saída |",
    "|---|---|---:|---:|---:|---:|",
    ...linhas,
    "",
    "- Respostas geradas e comprovadas como da API: **" + meta.respostasComprovadas + "**",
    "- Respostas excluídas (falha da API, origem não comprovada ou juiz sem resposta válida): **" + meta.respostasExcluidas + "**",
    "- Respostas simuladas avaliadas: **0**",
    "",
  ].join("\n");
}

const LIMITACOES = [
  "O gabarito do módulo climático é calculado pelo motor de regras do AgroAlerta, e o modelo recebe esses alertas no contexto. Portanto o resultado mede a **fidelidade da interpretação ao motor**, não a verdade agronômica.",
  "O avaliador é outro LLM (modelo diferente do avaliado, temperatura 0). Pode ter vieses próprios; por isso o arquivo `validacao-humana.csv` traz uma amostra para a equipe pontuar e comparar com o juiz.",
  "São 30 cenários por módulo, amostra pequena: os intervalos de confiança de Wilson mostram a incerteza dos percentuais. O desvio entre execuções (consistência) é medido com apenas 2 repetições por cenário.",
  "Os prompts foram refinados antes da medição (versões registradas nos metadados). Os números valem para as versões indicadas e o modelo informado.",
  "Cenários agronomicamente ambíguos foram deixados de fora de propósito para o gabarito ser inequívoco; o desempenho em situações ambíguas não foi medido.",
];

function gerarRelatorio({ meta, clima, mercado }) {
  const partes = [
    "# Avaliação de assertividade da IA (Claude) — AgroAlerta",
    "",
    "- Executado em: " + meta.executadoEm,
    "- Modelo avaliado: `" + meta.modeloAvaliado + "` (prompts: " + meta.promptVersoes.join(", ") + ")",
    "- Modelo avaliador (juiz): `" + meta.modeloJuiz + "`, temperatura 0",
    "- Cenários: " + (clima ? clima.resumo.n : 0) + " climáticos e " + (mercado ? mercado.resumo.n : 0) + " de mercado; " + meta.execucoes + " execuções por cenário",
    "- Critérios: coerência, clareza, relevância, ausência de informações inventadas e consistência (escala 1–5)",
    "",
    "Definição dos critérios:",
    ...Object.entries(RUBRICA).map(([, r]) => "- **" + r.titulo + "**: " + r.pergunta),
    "- **Consistência**: concordância entre as " + meta.execucoes + " execuções do mesmo cenário (nível geral e riscos no clima; mesma tendência no mercado), convertida para a escala 1–5.",
    "",
    secaoProveniencia(meta),
  ];
  if (clima) partes.push(secaoClima(clima));
  if (mercado) partes.push(secaoMercado(mercado));
  partes.push("## 4. Limitações", "", ...LIMITACOES.map((l) => "- " + l), "",
    "## 5. Como reproduzir", "",
    "```",
    "cd backend",
    "npm run ia:avaliar            # 30 + 30 cenários, 2 execuções cada",
    "npm run ia:avaliar -- --piloto # 2 cenários por módulo, para validar o funcionamento",
    "```", "");
  return partes.join("\n");
}

function planilhaResultados(cenarios) {
  const colunas = ["modulo", "cenario", "categoria", "descricao", "incluido", "motivo_exclusao", "coerencia", "clareza", "relevancia", "ausencia_invencao", "consistencia", "media", "satisfatorio", "gabarito", "request_ids"];
  const linhas = cenarios.map((c) => ({
    modulo: c.modulo, cenario: c.id, categoria: c.categoria, descricao: c.descricao,
    incluido: c.excluido ? "nao" : "sim", motivo_exclusao: c.motivoExclusao || "",
    coerencia: c.notas ? num(c.notas.coerencia) : "", clareza: c.notas ? num(c.notas.clareza) : "",
    relevancia: c.notas ? num(c.notas.relevancia) : "", ausencia_invencao: c.notas ? num(c.notas.ausenciaInvencao) : "",
    consistencia: c.notas ? num(c.notas.consistencia) : "", media: c.notas ? num(c.notas.media) : "",
    satisfatorio: c.excluido ? "" : c.satisfatorio ? "sim" : "nao",
    gabarito: c.gabarito, request_ids: c.execucoes.map((e) => (e.proveniencia ? e.proveniencia.requestId : "")).join(" | "),
  }));
  return csv(colunas, linhas);
}

function planilhaHumana(cenarios, porModulo = 10) {
  const colunas = ["modulo", "cenario", "descricao", "dados_enviados", "resposta_do_claude", "coerencia_1a5", "clareza_1a5", "relevancia_1a5", "ausencia_invencao_1a5", "observacoes"];
  const linhas = [];
  for (const modulo of ["clima", "mercado"]) {
    const validos = cenarios.filter((c) => c.modulo === modulo && !c.excluido);
    const passo = Math.max(1, Math.floor(validos.length / porModulo));
    validos.filter((_, i) => i % passo === 0).slice(0, porModulo).forEach((c) => {
      const e = c.execucoes.find((x) => !x.excluida);
      linhas.push({ modulo, cenario: c.id, descricao: c.descricao, dados_enviados: c.dadosEntrada, resposta_do_claude: e.textoAvaliado || e.textoBruto });
    });
  }
  return csv(colunas, linhas);
}

module.exports = { gerarRelatorio, planilhaResultados, planilhaHumana, csv, arred };
