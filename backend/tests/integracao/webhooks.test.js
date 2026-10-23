const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");
const webhooksRouter = require("../../routes/webhooks");
const { enfileirar, processarFila } = require("../../services/notificacoes/fila");
const { obterConsentimentos } = require("../../services/notificacoes/consentimentos");
const { consultarStatusDeEntrega } = require("../../services/notificacoes/statusEntrega");
const { listarEventosAdmin } = require("../../services/notificacoes/controle");
const { ErroProvedor } = require("../../services/notificacoes/provedores/comum");
const { jwtEvolution } = require("../helpers/jwt");

const SEGREDO_RESEND = "whsec_" + Buffer.from("segredo-do-resend-para-testes").toString("base64");
const SEGREDO_EVOLUTION = "segredo-do-webhook-da-evolution";
const ENV_EVOLUTION = { EVOLUTION_WEBHOOK_SECRET: SEGREDO_EVOLUTION, EVOLUTION_INSTANCE: "agroalerta", WHATSAPP_EXPECTED_SENDER: "9503" };

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
  Object.assign(process.env, ENV_EVOLUTION);
  await banco.limparBanco();
});
after(async () => {
  delete process.env.RESEND_WEBHOOK_SECRET;
  for (const variavel of Object.keys(ENV_EVOLUTION)) delete process.env[variavel];
  await new Promise((resolve) => servidor.close(resolve));
  await banco.pool.end();
});

let sequencia = 0;
const TELEFONE = "+5535999993362";

async function envioAceito({ canal = "email", provedor = "resend", provedorId = "email-1", status = "enviado", conteudo = "x" } = {}) {
  sequencia += 1;
  const p = await banco.criarProdutor({ email: `p${sequencia}@fazenda.com.br`, telefone: TELEFONE, consentimentos: { email: true, whatsapp: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: p.id, canal, tipo: "alerta_climatico", chaveIdempotencia: "envio-" + sequencia,
    destino: canal === "email" ? p.email : p.telefone, conteudo, resumo: "Risco de geada", maxTentativas: 5,
  });
  await banco.pool.query(
    `UPDATE notificacao_envios SET status = $4, provedor = $2, provedor_id = $3, modo = 'real', enviado_em = NOW(),
            tentativa_iniciada_em = NOW() WHERE id = $1`,
    [id, provedor, provedorId, status]
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

// Como a Evolution API v2.3.7 posta: { event, instance, data, date_time, sender, server_url, apikey }.
function postarEvolution(event, data, { segredo = SEGREDO_EVOLUTION, instancia = "agroalerta", corpo, autorizacao } = {}) {
  const bruto = corpo ?? JSON.stringify({
    event, instance: instancia, data, destination: url + "/evolution", date_time: new Date().toISOString(),
    sender: "553599999503@s.whatsapp.net", server_url: "http://evolution-api:8080", apikey: null,
  });
  return fetch(url + "/evolution", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: autorizacao ?? "Bearer " + jwtEvolution(segredo) },
    body: bruto,
  });
}

function recibo(keyId, status, extra = {}) {
  return postarEvolution("messages.update", {
    keyId, remoteJid: "553599993362@s.whatsapp.net", fromMe: true, participant: null, status, instanceId: "uuid", ...extra,
  });
}

async function linha(id) {
  return (await banco.listarEnvios()).find((e) => e.id === id);
}

async function situacao(id) {
  const envio = await linha(id);
  return [envio.status, envio.erro_codigo];
}

// ---- Resend -----------------------------------------------------------------------

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
  const envio = await linha(id);
  assert.deepEqual([envio.status, envio.erro_codigo, envio.erro_mensagem], ["falhou", "falha_entrega", "Resend: bounced — Caixa inexistente"]);
  // Confirmação fora de ordem não ressuscita um envio que falhou.
  await postarResend({ type: "email.delivered", data: { email_id: "email-1" } });
  assert.deepEqual(await situacao(id), ["falhou", "falha_entrega"]);
});

