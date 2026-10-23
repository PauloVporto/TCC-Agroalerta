const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const evolution = require("../services/notificacoes/provedores/evolution");
const { resposta } = require("./helpers/http");

afterEach(() => mock.restoreAll());

const CFG = {
  url: "http://evolution-api:8080",
  apiKey: "chave-global",
  instancia: "agroalerta",
  webhookUrl: "http://backend:3001/api/notificacoes/webhooks/evolution",
  webhookSecret: "segredo-jwt",
  tempoLimiteMs: 1000,
};

function responderCom(...respostas) {
  const chamadas = [];
  mock.method(globalThis, "fetch", async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    return proxima;
  });
  return chamadas;
}

function erroDeRede(codigo) {
  return Object.assign(new TypeError("fetch failed"), { cause: { code: codigo } });
}

const ERRO_EVOLUTION = (status, mensagens) => resposta(status, { status, error: "Erro", response: { message: mensagens } });

test("enviarTexto manda number e text com a apikey e devolve o id da mensagem", async () => {
  const chamadas = responderCom(resposta(201, { key: { id: "3EB0A1", remoteJid: "553599999000@s.whatsapp.net", fromMe: true }, status: "PENDING" }));
  assert.deepEqual(await evolution.enviarTexto(CFG, { numero: "5535999990000", texto: "Olá" }), { provedorId: "3EB0A1" });
  assert.equal(chamadas[0].url, "http://evolution-api:8080/message/sendText/agroalerta");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.equal(chamadas[0].opcoes.headers.apikey, "chave-global");
  assert.equal(chamadas[0].opcoes.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), { number: "5535999990000", text: "Olá" });
  assert.ok(chamadas[0].opcoes.signal, "toda chamada tem tempo limite");
});

test("número sem WhatsApp é falha definitiva: a mensagem não saiu", async () => {
  responderCom(ERRO_EVOLUTION(400, [{ exists: false, jid: "5535999990000@s.whatsapp.net", number: "5535999990000" }]));
  await assert.rejects(evolution.enviarTexto(CFG, { numero: "5535999990000", texto: "x" }), {
    codigo: "numero_sem_whatsapp", temporario: false, incerto: false, status: 400,
  });
});

test("falhas antes do envio são temporárias; depois dele, o resultado é incerto", async () => {
  const enviar = () => evolution.enviarTexto(CFG, { numero: "5535999990000", texto: "x" });
  for (const codigo of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]) {
    responderCom(erroDeRede(codigo));
    await assert.rejects(enviar(), { codigo: "falha_conexao", temporario: true, incerto: false });
    mock.restoreAll();
  }
  responderCom(ERRO_EVOLUTION(401, ["Unauthorized"]));
  await assert.rejects(enviar(), { codigo: "credencial_invalida", temporario: true, incerto: false });
  mock.restoreAll();
  responderCom(ERRO_EVOLUTION(404, ['The "agroalerta" instance does not exist']));
  await assert.rejects(enviar(), { codigo: "instancia_inexistente", temporario: true, incerto: false });
  mock.restoreAll();

  // A requisição pode ter chegado: tempo esgotado, conexão cortada, 5xx ou 400 genérico.
  const tempoEsgotado = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  for (const falha of [tempoEsgotado, erroDeRede("ECONNRESET"), erroDeRede("UND_ERR_SOCKET")]) {
    responderCom(falha);
    await assert.rejects(enviar(), { codigo: "sem_resposta", temporario: false, incerto: true });
    mock.restoreAll();
  }
  for (const falha of [ERRO_EVOLUTION(500, ["Connection Closed"]), ERRO_EVOLUTION(400, ["Error: Connection Closed"])]) {
    responderCom(falha);
    await assert.rejects(enviar(), (erro) => erro.codigo === "resultado_incerto" && erro.incerto && /Connection Closed/.test(erro.message));
    mock.restoreAll();
  }
  responderCom(resposta(201, { status: "PENDING" }));
  await assert.rejects(enviar(), { codigo: "resultado_incerto", incerto: true });
});

test("resposta interrompida no meio do corpo: incerta no envio, temporária nas consultas", async () => {
  const quebrada = () => ({ ok: true, status: 201, text: async () => { throw new Error("terminated"); } });
  responderCom(quebrada());
  await assert.rejects(evolution.enviarTexto(CFG, { numero: "5535999990000", texto: "x" }), { codigo: "sem_resposta", incerto: true });
  responderCom(quebrada());
  await assert.rejects(evolution.estadoDaConexao(CFG), { codigo: "sem_resposta", incerto: false, temporario: true });
});

