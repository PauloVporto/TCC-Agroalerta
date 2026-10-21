const banco = require("./helpers/banco");
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { iniciarEvolutionFalsa, ERRO } = require("./helpers/evolutionFalsa");
const { enfileirar, processarFila } = require("../../services/notificacoes/fila");
const { provedoresDaConfiguracao } = require("../../services/notificacoes/provedores");
const whatsapp = require("../../services/notificacoes/whatsapp");
const { listarEventosAdmin } = require("../../services/notificacoes/controle");
const { whatsappBoasVindas } = require("../../services/notificacoes/templates");

const TELEFONE = "+5535999993362";
const SEGREDO_WEBHOOK = "segredo-do-webhook";
let evolution;

before(() => banco.prepararBanco());
beforeEach(async () => {
  await banco.limparBanco();
  evolution = await iniciarEvolutionFalsa();
});
afterEach(() => evolution.fechar());
after(() => banco.pool.end());

function config(env = {}) {
  return banco.configuracao({
    ...evolution.env,
    EVOLUTION_WEBHOOK_URL: "http://backend:3001/api/notificacoes/webhooks/evolution",
    EVOLUTION_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
    ...env,
  });
}

function processarComEvolution(cfg = config()) {
  return processarFila({ config: cfg, provedores: { whatsapp: provedoresDaConfiguracao(cfg).whatsapp }, log: () => {} });
}

