#!/usr/bin/env node
/**
 * Gera docs/APENDICE_PROMPTS.md com os prompts LITERAIS enviados à IA (mercado, clima e avaliador),
 * montados pelas mesmas funções do sistema, com cenários reais da avaliação como exemplo.
 * Como o texto vem do código, o apêndice nunca diverge do que foi enviado.
 *
 *   npm run ia:prompts
 */
const fs = require("node:fs");
const path = require("node:path");
const anthropic = require("../services/anthropic");
const market = require("../services/market");
const climaIA = require("../services/climaIA");
const { promptJuiz } = require("./criterios");
const { modeloJuiz } = require("./juiz");
const { CENARIOS_CLIMA } = require("./cenarios-clima");
const { CENARIOS_MERCADO } = require("./cenarios-mercado");
const { pastaMaisRecente } = require("./gerar-pdf");

const cenarioMercado = CENARIOS_MERCADO.find((c) => c.id === "MC01");
const cenarioClima = CENARIOS_CLIMA.find((c) => c.id === "C04");

const promptMercado = market.montarPromptTendencia(cenarioMercado.entrada);
const contextoClima = climaIA.montarContextoClima(cenarioClima.entrada);
const promptClima = climaIA.promptAnaliseClimatica(contextoClima);

// Prompt do avaliador, com a resposta da execução 1 do cenário de clima na rodada mais recente.
const pasta = pastaMaisRecente();
const rodada = JSON.parse(fs.readFileSync(path.join(pasta, "respostas.json"), "utf8")).find((c) => c.id === "C04");
const exec1 = rodada.execucoes.find((e) => e.execucao === 1);
const promptAvaliador = promptJuiz({
  descricaoModulo: "monitoramento climático: o assistente interpreta temperatura, chuva, vento e os alertas do motor de regras de um talhão e devolve um parecer ao produtor.",
  dadosEntrada: rodada.dadosEntrada,
  gabarito: rodada.gabarito,
  pontosChave: cenarioClima.pontosChave,
  naoDeve: cenarioClima.naoDeve,
  textoResposta: exec1.textoAvaliado,
  numerosSuspeitos: exec1.numerosSuspeitos,
});

const bloco = (texto) => "```text\n" + texto + "\n```";

const md = [
  "# Apêndice: prompts literais enviados à IA",
  "",
  "Os textos abaixo foram gerados pelas **mesmas funções do código** que enviam as requisições à API da Anthropic (versões avaliadas: `" +
    climaIA.PROMPT_CLIMA_VERSAO + "` e `" + market.PROMPT_MERCADO_VERSAO + "`). Cada prompt é uma única mensagem do usuário; não há prompt de sistema. " +
    "O que varia de um cenário para outro são apenas os **dados** no fim do texto; as instruções são fixas.",
  "",
  "Gerado por `npm run ia:prompts` (`backend/avaliacao-ia/exportar-prompts.js`).",
  "",
  "## Parâmetros das chamadas",
  "",
  "| Prompt | Função | Modelo | `max_tokens` | Temperatura |",
  "|---|---|---|---:|---|",
  "| A. Mercado | `montarPromptTendencia` (`backend/services/market.js`) | `" + anthropic.MODELO_ANALISE + "` | 900 | padrão da API (não definida) |",
  "| B. Clima | `promptAnaliseClimatica` e `montarContextoClima` (`backend/services/climaIA.js`) | `" + anthropic.MODELO_ANALISE + "` | 900 | padrão da API (não definida) |",
  "| C. Avaliador | `promptJuiz` (`backend/avaliacao-ia/criterios.js`) | `" + modeloJuiz() + "` | 900 | 0 |",
  "",
  "## A. Prompt de mercado (`" + market.PROMPT_MERCADO_VERSAO + "`)",
  "",
  "Exemplo com o cenário controlado **" + cenarioMercado.id + "** (" + cenarioMercado.descricao + "; café, 14 observações). " +
    "Variam por cenário: cultura, unidade, número de observações e datas, preços inicial e final, variação, mínimo, máximo e a série completa.",
  "",
  bloco(promptMercado),
  "",
  "## B. Prompt de clima (`" + climaIA.PROMPT_CLIMA_VERSAO + "`)",
  "",
  "Exemplo com o cenário controlado **" + cenarioClima.id + "** (" + cenarioClima.descricao + "). " +
    "Variam por cenário: talhão, cultura e fase, os valores meteorológicos, a lista de alertas do motor de regras e, quando houver, os avisos do INMET.",
  "",
  bloco(promptClima),
  "",
  "## C. Prompt do avaliador (juiz)",
  "",
  "Usado na avaliação de assertividade, não pelo usuário final. Exemplo com o cenário **" + cenarioClima.id + "**, execução 1 da rodada `" + path.basename(pasta) + "`. " +
    "Varia por cenário: os dados enviados, o gabarito, os pontos-chave, o que a resposta não deve fazer, o texto da resposta avaliada e a lista de números suspeitos.",
  "",
  bloco(promptAvaliador),
  "",
].join("\n");

const destino = path.join(__dirname, "..", "..", "docs", "APENDICE_PROMPTS.md");
fs.writeFileSync(destino, md);
console.log("Apêndice gerado: " + destino + " (" + md.split("\n").length + " linhas)");
