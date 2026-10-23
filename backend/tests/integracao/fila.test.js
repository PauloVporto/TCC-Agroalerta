const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  enfileirar,
  cancelarPendentesDoProdutor,
  registrarTesteManual,
  concluirTesteManual,
} = require("../../services/notificacoes/fila");
const { ErroProvedor } = require("../../services/notificacoes/provedores/comum");
const { registrarConsentimento } = require("../../services/notificacoes/consentimentos");
const { lerConfiguracao } = require("../../services/notificacoes/config");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

function erro(codigo, temporario, provedor = "resend", incerto = false) {
  return new ErroProvedor({ provedor, codigo, mensagem: `${provedor}: ${codigo}`, temporario, incerto });
}

const TELEFONE = "+5535999993362";

async function produtorComEnvio({
  canal = "email", tipo = "boas_vindas", maxTentativas = 5, chave = "chave-1",
  consentimentos = { email: true, whatsapp: true }, expiraEm = null, conteudo = "Agro Alerta: teste",
} = {}) {
  const produtor = await banco.criarProdutor({ email: "p@fazenda.com.br", telefone: TELEFONE, consentimentos });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id,
    canal,
    tipo,
    chaveIdempotencia: chave,
    destino: canal === "email" ? produtor.email : produtor.telefone,
    assunto: canal === "email" ? "Bem-vindo ao Agro Alerta!" : null,
    conteudo,
    conteudoHtml: canal === "email" ? "<p>teste</p>" : null,
    resumo: "Boas-vindas ao Agro Alerta",
    maxTentativas,
    expiraEm,
  });
  return { produtor, id };
}

async function envio(id) {
  return (await banco.listarEnvios()).find((e) => e.id === id);
}

function whatsappFalso(opcoes = {}) {
  return banco.provedorFalso({ nome: "evolution", reenvioSeguro: false, ...opcoes });
}

// ---- E-mail (o comportamento da fila que já existia) --------------------------------

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

test("erro inesperado (fora do provedor) no e-mail é reagendado: o Resend descarta repetições", async () => {
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
  const semEmail = await produtorComEnvio();
  await banco.pool.query("UPDATE usuarios SET email = 'quebrado' WHERE id = $1", [semEmail.produtor.id]);
  await banco.processar();
  assert.equal((await envio(semEmail.id)).erro_codigo, "email_invalido");
});

test("reinício do backend: envio de e-mail preso em processando volta à fila quando a trava vence", async () => {
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
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => e.tipo), ["enfileirado", "retomado", "aceito"]);
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