async function boasVindasNaFila({ email = "agricultor@teste.com", telefone = TELEFONE } = {}) {
  const produtor = await banco.criarProdutor({ email, telefone, consentimentos: { whatsapp: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "whatsapp", tipo: "boas_vindas", chaveIdempotencia: `boas_vindas:whatsapp:usuario:${produtor.id}`,
    destino: telefone, conteudo: whatsappBoasVindas(), resumo: "Boas-vindas ao Agro Alerta", maxTentativas: 5,
  });
  return { produtor, id };
}

async function envio(id) {
  return (await banco.listarEnvios()).find((e) => e.id === id);
}

// ---- Liberação do despacho --------------------------------------------------------

test("travas fechadas retêm o despacho sem chamar a Evolution API", async () => {
  const casos = [
    [config({ WHATSAPP_SENDING_ENABLED: "false" }), /WHATSAPP_SENDING_ENABLED=false/],
    [config({ EVOLUTION_API_URL: "" }), /Evolution API não configurada/],
    [config({ WHATSAPP_EXPECTED_SENDER: "" }), /WHATSAPP_EXPECTED_SENDER/],
    [config(), /bloqueados pelo administrador/], // o padrão da migration: bloqueado
  ];
  for (const [cfg, motivo] of casos) {
    const liberacao = await whatsapp.liberacaoDoDespacho(cfg);
    assert.deepEqual(liberacao.tipos, []);
    assert.match(liberacao.motivo, motivo);
  }
  await banco.definirControle({ boasVindasAtivas: false, alertasAtivos: false });
  assert.match((await whatsapp.liberacaoDoDespacho(config())).motivo, /Boas-vindas e alertas automáticos bloqueados/);
  assert.equal(evolution.requisicoes.length, 0);
});

test("com as travas do administrador abertas, a conexão real decide", async () => {
  await banco.definirControle();
  const liberada = await whatsapp.liberacaoDoDespacho(config());
  assert.deepEqual(liberada, { tipos: ["boas_vindas", "alerta_climatico"], motivo: null, remetente: "+5535999999503" });

  await banco.definirControle({ boasVindasAtivas: false });
  assert.deepEqual((await whatsapp.liberacaoDoDespacho(config())).tipos, ["alerta_climatico"]);
  await banco.definirControle();

  evolution.estado.conexao = "connecting";
  assert.match((await whatsapp.liberacaoDoDespacho(config())).motivo, /WhatsApp desconectado \(estado: connecting\)/);
  evolution.estado.conexao = "open";
  evolution.estado.numero = "553599991111@s.whatsapp.net";
  assert.match((await whatsapp.liberacaoDoDespacho(config())).motivo, /não é o remetente esperado \(final 9503\)/);
  evolution.estado.existe = false;
  assert.match((await whatsapp.liberacaoDoDespacho(config())).motivo, /ainda não foi criada/);
  assert.match((await whatsapp.liberacaoDoDespacho(config({ EVOLUTION_API_KEY: "errada" }))).motivo, /Evolution API indisponível: .*recusada/);

  evolution.estado.existe = true;
  evolution.estado.conexao = null;
  assert.match((await whatsapp.liberacaoDoDespacho(config())).motivo, /WhatsApp desconectado \(estado: desconhecido\)/);

  await evolution.fechar();
  assert.match((await whatsapp.liberacaoDoDespacho(config())).motivo, /Evolution API indisponível: .*sem conexão/);
});

test("sem a linha de controle no banco, a liberação nunca é presumida: tudo fica bloqueado", async () => {
  await banco.pool.query("DELETE FROM whatsapp_controle");
  const liberacao = await whatsapp.liberacaoDoDespacho(config());
  assert.deepEqual(liberacao.tipos, []);
  assert.match(liberacao.motivo, /bloqueados pelo administrador/);
  assert.equal((await whatsapp.estadoParaPainel(config({ WHATSAPP_EXPECTED_SENDER: "" }))).remetenteEsperadoFinal, null);
});

// ---- Envio pela Evolution (HTTP de verdade) -------------------------------------------

test("boas-vindas saem pela instância agroalerta, para o número do agricultor, com a apikey", async () => {
  const { id } = await boasVindasNaFila();
  await banco.definirControle();
  await processarComEvolution();

  const [chamada, ...outras] = evolution.envios();
  assert.equal(outras.length, 0);
  assert.equal(chamada.caminho, "/message/sendText/agroalerta");
  assert.equal(chamada.apikey, "chave-de-teste");
  assert.deepEqual(chamada.corpo, { number: "5535999993362", text: whatsappBoasVindas() });
  const final = await envio(id);
  assert.deepEqual(
    [final.status, final.provedor, final.provedor_id, final.remetente, final.destino],
    ["enviado", "evolution", "MSG-1", "+5535999999503", TELEFONE]
  );
});

test("WhatsApp desconectado: a mensagem espera e sai quando a conexão volta", async () => {
  const { id } = await boasVindasNaFila();
  await banco.definirControle();
  evolution.estado.conexao = "close";
  await processarComEvolution();
  assert.deepEqual([(await envio(id)).status, (await envio(id)).tentativas], ["pendente", 0]);
  assert.equal(evolution.envios().length, 0);

  evolution.estado.conexao = "open";
  await processarComEvolution();
  assert.equal((await envio(id)).status, "enviado");
});

test("sem resposta da Evolution (tempo esgotado ou conexão derrubada): incerto, sem reenvio", async () => {
  const lento = await boasVindasNaFila({ email: "a@teste.com" });
  const derrubado = await boasVindasNaFila({ email: "b@teste.com", telefone: "+5535988882222" });
  await banco.definirControle();
  evolution.estado.respostasEnvio.push({ atrasoMs: 1500 }, { derrubar: true });
  const cfg = config({ EVOLUTION_REQUEST_TIMEOUT_MS: "300" });
  await processarComEvolution(cfg);
  await banco.liberarRetentativas();
  await processarComEvolution(cfg);

  for (const id of [lento.id, derrubado.id]) {
    const final = await envio(id);
    assert.deepEqual([final.status, final.erro_codigo, final.tentativas], ["incerto", "sem_resposta", 1]);
  }
  assert.equal(evolution.envios().length, 2, "cada mensagem foi pedida uma única vez");
});

test("número sem WhatsApp falha; 5xx da Evolution é incerto; chave recusada volta à fila", async () => {
  const semWhatsapp = await boasVindasNaFila({ email: "a@teste.com" });
  const cincoXX = await boasVindasNaFila({ email: "b@teste.com", telefone: "+5535988882222" });
  const chave = await boasVindasNaFila({ email: "c@teste.com", telefone: "+5535977773333" });
  await banco.definirControle();
  evolution.estado.respostasEnvio.push(
    { status: 400, corpo: ERRO(400, [{ exists: false, jid: "5535999993362@s.whatsapp.net", number: "5535999993362" }]) },
    { status: 500, corpo: ERRO(500, ["Connection Closed"]) },
    { status: 401, corpo: ERRO(401, "Unauthorized") }
  );
  await processarComEvolution();

  assert.deepEqual([(await envio(semWhatsapp.id)).status, (await envio(semWhatsapp.id)).erro_codigo], ["falhou", "numero_sem_whatsapp"]);
  assert.deepEqual([(await envio(cincoXX.id)).status, (await envio(cincoXX.id)).erro_codigo], ["incerto", "resultado_incerto"]);
  assert.deepEqual([(await envio(chave.id)).status, (await envio(chave.id)).erro_codigo], ["pendente", "credencial_invalida"]);
});

test("o administrador bloqueia no meio da rodada: o que ainda não saiu fica na fila", async () => {
  const primeiro = await boasVindasNaFila({ email: "a@teste.com" });
  const segundo = await boasVindasNaFila({ email: "b@teste.com", telefone: "+5535988882222" });
  await banco.definirControle();
  evolution.estado.aoReceberEnvio = () => banco.definirControle({ enviosBloqueados: true });
  await processarComEvolution();

  assert.equal((await envio(primeiro.id)).status, "enviado");
  const retido = await envio(segundo.id);
  assert.deepEqual([retido.status, retido.tentativas, retido.erro_codigo], ["pendente", 0, "envios_bloqueados"]);
  assert.equal(evolution.envios().length, 1);
});

test("ritmo: limite por produtor adia para amanhã; limite por hora interrompe a rodada; intervalo mínimo entre mensagens", async () => {
  const { produtor, id } = await boasVindasNaFila();
  const segundoDoMesmo = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "whatsapp", tipo: "alerta_climatico", chaveIdempotencia: "alerta:1:whatsapp",
    destino: TELEFONE, conteudo: "geada", resumo: "Risco de geada", maxTentativas: 5,
  });
  await banco.definirControle();
  await processarComEvolution(config({ WHATSAPP_PER_USER_DAILY_LIMIT: "1" }));
  assert.equal((await envio(id)).status, "enviado");
  const adiado = await envio(segundoDoMesmo);
  assert.deepEqual([adiado.status, adiado.tentativas, adiado.erro_codigo], ["pendente", 0, "limite_produtor_diario"]);
  assert.ok(new Date(adiado.proxima_tentativa_em) > new Date(), "adiado para o próximo dia");

  await banco.limparBanco();
  await banco.definirControle();
  const a = await boasVindasNaFila({ email: "a@teste.com" });
  const b = await boasVindasNaFila({ email: "b@teste.com", telefone: "+5535988882222" });
  await processarComEvolution(config({ WHATSAPP_HOURLY_LIMIT: "1" }));
  assert.equal((await envio(a.id)).status, "enviado");
  assert.deepEqual([(await envio(b.id)).status, (await envio(b.id)).erro_codigo], ["pendente", "limite_por_hora"]);

  await banco.limparBanco();
  await banco.definirControle();
  const hoje = await boasVindasNaFila({ email: "a@teste.com" });
  const amanha = await boasVindasNaFila({ email: "b@teste.com", telefone: "+5535988882222" });
  await processarComEvolution(config({ WHATSAPP_DAILY_LIMIT: "1" }));
  assert.equal((await envio(hoje.id)).status, "enviado");
  assert.deepEqual([(await envio(amanha.id)).status, (await envio(amanha.id)).erro_codigo], ["pendente", "limite_diario"]);

  await banco.limparBanco();
  await banco.definirControle();
  await boasVindasNaFila({ email: "a@teste.com" });
  await boasVindasNaFila({ email: "b@teste.com", telefone: "+5535988882222" });
  const instantes = [];
  evolution.estado.aoReceberEnvio = () => instantes.push(Date.now());
  await processarComEvolution(config({ WHATSAPP_MIN_INTERVAL_MS: "400" }));
  assert.equal(instantes.length, 2);
  assert.ok(instantes[1] - instantes[0] >= 350, "intervalo de " + (instantes[1] - instantes[0]) + " ms");
});

