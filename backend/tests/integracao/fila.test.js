const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { enfileirar, registrarTesteManual, concluirTesteManual } = require("../../services/notificacoes/fila");
const { ErroProvedor } = require("../../services/notificacoes/provedores/comum");
const { registrarConsentimento } = require("../../services/notificacoes/consentimentos");
const { lerConfiguracao } = require("../../services/notificacoes/config");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

function erro(codigo, temporario, provedor = "resend") {
  return new ErroProvedor({ provedor, codigo, mensagem: `${provedor}: ${codigo}`, temporario });
}

async function produtorComEnvio({ canal = "email", maxTentativas = 5, chave = "chave-1", consentimentos = { email: true, sms: true } } = {}) {
  const produtor = await banco.criarProdutor({ email: "p@fazenda.com.br", telefone: "+5535999990000", consentimentos });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id,
    canal,
    tipo: "boas_vindas",
    chaveIdempotencia: chave,
    destino: canal === "email" ? produtor.email : produtor.telefone,
    assunto: canal === "email" ? "Bem-vindo ao Agro Alerta!" : null,
    conteudo: "Agro Alerta: teste",
    conteudoHtml: canal === "email" ? "<p>teste</p>" : null,
    resumo: "Boas-vindas ao Agro Alerta",
    maxTentativas,
  });
  return { produtor, id };
}

async function envio(id) {
  return (await banco.listarEnvios()).find((e) => e.id === id);
}

test("falha definitiva do Resend (remetente de teste) termina em falhou, sem nova tentativa", async () => {
  const { id } = await produtorComEnvio();
  const email = banco.provedorFalso({ nome: "resend", roteiro: [erro("remetente_de_teste", false)] });
  await banco.processar({ email });
  await banco.liberarRetentativas();
  await banco.processar({ email });

  const final = await envio(id);
  assert.deepEqual([final.status, final.erro_codigo, final.tentativas, final.provedor], ["falhou", "remetente_de_teste", 1, "resend"]);
  assert.equal(email.enviados.length, 1);
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => e.tipo), ["enfileirado", "falhou"]);
});

test("falha da SMSGo (saldo insuficiente) e credencial inválida são definitivas", async () => {
  const { id } = await produtorComEnvio({ canal: "sms" });
  await banco.processar({ sms: banco.provedorFalso({ nome: "smsgo", roteiro: [erro("saldo_insuficiente", false, "smsgo")] }) });
  assert.deepEqual([(await envio(id)).status, (await envio(id)).erro_codigo], ["falhou", "saldo_insuficiente"]);

  await banco.limparBanco();
  const outro = await produtorComEnvio({ canal: "sms" });
  await banco.processar({ sms: banco.provedorFalso({ nome: "smsgo", roteiro: [erro("credencial_invalida", false, "smsgo")] }) });
  const final = await envio(outro.id);
  assert.deepEqual([final.status, final.erro_codigo, final.erro_mensagem], ["falhou", "credencial_invalida", "smsgo: credencial_invalida"]);
});

test("queda de conexão reagenda com espera e a retentativa reaproveita a chave de idempotência", async () => {
  const { id } = await produtorComEnvio();
  const email = banco.provedorFalso({ nome: "resend", roteiro: [erro("falha_conexao", true), { provedorId: "email-77" }] });

  await banco.processar({ email });
  const reagendado = await envio(id);
  assert.deepEqual([reagendado.status, reagendado.erro_codigo, reagendado.tentativas], ["pendente", "falha_conexao", 1]);
  const esperaMs = new Date(reagendado.proxima_tentativa_em) - Date.now();
  assert.ok(esperaMs > 50 * 1000 && esperaMs <= 60 * 1000, "espera de ~1 min, foi " + esperaMs);

  await banco.processar({ email });
  assert.equal(email.enviados.length, 1, "não tenta antes da hora");

  await banco.liberarRetentativas();
  await banco.processar({ email });
  const final = await envio(id);
  assert.deepEqual([final.status, final.provedor_id, final.tentativas, final.erro_codigo], ["enviado", "email-77", 2, null]);
  assert.ok(final.enviado_em);
  assert.equal(email.enviados[0].chaveIdempotencia, email.enviados[1].chaveIdempotencia);
  assert.match(email.enviados[0].chaveIdempotencia, new RegExp(`^agroalerta-envio-${id}-[0-9a-f]{12}$`));
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => e.tipo), ["enfileirado", "falha_temporaria", "aceito"]);
});

