const { test, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const anthropic = require("../services/anthropic");
const climaIA = require("../services/climaIA");

const talhao = { id: 7, nome: "Talhão 1", cultura: "cafe", fase: "floracao" };
const clima = {
  fonte: "open-meteo", temperaturaMinima: 1.5, chuvaAcumulada7dias: 12, diasSemChuva: 3,
  probabilidadeChuva7dias: 40, ventoMaximoKmh: 18,
};
const alertas = [
  { id: "cafe_geada", nivel: "alto", titulo: "Risco de geada", mensagem: "Temperatura mínima prevista de 1.5°C.", recomendacao: "Proteger a lavoura.", janela: "próximas 48h" },
];
const entrada = { talhao, clima, alertas, alertasOficiais: [] };

const jsonValido = {
  nivelGeral: "alto",
  resumo: "Risco alto de geada nas próximas 48h, com mínima de 1.5°C.",
  riscos: [{ tipo: "geada", nivel: "alto", justificativa: "Mínima prevista de 1.5°C." }],
  recomendacoes: ["Proteger a lavoura."],
};
const respostaApi = (texto) => ({
  dados: { id: "msg_teste", model: "claude-teste", usage: { input_tokens: 10, output_tokens: 20 } },
  texto,
  requestId: "req_teste",
});

let chaveOriginal;
beforeEach(() => {
  chaveOriginal = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "chave-de-teste";
  climaIA.limparCache();
});
afterEach(() => {
  mock.restoreAll();
  if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = chaveOriginal;
});

test("tipoDoAlerta converte o id da regra no tipo de risco", () => {
  assert.equal(climaIA.tipoDoAlerta("cafe_geada"), "geada");
  assert.equal(climaIA.tipoDoAlerta("cana_estiagem_prolongada"), "estiagem");
  assert.equal(climaIA.tipoDoAlerta("soja_vento_forte"), "vento");
  assert.equal(climaIA.tipoDoAlerta("soja_chuva_colheita"), "chuva_colheita");
  assert.equal(climaIA.tipoDoAlerta("desconhecida"), null);
});

test("nivelGeralDosAlertas devolve o maior nível, ou baixo sem alertas", () => {
  assert.equal(climaIA.nivelGeralDosAlertas([]), "baixo");
  assert.equal(climaIA.nivelGeralDosAlertas([{ nivel: "medio" }, { nivel: "alto" }]), "alto");
});

test("validarAnalise recusa nível, tipo ou forma inválidos", () => {
  assert.ok(climaIA.validarAnalise(jsonValido));
  assert.equal(climaIA.validarAnalise({ ...jsonValido, nivelGeral: "critico" }), null);
  assert.equal(climaIA.validarAnalise({ ...jsonValido, riscos: [{ tipo: "granizo", nivel: "alto" }] }), null);
  assert.equal(climaIA.validarAnalise({ ...jsonValido, resumo: "  " }), null);
  assert.equal(climaIA.validarAnalise({ ...jsonValido, riscos: "geada" }), null);
});

test("o contexto envia os números reais e os alertas do motor de regras", () => {
  const contexto = climaIA.montarContextoClima(entrada);
  assert.match(contexto, /1\.5 °C/);
  assert.match(contexto, /\[alto\] Risco de geada/);
  assert.match(contexto, /café arábica/);
  assert.match(climaIA.montarContextoClima({ ...entrada, alertas: [] }), /nenhum alerta disparado/);
});

test("interpretarClimaComIA aceita JSON com cerca de markdown e registra a proveniência", async () => {
  mock.method(anthropic, "mensagens", async () => respostaApi("```json\n" + JSON.stringify(jsonValido) + "\n```"));
  const r = await climaIA.interpretarClimaComIA(entrada);
  assert.equal(r.formatoValido, true);
  assert.equal(r.analise.nivelGeral, "alto");
  assert.equal(r.requestId, "req_teste");
  assert.equal(r.respostaId, "msg_teste");
  assert.equal(r.modelo, "claude-teste");
  assert.equal(r.promptVersao, climaIA.PROMPT_CLIMA_VERSAO);
});

test("interpretarClimaComIA lança em falha da API, sem cair para resposta simulada", async () => {
  mock.method(anthropic, "mensagens", async () => { throw Object.assign(new Error("x"), { codigo: "limite" }); });
  await assert.rejects(climaIA.interpretarClimaComIA(entrada), (e) => e.codigo === "limite");
});

test("sem chave, a análise é simulada e informa o motivo", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const chamada = mock.method(anthropic, "mensagens", async () => respostaApi("{}"));
  const r = await climaIA.gerarAnaliseClimatica(entrada);
  assert.equal(r.origem, "simulado");
  assert.equal(r.ia.codigo, "nao_configurada");
  assert.equal(r.analise.nivelGeral, "alto");
  assert.equal(r.analise.riscos[0].tipo, "geada");
  assert.equal(chamada.mock.callCount(), 0);
});

test("com chave, a análise vem da Anthropic e fica em cache até pedir renovação", async () => {
  const chamada = mock.method(anthropic, "mensagens", async () => respostaApi(JSON.stringify(jsonValido)));
  const a = await climaIA.gerarAnaliseClimatica(entrada);
  assert.equal(a.origem, "anthropic");
  assert.equal(a.requestId, "req_teste");
  const b = await climaIA.gerarAnaliseClimatica(entrada);
  assert.equal(b.emCache, true);
  assert.equal(chamada.mock.callCount(), 1);
  await climaIA.gerarAnaliseClimatica(entrada, { forcar: true });
  assert.equal(chamada.mock.callCount(), 2);
});

test("dados diferentes não reaproveitam o cache", async () => {
  const chamada = mock.method(anthropic, "mensagens", async () => respostaApi(JSON.stringify(jsonValido)));
  await climaIA.gerarAnaliseClimatica(entrada);
  await climaIA.gerarAnaliseClimatica({ ...entrada, clima: { ...clima, temperaturaMinima: 8 }, alertas: [] });
  assert.equal(chamada.mock.callCount(), 2);
});

test("falha de autenticação vira resumo simulado, nunca rotulado como Anthropic", async () => {
  mock.method(anthropic, "mensagens", async () => { throw Object.assign(new Error("401"), { codigo: "autenticacao", status: 401 }); });
  const r = await climaIA.gerarAnaliseClimatica(entrada);
  assert.equal(r.origem, "simulado");
  assert.equal(r.ia.codigo, "autenticacao");
  assert.equal(r.requestId, undefined);
});

test("JSON fora do formato mantém origem anthropic, mas sinaliza formato inválido e usa o texto bruto", async () => {
  mock.method(anthropic, "mensagens", async () => respostaApi("Risco alto de geada nesta semana."));
  const r = await climaIA.gerarAnaliseClimatica(entrada);
  assert.equal(r.origem, "anthropic");
  assert.equal(r.formatoValido, false);
  assert.equal(r.analise.resumo, "Risco alto de geada nesta semana.");
  assert.equal(r.analise.nivelGeral, "alto");
});