// ---- Painel do administrador -----------------------------------------------------------

test("conectar cria a instância, configura o webhook com JWT e devolve o QR Code, tudo auditado", async () => {
  const admin = await banco.criarProdutor({ nome: "Admin", email: "admin@teste.com", papel: "admin" });
  evolution.estado.existe = false;
  const estado = await whatsapp.conectar(config(), admin.id);

  const criada = evolution.requisicoes.find((r) => r.caminho === "/instance/create");
  assert.deepEqual([criada.corpo.instanceName, criada.corpo.integration, criada.corpo.qrcode], ["agroalerta", "WHATSAPP-BAILEYS", false]);
  assert.deepEqual(evolution.estado.webhook, {
    enabled: true, url: "http://backend:3001/api/notificacoes/webhooks/evolution", headers: { jwt_key: SEGREDO_WEBHOOK },
    byEvents: false, base64: false, events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"],
  });
  assert.equal(estado.conexao.estado, "connecting");
  assert.equal(estado.conexao.qrCode, "data:image/png;base64,QRCODE");
  assert.equal(estado.webhook.emDia, true);
  assert.deepEqual((await listarEventosAdmin(10)).map((e) => [e.tipo, e.autor]).reverse(), [
    ["instancia_criada", "Admin"],
    ["pareamento_solicitado", "Admin"],
  ]);

  evolution.estado.conexao = "open";
  await whatsapp.conectar(config(), admin.id);
  assert.equal((await listarEventosAdmin(1))[0].tipo, "ja_conectado");
});