test("falhas temporárias param no limite de tentativas", async () => {
  const { id } = await produtorComEnvio({ maxTentativas: 3 });
  const email = banco.provedorFalso({ nome: "resend", roteiro: [erro("erro_provedor", true), erro("erro_provedor", true), erro("erro_provedor", true)] });
  for (let i = 0; i < 3; i++) {
    await banco.processar({ email });
    await banco.liberarRetentativas();
  }
  await banco.processar({ email });
  const final = await envio(id);
  assert.deepEqual([final.status, final.tentativas, final.erro_codigo], ["falhou", 3, "erro_provedor"]);
  assert.equal(email.enviados.length, 3);
});

test("erro inesperado (fora do provedor) também é reagendado", async () => {
  const { id } = await produtorComEnvio();
  await banco.processar({ email: banco.provedorFalso({ nome: "resend", roteiro: [new Error("bug")] }) });
  const final = await envio(id);
  assert.deepEqual([final.status, final.erro_codigo, final.erro_mensagem], ["pendente", "erro_interno", "bug"]);
});

test("a mesma chave de idempotência nunca gera dois envios, nem reprocessar reenvia", async () => {
  const { produtor, id } = await produtorComEnvio({ chave: "alerta:1:email" });
  const repetido = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "email", tipo: "alerta_climatico", chaveIdempotencia: "alerta:1:email",
    destino: produtor.email, conteudo: "x", resumo: "x", maxTentativas: 5,
  });
  assert.equal(repetido, null);
  assert.equal((await banco.listarEnvios()).length, 1);

  const email = banco.provedorFalso({ nome: "resend" });
  await banco.processar({ email });
  await banco.processar({ email });
  assert.equal(email.enviados.length, 1);
  assert.equal((await envio(id)).status, "enviado");
});

test("consentimento revogado depois de enfileirar bloqueia o envio", async () => {
  const { produtor, id } = await produtorComEnvio();
  await registrarConsentimento(banco.pool, { usuarioId: produtor.id, canal: "email", concedido: false, destino: produtor.email, origem: "painel" });
  const email = banco.provedorFalso({ nome: "resend" });
  await banco.processar({ email });
  const final = await envio(id);
  assert.deepEqual([final.status, final.erro_codigo], ["bloqueado", "sem_consentimento"]);
  assert.equal(email.enviados.length, 0);
});

test("contato é relido no envio: e-mail trocado vai para o novo endereço; contato inválido bloqueia", async () => {
  const { produtor, id } = await produtorComEnvio();
  await banco.pool.query("UPDATE usuarios SET email = 'novo@fazenda.com.br' WHERE id = $1", [produtor.id]);
  const email = banco.provedorFalso({ nome: "resend" });
  await banco.processar({ email });
  assert.equal(email.enviados[0].destino, "novo@fazenda.com.br");
  assert.equal((await envio(id)).destino, "novo@fazenda.com.br");

  await banco.limparBanco();
  const sms = await produtorComEnvio({ canal: "sms" });
  await banco.pool.query("UPDATE usuarios SET telefone = '(35) 3471-0000' WHERE id = $1", [sms.produtor.id]);
  await banco.processar();
  assert.deepEqual([(await envio(sms.id)).status, (await envio(sms.id)).erro_codigo], ["bloqueado", "telefone_invalido"]);

  await banco.limparBanco();
  const semEmail = await produtorComEnvio();
  await banco.pool.query("UPDATE usuarios SET email = 'quebrado' WHERE id = $1", [semEmail.produtor.id]);
  await banco.processar();
  assert.equal((await envio(semEmail.id)).erro_codigo, "email_invalido");
});

