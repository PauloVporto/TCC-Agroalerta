#!/usr/bin/env node
/**
 * Avaliação de assertividade da IA (Claude) nos módulos de clima e mercado.
 *
 *   npm run ia:avaliar                     30 + 30 cenários, 2 execuções cada
 *   npm run ia:avaliar -- --piloto         2 cenários por módulo (valida o funcionamento)
 *   npm run ia:avaliar -- --modulo=clima   só um módulo
 *
 * Só mede respostas REAIS da API Anthropic: não há fallback simulado neste fluxo.
 * Cada chamada (geração e juiz) é registrada em registro-chamadas.jsonl com requestId e respostaId.
 */
const path = require("node:path");
const fs = require("node:fs");
// O .env precisa ser lido antes de importar os serviços (o modelo é resolvido na importação).
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const anthropic = require("../services/anthropic");
const climaIA = require("../services/climaIA");
const market = require("../services/market");
const { julgar, modeloJuiz } = require("./juiz");
const { CRITERIOS_JULGADOS } = require("./criterios");
const M = require("./metricas");
const { CENARIOS_CLIMA } = require("./cenarios-clima");
const { CENARIOS_MERCADO } = require("./cenarios-mercado");
const relatorio = require("./relatorio");

const PILOTO = { clima: ["C02", "S10"], mercado: ["MC01", "MC15"] };
const RETENTAVEIS = new Set(["limite", "tempo_limite", "provedor", "rede", "juiz_formato_invalido"]);
const DESCRICAO_MODULO = {
  clima: "monitoramento climático: o assistente interpreta temperatura, chuva, vento e os alertas do motor de regras de um talhão e devolve um parecer ao produtor.",
  mercado: "mercado agrícola: o assistente interpreta uma série de preços e diz se o produto está em alta, queda ou estável.",
};

function lerArgs(argv) {
  const a = { piloto: false, modulo: "todos", execucoes: 2, concorrencia: 3, saida: null };
  for (const arg of argv) {
    if (arg === "--piloto") a.piloto = true;
    else if (arg.startsWith("--modulo=")) a.modulo = arg.split("=")[1];
    else if (arg.startsWith("--execucoes=")) a.execucoes = Number(arg.split("=")[1]);
    else if (arg.startsWith("--concorrencia=")) a.concorrencia = Number(arg.split("=")[1]);
    else if (arg.startsWith("--saida=")) a.saida = arg.split("=")[1];
  }
  if (!["todos", "clima", "mercado"].includes(a.modulo)) throw new Error("--modulo deve ser clima, mercado ou todos");
  if (!Number.isInteger(a.execucoes) || a.execucoes < 2 || a.execucoes > 5) throw new Error("--execucoes deve ficar entre 2 e 5 (a consistência precisa de pares)");
  if (!Number.isInteger(a.concorrencia) || a.concorrencia < 1 || a.concorrencia > 8) throw new Error("--concorrencia deve ficar entre 1 e 8");
  return a;
}

const tokensEnxutos = (u) => (u ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens } : null);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function comConcorrencia(itens, limite, fn) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await fn(itens[i], i);
    }
  }));
  return resultados;
}

function principalComContexto(args) {
  const agora = new Date();
  const carimbo = agora.toISOString().replace(/[:T]/g, "-").slice(0, 19) + (args.piloto ? "_piloto" : "");
  const pasta = args.saida || path.join(__dirname, "resultados", carimbo);
  fs.mkdirSync(pasta, { recursive: true });
  const arquivoRegistro = path.join(pasta, "registro-chamadas.jsonl");
  fs.writeFileSync(arquivoRegistro, "");
  const chamadas = [];

  function registrar(entrada) {
    const linha = { ts: new Date().toISOString(), ...entrada };
    chamadas.push(linha);
    fs.appendFileSync(arquivoRegistro, JSON.stringify(linha) + "\n");
  }

  // Executa uma chamada à API com até 3 tentativas para falhas transitórias; registra cada tentativa.
  async function chamar(descricao, fn) {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const r = await fn();
        return r;
      } catch (erro) {
        registrar({ ...descricao, tentativa, status: "falha_api", codigo: erro.codigo || "desconhecido", httpStatus: erro.status || null, requestId: erro.requestId || null });
        if (!RETENTAVEIS.has(erro.codigo) || tentativa === 3) throw erro;
        await dormir(2000 * tentativa);
      }
    }
    throw new Error("inalcançável");
  }

  return { pasta, carimbo, agora, chamadas, registrar, chamar };
}