test("sem URL ou chave nada é chamado", async () => {
  const chamadas = responderCom();
  await assert.rejects(evolution.estadoDaConexao({ ...CFG, apiKey: "" }), { codigo: "configuracao_ausente" });
  assert.equal(chamadas.length, 0);
});

test("estado da conexão e instância inexistente", async () => {
  const chamadas = responderCom(resposta(200, { instance: { instanceName: "agroalerta", state: "open" } }), ERRO_EVOLUTION(404, ["not found"]));
  assert.deepEqual(await evolution.estadoDaConexao(CFG), { existe: true, estado: "open" });
  assert.equal(chamadas[0].url, "http://evolution-api:8080/instance/connectionState/agroalerta");
  assert.deepEqual(await evolution.estadoDaConexao(CFG), { existe: false, estado: null });

  responderCom(resposta(200, { instance: { instanceName: "agroalerta" } }));
  assert.deepEqual(await evolution.estadoDaConexao(CFG), { existe: true, estado: null });
  responderCom(ERRO_EVOLUTION(500, ["db down"]));
  await assert.rejects(evolution.estadoDaConexao(CFG), { codigo: "erro_provedor", temporario: true });
});

test("dados da instância nunca devolvem o token dela", async () => {
  const chamadas = responderCom(
    resposta(200, [
      { name: "outra", ownerJid: "x", token: "t-outra" },
      {
        name: "agroalerta", connectionStatus: "open", ownerJid: "553599999503@s.whatsapp.net", profileName: "Luiz",
        token: "TOKEN-SECRETO", disconnectionReasonCode: null, disconnectionAt: null,
      },
    ])
  );
  const dados = await evolution.dadosDaInstancia(CFG);
  assert.equal(chamadas[0].url, "http://evolution-api:8080/instance/fetchInstances?instanceName=agroalerta");
  assert.deepEqual(dados, { numero: "553599999503@s.whatsapp.net", perfil: "Luiz", motivoDesconexao: null, desconectadaEm: null });
  assert.ok(!JSON.stringify(dados).includes("TOKEN-SECRETO"));

  responderCom(ERRO_EVOLUTION(404, ['Instance "agroalerta" not found']));
  assert.equal(await evolution.dadosDaInstancia(CFG), null);
  responderCom(resposta(200, []));
  assert.equal(await evolution.dadosDaInstancia(CFG), null);
  responderCom(resposta(200, { name: "agroalerta" }));
  assert.equal(await evolution.dadosDaInstancia(CFG), null, "corpo inesperado (não é lista)");
  responderCom(resposta(200, [null, { name: "outra" }]));
  assert.equal(await evolution.dadosDaInstancia(CFG), null);
  responderCom(resposta(200, [{ name: "agroalerta" }]));
  assert.deepEqual(await evolution.dadosDaInstancia(CFG), { numero: null, perfil: null, motivoDesconexao: null, desconectadaEm: null });
  responderCom(ERRO_EVOLUTION(401, ["Unauthorized"]));
  await assert.rejects(evolution.dadosDaInstancia(CFG), { codigo: "credencial_invalida" });
});

test("criar a instância: Baileys, sem QR automático e sem mexer no comportamento do celular", async () => {
  const chamadas = responderCom(resposta(201, { instance: { instanceName: "agroalerta" } }), ERRO_EVOLUTION(403, ['This name "agroalerta" is already in use.']));
  assert.equal(await evolution.criarInstancia(CFG), true);
  assert.equal(chamadas[0].url, "http://evolution-api:8080/instance/create");
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), {
    instanceName: "agroalerta", integration: "WHATSAPP-BAILEYS", qrcode: false, rejectCall: false, groupsIgnore: true,
    alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false,
  });
  assert.equal(await evolution.criarInstancia(CFG), false, "já existia");
  responderCom(ERRO_EVOLUTION(403, ["Forbidden"]));
  await assert.rejects(evolution.criarInstancia(CFG), { codigo: "credencial_invalida" });
});

