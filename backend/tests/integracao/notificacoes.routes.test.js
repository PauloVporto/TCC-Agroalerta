const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const notificacoesRouter = require("../../routes/notificacoes");
const { iniciarApp } = require("../helpers/servidor");
const { enfileirar } = require("../../services/notificacoes/fila");

let servidor;

before(async () => {
  process.env.WHATSAPP_EXPECTED_SENDER = "5535999999503";
  await banco.prepararBanco();
  servidor = await iniciarApp((app) => app.use("/api/notificacoes", notificacoesRouter));
});
beforeEach(() => banco.limparBanco());
after(async () => {
  delete process.env.WHATSAPP_EXPECTED_SENDER;
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

const ESCOLHA = (email, whatsapp, nivelEmail = "medio", nivelWhatsapp = "medio") => ({
  email: { consentido: email, nivelMinimo: nivelEmail },
  whatsapp: { consentido: whatsapp, nivelMinimo: nivelWhatsapp },
});

async function consentimentosGravados(usuarioId) {
  const { rows } = await banco.pool.query(
    "SELECT canal, concedido, destino, origem FROM notificacao_consentimentos WHERE usuario_id = $1 ORDER BY id",
    [usuarioId]
  );
  return rows;
}

test("sem decisão do produtor, os dois canais aparecem desautorizados, com destino, remetente e modo", async () => {
  const p = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999993362", consentimentos: { sms: true } });
  const token = await banco.criarSessao(p.id);
  const resposta = await chamar("GET", "/preferencias", token);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), {
    email: { consentido: false, atualizadoEm: null, nivelMinimo: "medio", destino: "ana@fazenda.com.br", modo: "simulado" },
    whatsapp: {
      consentido: false, autorizadoOutroNumero: false, atualizadoEm: null, nivelMinimo: "medio",
      destino: "(35) 99999-3362", celularValido: true, remetenteFinal: "9503", modo: "desativado",
    },
  });
});

test("autorizar o WhatsApp grava a decisão do número e enfileira as boas-vindas uma única vez por conta", async () => {
  const p = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999993362" });
  const token = await banco.criarSessao(p.id);

  const autorizado = await (await chamar("PUT", "/preferencias", token, ESCOLHA(true, true, "alto", "alto"))).json();
  assert.deepEqual([autorizado.email.consentido, autorizado.whatsapp.consentido], [true, true]);
  assert.deepEqual([autorizado.email.nivelMinimo, autorizado.whatsapp.nivelMinimo], ["alto", "alto"]);
  assert.ok(autorizado.whatsapp.atualizadoEm);
  assert.deepEqual((await banco.listarEnvios()).map((e) => [e.canal, e.tipo]), [["whatsapp", "boas_vindas"]]);

  // Salvar de novo, revogar e autorizar outra vez: nenhuma boas-vindas nova.
  await chamar("PUT", "/preferencias", token, ESCOLHA(true, true, "alto", "alto"));
  await chamar("PUT", "/preferencias", token, ESCOLHA(true, false));
  await chamar("PUT", "/preferencias", token, ESCOLHA(true, true));
  assert.equal((await banco.listarEnvios()).length, 1);

  assert.deepEqual(await consentimentosGravados(p.id), [
    { canal: "email", concedido: true, destino: "ana@fazenda.com.br", origem: "painel" },
    { canal: "whatsapp", concedido: true, destino: "+5535999993362", origem: "painel" },
    { canal: "whatsapp", concedido: false, destino: "+5535999993362", origem: "painel" },
    { canal: "whatsapp", concedido: true, destino: "+5535999993362", origem: "painel" },
  ]);
});

