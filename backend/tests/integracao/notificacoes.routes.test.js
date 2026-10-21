const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const notificacoesRouter = require("../../routes/notificacoes");
const { iniciarApp } = require("../helpers/servidor");
const { enfileirar } = require("../../services/notificacoes/fila");

let servidor;

before(async () => {
  await banco.prepararBanco();
  servidor = await iniciarApp((app) => app.use("/api/notificacoes", notificacoesRouter));
});
beforeEach(() => banco.limparBanco());
after(async () => {
  await servidor.fechar();
  await banco.pool.end();
});

function chamar(metodo, caminho, token, corpo) {
  return fetch(servidor.url + "/api/notificacoes" + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

const ESCOLHA = (email, sms, nivelEmail = "medio", nivelSms = "alto") => ({
  email: { consentido: email, nivelMinimo: nivelEmail },
  sms: { consentido: sms, nivelMinimo: nivelSms },
});

async function consentimentosGravados(usuarioId) {
  const { rows } = await banco.pool.query(
    "SELECT canal, concedido, origem FROM notificacao_consentimentos WHERE usuario_id = $1 ORDER BY id",
    [usuarioId]
  );
  return rows;
}

test("sem decisão do produtor, os dois canais aparecem desautorizados, com destino e modo", async () => {
  const p = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999990001" });
  const token = await banco.criarSessao(p.id);
  const resposta = await chamar("GET", "/preferencias", token);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), {
    email: { consentido: false, atualizadoEm: null, nivelMinimo: "medio", destino: "ana@fazenda.com.br", modo: "simulado" },
    sms: { consentido: false, atualizadoEm: null, nivelMinimo: "alto", destino: "(35) 99999-0001", celularValido: true, modo: "simulado" },
  });
});

test("autorizar, repetir e revogar: só decisões que mudam viram registro de consentimento", async () => {
  const p = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999990001" });
  const token = await banco.criarSessao(p.id);

  const autorizado = await (await chamar("PUT", "/preferencias", token, ESCOLHA(true, true, "alto", "medio"))).json();
  assert.equal(autorizado.email.consentido, true);
  assert.equal(autorizado.sms.consentido, true);
  assert.equal(autorizado.email.nivelMinimo, "alto");
  assert.equal(autorizado.sms.nivelMinimo, "medio");
  assert.ok(autorizado.sms.atualizadoEm);

  await chamar("PUT", "/preferencias", token, ESCOLHA(true, true, "alto", "medio"));
  const revogado = await (await chamar("PUT", "/preferencias", token, ESCOLHA(true, false))).json();
  assert.equal(revogado.sms.consentido, false);

  assert.deepEqual(await consentimentosGravados(p.id), [
    { canal: "email", concedido: true, origem: "painel" },
    { canal: "sms", concedido: true, origem: "painel" },
    { canal: "sms", concedido: false, origem: "painel" },
  ]);
});

test("autorizar SMS exige celular válido cadastrado", async () => {
  const fixo = await banco.criarProdutor({ email: "b@fazenda.com.br", telefone: "+553534710000" });
  const resposta = await chamar("PUT", "/preferencias", await banco.criarSessao(fixo.id), ESCOLHA(false, true));
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /celular válido/);
  assert.deepEqual(await consentimentosGravados(fixo.id), []);
});

test("corpo inválido e falta de autenticação", async () => {
  const p = await banco.criarProdutor({ email: "c@fazenda.com.br" });
  const token = await banco.criarSessao(p.id);
  for (const corpo of [{}, { email: { consentido: "sim", nivelMinimo: "medio" }, sms: ESCOLHA(false, false).sms }, ESCOLHA(true, false, "baixo")]) {
    assert.equal((await chamar("PUT", "/preferencias", token, corpo)).status, 400);
  }
  assert.equal((await chamar("GET", "/preferencias")).status, 401);
  assert.equal((await chamar("GET", "/historico", "token-inexistente")).status, 401);
});

test("histórico mostra só os envios do próprio produtor, com telefone formatado e motivo de falha", async () => {
  const ana = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999990001", consentimentos: { email: true, sms: true } });
  const bruno = await banco.criarProdutor({ email: "bruno@sitio.com.br", telefone: "+5535988880002", consentimentos: { email: true } });
  const comum = { tipo: "alerta_climatico", conteudo: "x", resumo: "Risco de geada (risco alto) · Encosta", regiao: "Lavras - MG", nivel: "alto", maxTentativas: 5 };
  await enfileirar(banco.pool, { ...comum, usuarioId: ana.id, canal: "email", chaveIdempotencia: "a-email", destino: ana.email });
  await enfileirar(banco.pool, { ...comum, usuarioId: ana.id, canal: "sms", chaveIdempotencia: "a-sms", destino: ana.telefone });
  await enfileirar(banco.pool, { ...comum, usuarioId: bruno.id, canal: "email", chaveIdempotencia: "b-email", destino: bruno.email });
  await banco.pool.query("UPDATE notificacao_envios SET status = 'bloqueado', erro_codigo = 'limite_diario', erro_mensagem = 'Limite diário de 20 SMS atingido (SMS_DAILY_LIMIT).' WHERE canal = 'sms'");

  const historicoAna = await (await chamar("GET", "/historico", await banco.criarSessao(ana.id))).json();
  assert.deepEqual(historicoAna.envios.map((e) => [e.canal, e.destino, e.status]), [
    ["sms", "(35) 99999-0001", "bloqueado"],
    ["email", "ana@fazenda.com.br", "pendente"],
  ]);
  const [sms] = historicoAna.envios;
  assert.deepEqual(
    [sms.tipo, sms.regiao, sms.nivel, sms.resumo, sms.erroCodigo, sms.erroMensagem],
    ["alerta_climatico", "Lavras - MG", "alto", "Risco de geada (risco alto) · Encosta", "limite_diario", "Limite diário de 20 SMS atingido (SMS_DAILY_LIMIT)."]
  );
  assert.equal(typeof sms.id, "number");
  assert.equal("conteudo_html" in sms || "conteudoHtml" in sms, false);

  const historicoBruno = await (await chamar("GET", "/historico?limite=1", await banco.criarSessao(bruno.id))).json();
  assert.deepEqual(historicoBruno.envios.map((e) => e.destino), ["bruno@sitio.com.br"]);
});

test("erros inesperados do banco viram 500 com mensagem amigável", async (t) => {
  const p = await banco.criarProdutor({ email: "d@fazenda.com.br", telefone: "+5535999990004" });
  const token = await banco.criarSessao(p.id);
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  // Só as consultas das notificações falham; a sessão continua válida.
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/notificacao_|SELECT nome, email, telefone FROM usuarios/.test(sql)) throw new Error("banco fora do ar");
    return consultaOriginal(sql, params);
  });
  t.mock.method(console, "error", () => {});
  assert.equal((await chamar("GET", "/preferencias", token)).status, 500);
  assert.equal((await chamar("PUT", "/preferencias", token, ESCOLHA(true, true))).status, 500);
  assert.equal((await chamar("GET", "/historico", token)).status, 500);
});