test("Resend: reclamação de spam revoga só o consentimento de e-mail do produtor", async () => {
  const { produtor } = await envioAceito();
  await postarResend({ type: "email.complained", data: { email_id: "email-1" } });
  const consentimentos = await obterConsentimentos(produtor.id);
  assert.equal(consentimentos.email.concedido, false);
  assert.equal(consentimentos.whatsapp.concedido, true);
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

test("consulta periódica do e-mail confirma a entrega sem webhook; erro do provedor só vai para o log", async () => {
  const email = await envioAceito({ provedorId: "email-1" });
  const whatsapp = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });

  const consultas = [];
  const provedores = {
    email: banco.provedorFalso({ nome: "resend", consultarStatus: async (id) => (consultas.push(id), { status: "entregue", reclamacao: false, detalhe: "Resend: delivered" }) }),
  };
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 1);
  assert.deepEqual(consultas, ["email-1"], "o WhatsApp não tem consulta: depende dos recibos do webhook");
  assert.deepEqual(await situacao(email.id), ["entregue", null]);
  assert.deepEqual(await situacao(whatsapp.id), ["enviado", null]);

  // Consultado há pouco: só volta a perguntar depois do intervalo.
  const outro = await envioAceito({ provedorId: "email-2" });
  await banco.pool.query("UPDATE notificacao_envios SET status_consultado_em = NOW() WHERE id = $1", [outro.id]);
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 0);

  // Provedor fora do ar: nada muda, o erro vai para o log.
  await banco.pool.query("UPDATE notificacao_envios SET status_consultado_em = NULL");
  const logs = [];
  provedores.email.consultarStatus = async () => {
    throw new Error("Resend instável");
  };
  assert.equal(await consultarStatusDeEntrega({ provedores, log: (l) => logs.push(l) }), 0);
  assert.match(logs[0], /Resend instável/);

  // Provedor diferente do que enviou não é consultado; sem consulta disponível, nada a fazer.
  await banco.pool.query("UPDATE notificacao_envios SET status_consultado_em = NULL");
  provedores.email.nome = "outro";
  provedores.email.consultarStatus = async () => ({ status: "entregue", reclamacao: false, detalhe: "x" });
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 0);
  assert.equal(await consultarStatusDeEntrega({ provedores: { email: banco.provedorFalso({ nome: "simulado" }) } }), 0);

  const reclamado = await envioAceito({ provedorId: "email-9" });
  await banco.pool.query("UPDATE notificacao_envios SET status_consultado_em = NULL");
  provedores.email.nome = "resend";
  provedores.email.consultarStatus = async () => ({ status: "entregue", reclamacao: true, detalhe: "Resend: complained" });
  assert.equal(await consultarStatusDeEntrega({ provedores, log: () => {} }), 2);
  assert.equal((await obterConsentimentos(reclamado.produtor.id)).email.concedido, false);
});

// ---- Evolution API: autenticidade ---------------------------------------------------------

test("Evolution: sem segredo 503; JWT ausente, errado ou vencido 401; outra instância 403; corpo inválido 400", async () => {
  const { id } = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });
  assert.equal((await recibo("MSG-1", "DELIVERY_ACK", {})).status, 200);
  await banco.limparBanco();
  const outro = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });

  const tentativas = [
    [{ autorizacao: "" }, 401],
    [{ segredo: "outro-segredo" }, 401],
    [{ autorizacao: "Bearer " + jwtEvolution(SEGREDO_EVOLUTION, { agoraMs: Date.now() - 20 * 60 * 1000 }) }, 401],
    [{ instancia: "outra-instancia" }, 403],
    [{ corpo: "não é json" }, 400],
    [{ corpo: JSON.stringify({ instance: "agroalerta", data: {} }) }, 400],
  ];
  for (const [opcoes, esperado] of tentativas) {
    const resposta = await postarEvolution("messages.update", { keyId: "MSG-1", fromMe: true, status: "DELIVERY_ACK" }, opcoes);
    assert.equal(resposta.status, esperado, JSON.stringify(opcoes));
  }
  assert.deepEqual(await situacao(outro.id), ["enviado", null], "nada recusado foi aplicado");
  assert.ok(id);

  delete process.env.EVOLUTION_WEBHOOK_SECRET;
  const semSegredo = await recibo("MSG-1", "DELIVERY_ACK");
  assert.equal(semSegredo.status, 503);
  assert.match((await semSegredo.json()).erro, /EVOLUTION_WEBHOOK_SECRET/);
});

// ---- Evolution API: recibos ------------------------------------------------------------------

