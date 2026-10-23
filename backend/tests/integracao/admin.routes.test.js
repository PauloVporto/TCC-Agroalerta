const banco = require("./helpers/banco");
const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const adminRouter = require("../../routes/admin");
const { iniciarApp } = require("../helpers/servidor");
const { iniciarEvolutionFalsa } = require("./helpers/evolutionFalsa");
const { enfileirar } = require("../../services/notificacoes/fila");

const SEGREDO_WEBHOOK = "segredo-do-webhook";
let servidor;
let evolution;
let tokens;

before(async () => {
  await banco.prepararBanco();
  servidor = await iniciarApp((app) => app.use("/api/admin", adminRouter));
});
beforeEach(async () => {
  await banco.limparBanco();
  evolution = await iniciarEvolutionFalsa();
  Object.assign(process.env, evolution.env, {
    WHATSAPP_EXPECTED_SENDER: "9503",
    EVOLUTION_WEBHOOK_URL: "http://backend:3001/api/notificacoes/webhooks/evolution",
    EVOLUTION_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
  });
  const admin = await banco.criarProdutor({ nome: "Luiz (admin)", email: "admin@agroalerta.com.br", telefone: "+5535999999503", papel: "admin" });
  const produtor = await banco.criarProdutor({ nome: "Agricultor 3362", email: "agricultor@teste.com", telefone: "+5535999993362" });
  const fornecedor = await banco.criarProdutor({ nome: "Loja", email: "loja@insumos.com.br", papel: "fornecedor" });
  tokens = {
    admin: await banco.criarSessao(admin.id),
    produtor: await banco.criarSessao(produtor.id),
    fornecedor: await banco.criarSessao(fornecedor.id),
    adminId: admin.id,
    produtorId: produtor.id,
  };
});
afterEach(async () => {
  for (const variavel of [...Object.keys(evolution.env), "WHATSAPP_EXPECTED_SENDER", "EVOLUTION_WEBHOOK_URL", "EVOLUTION_WEBHOOK_SECRET"]) {
    delete process.env[variavel];
  }
  await evolution.fechar();
});
after(async () => {
  await servidor.fechar();
  await banco.pool.end();
});

