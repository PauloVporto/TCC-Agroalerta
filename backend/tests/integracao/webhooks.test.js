const banco = require("./helpers/banco");
const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");
const webhooksRouter = require("../../routes/webhooks");
const { enfileirar } = require("../../services/notificacoes/fila");
const { obterConsentimentos } = require("../../services/notificacoes/consentimentos");
const { consultarStatusDeEntrega } = require("../../services/notificacoes/statusEntrega");

const SEGREDO_RESEND = "whsec_" + Buffer.from("segredo-do-resend-para-testes").toString("base64");
const SEGREDO_SMSGO = "whsec_segredo_smsgo";

let servidor;
let url;

before(async () => {
  await banco.prepararBanco();
  // Montado como no server.js: sem express.json() antes, para manter o corpo bruto.
  const app = express();
  app.use("/api/notificacoes/webhooks", webhooksRouter);
  servidor = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  url = `http://127.0.0.1:${servidor.address().port}/api/notificacoes/webhooks`;
});
beforeEach(async () => {
  process.env.RESEND_WEBHOOK_SECRET = SEGREDO_RESEND;
  process.env.SMSGO_WEBHOOK_SECRET = SEGREDO_SMSGO;
  await banco.limparBanco();
});
after(async () => {
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.SMSGO_WEBHOOK_SECRET;
  await new Promise((resolve) => servidor.close(resolve));
  await banco.pool.end();
});

let sequencia = 0;

async function envioAceito({ canal = "email", provedor = "resend", provedorId = "email-1" } = {}) {
  sequencia += 1;
  const p = await banco.criarProdutor({ email: `p${sequencia}@fazenda.com.br`, telefone: "+5535999990000", consentimentos: { email: true, sms: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: p.id, canal, tipo: "alerta_climatico", chaveIdempotencia: "envio-" + sequencia,
    destino: canal === "email" ? p.email : p.telefone, conteudo: "x", resumo: "Risco de geada", maxTentativas: 5,
  });
  await banco.pool.query(
    "UPDATE notificacao_envios SET status = 'enviado', provedor = $2, provedor_id = $3, modo = 'real', enviado_em = NOW() WHERE id = $1",
    [id, provedor, provedorId]
  );
  return { id, produtor: p };
}

function postarResend(evento, { svixId = "msg_" + crypto.randomUUID(), segredo = SEGREDO_RESEND, corpo } = {}) {
  const bruto = corpo ?? JSON.stringify(evento);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const chave = Buffer.from(segredo.replace(/^whsec_/, ""), "base64");
  const assinatura = crypto.createHmac("sha256", chave).update(`${svixId}.${timestamp}.${bruto}`).digest("base64");
  return fetch(url + "/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json", "svix-id": svixId, "svix-timestamp": timestamp, "svix-signature": "v1," + assinatura },
    body: bruto,
  });
}

function postarSmsgo(evento, { segredo = SEGREDO_SMSGO, corpo } = {}) {
  const bruto = corpo ?? JSON.stringify(evento);
  const assinatura = "sha256=" + crypto.createHmac("sha256", segredo).update(bruto).digest("hex");
  return fetch(url + "/smsgo", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SMSGo-Signature": assinatura },
    body: bruto,
  });
}

async function situacao(id) {
  const envio = (await banco.listarEnvios()).find((e) => e.id === id);
  return [envio.status, envio.erro_codigo];
}

test("Resend: email.delivered confirma a entrega; o mesmo evento repetido é ignorado", async () => {
  const { id } = await envioAceito();
  const evento = { type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "email-1" } };
  const primeira = await postarResend(evento, { svixId: "msg_fixo" });
  assert.equal(primeira.status, 200);
  assert.deepEqual(await situacao(id), ["entregue", null]);

  assert.equal((await postarResend(evento, { svixId: "msg_fixo" })).status, 200);
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => [e.tipo, e.status]), [["enfileirado", "pendente"], ["webhook", "entregue"]]);
  const { rows } = await banco.pool.query("SELECT provedor, evento_id, tipo FROM notificacao_webhooks");
  assert.deepEqual(rows, [{ provedor: "resend", evento_id: "msg_fixo", tipo: "email.delivered" }]);
});