function gabaritoClima(cenario) {
  const riscos = cenario.entrada.alertas.map((a) => climaIA.tipoDoAlerta(a.id) + " (" + a.nivel + ")").filter((t) => !t.startsWith("null"));
  return riscos.length
    ? "Nível geral esperado: " + cenario.esperado.nivelGeral + ". Riscos esperados (tipo, nível): " + riscos.join("; ") + "."
    : "Nenhum risco esperado; nível geral baixo.";
}

function gabaritoMercado(cenario) {
  return "Tendência esperada pela regra: " + cenario.esperado.tendencia + " (variação líquida de " + cenario.esperado.variacaoPercentual +
    "%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: " + cenario.descricao + ".";
}

// Texto que o produtor realmente lê: o JSON técnico é convertido em texto antes de ser julgado.
function textoExibido(modulo, g) {
  if (!g.formatoValido) return g.textoBruto;
  if (modulo === "mercado") return "Tendência: " + g.tendencia + "\nResumo: " + g.resumo;
  const a = g.analise;
  return [
    "Nível geral: " + a.nivelGeral,
    "Resumo: " + a.resumo,
    a.riscos.length ? "Riscos:\n" + a.riscos.map((r) => "- " + r.tipo + " (" + r.nivel + "): " + r.justificativa).join("\n") : "Riscos: nenhum",
    a.recomendacoes.length ? "Recomendações:\n" + a.recomendacoes.map((t) => "- " + t).join("\n") : "Recomendações: nenhuma",
  ].join("\n");
}

async function gerarResposta(modulo, cenario) {
  if (modulo === "clima") {
    const r = await climaIA.interpretarClimaComIA(cenario.entrada);
    return {
      textoBruto: r.textoBruto, formatoValido: r.formatoValido, analise: r.analise, tendencia: null, resumo: null,
      dadosEntrada: r.contexto, promptVersao: r.promptVersao,
      proveniencia: { modelo: r.modelo, requestId: r.requestId, respostaId: r.respostaId, uso: r.uso },
    };
  }
  const r = await market.interpretarSerieComIA(cenario.entrada);
  return {
    textoBruto: r.textoBruto, formatoValido: r.formatoValido, analise: null, tendencia: r.tendencia, resumo: r.resumo,
    dadosEntrada: r.prompt.split("Dados:\n")[1] || r.prompt, promptVersao: r.promptVersao,
    proveniencia: { modelo: r.modelo, requestId: r.requestId, respostaId: r.respostaId, uso: r.uso },
  };
}