test("recibos do WhatsApp avançam: servidor, entrega e leitura, cada um com seu horário", async () => {
  const { id } = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });
  await recibo("MSG-1", "SERVER_ACK");
  let envio = await linha(id);
  assert.deepEqual([envio.status, Boolean(envio.confirmado_servidor_em), envio.entregue_em, envio.lido_em], ["confirmado_servidor", true, null, null]);
  await recibo("MSG-1", "DELIVERY_ACK");
  envio = await linha(id);
  assert.deepEqual([envio.status, Boolean(envio.entregue_em), envio.lido_em], ["entregue", true, null]);
  await recibo("MSG-1", "READ");
  envio = await linha(id);
  assert.deepEqual([envio.status, Boolean(envio.lido_em)], ["lido", true]);
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => [e.tipo, e.status]).slice(1), [
    ["webhook", "confirmado_servidor"], ["webhook", "entregue"], ["webhook", "lido"],
  ]);
});

test("recibos fora de ordem e repetidos não rebaixam nem duplicam; a leitura comprova a entrega", async () => {
  const { id } = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });
  await recibo("MSG-1", "READ");
  await recibo("MSG-1", "DELIVERY_ACK");
  await recibo("MSG-1", "SERVER_ACK");
  await recibo("MSG-1", "READ");
  await recibo("MSG-1", "PLAYED");
  const envio = await linha(id);
  assert.equal(envio.status, "lido");
  assert.ok(envio.confirmado_servidor_em && envio.entregue_em && envio.lido_em);
  const eventos = (await banco.eventosDoEnvio(id)).slice(1);
  assert.deepEqual(eventos.map((e) => e.status), ["lido", null, null, null], "o READ repetido nem vira evento");
  assert.match(eventos[1].detalhe, /DELIVERY_ACK \(repetido ou fora de ordem; estado mantido\)/);
  const { rows } = await banco.pool.query("SELECT evento_id FROM notificacao_webhooks ORDER BY id");
  assert.deepEqual(rows.map((r) => r.evento_id), [
    "messages.update:MSG-1:READ", "messages.update:MSG-1:DELIVERY_ACK", "messages.update:MSG-1:SERVER_ACK", "messages.update:MSG-1:PLAYED",
  ]);
});

test("ERROR do WhatsApp marca a falha de entrega, mas não desfaz uma entrega já confirmada", async () => {
  const falhou = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });
  await recibo("MSG-1", "ERROR");
  assert.deepEqual(await situacao(falhou.id), ["falhou", "falha_entrega"]);

  const entregue = await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-2" });
  await recibo("MSG-2", "DELIVERY_ACK");
  await recibo("MSG-2", "ERROR");
  await recibo("MSG-2", "DELETED");
  assert.deepEqual(await situacao(entregue.id), ["entregue", null]);
});

test("eventos que não são desta aplicação são ignorados sem guardar nada", async () => {
  await envioAceito({ canal: "whatsapp", provedor: "evolution", provedorId: "MSG-1" });
  // Mensagem recebida, grupo, status, recibo sem dados e mensagem digitada no celular do remetente.
  await recibo("MSG-1", "READ", { fromMe: false });
  await recibo("MSG-1", "READ", { remoteJid: "120363@g.us" });
  await recibo("MSG-1", "READ", { remoteJid: "status@broadcast" });
  await postarEvolution("messages.update", { fromMe: true });
  await recibo("DIGITADA-NO-CELULAR", "DELIVERY_ACK");
  await postarEvolution("qrcode.updated", { qrcode: { base64: "data:image/png;base64,SEGREDO" } });
  await postarEvolution("send.message", { key: { id: "OUTRA", remoteJid: "x@s.whatsapp.net", fromMe: false } });
  await postarEvolution("send.message", { key: { remoteJid: "x@s.whatsapp.net", fromMe: true } });
  // Transmitida por esta instância, mas sem envio conhecido nem envio saindo: não é nossa.
  await postarEvolution("send.message", { key: { id: "SEM-TEXTO", remoteJid: "553599993362@s.whatsapp.net", fromMe: true } });
  await postarEvolution("send.message", { key: { id: "FOTO", remoteJid: "553599993362@s.whatsapp.net", fromMe: true }, message: { imageMessage: {} } });
  await postarEvolution("messages.update", { keyId: "SEM-JID", fromMe: true, status: "READ" });
  await postarEvolution("chats.upsert", [{ remoteJid: "x" }]);
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS total FROM notificacao_webhooks");
  assert.equal(rows[0].total, 0);
});