test("Resend: bounce marca a falha com o motivo; eventos sem mudança só entram na linha do tempo", async () => {
  const { id } = await envioAceito();
  await postarResend({ type: "email.sent", data: { email_id: "email-1" } });
  assert.deepEqual(await situacao(id), ["enviado", null]);
  await postarResend({ type: "email.bounced", data: { email_id: "email-1", bounce: { message: "Caixa inexistente", type: "Permanent" } } });
  const envio = (await banco.listarEnvios()).find((e) => e.id === id);
  assert.deepEqual([envio.status, envio.erro_codigo, envio.erro_mensagem], ["falhou", "falha_entrega", "Resend: bounced — Caixa inexistente"]);
  // Confirmação fora de ordem não ressuscita um envio que falhou.
  await postarResend({ type: "email.delivered", data: { email_id: "email-1" } });
  assert.deepEqual(await situacao(id), ["falhou", "falha_entrega"]);
});

test("Resend: reclamação de spam revoga o consentimento de e-mail do produtor", async () => {
  const { produtor } = await envioAceito();
  await postarResend({ type: "email.complained", data: { email_id: "email-1" } });
  const consentimentos = await obterConsentimentos(produtor.id);
  assert.equal(consentimentos.email.concedido, false);
  assert.equal(consentimentos.sms.concedido, true);
  const { rows } = await banco.pool.query("SELECT origem FROM notificacao_consentimentos WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1", [produtor.id]);
  assert.equal(rows[0].origem, "reclamacao_spam");
});

test("Resend: assinatura inválida, corpo inválido, segredo ausente e envio desconhecido", async () => {
  const { id } = await envioAceito();
  const outroSegredo = "whsec_" + Buffer.from("outro").toString("base64");
  assert.equal((await postarResend({ type: "email.delivered", data: { email_id: "email-1" } }, { segredo: outroSegredo })).status, 401);
  assert.deepEqual(await situacao(id), ["enviado", null]);
  assert.equal((await postarResend(null, { corpo: "não é json" })).status, 400);
  assert.equal((await postarResend({ type: "email.delivered", data: { email_id: "desconhecido" } })).status, 200);

  delete process.env.RESEND_WEBHOOK_SECRET;
  const semSegredo = await postarResend({ type: "email.delivered", data: { email_id: "email-1" } });
  assert.equal(semSegredo.status, 503);
  assert.match((await semSegredo.json()).erro, /RESEND_WEBHOOK_SECRET/);
});

test("SMSGo: sms.status confirma entrega ou falha; resposta do produtor é só registrada", async () => {
  const entregue = await envioAceito({ canal: "sms", provedor: "smsgo", provedorId: "uuid-1" });
  const falhou = await envioAceito({ canal: "sms", provedor: "smsgo", provedorId: "uuid-2" });
  assert.equal((await postarSmsgo({ id: "evt-1", event: "sms.status", data: { sendId: "uuid-1", phone: "+5535999990000", status: "delivered" } })).status, 200);
  await postarSmsgo({ id: "evt-2", event: "sms.status", data: { sendId: "uuid-2", status: "failed" } });
  await postarSmsgo({ id: "evt-3", event: "sms.status", data: { sendId: "uuid-2", status: "in_progress" } });
  await postarSmsgo({ event: "sms.reply", data: { fromPhone: "+5535999990000", message: "ok" } });
  await postarSmsgo({ id: "evt-1", event: "sms.status", data: { sendId: "uuid-1", status: "failed" } });
  await postarSmsgo({ id: "evt-4", event: "sms.status", data: { sendId: "desconhecido", status: "delivered" } });

  assert.deepEqual(await situacao(entregue.id), ["entregue", null]);
  assert.deepEqual(await situacao(falhou.id), ["falhou", "falha_entrega"]);
  const { rows } = await banco.pool.query("SELECT tipo FROM notificacao_webhooks WHERE provedor = 'smsgo' ORDER BY id");
  assert.deepEqual(rows.map((r) => r.tipo), ["sms.status", "sms.status", "sms.status", "sms.reply", "sms.status"]);
});