test("modo simulado do e-mail fica registrado no histórico", async () => {
  const simulado = await produtorComEnvio();
  const { provedoresDaConfiguracao } = require("../../services/notificacoes/provedores");
  const { email } = provedoresDaConfiguracao(lerConfiguracao({}));
  await banco.processar({ email });
  const registrado = await envio(simulado.id);
  assert.deepEqual([registrado.status, registrado.modo, registrado.provedor], ["simulado", "simulado", "simulado"]);
  assert.match(registrado.provedor_id, /^simulado-/);
  assert.deepEqual((await banco.eventosDoEnvio(simulado.id)).map((e) => e.tipo), ["enfileirado", "simulado"]);
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

// ---- WhatsApp ---------------------------------------------------------------------

test("WhatsApp aceito pela API fica 'enviado' com o id da mensagem e o remetente conectado", async () => {
  const { id } = await produtorComEnvio({ canal: "whatsapp" });
  const whatsapp = whatsappFalso({
    roteiro: [{ provedorId: "MSG-1" }],
    liberacao: { tipos: ["boas_vindas", "alerta_climatico"], motivo: null, remetente: "+5535999999503" },
  });
  await banco.processar({ whatsapp });
  const final = await envio(id);
  assert.deepEqual(
    [final.status, final.provedor, final.provedor_id, final.destino, final.remetente, final.modo],
    ["enviado", "evolution", "MSG-1", TELEFONE, "+5535999999503", "real"]
  );
  assert.ok(final.tentativa_iniciada_em, "a tentativa fica registrada antes da chamada");
  assert.equal(whatsapp.enviados[0].destino, TELEFONE);
  assert.equal(whatsapp.enviados[0].texto, "Agro Alerta: teste");
  assert.deepEqual((await banco.eventosDoEnvio(id)).map((e) => e.tipo), ["enfileirado", "aceito"]);
});

test("travas fechadas retêm o WhatsApp na fila sem gastar tentativa; liberado, ele sai", async () => {
  const { id } = await produtorComEnvio({ canal: "whatsapp" });
  const retido = whatsappFalso({ liberacao: { tipos: [], motivo: "Envios do WhatsApp bloqueados pelo administrador.", remetente: null } });
  await banco.processar({ whatsapp: retido });
  assert.equal(retido.enviados.length, 0);
  assert.deepEqual([(await envio(id)).status, (await envio(id)).tentativas], ["pendente", 0]);

  // Só as boas-vindas bloqueadas: alertas saem, boas-vindas esperam.
  const alerta = await enfileirar(banco.pool, {
    usuarioId: (await envio(id)).usuario_id, canal: "whatsapp", tipo: "alerta_climatico", chaveIdempotencia: "alerta:9:whatsapp",
    destino: TELEFONE, conteudo: "geada", resumo: "Risco de geada", maxTentativas: 5,
  });
  const soAlertas = whatsappFalso({ liberacao: { tipos: ["alerta_climatico"], motivo: null, remetente: null } });
  await banco.processar({ whatsapp: soAlertas });
  assert.deepEqual(soAlertas.enviados.map((m) => m.texto), ["geada"]);
  assert.deepEqual([(await envio(id)).status, (await envio(alerta)).status], ["pendente", "enviado"]);

  await banco.processar({ whatsapp: whatsappFalso() });
  assert.equal((await envio(id)).status, "enviado");
});

test("resultado incerto nunca é reenviado automaticamente", async () => {
  const { id } = await produtorComEnvio({ canal: "whatsapp" });
  const whatsapp = whatsappFalso({ roteiro: [erro("sem_resposta", false, "evolution", true)] });
  await banco.processar({ whatsapp });
  await banco.liberarRetentativas();
  await banco.processar({ whatsapp });
  await banco.processar({ whatsapp });
  const final = await envio(id);
  assert.deepEqual([final.status, final.erro_codigo, final.tentativas], ["incerto", "sem_resposta", 1]);
  assert.equal(whatsapp.enviados.length, 1, "uma única chamada");
  assert.match((await banco.eventosDoEnvio(id)).at(-1).detalhe, /não será reenviada automaticamente/);
});

test("erro inesperado depois de chamar a Evolution também é incerto, nunca reagendado", async () => {
  const { id } = await produtorComEnvio({ canal: "whatsapp" });
  const whatsapp = whatsappFalso({ roteiro: [new Error("bug depois da chamada")] });
  await banco.processar({ whatsapp });
  const final = await envio(id);
  assert.deepEqual([final.status, final.erro_codigo, final.erro_mensagem], ["incerto", "erro_interno", "bug depois da chamada"]);
});

test("falha comprovadamente anterior ao envio (sem conexão) é reagendada; número sem WhatsApp falha", async () => {
  const semConexao = await produtorComEnvio({ canal: "whatsapp" });
  await banco.processar({ whatsapp: whatsappFalso({ roteiro: [erro("falha_conexao", true, "evolution")] }) });
  const reagendado = await envio(semConexao.id);
  assert.deepEqual([reagendado.status, reagendado.erro_codigo, reagendado.tentativas], ["pendente", "falha_conexao", 1]);

  await banco.limparBanco();
  const semWhatsapp = await produtorComEnvio({ canal: "whatsapp" });
  await banco.processar({ whatsapp: whatsappFalso({ roteiro: [erro("numero_sem_whatsapp", false, "evolution")] }) });
  assert.deepEqual([(await envio(semWhatsapp.id)).status, (await envio(semWhatsapp.id)).erro_codigo], ["falhou", "numero_sem_whatsapp"]);
});

test("reinício no meio de um envio do WhatsApp: se a chamada já tinha começado, o resultado é incerto", async () => {
  const comecou = await produtorComEnvio({ canal: "whatsapp", chave: "a" });
  const naoComecou = await enfileirar(banco.pool, {
    usuarioId: comecou.produtor.id, canal: "whatsapp", tipo: "boas_vindas", chaveIdempotencia: "b",
    destino: TELEFONE, conteudo: "y", resumo: "y", maxTentativas: 5,
  });
  await banco.pool.query(
    `UPDATE notificacao_envios SET status = 'processando', tentativas = 1, processando_ate = NOW() - INTERVAL '1 second',
            tentativa_iniciada_em = CASE WHEN id = $1 THEN NOW() - INTERVAL '3 minutes' END
     WHERE id IN ($1, $2)`,
    [comecou.id, naoComecou]
  );
  const whatsapp = whatsappFalso();
  await banco.processar({ whatsapp });

  const incerto = await envio(comecou.id);
  assert.deepEqual([incerto.status, incerto.erro_codigo], ["incerto", "resultado_incerto"]);
  assert.match(incerto.erro_mensagem, /O backend parou durante o envio/);
  assert.equal((await envio(naoComecou)).status, "enviado", "a chamada não tinha começado: pode sair");
  assert.deepEqual(whatsapp.enviados.map((m) => m.texto), ["y"]);
});

test("mensagem vencida expira sem sair; dentro da validade sai normalmente", async () => {
  const vencida = await produtorComEnvio({ canal: "whatsapp", chave: "v", expiraEm: new Date(Date.now() - 1000) });
  const valida = await enfileirar(banco.pool, {
    usuarioId: vencida.produtor.id, canal: "whatsapp", tipo: "alerta_climatico", chaveIdempotencia: "ok",
    destino: TELEFONE, conteudo: "ok", resumo: "ok", maxTentativas: 5, expiraEm: new Date(Date.now() + 60 * 60 * 1000),
  });
  const whatsapp = whatsappFalso();
  await banco.processar({ whatsapp });
  const expirado = await envio(vencida.id);
  assert.deepEqual([expirado.status, expirado.erro_codigo, expirado.tentativas], ["expirado", "validade_vencida", 0]);
  assert.equal((await envio(valida)).status, "enviado");
  assert.deepEqual(whatsapp.enviados.map((m) => m.texto), ["ok"]);
});

test("WhatsApp: autorização dada para outro número não vale; o celular precisa ser autorizado de novo", async () => {
  const { produtor, id } = await produtorComEnvio({ canal: "whatsapp" });
  await banco.pool.query("UPDATE usuarios SET telefone = '+5535988887777' WHERE id = $1", [produtor.id]);
  const whatsapp = whatsappFalso();
  await banco.processar({ whatsapp });
  assert.deepEqual([(await envio(id)).status, (await envio(id)).erro_codigo], ["bloqueado", "telefone_alterado"]);
  assert.equal(whatsapp.enviados.length, 0);

  await banco.limparBanco();
  const fixo = await produtorComEnvio({ canal: "whatsapp" });
  await banco.pool.query("UPDATE usuarios SET telefone = '+553534710000' WHERE id = $1", [fixo.produtor.id]);
  await registrarConsentimento(banco.pool, { usuarioId: fixo.produtor.id, canal: "whatsapp", concedido: true, destino: "+553534710000", origem: "painel" });
  await banco.processar();
  assert.deepEqual([(await envio(fixo.id)).status, (await envio(fixo.id)).erro_codigo], ["bloqueado", "telefone_invalido"]);

  await banco.limparBanco();
  const smsAntigo = await produtorComEnvio({ canal: "whatsapp", consentimentos: { sms: true } });
  await banco.processar();
  assert.deepEqual(
    [(await envio(smsAntigo.id)).status, (await envio(smsAntigo.id)).erro_codigo],
    ["bloqueado", "sem_consentimento"],
    "consentimento de SMS não autoriza WhatsApp"
  );
});

test("vez negada (limite ou bloqueio recente) adia sem gastar tentativa; limite global interrompe a rodada", async () => {
  const primeiro = await produtorComEnvio({ canal: "whatsapp", chave: "a" });
  const segundo = await enfileirar(banco.pool, {
    usuarioId: primeiro.produtor.id, canal: "whatsapp", tipo: "boas_vindas", chaveIdempotencia: "b",
    destino: TELEFONE, conteudo: "y", resumo: "y", maxTentativas: 5,
  });
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const consultas = [];
  const whatsapp = whatsappFalso({
    reservarVez: async (e) => {
      consultas.push(Number(e.id));
      return { ok: false, global: true, ate: amanha, codigo: "limite_diario", mensagem: "Limite diário atingido." };
    },
  });
  await banco.processar({ whatsapp });
  assert.deepEqual(consultas, [primeiro.id], "o segundo nem é tentado");
  const adiado = await envio(primeiro.id);
  assert.deepEqual([adiado.status, adiado.tentativas, adiado.erro_codigo], ["pendente", 0, "limite_diario"]);
  assert.equal(new Date(adiado.proxima_tentativa_em).getTime(), amanha.getTime());
  assert.equal((await envio(segundo)).status, "pendente");
  assert.equal(whatsapp.enviados.length, 0);
  assert.deepEqual((await banco.eventosDoEnvio(primeiro.id)).map((e) => e.tipo), ["enfileirado", "adiado"]);
});

test("um único despachante de WhatsApp por vez: com a trava ocupada, a rodada é pulada", async () => {
  const { id } = await produtorComEnvio({ canal: "whatsapp" });
  const outroProcesso = await banco.pool.connect();
  try {
    await outroProcesso.query("SELECT pg_advisory_lock(hashtext('agroalerta_despacho_whatsapp'))");
    const whatsapp = { ...whatsappFalso(), despachoExclusivo: true };
    await banco.processar({ whatsapp });
    assert.equal(whatsapp.enviados.length, 0);
    assert.equal((await envio(id)).status, "pendente");
    await outroProcesso.query("SELECT pg_advisory_unlock(hashtext('agroalerta_despacho_whatsapp'))");
    await banco.processar({ whatsapp });
    assert.equal((await envio(id)).status, "enviado");
  } finally {
    outroProcesso.release();
  }
});

test("cancelar os pendentes de um produtor num canal não mexe nos outros canais nem nos já enviados", async () => {
  const { produtor, id } = await produtorComEnvio({ canal: "whatsapp", chave: "w" });
  const email = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "email", tipo: "boas_vindas", chaveIdempotencia: "e",
    destino: produtor.email, conteudo: "e", resumo: "e", maxTentativas: 5,
  });
  assert.equal(await cancelarPendentesDoProdutor(banco.pool, produtor.id, "whatsapp", "O produtor revogou a autorização do WhatsApp."), 1);
  const cancelado = await envio(id);
  assert.deepEqual([cancelado.status, cancelado.erro_codigo], ["cancelado", "cancelado"]);
  assert.equal((await envio(email)).status, "pendente");
  await banco.processar({ whatsapp: whatsappFalso() });
  assert.equal((await envio(id)).status, "cancelado", "cancelado não volta para a fila");
});