test("eventos guardados antes do id são aplicados na ordem dos estados, com o erro por último", async () => {
  const produtor = await banco.criarProdutor({ email: "p@fazenda.com.br", telefone: TELEFONE, consentimentos: { whatsapp: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "whatsapp", tipo: "boas_vindas", chaveIdempotencia: "b", destino: TELEFONE,
    conteudo: "Olá", resumo: "Boas-vindas", maxTentativas: 5,
  });
  const whatsapp = banco.provedorFalso({
    nome: "evolution",
    reenvioSeguro: false,
    roteiro: [{ provedorId: "MSG-ORDEM" }],
    aoEnviar: async () => {
      for (const status of ["ERROR", "READ", "SERVER_ACK"]) await recibo("MSG-ORDEM", status);
      await recibo("MSG-ORDEM", "PENDING");
    },
  });
  await processarFila({ config: banco.configuracao(), provedores: { whatsapp }, log: () => {} });
  const envio = await linha(id);
  assert.deepEqual([envio.status, envio.erro_codigo], ["lido", null], "a leitura vale; o ERROR, aplicado por último, não rebaixa");
  const aplicados = (await banco.eventosDoEnvio(id)).map((e) => [e.status, e.detalhe]).slice(2);
  assert.deepEqual(aplicados.slice(0, 2), [["confirmado_servidor", "WhatsApp: SERVER_ACK"], ["lido", "WhatsApp: READ"]]);
  // Os sem estado próprio (ERROR, PENDING) vêm depois, em qualquer ordem entre si.
  assert.deepEqual(aplicados.slice(2).map((e) => e[1]).sort(), ["WhatsApp: ERROR", "WhatsApp: PENDING"]);
  assert.ok(aplicados.slice(2).every((e) => e[0] === null));
});

test("recibo que chega antes da resposta do envio é guardado e aplicado quando o id é gravado", async () => {
  const produtor = await banco.criarProdutor({ email: "p@fazenda.com.br", telefone: TELEFONE, consentimentos: { whatsapp: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "whatsapp", tipo: "boas_vindas", chaveIdempotencia: "b", destino: TELEFONE,
    conteudo: "Olá", resumo: "Boas-vindas", maxTentativas: 5,
  });
  // A Evolution avisa (send.message e SERVER_ACK) enquanto a resposta do envio ainda não voltou.
  const whatsapp = banco.provedorFalso({
    nome: "evolution",
    reenvioSeguro: false,
    roteiro: [{ provedorId: "MSG-RAPIDA" }],
    aoEnviar: async () => {
      await postarEvolution("send.message", { key: { id: "MSG-RAPIDA", remoteJid: "553599993362@s.whatsapp.net", fromMe: true }, message: { conversation: "Olá" } });
      await recibo("MSG-RAPIDA", "SERVER_ACK");
    },
  });
  await processarFila({ config: banco.configuracao(), provedores: { whatsapp }, log: () => {} });

  const envio = await linha(id);
  assert.deepEqual([envio.status, envio.provedor_id], ["confirmado_servidor", "MSG-RAPIDA"]);
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => [e.tipo, e.status]), [
    ["enfileirado", "pendente"], ["aceito", "enviado"], ["webhook", null], ["webhook", "confirmado_servidor"],
  ]);
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS pendentes FROM notificacao_webhooks WHERE processado_em IS NULL");
  assert.equal(rows[0].pendentes, 0);
});

