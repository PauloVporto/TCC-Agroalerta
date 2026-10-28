/**
 * Análise climática por IA (Claude) para um talhão.
 *
 * O modelo recebe apenas dados reais da leitura (Open-Meteo/OWM), os alertas já
 * calculados pelo motor de regras (rules.js) e os avisos do INMET. Ele traduz isso em
 * um parecer para o produtor; não busca dados por conta própria.
 *
 * interpretarClimaComIA   -> LANÇA erro se a API falhar (usada na avaliação de assertividade).
 * gerarAnaliseClimatica   -> usada pela rota; cai para um resumo determinístico, sempre
 *                            rotulado origem:"simulado", e nunca o apresenta como IA.
 */
const crypto = require("node:crypto");
const anthropic = require("./anthropic");
const { extrairJson } = require("./jsonIA");

const PROMPT_CLIMA_VERSAO = "clima-v1";
const TIPOS_RISCO = ["geada", "estiagem", "excesso_chuva", "vento", "chuva_colheita"];
const NIVEIS = ["baixo", "medio", "alto"];
const ORDEM_NIVEL = { baixo: 0, medio: 1, alto: 2 };
const CACHE_MS = 30 * 60 * 1000;

const NOMES_CULTURA = { cafe: "café arábica", soja: "soja", milho: "milho", cana: "cana-de-açúcar", feijao: "feijão" };

// Converte o id da regra (ex.: "cafe_geada", "cana_estiagem_prolongada") no tipo de risco.
function tipoDoAlerta(idRegra) {
  const id = String(idRegra || "");
  if (/geada/.test(id)) return "geada";
  if (/estiagem/.test(id)) return "estiagem";
  if (/excesso_chuva/.test(id)) return "excesso_chuva";
  if (/vento/.test(id)) return "vento";
  if (/chuva_colheita/.test(id)) return "chuva_colheita";
  return null;
}

function nivelGeralDosAlertas(alertas) {
  return (alertas || []).reduce((maior, a) => (ORDEM_NIVEL[a.nivel] > ORDEM_NIVEL[maior] ? a.nivel : maior), "baixo");
}

function montarContextoClima({ talhao, clima, alertas, alertasOficiais }) {
  const linhas = [
    "Talhão: " + talhao.nome + " (" + (NOMES_CULTURA[talhao.cultura] || talhao.cultura) + ", fase " + String(talhao.fase).replace(/_/g, " ") + ")",
    "Leitura meteorológica (fonte " + (clima.fonte || "desconhecida") + "):",
    "- Temperatura mínima prevista nos próximos 7 dias: " + clima.temperaturaMinima + " °C",
    "- Chuva acumulada prevista nos próximos 7 dias: " + clima.chuvaAcumulada7dias + " mm",
    "- Dias secos consecutivos até ontem: " + clima.diasSemChuva,
    "- Probabilidade máxima de chuva nos próximos 7 dias: " + clima.probabilidadeChuva7dias + "%",
    "- Vento máximo previsto: " + clima.ventoMaximoKmh + " km/h",
  ];
  if (typeof clima.evapotranspiracao7dias === "number") {
    linhas.push("- Evapotranspiração (ET0) prevista em 7 dias: " + clima.evapotranspiracao7dias + " mm");
  }
  linhas.push("Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):");
  if (alertas && alertas.length) {
    alertas.forEach((a) => linhas.push("- [" + a.nivel + "] " + a.titulo + ": " + a.mensagem + (a.janela ? " (janela: " + a.janela + ")" : "")));
  } else {
    linhas.push("- nenhum alerta disparado");
  }
  if (alertasOficiais && alertasOficiais.length) {
    linhas.push("Avisos oficiais do INMET para a região:");
    alertasOficiais.slice(0, 5).forEach((o) => linhas.push("- " + o.descricao + (o.janela ? " (" + o.janela + ")" : "")));
  }
  return linhas.join("\n");
}

function promptAnaliseClimatica(contexto) {
  return (
    "Você é o assistente de monitoramento climático do AgroAlerta, escrevendo para um produtor rural do Sul de Minas Gerais.\n" +
    "Interprete SOMENTE os dados abaixo: temperatura, chuva, vento e os alertas já calculados pelo motor de regras. " +
    "Não invente números, datas, eventos nem riscos que não constem nos dados. " +
    "Se nenhum alerta foi disparado, diga que não há risco relevante no momento.\n\n" +
    "Responda APENAS com JSON válido, sem markdown, neste formato:\n" +
    '{"nivelGeral":"baixo|medio|alto","resumo":"até 4 frases em português simples",' +
    '"riscos":[{"tipo":"geada|estiagem|excesso_chuva|vento|chuva_colheita","nivel":"medio|alto","justificativa":"1 frase usando os números dos dados"}],' +
    '"recomendacoes":["ação prática e curta"]}\n' +
    "Regras: liste em \"riscos\" apenas os riscos que constam nos alertas do motor de regras, mantendo o nível de cada um; " +
    "\"nivelGeral\" é o maior nível entre os riscos (\"baixo\" se não houver nenhum); " +
    "\"recomendacoes\" fica vazio quando não há risco.\n\n" +
    "Dados:\n" +
    contexto
  );
}