test("teste manual fica no histórico, fora do alcance da fila automática", async () => {
  const id = await registrarTesteManual({ canal: "whatsapp", destino: TELEFONE, conteudo: "teste", provedor: "evolution", modo: "real", remetente: "+5535999999503" });
  const whatsapp = whatsappFalso();
  await banco.processar({ whatsapp });
  assert.equal(whatsapp.enviados.length, 0);

  await concluirTesteManual(id, { provedorId: "MSG-teste" });
  const aceito = await envio(id);
  assert.deepEqual(
    [aceito.tipo, aceito.status, aceito.provedor_id, aceito.usuario_id, aceito.remetente],
    ["teste", "enviado", "MSG-teste", null, "+5535999999503"]
  );

  const incerto = await registrarTesteManual({ canal: "whatsapp", destino: TELEFONE, conteudo: "t", provedor: "evolution", modo: "real" });
  await concluirTesteManual(incerto, { erro: erro("sem_resposta", false, "evolution", true) });
  assert.equal((await envio(incerto)).status, "incerto");

  const falho = await registrarTesteManual({ canal: "email", destino: "eu@exemplo.com", assunto: "t", conteudo: "t", provedor: "resend", modo: "real" });
  await concluirTesteManual(falho, { erro: erro("remetente_de_teste", false) });
  await concluirTesteManual(falho, { erro: new Error("sem código") });
  assert.deepEqual([(await envio(falho)).status, (await envio(falho)).erro_codigo], ["falhou", "erro_interno"]);
  assert.deepEqual((await banco.eventosDoEnvio(falho)).map((e) => e.tipo), ["teste_manual", "falhou", "falhou"]);
});