test("resultado incerto se resolve com o send.message da Evolution (mesmo número e texto), sem reenvio", async () => {
  const produtor = await banco.criarProdutor({ email: "p@fazenda.com.br", telefone: TELEFONE, consentimentos: { whatsapp: true } });
  const fila = (chave, conteudo) =>
    enfileirar(banco.pool, {
      usuarioId: produtor.id, canal: "whatsapp", tipo: "alerta_climatico", chaveIdempotencia: chave, destino: TELEFONE,
      conteudo, resumo: "Risco de geada", maxTentativas: 5,
    });
  const semResposta = () => new ErroProvedor({ provedor: "evolution", codigo: "sem_resposta", mensagem: "sem resposta", temporario: false, incerto: true });

  // 1) O evento chega durante a chamada que fica sem resposta: o envio já sai como aceito.
  const durante = await fila("a", "Geada amanhã");
  await processarFila({
    config: banco.configuracao(),
    provedores: {
      whatsapp: banco.provedorFalso({
        nome: "evolution", reenvioSeguro: false, roteiro: [semResposta()],
        aoEnviar: () => postarEvolution("send.message", {
          key: { id: "MSG-A", remoteJid: "553599993362@s.whatsapp.net", fromMe: true },
          message: { extendedTextMessage: { text: "Geada amanhã" } },
        }),
      }),
    },
    log: () => {},
  });
  assert.deepEqual([(await linha(durante)).status, (await linha(durante)).provedor_id], ["enviado", "MSG-A"]);

  // 2) O evento chega depois: o envio incerto é resolvido; outro texto não resolve nada.
  const depois = await fila("b", "Geada depois de amanhã");
  const diferente = await fila("c", "Outro texto");
  await processarFila({
    config: banco.configuracao(),
    provedores: { whatsapp: banco.provedorFalso({ nome: "evolution", reenvioSeguro: false, roteiro: [semResposta(), semResposta()] }) },
    log: () => {},
  });
  assert.deepEqual([(await linha(depois)).status, (await linha(diferente)).status], ["incerto", "incerto"]);
  await postarEvolution("send.message", {
    key: { id: "MSG-B", remoteJid: "553599993362@s.whatsapp.net", fromMe: true }, message: { conversation: "Geada depois de amanhã" },
  });
  await recibo("MSG-B", "DELIVERY_ACK");
  assert.deepEqual([(await linha(depois)).status, (await linha(depois)).provedor_id], ["entregue", "MSG-B"]);
  assert.equal((await linha(diferente)).status, "incerto");
  assert.ok((await banco.eventosDoEnvio(depois)).some((e) => e.tipo === "incerto_resolvido"));
});

// ---- Evolution API: conexão ---------------------------------------------------------------

test("conexão aberta, número inesperado e queda viram registros de auditoria (sem repetir)", async () => {
  await postarEvolution("connection.update", { instance: "agroalerta", wuid: "553599999503@s.whatsapp.net", profileName: "Luiz", state: "open", statusReason: 200 });
  const queda = { instance: "agroalerta", state: "close", statusReason: 401 };
  await postarEvolution("connection.update", queda, { corpo: JSON.stringify({ event: "connection.update", instance: "agroalerta", data: queda }) });
  await postarEvolution("connection.update", queda, { corpo: JSON.stringify({ event: "connection.update", instance: "agroalerta", data: queda }) });
  await postarEvolution("connection.update", { instance: "agroalerta", state: "connecting", statusReason: 200 });
  await postarEvolution("connection.update", { instance: "agroalerta", wuid: "553588881111@s.whatsapp.net", state: "open" });
  await postarEvolution("connection.update", { instance: "agroalerta", state: "refused", statusReason: 999 });
  await postarEvolution("connection.update", { instance: "agroalerta", state: "open" });
  await postarEvolution("connection.update", { instance: "agroalerta", state: "close" });
  await postarEvolution("connection.update", null);

  const eventos = (await listarEventosAdmin(10)).reverse();
  assert.deepEqual(eventos.map((e) => e.tipo), ["conectado", "desconectado", "remetente_inesperado", "desconectado", "remetente_inesperado", "desconectado"]);
  assert.equal(eventos[0].detalhe, "WhatsApp conectado: (35) 99999-9503.");
  assert.match(eventos[1].detalhe, /sessão foi encerrada no celular/);
  assert.match(eventos[2].detalhe, /\(35\) 98888-1111\): envios bloqueados/);
  assert.match(eventos[3].detalhe, /código 999/);
  assert.match(eventos[4].detalhe, /número não informado/);
  assert.match(eventos[5].detalhe, /código desconhecido/);
  const { rows } = await banco.pool.query("SELECT payload FROM notificacao_webhooks WHERE tipo = 'connection.update' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(rows[0].payload, { estado: null, motivo: null }, "evento sem dados fica registrado, sem estado");
});

test("falha inesperada no processamento do webhook responde 500", async (t) => {
  t.mock.method(banco.pool, "query", async () => {
    throw new Error("banco fora do ar");
  });
  t.mock.method(console, "error", () => {});
  assert.equal((await recibo("MSG-1", "DELIVERY_ACK")).status, 500);
  const vazio = await fetch(url + "/evolution", { method: "POST" });
  assert.equal(vazio.status, 401, "sem corpo e sem JWT");
});