// Valida a forma da resposta. Devolve a análise normalizada ou null.
function validarAnalise(json) {
  if (!json || !NIVEIS.includes(json.nivelGeral) || typeof json.resumo !== "string" || !json.resumo.trim()) return null;
  if (!Array.isArray(json.riscos)) return null;
  const riscos = [];
  for (const r of json.riscos) {
    if (!r || !TIPOS_RISCO.includes(r.tipo) || !NIVEIS.includes(r.nivel)) return null;
    riscos.push({ tipo: r.tipo, nivel: r.nivel, justificativa: typeof r.justificativa === "string" ? r.justificativa.trim() : "" });
  }
  const recomendacoes = Array.isArray(json.recomendacoes) ? json.recomendacoes.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  return { nivelGeral: json.nivelGeral, resumo: json.resumo.trim(), riscos, recomendacoes };
}

async function interpretarClimaComIA(entrada) {
  const contexto = montarContextoClima(entrada);
  const prompt = promptAnaliseClimatica(contexto);
  const { texto, dados, requestId } = await anthropic.mensagens({
    model: anthropic.MODELO_ANALISE,
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  });
  const analise = validarAnalise(extrairJson(texto));
  return {
    analise,
    formatoValido: Boolean(analise),
    textoBruto: texto,
    modelo: dados.model,
    respostaId: dados.id,
    requestId,
    uso: dados.usage || null,
    promptVersao: PROMPT_CLIMA_VERSAO,
    contexto,
    prompt,
  };
}

function analiseDeterministica({ clima, alertas }) {
  const lista = alertas || [];
  const resumo = lista.length
    ? lista.map((a) => a.titulo + ": " + a.mensagem).join(" ")
    : "Sem alertas ativos. Mínima prevista de " + clima.temperaturaMinima + " °C, chuva de " + clima.chuvaAcumulada7dias +
      " mm em 7 dias e vento máximo de " + clima.ventoMaximoKmh + " km/h.";
  return {
    nivelGeral: nivelGeralDosAlertas(lista),
    resumo,
    riscos: lista.filter((a) => tipoDoAlerta(a.id)).map((a) => ({ tipo: tipoDoAlerta(a.id), nivel: a.nivel, justificativa: a.mensagem })),
    recomendacoes: [...new Set(lista.map((a) => a.recomendacao).filter(Boolean))],
  };
}

const cache = new Map();

async function gerarAnaliseClimatica(entrada, { forcar = false } = {}) {
  const geradoEm = new Date().toISOString();
  const simulado = (ia) => ({
    origem: "simulado",
    analise: analiseDeterministica(entrada),
    ia,
    promptVersao: PROMPT_CLIMA_VERSAO,
    geradoEm,
  });

  if (!anthropic.chaveConfigurada()) return simulado(anthropic.estadoFalha({ codigo: "nao_configurada" }));

  const contexto = montarContextoClima(entrada);
  const chave = entrada.talhao.id + ":" + crypto.createHash("sha1").update(contexto).digest("hex");
  const guardado = cache.get(chave);
  if (!forcar && guardado && Date.now() - guardado.ts < CACHE_MS) return { ...guardado.valor, emCache: true };

  try {
    const r = await interpretarClimaComIA(entrada);
    const valor = {
      origem: "anthropic",
      formatoValido: r.formatoValido,
      // Se o JSON vier fora do formato, mostra o texto do modelo e o nível calculado pelas regras.
      analise: r.analise || { nivelGeral: nivelGeralDosAlertas(entrada.alertas), resumo: r.textoBruto, riscos: [], recomendacoes: [] },
      modelo: r.modelo,
      respostaId: r.respostaId,
      requestId: r.requestId,
      promptVersao: r.promptVersao,
      geradoEm,
    };
    cache.set(chave, { ts: Date.now(), valor });
    return valor;
  } catch (erro) {
    const ia = anthropic.estadoFalha(erro);
    console.error("[climaIA] IA indisponível:", ia.codigo);
    return simulado(ia);
  }
}

function limparCache() {
  cache.clear();
}

module.exports = {
  PROMPT_CLIMA_VERSAO, TIPOS_RISCO, NIVEIS,
  tipoDoAlerta, nivelGeralDosAlertas, montarContextoClima, promptAnaliseClimatica, validarAnalise,
  interpretarClimaComIA, gerarAnaliseClimatica, limparCache,
};