async function avaliarCenario(modulo, cenario, ctx, execucoes) {
  const gabarito = modulo === "clima" ? gabaritoClima(cenario) : gabaritoMercado(cenario);
  const registro = {
    id: cenario.id, modulo, categoria: cenario.categoria, descricao: cenario.descricao,
    esperado: cenario.esperado, gabarito, dadosEntrada: null, execucoes: [],
  };

  for (let e = 1; e <= execucoes; e++) {
    const base = { modulo, cenarioId: cenario.id, execucao: e };
    const exec = { execucao: e, excluida: false };
    try {
      const g = await ctx.chamar({ ...base, papel: "geracao", modeloSolicitado: anthropic.MODELO_ANALISE }, () => gerarResposta(modulo, cenario));
      registro.dadosEntrada = registro.dadosEntrada || g.dadosEntrada;
      const comprovada = M.origemComprovada(g.proveniencia);
      ctx.registrar({
        ...base, papel: "geracao", status: "ok", origem: comprovada ? "anthropic_api" : "nao_comprovada",
        modelo: g.proveniencia.modelo, requestId: g.proveniencia.requestId, respostaId: g.proveniencia.respostaId,
        tokens: tokensEnxutos(g.proveniencia.uso), promptVersao: g.promptVersao, formatoValido: g.formatoValido,
      });
      g.textoAvaliado = textoExibido(modulo, g);
      Object.assign(exec, { textoAvaliado: g.textoAvaliado, textoBruto: g.textoBruto, formatoValido: g.formatoValido, analise: g.analise, tendencia: g.tendencia, promptVersao: g.promptVersao, proveniencia: g.proveniencia });
      if (!comprovada) {
        exec.excluida = true; exec.motivo = "origem_nao_comprovada";
        registro.execucoes.push(exec);
        continue;
      }
      if (modulo === "clima") {
        exec.objetivo = M.objetivoClima({ alertas: cenario.entrada.alertas, analise: g.analise });
        exec.numerosSuspeitos = M.numerosSuspeitos(g.textoAvaliado, M.conjuntoPermitido(g.dadosEntrada));
      } else {
        exec.objetivo = M.objetivoMercado({ esperado: cenario.esperado, tendencia: g.tendencia, formatoValido: g.formatoValido });
        exec.numerosSuspeitos = M.numerosSuspeitos(g.textoAvaliado, M.conjuntoPermitido(g.dadosEntrada, M.derivadosMercado(cenario.entrada.serie)));
      }
      const j = await ctx.chamar({ ...base, papel: "juiz", modeloSolicitado: modeloJuiz() }, () => julgar({
        descricaoModulo: DESCRICAO_MODULO[modulo], dadosEntrada: g.dadosEntrada, gabarito,
        pontosChave: cenario.pontosChave, naoDeve: cenario.naoDeve, textoResposta: g.textoAvaliado, numerosSuspeitos: exec.numerosSuspeitos,
      }));
      ctx.registrar({ ...base, papel: "juiz", status: "ok", origem: M.origemComprovada(j.proveniencia) ? "anthropic_api" : "nao_comprovada", modelo: j.proveniencia.modelo, requestId: j.proveniencia.requestId, respostaId: j.proveniencia.respostaId, tokens: tokensEnxutos(j.proveniencia.uso) });
      if (!M.origemComprovada(j.proveniencia)) { exec.excluida = true; exec.motivo = "juiz_origem_nao_comprovada"; }
      exec.juiz = { notas: j.notas, justificativas: j.justificativas, proveniencia: j.proveniencia };
    } catch (erro) {
      exec.excluida = true;
      exec.motivo = "falha:" + (erro.codigo || erro.message);
    }
    registro.execucoes.push(exec);
  }

  const validas = registro.execucoes.filter((x) => !x.excluida);
  if (validas.length < execucoes) {
    registro.excluido = true;
    registro.motivoExclusao = registro.execucoes.filter((x) => x.excluida).map((x) => "exec" + x.execucao + ": " + x.motivo).join("; ");
    return registro;
  }

  const notas = {};
  for (const c of CRITERIOS_JULGADOS) notas[c] = M.arred(M.media(validas.map((x) => x.juiz.notas[c])));
  const pares = [];
  for (let i = 0; i < validas.length; i++) for (let k = i + 1; k < validas.length; k++) pares.push([validas[i], validas[k]]);
  const concordancia = M.media(pares.map(([a, b]) => modulo === "clima" ? M.concordanciaClima(a.analise, b.analise) : M.concordanciaMercado(a.tendencia, b.tendencia)));
  notas.consistencia = M.notaConsistencia(concordancia);
  notas.media = M.arred(M.media(M.CRITERIOS.map((c) => notas[c])));
  registro.notas = notas;
  registro.consistencia = { concordancia: M.arred(concordancia, 3) };
  registro.satisfatorio = M.satisfatorio(notas);
  return registro;
}