test("webhook: configura com jwt_key e confere sem expor o segredo", async () => {
  const chamadas = responderCom(resposta(201, {}));
  await evolution.configurarWebhook(CFG);
  assert.equal(chamadas[0].url, "http://evolution-api:8080/webhook/set/agroalerta");
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), {
    webhook: {
      enabled: true, url: CFG.webhookUrl, headers: { jwt_key: "segredo-jwt" }, byEvents: false, base64: false,
      events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"],
    },
  });
  await assert.rejects(evolution.configurarWebhook({ ...CFG, webhookSecret: "" }), { codigo: "configuracao_ausente" });

  const emDia = { enabled: true, url: CFG.webhookUrl, headers: { jwt_key: "segredo-jwt" }, events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE", "QRCODE_UPDATED"] };
  responderCom(resposta(200, emDia));
  assert.equal(await evolution.webhookEmDia(CFG), true);
  for (const diferente of [
    { ...emDia, enabled: false },
    { ...emDia, url: "http://outro" },
    { ...emDia, headers: { jwt_key: "antigo" } },
    { ...emDia, headers: null },
    { ...emDia, events: ["CONNECTION_UPDATE"] },
    { ...emDia, events: undefined },
  ]) {
    mock.restoreAll();
    responderCom(resposta(200, diferente));
    assert.equal(await evolution.webhookEmDia(CFG), false);
  }
  mock.restoreAll();
  responderCom(resposta(200, ""));
  assert.equal(await evolution.webhookEmDia(CFG), false, "sem webhook configurado");
});

test("conectar devolve o QR (data URL) ou o estado aberto; erro em 200 vira falha", async () => {
  const chamadas = responderCom(
    resposta(200, { pairingCode: null, code: "2@abc", base64: "data:image/png;base64,iVBOR", count: 1 }),
    resposta(200, { instance: { instanceName: "agroalerta", state: "open" } }),
    resposta(200, { count: 0 }),
    resposta(200, { error: true, message: "Error: boom" }),
    resposta(200, { error: true })
  );
  assert.deepEqual(await evolution.conectar(CFG), { estado: "connecting", qrCode: "data:image/png;base64,iVBOR" });
  assert.equal(chamadas[0].url, "http://evolution-api:8080/instance/connect/agroalerta");
  assert.deepEqual(await evolution.conectar(CFG), { estado: "open", qrCode: null });
  assert.deepEqual(await evolution.conectar(CFG), { estado: "connecting", qrCode: null }, "QR ainda sendo gerado");
  await assert.rejects(evolution.conectar(CFG), { codigo: "erro_provedor", message: "Evolution API: Error: boom" });
  await assert.rejects(evolution.conectar(CFG), { message: "Evolution API: falha ao conectar." });
});

test("reiniciar, desconectar e versão do servidor", async () => {
  const chamadas = responderCom(
    resposta(200, { instance: { instanceName: "agroalerta", status: "connecting" } }),
    resposta(200, { error: true, message: "not connected" }),
    resposta(200, { error: true }),
    resposta(200, { status: "SUCCESS", error: false }),
    resposta(200, { status: 200, version: "2.3.7" }),
    resposta(200, { status: 200 })
  );
  await evolution.reiniciar(CFG);
  assert.deepEqual([chamadas[0].url, chamadas[0].opcoes.method], ["http://evolution-api:8080/instance/restart/agroalerta", "POST"]);
  await assert.rejects(evolution.reiniciar(CFG), { message: "Evolution API: not connected" });
  await assert.rejects(evolution.reiniciar(CFG), { message: "Evolution API: falha ao reiniciar." });
  await evolution.desconectar(CFG);
  assert.deepEqual([chamadas[3].url, chamadas[3].opcoes.method], ["http://evolution-api:8080/instance/logout/agroalerta", "DELETE"]);
  assert.equal(await evolution.versaoDoServidor(CFG), "2.3.7");
  assert.equal(await evolution.versaoDoServidor(CFG), null);
});

test("erro sem corpo estruturado: a mensagem cai no texto ou no código HTTP", async () => {
  responderCom(resposta(502, "Bad Gateway"), resposta(400, ""), resposta(422, { message: "campo x" }));
  await assert.rejects(evolution.estadoDaConexao(CFG), { codigo: "erro_provedor", message: "Evolution API: Bad Gateway" });
  await assert.rejects(evolution.estadoDaConexao(CFG), { codigo: "requisicao_invalida", message: "Evolution API: HTTP 400" });
  await assert.rejects(evolution.estadoDaConexao(CFG), { codigo: "requisicao_invalida", message: "Evolution API: campo x" });
});