function chamar(metodo, caminho, token, corpo) {
  return fetch(servidor.url + "/api/admin" + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

async function envioNaFila(status = "pendente", extra = {}) {
  const id = await enfileirar(banco.pool, {
    usuarioId: tokens.produtorId, canal: "whatsapp", tipo: "boas_vindas", chaveIdempotencia: "c-" + Math.random(),
    destino: "+5535999993362", conteudo: "x", resumo: "Boas-vindas ao Agro Alerta", maxTentativas: 5, ...extra,
  });
  if (status !== "pendente") await banco.pool.query("UPDATE notificacao_envios SET status = $2 WHERE id = $1", [id, status]);
  return id;
}

const ROTAS = [
  ["GET", "/whatsapp"],
  ["POST", "/whatsapp/conectar"],
  ["POST", "/whatsapp/reconectar"],
  ["POST", "/whatsapp/desconectar"],
  ["PUT", "/whatsapp/controles", { enviosBloqueados: false }],
  ["GET", "/notificacoes/resumo"],
  ["GET", "/notificacoes"],
  ["GET", "/notificacoes/1/eventos"],
  ["POST", "/notificacoes/1/cancelar"],
  ["POST", "/notificacoes/1/reenfileirar"],
  ["POST", "/notificacoes/cancelar-pendentes", { canal: "whatsapp" }],
  ["GET", "/agricultores"],
  ["GET", "/logs"],
];

test("sem sessão, 401; agricultor e fornecedor, 403 — em todas as rotas do administrador", async () => {
  for (const [metodo, caminho, corpo] of ROTAS) {
    assert.equal((await chamar(metodo, caminho, null, corpo)).status, 401, `${metodo} ${caminho} sem sessão`);
    for (const papel of ["produtor", "fornecedor"]) {
      const resposta = await chamar(metodo, caminho, tokens[papel], corpo);
      assert.equal(resposta.status, 403, `${metodo} ${caminho} como ${papel}`);
      assert.equal((await resposta.json()).erro, "Esta ação é só para contas de administrador.");
    }
  }
  assert.equal(evolution.requisicoes.length, 0, "nada chegou à Evolution");
  const { rows } = await banco.pool.query("SELECT envios_bloqueados FROM whatsapp_controle");
  assert.equal(rows[0].envios_bloqueados, true, "o agricultor não liberou nada");
});

test("estado do WhatsApp para o administrador: conexão e travas, sem token, apikey nem segredo", async () => {
  const resposta = await chamar("GET", "/whatsapp", tokens.admin);
  assert.equal(resposta.status, 200);
  const texto = await resposta.text();
  for (const segredo of ["TOKEN-DA-INSTANCIA", "chave-de-teste", SEGREDO_WEBHOOK, "jwt_key"]) assert.ok(!texto.includes(segredo), segredo);
  const estado = JSON.parse(texto);
  assert.deepEqual(
    [estado.instancia, estado.conexao.estado, estado.conexao.numero, estado.conexao.remetenteValido, estado.envioLiberado],
    ["agroalerta", "open", "(35) 99999-9503", true, false]
  );
  assert.match(estado.motivoRetencao, /bloqueados pelo administrador/);
});

test("conectar e reconectar passam pela Evolution; falha dela vira 502 com a mensagem", async () => {
  evolution.estado.existe = false;
  const conectado = await (await chamar("POST", "/whatsapp/conectar", tokens.admin)).json();
  assert.deepEqual([conectado.conexao.estado, conectado.conexao.qrCode], ["connecting", "data:image/png;base64,QRCODE"]);
  assert.equal((await chamar("POST", "/whatsapp/reconectar", tokens.admin)).status, 200);
  evolution.estado.conexao = "open";
  assert.equal((await (await chamar("POST", "/whatsapp/desconectar", tokens.admin)).json()).conexao.estado, "close");

  await evolution.fechar();
  const fora = await chamar("POST", "/whatsapp/conectar", tokens.admin);
  assert.equal(fora.status, 502);
  assert.match((await fora.json()).erro, /^Evolution API: sem conexão/);
});

test("controles: validação, gravação com autor na auditoria e leitura", async () => {
  for (const corpo of [{}, { enviosBloqueados: "não" }, { outraCoisa: true }, { alertasAtivos: true, boasVindasAtivas: 1 }]) {
    assert.equal((await chamar("PUT", "/whatsapp/controles", tokens.admin, corpo)).status, 400, JSON.stringify(corpo));
  }
  const resposta = await chamar("PUT", "/whatsapp/controles", tokens.admin, { enviosBloqueados: false, alertasAtivos: false });
  const controle = await resposta.json();
  assert.deepEqual(
    [controle.enviosBloqueados, controle.boasVindasAtivas, controle.alertasAtivos, controle.atualizadoPor],
    [false, false, false, tokens.adminId]
  );
  // Repetir o mesmo valor não gera auditoria.
  await chamar("PUT", "/whatsapp/controles", tokens.admin, { enviosBloqueados: false });
  await chamar("PUT", "/whatsapp/controles", tokens.admin, { enviosBloqueados: true, alertasAtivos: true });
  const { eventos } = await (await chamar("GET", "/logs", tokens.admin)).json();
  assert.deepEqual(eventos.map((e) => [e.categoria, e.detalhe, e.autor]).reverse(), [
    ["controle", "Envios do WhatsApp liberados", "Luiz (admin)"],
    ["controle", "Envios do WhatsApp bloqueados", "Luiz (admin)"],
    ["controle", "Alertas automáticos habilitados", "Luiz (admin)"],
  ]);
});

test("administradores são criados só pelo servidor: promover e rebaixar uma conta existente", async () => {
  const { definirPapel } = require("../../services/auth");
  const promovido = await definirPapel("AGRICULTOR@teste.com", "admin");
  assert.deepEqual([promovido.email, promovido.papel], ["agricultor@teste.com", "admin"]);
  assert.equal((await chamar("GET", "/logs", tokens.produtor)).status, 200, "a sessão aberta passa a ter acesso");
  assert.equal((await definirPapel("agricultor@teste.com", "produtor")).papel, "produtor");
  assert.equal((await chamar("GET", "/logs", tokens.produtor)).status, 403);
  assert.equal(await definirPapel("ninguem@teste.com", "admin"), null);
});

test("resumo, histórico com filtros, linha do tempo e agricultores", async () => {
  await envioNaFila("pendente");
  await envioNaFila("entregue");
  await envioNaFila("lido");
  await envioNaFila("falhou");
  const incerto = await envioNaFila("incerto");
  await banco.pool.query(
    "INSERT INTO notificacao_consentimentos (usuario_id, canal, concedido, destino, origem) VALUES ($1, 'whatsapp', TRUE, '+5535999993362', 'cadastro')",
    [tokens.produtorId]
  );

  const resumo = await (await chamar("GET", "/notificacoes/resumo", tokens.admin)).json();
  assert.deepEqual(resumo, {
    autorizados: 1, pendentes: 1, aceitas: 2, confirmadasServidor: 2, entregues: 2, lidas: 1, falhas: 1, incertas: 1, bloqueadas: 0, descartadas: 0,
  });

  const todos = await (await chamar("GET", "/notificacoes", tokens.admin)).json();
  assert.equal(todos.envios.length, 5);
  assert.deepEqual([todos.envios[0].agricultor, todos.envios[0].destino], ["Agricultor 3362", "(35) 99999-3362"]);
  const soIncertos = await (await chamar("GET", "/notificacoes?status=incerto&canal=whatsapp&tipo=boas_vindas&limite=1", tokens.admin)).json();
  assert.deepEqual(soIncertos.envios.map((e) => e.id), [incerto]);
  for (const filtro of ["status=inventado", "tipo=x", "canal=pombo"]) {
    assert.equal((await chamar("GET", "/notificacoes?" + filtro, tokens.admin)).status, 400);
  }

  const linha = await (await chamar("GET", `/notificacoes/${incerto}/eventos`, tokens.admin)).json();
  assert.deepEqual(linha.eventos.map((e) => e.tipo), ["enfileirado"]);
  assert.equal((await chamar("GET", "/notificacoes/abc/eventos", tokens.admin)).status, 400);

  const { agricultores } = await (await chamar("GET", "/agricultores", tokens.admin)).json();
  assert.deepEqual(agricultores.map((a) => [a.nome, a.telefone, a.whatsapp, a.talhoes]), [["Agricultor 3362", "(35) 99999-3362", "autorizado", 0]]);
});

test("situação do WhatsApp de cada agricultor: autorizado, revogado, outro número ou sem decisão", async () => {
  const p = (nome, telefone, decisao) =>
    banco.criarProdutor({ nome, email: nome + "@t.com", telefone, consentimentos: decisao === undefined ? {} : { whatsapp: decisao } });
  await p("revogou", "+5535911110000", false);
  const trocou = await p("trocou", "+5535922220000", true);
  await banco.pool.query("UPDATE usuarios SET telefone = '+5535933330000' WHERE id = $1", [trocou.id]);
  await p("sem telefone", null);
  const { agricultores } = await (await chamar("GET", "/agricultores?limite=10", tokens.admin)).json();
  const situacao = Object.fromEntries(agricultores.map((a) => [a.nome, [a.whatsapp, a.telefone]]));
  assert.deepEqual(situacao, {
    "Agricultor 3362": ["nao_autorizado", "(35) 99999-3362"],
    revogou: ["revogado", "(35) 91111-0000"],
    trocou: ["autorizado_outro_numero", "(35) 93333-0000"],
    "sem telefone": ["nao_autorizado", null],
  });
});

test("cancelar pendente, reenfileirar incerto e cancelar em lote, com auditoria; ações fora de hora dão 409", async () => {
  const pendente = await envioNaFila("pendente");
  const incerto = await envioNaFila("incerto");
  const vencido = await envioNaFila("incerto", { expiraEm: new Date(Date.now() - 1000) });

  assert.equal((await chamar("POST", `/notificacoes/${pendente}/cancelar`, tokens.admin)).status, 200);
  const segundaVez = await chamar("POST", `/notificacoes/${pendente}/cancelar`, tokens.admin);
  assert.equal(segundaVez.status, 409);
  assert.match((await segundaVez.json()).erro, /ainda está na fila/);

  assert.equal((await chamar("POST", `/notificacoes/${incerto}/reenfileirar`, tokens.admin)).status, 200);
  const devolvido = (await banco.listarEnvios()).find((e) => e.id === incerto);
  assert.deepEqual([devolvido.status, devolvido.erro_codigo], ["pendente", null]);
  assert.equal((await chamar("POST", `/notificacoes/${vencido}/reenfileirar`, tokens.admin)).status, 409, "validade vencida");
  assert.equal((await chamar("POST", `/notificacoes/${pendente}/reenfileirar`, tokens.admin)).status, 409, "não era incerto");
  assert.equal((await chamar("POST", "/notificacoes/0/cancelar", tokens.admin)).status, 400);
  assert.equal((await chamar("POST", "/notificacoes/x/reenfileirar", tokens.admin)).status, 400);

  assert.equal((await chamar("POST", "/notificacoes/cancelar-pendentes", tokens.admin, { canal: "sms" })).status, 400);
  const lote = await (await chamar("POST", "/notificacoes/cancelar-pendentes", tokens.admin, { canal: "whatsapp" })).json();
  assert.equal(lote.cancelados, 1, "o reenfileirado era o único pendente");

  const { eventos } = await (await chamar("GET", "/logs?limite=3", tokens.admin)).json();
  assert.deepEqual(eventos.map((e) => e.tipo).reverse(), ["envio_cancelado", "incerto_reenfileirado", "pendentes_cancelados"]);
  const linha = (await banco.eventosDoEnvio(incerto)).map((e) => e.tipo);
  assert.deepEqual(linha, ["enfileirado", "reenfileirado", "cancelado"]);
});

test("erro inesperado do banco vira 500 genérico, sem detalhes internos", async (t) => {
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    // A transação dos controles usa um cliente próprio; a leitura final (lerControle) passa pelo pool.
    if (/FROM notificacao_envios WHERE canal = 'whatsapp'|administracao_eventos e|FROM whatsapp_controle WHERE id = 1$|u\.papel = 'produtor'/.test(sql)) {
      throw new Error("detalhe interno do banco");
    }
    return consultaOriginal(sql, params);
  });
  t.mock.method(console, "error", () => {});
  for (const [metodo, caminho, corpo] of [
    ["GET", "/notificacoes/resumo"],
    ["GET", "/logs"],
    ["PUT", "/whatsapp/controles", { enviosBloqueados: false }],
    ["GET", "/agricultores"],
  ]) {
    const resposta = await chamar(metodo, caminho, tokens.admin, corpo);
    assert.equal(resposta.status, 500, caminho);
    assert.equal((await resposta.json()).erro, "Não foi possível concluir a ação. Veja o log do backend.");
  }
});