test("reinício do backend: envio preso em processando volta à fila quando a trava vence", async () => {
  const { id } = await produtorComEnvio();
  // Simula uma queda no meio do envio: linha reservada e trava ainda válida.
  await banco.pool.query(
    "UPDATE notificacao_envios SET status = 'processando', tentativas = 1, processando_ate = NOW() + INTERVAL '1 minute' WHERE id = $1",
    [id]
  );
  const email = banco.provedorFalso({ nome: "resend" });
  await banco.processar({ email });
  assert.equal(email.enviados.length, 0, "a trava ainda vale: outro processo pode estar enviando");

  await banco.pool.query("UPDATE notificacao_envios SET processando_ate = NOW() - INTERVAL '1 second' WHERE id = $1", [id]);
  await banco.processar({ email });
  const final = await envio(id);
  assert.deepEqual([final.status, final.tentativas], ["enviado", 2]);
});

test("envio que já esgotou as tentativas antes da queda falha sem chamar o provedor", async () => {
  const { id } = await produtorComEnvio({ maxTentativas: 2 });
  await banco.pool.query(
    "UPDATE notificacao_envios SET status = 'processando', tentativas = 2, processando_ate = NOW() - INTERVAL '1 second' WHERE id = $1",
    [id]
  );
  const email = banco.provedorFalso({ nome: "resend" });
  await banco.processar({ email });
  assert.deepEqual([(await envio(id)).status, (await envio(id)).erro_codigo], ["falhou", "tentativas_esgotadas"]);
  assert.equal(email.enviados.length, 0);
});

test("modo simulado e sandbox ficam registrados no histórico", async () => {
  const simulado = await produtorComEnvio();
  const { provedoresDaConfiguracao } = require("../../services/notificacoes/provedores");
  const { email } = provedoresDaConfiguracao(lerConfiguracao({}));
  await banco.processar({ email });
  const registrado = await envio(simulado.id);
  assert.deepEqual([registrado.status, registrado.modo, registrado.provedor], ["simulado", "simulado", "simulado"]);
  assert.match(registrado.provedor_id, /^simulado-/);
  assert.deepEqual((await banco.eventosDoEnvio(simulado.id)).map((e) => e.tipo), ["enfileirado", "simulado"]);

  await banco.limparBanco();
  const sandbox = await produtorComEnvio({ canal: "sms" });
  await banco.processar({ sms: banco.provedorFalso({ nome: "smsgo", modo: "sandbox" }) });
  const final = await envio(sandbox.id);
  assert.deepEqual([final.status, final.modo, final.segmentos], ["enviado", "sandbox", 1]);
});

test("o histórico persiste: linha e eventos de cada envio continuam no banco", async () => {
  const { id } = await produtorComEnvio();
  await banco.processar();
  const { rows } = await banco.pool.query(
    "SELECT e.status, COUNT(v.id)::int AS eventos FROM notificacao_envios e JOIN notificacao_eventos v ON v.envio_id = e.id WHERE e.id = $1 GROUP BY e.status",
    [id]
  );
  assert.deepEqual(rows, [{ status: "enviado", eventos: 2 }]);
});

test("teste manual fica no histórico, fora do alcance da fila automática", async () => {
  const id = await registrarTesteManual({ canal: "sms", destino: "+5535999990000", conteudo: "teste", provedor: "smsgo", modo: "sandbox", segmentos: 1, custo: 0 });
  const sms = banco.provedorFalso({ nome: "smsgo" });
  await banco.processar({ sms });
  assert.equal(sms.enviados.length, 0);

  await concluirTesteManual(id, { provedorId: "uuid-teste" });
  const aceito = await envio(id);
  assert.deepEqual([aceito.tipo, aceito.status, aceito.provedor_id, aceito.usuario_id], ["teste", "enviado", "uuid-teste", null]);

  const falho = await registrarTesteManual({ canal: "email", destino: "eu@exemplo.com", assunto: "t", conteudo: "t", provedor: "resend", modo: "real" });
  await concluirTesteManual(falho, { erro: erro("remetente_de_teste", false) });
  await concluirTesteManual(falho, { erro: new Error("sem código") });
  assert.deepEqual([(await envio(falho)).status, (await envio(falho)).erro_codigo], ["falhou", "erro_interno"]);
  assert.deepEqual((await banco.eventosDoEnvio(falho)).map((e) => e.tipo), ["teste_manual", "falhou", "falhou"]);
});