test("revogar cancela o que estava na fila daquele canal", async () => {
  const p = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999993362" });
  const token = await banco.criarSessao(p.id);
  await chamar("PUT", "/preferencias", token, ESCOLHA(true, true));
  await enfileirar(banco.pool, {
    usuarioId: p.id, canal: "email", tipo: "alerta_climatico", chaveIdempotencia: "alerta:1:email",
    destino: p.email, conteudo: "x", resumo: "x", maxTentativas: 5,
  });
  await chamar("PUT", "/preferencias", token, ESCOLHA(false, false));
  const envios = await banco.listarEnvios();
  assert.deepEqual(envios.map((e) => [e.canal, e.status]), [["whatsapp", "cancelado"], ["email", "cancelado"]]);
  assert.match(envios[0].erro_mensagem, /revogou a autorização do WhatsApp/);
});

test("trocar de celular: a autorização antiga deixa de valer e é renovada para o número novo", async () => {
  const p = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999993362" });
  const token = await banco.criarSessao(p.id);
  await chamar("PUT", "/preferencias", token, ESCOLHA(false, true));
  await banco.pool.query("UPDATE usuarios SET telefone = '+5535988887777' WHERE id = $1", [p.id]);

  const antes = await (await chamar("GET", "/preferencias", token)).json();
  assert.deepEqual([antes.whatsapp.consentido, antes.whatsapp.autorizadoOutroNumero, antes.whatsapp.destino], [false, true, "(35) 98888-7777"]);

  const depois = await (await chamar("PUT", "/preferencias", token, ESCOLHA(false, true))).json();
  assert.deepEqual([depois.whatsapp.consentido, depois.whatsapp.autorizadoOutroNumero], [true, false]);
  assert.deepEqual((await consentimentosGravados(p.id)).map((c) => [c.concedido, c.destino]), [
    [true, "+5535999993362"],
    [true, "+5535988887777"],
  ]);
  assert.equal((await banco.listarEnvios()).length, 1, "a troca de número não gera outra boas-vindas");

  // Desmarcar depois de trocar de número também é registrado (a última decisão era "sim").
  await banco.pool.query("UPDATE usuarios SET telefone = '+5535977776666' WHERE id = $1", [p.id]);
  await chamar("PUT", "/preferencias", token, ESCOLHA(false, false));
  assert.deepEqual((await consentimentosGravados(p.id)).at(-1), { canal: "whatsapp", concedido: false, destino: "+5535977776666", origem: "painel" });
});

test("sem celular cadastrado e sem remetente configurado, o painel mostra os campos vazios", async () => {
  const p = await banco.criarProdutor({ email: "semtel@fazenda.com.br" });
  delete process.env.WHATSAPP_EXPECTED_SENDER;
  try {
    const { whatsapp } = await (await chamar("GET", "/preferencias", await banco.criarSessao(p.id))).json();
    assert.deepEqual([whatsapp.destino, whatsapp.celularValido, whatsapp.remetenteFinal], [null, false, null]);
  } finally {
    process.env.WHATSAPP_EXPECTED_SENDER = "5535999999503";
  }
});

test("autorizar o WhatsApp exige celular válido cadastrado", async () => {
  const fixo = await banco.criarProdutor({ email: "b@fazenda.com.br", telefone: "+553534710000" });
  const resposta = await chamar("PUT", "/preferencias", await banco.criarSessao(fixo.id), ESCOLHA(false, true));
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /celular válido/);
  assert.deepEqual(await consentimentosGravados(fixo.id), []);
});

test("corpo inválido e falta de autenticação", async () => {
  const p = await banco.criarProdutor({ email: "c@fazenda.com.br" });
  const token = await banco.criarSessao(p.id);
  const smsAntigo = { email: { consentido: false, nivelMinimo: "medio" }, sms: { consentido: true, nivelMinimo: "alto" } };
  for (const corpo of [{}, smsAntigo, { ...ESCOLHA(false, false), email: { consentido: "sim", nivelMinimo: "medio" } }, ESCOLHA(true, false, "baixo")]) {
    assert.equal((await chamar("PUT", "/preferencias", token, corpo)).status, 400);
  }
  assert.equal((await chamar("GET", "/preferencias")).status, 401);
  assert.equal((await chamar("GET", "/historico", "token-inexistente")).status, 401);
});