test("o estado do painel mostra número, remetente e travas, mas nunca token, apikey ou segredo", async () => {
  await banco.definirControle();
  await whatsapp.conectar(config(), null);
  const estado = await whatsapp.estadoParaPainel(config());
  assert.deepEqual(estado.conexao, {
    existe: true, estado: "open", numero: "(35) 99999-9503", perfil: "Agro Alerta", remetenteValido: true,
    qrCode: null, motivoDesconexao: null, desconectadaEm: null,
  });
  assert.deepEqual(
    [estado.instancia, estado.modo, estado.remetenteEsperadoFinal, estado.envioLiberado, estado.motivoRetencao],
    ["agroalerta", "real", "9503", true, null]
  );
  assert.deepEqual(estado.evolution, { configurada: true, disponivel: true, erro: null });
  const json = JSON.stringify(estado);
  for (const segredo of ["TOKEN-DA-INSTANCIA", "chave-de-teste", SEGREDO_WEBHOOK]) assert.ok(!json.includes(segredo), segredo);

  evolution.estado.numero = "553588881111@s.whatsapp.net";
  const outroNumero = await whatsapp.estadoParaPainel(config());
  assert.deepEqual([outroNumero.conexao.remetenteValido, outroNumero.envioLiberado], [false, false]);

  await evolution.fechar();
  const fora = await whatsapp.estadoParaPainel(config());
  assert.deepEqual([fora.evolution.disponivel, fora.conexao.existe], [false, false]);
  assert.match(fora.evolution.erro, /sem conexão/);
  assert.equal((await whatsapp.estadoParaPainel(config({ EVOLUTION_API_KEY: "" }))).evolution.configurada, false);
});

test("reconectar reinicia uma conexão aberta e pede pareamento quando fechada; desconectar faz logout", async () => {
  await whatsapp.reconectar(config(), null);
  assert.ok(evolution.requisicoes.some((r) => r.metodo === "POST" && r.caminho === "/instance/restart/agroalerta"));

  evolution.estado.conexao = null;
  const reconectando = await whatsapp.reconectar(config(), null);
  assert.equal(reconectando.conexao.estado, "connecting", "estado desconhecido: pede o pareamento");
  assert.equal(reconectando.conexao.qrCode, "data:image/png;base64,QRCODE");
  assert.match((await listarEventosAdmin(1))[0].detalhe, /estado anterior: desconhecido/);

  evolution.estado.conexao = "open";
  const desconectado = await whatsapp.desconectar(config(), null);
  assert.ok(evolution.requisicoes.some((r) => r.metodo === "DELETE" && r.caminho === "/instance/logout/agroalerta"));
  assert.equal(desconectado.conexao.estado, "close");
  assert.deepEqual((await listarEventosAdmin(10)).map((e) => e.tipo).reverse(), [
    "reconexao_solicitada", "reconexao_solicitada", "desconectado_pelo_administrador",
  ]);
});