test("SMSGo: assinatura inválida, corpo inválido e segredo ausente", async () => {
  assert.equal((await postarSmsgo({ event: "sms.status", data: {} }, { segredo: "errado" })).status, 401);
  assert.equal((await postarSmsgo(null, { corpo: '{"sem":"evento"}' })).status, 400);
  delete process.env.SMSGO_WEBHOOK_SECRET;
  assert.equal((await postarSmsgo({ event: "sms.status", data: {} })).status, 503);
  const vazio = await fetch(url + "/smsgo", { method: "POST" });
  assert.equal(vazio.status, 503);
});

test("falha inesperada no processamento do webhook responde 500", async (t) => {
  t.mock.method(banco.pool, "query", async () => {
    throw new Error("banco fora do ar");
  });
  t.mock.method(console, "error", () => {});
  assert.equal((await postarSmsgo({ id: "evt-x", event: "sms.status", data: { sendId: "uuid-1", status: "delivered" } })).status, 500);
});

test("consulta periódica confirma a entrega sem webhook e não insiste em quem o provedor atual não consulta", async () => {
  const email = await envioAceito({ provedorId: "email-1" });
  const sms = await envioAceito({ canal: "sms", provedor: "smsgo", provedorId: "uuid-1" });
  const outroModo = await envioAceito({ canal: "sms", provedor: "smsgo", provedorId: "uuid-2" });
  await banco.pool.query("UPDATE notificacao_envios SET modo = 'sandbox' WHERE id = $1", [outroModo.id]);

  const consultas = [];
  const provedores = {
    email: banco.provedorFalso({ nome: "resend", consultarStatus: async (id) => (consultas.push(id), { status: "entregue", reclamacao: false, detalhe: "Resend: delivered" }) }),
    sms: banco.provedorFalso({
      nome: "smsgo",
      consultarStatus: async (id) => {
        consultas.push(id);
        throw new Error("SMSGo instável");
      },
    }),
  };
  const logs = [];
  assert.equal(await consultarStatusDeEntrega({ provedores, log: (linha) => logs.push(linha) }), 1);
  assert.deepEqual(consultas.sort(), ["email-1", "uuid-1"]);
  assert.deepEqual(await situacao(email.id), ["entregue", null]);
  assert.deepEqual(await situacao(sms.id), ["enviado", null]);
  assert.match(logs[0], /SMSGo instável/);

  // Consultado há pouco: só volta a perguntar depois do intervalo.
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 0);
  assert.equal(consultas.length, 2);

  // Sem resposta definitiva, nada muda; reclamação revoga o consentimento.
  await banco.pool.query("UPDATE notificacao_envios SET status_consultado_em = NULL");
  provedores.sms.consultarStatus = async () => ({ status: null, reclamacao: false, detalhe: "SMSGo: em andamento" });
  provedores.sms.nome = "outro";
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 0);
  await banco.pool.query("UPDATE notificacao_envios SET status_consultado_em = NULL");
  provedores.sms.nome = "smsgo";
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 0);
  assert.deepEqual(await situacao(sms.id), ["enviado", null]);

  const reclamado = await envioAceito({ provedorId: "email-9" });
  provedores.email.consultarStatus = async () => ({ status: "entregue", reclamacao: true, detalhe: "Resend: complained" });
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 1);
  assert.equal((await obterConsentimentos(reclamado.produtor.id)).email.concedido, false);
});