function resumirChamadas(chamadas) {
  const grupos = new Map();
  for (const c of chamadas) {
    const modelo = c.modelo || c.modeloSolicitado || "—";
    const chave = c.papel + "|" + modelo;
    const g = grupos.get(chave) || { papel: c.papel, modelo, ok: 0, falhas: 0, tokensEntrada: 0, tokensSaida: 0 };
    if (c.status === "ok") {
      g.ok++;
      g.tokensEntrada += (c.tokens && c.tokens.input_tokens) || 0;
      g.tokensSaida += (c.tokens && c.tokens.output_tokens) || 0;
    } else {
      g.falhas++;
    }
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort((a, b) => a.papel.localeCompare(b.papel));
}

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  if (!anthropic.chaveConfigurada()) {
    console.error("ANTHROPIC_API_KEY ausente em backend/.env. A avaliação só mede respostas reais da API; nada será simulado.");
    process.exit(1);
  }
  const ctx = principalComContexto(args);

  const auth = await anthropic.verificarAutenticacao().catch((e) => ({ erro: anthropic.estadoFalha(e).mensagem }));
  if (auth.erro) {
    console.error("Autenticação Anthropic falhou: " + auth.erro);
    process.exit(1);
  }
  ctx.registrar({ papel: "diagnostico", status: "ok", detalhe: "GET /v1/models autenticado", requestId: auth.requestId });

  const modulos = args.modulo === "todos" ? ["clima", "mercado"] : [args.modulo];
  console.log("Modelo avaliado: " + anthropic.MODELO_ANALISE + " | juiz: " + modeloJuiz() + " | execuções por cenário: " + args.execucoes);

  const todos = [];
  for (const modulo of modulos) {
    let lista = modulo === "clima" ? CENARIOS_CLIMA : CENARIOS_MERCADO;
    if (args.piloto) lista = lista.filter((c) => PILOTO[modulo].includes(c.id));
    console.log("\n== " + modulo + ": " + lista.length + " cenário(s) ==");
    const feitos = await comConcorrencia(lista, args.concorrencia, async (cenario) => {
      const r = await avaliarCenario(modulo, cenario, ctx, args.execucoes);
      console.log("  " + r.id + " " + (r.excluido ? "EXCLUÍDO (" + r.motivoExclusao + ")" : "média " + r.notas.media + (r.satisfatorio ? " ✓" : " ✗")));
      return r;
    });
    todos.push(...feitos);
  }

  const fatiar = (modulo) => {
    const dosModulo = todos.filter((c) => c.modulo === modulo);
    const incluidos = dosModulo.filter((c) => !c.excluido);
    if (!dosModulo.length) return null;
    const respostas = incluidos.flatMap((c) => c.execucoes.filter((e) => !e.excluida).map((e) => ({ objetivo: e.objetivo, numerosSuspeitos: e.numerosSuspeitos, esperado: c.esperado })));
    return {
      resumo: M.resumirModulo(incluidos),
      objetivo: modulo === "clima" ? M.resumirObjetivoClima(respostas) : M.resumirObjetivoMercado(respostas),
      cenarios: incluidos,
      excluidos: dosModulo.filter((c) => c.excluido),
    };
  };
  const clima = fatiar("clima");
  const mercado = fatiar("mercado");

  const geracoesOk = ctx.chamadas.filter((c) => c.papel === "geracao" && c.status === "ok" && c.origem === "anthropic_api").length;
  const execucoesExcluidas = todos.flatMap((c) => c.execucoes).filter((e) => e.excluida).length;
  const meta = {
    executadoEm: ctx.agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    modeloAvaliado: anthropic.MODELO_ANALISE,
    modeloJuiz: modeloJuiz(),
    promptVersoes: [climaIA.PROMPT_CLIMA_VERSAO, market.PROMPT_MERCADO_VERSAO],
    execucoes: args.execucoes,
    chamadas: resumirChamadas(ctx.chamadas.filter((c) => c.papel === "geracao" || c.papel === "juiz")),
    respostasComprovadas: geracoesOk,
    respostasExcluidas: execucoesExcluidas,
  };

  fs.writeFileSync(path.join(ctx.pasta, "respostas.json"), JSON.stringify(todos, null, 2));
  fs.writeFileSync(path.join(ctx.pasta, "resumo.json"), JSON.stringify({ meta, clima: clima && { resumo: clima.resumo, objetivo: clima.objetivo }, mercado: mercado && { resumo: mercado.resumo, objetivo: mercado.objetivo } }, null, 2));
  fs.writeFileSync(path.join(ctx.pasta, "resultados.csv"), relatorio.planilhaResultados(todos));
  fs.writeFileSync(path.join(ctx.pasta, "validacao-humana.csv"), relatorio.planilhaHumana(todos));
  fs.writeFileSync(path.join(ctx.pasta, "relatorio.md"), relatorio.gerarRelatorio({ meta, clima, mercado }));

  console.log("\nResultados em: " + ctx.pasta);
  for (const [nome, m] of [["clima", clima], ["mercado", mercado]]) {
    if (!m) continue;
    console.log(nome + ": média geral " + m.resumo.mediaGeral + " | satisfatórias " + m.resumo.satisfatorios.k + "/" + m.resumo.satisfatorios.n + " (" + m.resumo.satisfatorios.pct + "%) | excluídos " + m.excluidos.length);
  }
  console.log("Respostas comprovadas da API: " + geracoesOk + " | excluídas: " + execucoesExcluidas);
}

if (require.main === module) {
  principal().catch((erro) => {
    console.error("Falha na avaliação:", erro.message);
    process.exit(1);
  });
}

module.exports = { lerArgs, gabaritoClima, gabaritoMercado, resumirChamadas };