test("histórico mostra só os envios do próprio produtor: telefones formatados, recibos e motivo de falha", async () => {
  const ana = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999993362", consentimentos: { email: true, whatsapp: true } });
  const bruno = await banco.criarProdutor({ email: "bruno@sitio.com.br", telefone: "+5535988880002", consentimentos: { email: true } });
  const comum = { tipo: "alerta_climatico", conteudo: "x", resumo: "Risco de geada (risco alto) · Encosta", regiao: "Lavras - MG", nivel: "alto", maxTentativas: 5 };
  await enfileirar(banco.pool, { ...comum, usuarioId: ana.id, canal: "email", chaveIdempotencia: "a-email", destino: ana.email });
  await enfileirar(banco.pool, { ...comum, usuarioId: ana.id, canal: "whatsapp", chaveIdempotencia: "a-whatsapp", destino: ana.telefone });
  await enfileirar(banco.pool, { ...comum, usuarioId: bruno.id, canal: "email", chaveIdempotencia: "b-email", destino: bruno.email });
  await banco.pool.query(
    `UPDATE notificacao_envios SET status = 'lido', remetente = '+5535999999503', enviado_em = NOW(),
            confirmado_servidor_em = NOW(), entregue_em = NOW(), lido_em = NOW() WHERE canal = 'whatsapp'`
  );
  await banco.pool.query("UPDATE notificacao_envios SET status = 'falhou', erro_codigo = 'falha_entrega', erro_mensagem = 'Resend: bounced' WHERE chave_idempotencia = 'a-email'");

  const historicoAna = await (await chamar("GET", "/historico", await banco.criarSessao(ana.id))).json();
  assert.deepEqual(historicoAna.envios.map((e) => [e.canal, e.destino, e.status]), [
    ["whatsapp", "(35) 99999-3362", "lido"],
    ["email", "ana@fazenda.com.br", "falhou"],
  ]);
  const [whatsapp, email] = historicoAna.envios;
  assert.equal(whatsapp.remetente, "(35) 99999-9503");
  assert.ok(whatsapp.confirmadoServidorEm && whatsapp.entregueEm && whatsapp.lidoEm);
  assert.deepEqual([email.erroCodigo, email.erroMensagem, email.remetente], ["falha_entrega", "Resend: bounced", null]);
  assert.deepEqual([whatsapp.tipo, whatsapp.regiao, whatsapp.nivel, whatsapp.resumo], ["alerta_climatico", "Lavras - MG", "alto", "Risco de geada (risco alto) · Encosta"]);
  assert.equal(typeof whatsapp.id, "number");
  assert.equal("conteudo_html" in whatsapp || "conteudoHtml" in whatsapp || "conteudo" in whatsapp, false);

  const historicoBruno = await (await chamar("GET", "/historico?limite=1", await banco.criarSessao(bruno.id))).json();
  assert.deepEqual(historicoBruno.envios.map((e) => e.destino), ["bruno@sitio.com.br"]);
});

test("histórico antigo de SMS continua visível, com o telefone formatado", async () => {
  const ana = await banco.criarProdutor({ email: "ana@fazenda.com.br", telefone: "+5535999993362" });
  await enfileirar(banco.pool, {
    usuarioId: ana.id, canal: "sms", tipo: "boas_vindas", chaveIdempotencia: "s", destino: ana.telefone,
    conteudo: "Agro Alerta", resumo: "Boas-vindas", maxTentativas: 5,
  });
  const { envios } = await (await chamar("GET", "/historico", await banco.criarSessao(ana.id))).json();
  assert.deepEqual(envios.map((e) => [e.canal, e.destino]), [["sms", "(35) 99999-3362"]]);
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
