const banco = require("./helpers/banco");
const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// As rotas guardam a função de localização ao serem carregadas: o dublê vem antes.
const localizacao = require("../../services/localizacao");
mock.method(localizacao, "resolverLocalizacaoPorCep", async (cep) =>
  cep === "00000000"
    ? { valido: false, erro: "CEP não encontrado. Verifique o número digitado." }
    : { valido: true, cep, cidade: "Lavras", uf: "MG", latitude: -21.245, longitude: -44.999, enderecoFormatado: "Lavras, Minas Gerais, Brasil" }
);
const notificacoes = require("../../services/notificacoes");
const registrarOriginal = notificacoes.registrarEscolhasDoCadastro;
mock.method(notificacoes, "registrarEscolhasDoCadastro", async (usuario, escolhas) => {
  if (usuario.email === "banco.instavel@exemplo.com") throw new Error("conexão perdida");
  return registrarOriginal(usuario, escolhas);
});

const authRouter = require("../../routes/auth");
const { iniciarApp } = require("../helpers/servidor");
const { obterConsentimentos } = require("../../services/notificacoes/consentimentos");

let servidor;

before(async () => {
  await banco.prepararBanco();
  servidor = await iniciarApp((app) => app.use("/api/auth", authRouter));
});
beforeEach(() => banco.limparBanco());
after(async () => {
  await servidor.fechar();
  await banco.pool.end();
});

function registrar(corpo) {
  return fetch(servidor.url + "/api/auth/registrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "Marina Rezende", senha: "segredo1", cep: "37200000", cultura: "cafe", ...corpo }),
  });
}

function chamar(metodo, caminho, token, corpo) {
  return fetch(servidor.url + "/api/auth" + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

test("cadastro só com e-mail autorizado: boas-vindas por e-mail e nenhum SMS", async () => {
  const resposta = await registrar({ email: "marina@fazenda.com.br", telefone: "(35) 99999-0001", notificacoes: { email: true, sms: false } });
  assert.equal(resposta.status, 201);
  const { usuario } = await resposta.json();
  assert.equal(usuario.telefone, "+5535999990001");

  const consentimentos = await obterConsentimentos(usuario.id);
  assert.equal(consentimentos.email.concedido, true);
  assert.equal(consentimentos.sms.concedido, false);

  const [envio, ...outros] = await banco.listarEnvios();
  assert.equal(outros.length, 0);
  assert.deepEqual([envio.canal, envio.tipo, envio.status, envio.destino], ["email", "boas_vindas", "pendente", "marina@fazenda.com.br"]);
  assert.equal(envio.assunto, "Bem-vindo ao Agro Alerta!");

  const email = banco.provedorFalso({ nome: "resend" });
  await banco.processar({ email });
  assert.equal(email.enviados.length, 1);
  assert.equal(email.enviados[0].destino, "marina@fazenda.com.br");
  assert.ok(email.enviados[0].html.includes("Olá, Marina Rezende!"));
  assert.equal((await banco.listarEnvios())[0].status, "enviado");
});

test("cadastro só com SMS autorizado: boas-vindas por SMS para o celular normalizado", async () => {
  const resposta = await registrar({ email: "joao@fazenda.com.br", telefone: "35 98888-0002", notificacoes: { email: false, sms: true } });
  assert.equal(resposta.status, 201);
  const [envio, ...outros] = await banco.listarEnvios();
  assert.equal(outros.length, 0);
  assert.deepEqual([envio.canal, envio.destino], ["sms", "+5535988880002"]);
  assert.equal(
    envio.conteudo,
    "Agro Alerta: Cadastro realizado com sucesso! Voce recebera alertas climaticos conforme suas preferencias."
  );

  const sms = banco.provedorFalso({ nome: "smsgo" });
  await banco.processar({ sms });
  assert.deepEqual(sms.enviados.map((m) => m.destino), ["+5535988880002"]);
});

test("cadastro com os dois canais: uma mensagem de boas-vindas em cada", async () => {
  await registrar({ email: "ana@fazenda.com.br", telefone: "(35) 97777-0003", notificacoes: { email: true, sms: true } });
  assert.deepEqual((await banco.listarEnvios()).map((e) => e.canal), ["email", "sms"]);
});

test("sem marcar nenhum canal (o padrão), nada é autorizado nem enfileirado", async () => {
  const resposta = await registrar({ email: "pedro@fazenda.com.br", telefone: "(35) 3471-0004" });
  assert.equal(resposta.status, 201);
  const { usuario } = await resposta.json();
  assert.deepEqual(await banco.listarEnvios(), []);
  const consentimentos = await obterConsentimentos(usuario.id);
  assert.equal(consentimentos.email.concedido || consentimentos.sms.concedido, false);

  const { rows } = await banco.pool.query("SELECT regiao FROM talhoes WHERE usuario_id = $1", [usuario.id]);
  assert.equal(rows[0].regiao, "Lavras - MG");
});

test("produtores diferentes recebem cada um no próprio e-mail e telefone", async () => {
  await registrar({ email: "a@fazenda.com.br", telefone: "(35) 99999-0011", notificacoes: { email: true, sms: true } });
  await registrar({ nome: "Bruno Lima", email: "b@sitio.com.br", telefone: "(31) 98888-0022", notificacoes: { email: true, sms: true } });

  const email = banco.provedorFalso({ nome: "resend" });
  const sms = banco.provedorFalso({ nome: "smsgo" });
  await banco.processar({ email, sms });
  assert.deepEqual(email.enviados.map((m) => m.destino), ["a@fazenda.com.br", "b@sitio.com.br"]);
  assert.deepEqual(sms.enviados.map((m) => m.destino), ["+5535999990011", "+5531988880022"]);
  assert.ok(email.enviados[1].html.includes("Olá, Bruno Lima!"));
});

test("e-mail inválido é recusado e a conta não é criada", async () => {
  const resposta = await registrar({ email: "marina@fazenda", notificacoes: { email: true } });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "E-mail em formato inválido.");
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS total FROM usuarios");
  assert.equal(rows[0].total, 0);
});

test("telefone inválido é recusado, e SMS exige celular", async () => {
  const invalido = await registrar({ email: "c@fazenda.com.br", telefone: "(20) 1234" });
  assert.equal(invalido.status, 400);
  assert.match((await invalido.json()).erro, /Telefone inválido/);

  const fixo = await registrar({ email: "c@fazenda.com.br", telefone: "(35) 3471-0000", notificacoes: { sms: true } });
  assert.equal(fixo.status, 400);
  assert.equal((await fixo.json()).erro, "Para receber SMS, informe um celular válido com DDD.");

  const semTelefone = await registrar({ email: "c@fazenda.com.br", notificacoes: { sms: true } });
  assert.equal(semTelefone.status, 400);
});

test("demais validações do cadastro continuam valendo", async () => {
  assert.equal((await registrar({ email: "" })).status, 400);
  assert.equal((await registrar({ email: "d@fazenda.com.br", senha: "123" })).status, 400);
  const cep = await registrar({ email: "d@fazenda.com.br", cep: "00000000" });
  assert.equal(cep.status, 400);
  assert.match((await cep.json()).erro, /CEP não encontrado/);
  await registrar({ email: "d@fazenda.com.br" });
  const duplicado = await registrar({ email: "d@fazenda.com.br" });
  assert.equal(duplicado.status, 409);
});

test("boas-vindas saem uma única vez por cadastro e canal", async () => {
  const resposta = await registrar({ email: "e@fazenda.com.br", telefone: "(35) 99999-0005", notificacoes: { email: true, sms: true } });
  const { usuario } = await resposta.json();
  // Repetir o registro das escolhas (ex.: um retry) não cria nova mensagem.
  await registrarOriginal({ ...usuario, telefone: "+5535999990005" }, { email: true, sms: true });
  assert.equal((await banco.listarEnvios()).length, 2);

  const email = banco.provedorFalso({ nome: "resend" });
  const sms = banco.provedorFalso({ nome: "smsgo" });
  await banco.processar({ email, sms });
  await banco.processar({ email, sms });
  assert.equal(email.enviados.length + sms.enviados.length, 2);
});

test("o cadastro não depende do provedor: com o Resend fora do ar a conta é criada e o e-mail aguarda na fila", async () => {
  const resposta = await registrar({ email: "f@fazenda.com.br", notificacoes: { email: true } });
  assert.equal(resposta.status, 201);
  const { ErroProvedor } = require("../../services/notificacoes/provedores/comum");
  const foraDoAr = new ErroProvedor({ provedor: "resend", codigo: "erro_provedor", mensagem: "Resend: 503", temporario: true });
  await banco.processar({ email: banco.provedorFalso({ nome: "resend", roteiro: [foraDoAr] }) });
  const [envio] = await banco.listarEnvios();
  assert.deepEqual([envio.status, envio.erro_codigo, envio.tentativas], ["pendente", "erro_provedor", 1]);
});

test("falha ao gravar as notificações não desfaz o cadastro", async () => {
  const resposta = await registrar({ email: "banco.instavel@exemplo.com", notificacoes: { email: true } });
  assert.equal(resposta.status, 201);
  assert.ok((await resposta.json()).token);
  assert.deepEqual(await banco.listarEnvios(), []);
});

test("perfil: telefone normalizado, mantido quando omitido e protegido enquanto o SMS estiver autorizado", async () => {
  const resposta = await registrar({ email: "g@fazenda.com.br", telefone: "(35) 99999-0007", notificacoes: { sms: true } });
  const { token } = await resposta.json();

  const configuracoes = await (await chamar("GET", "/configuracoes", token)).json();
  assert.equal(configuracoes.telefone, "+5535999990007");
  assert.equal("notificacoes" in configuracoes, false);

  const troca = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "(35) 98888-1234" });
  assert.equal((await troca.json()).telefone, "+5535988881234");

  const semCampo = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br" });
  assert.equal((await semCampo.json()).telefone, "+5535988881234");

  const remover = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "" });
  assert.equal(remover.status, 400);
  assert.match((await remover.json()).erro, /desative o SMS antes/);

  const invalido = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "123" });
  assert.equal(invalido.status, 400);

  const emailRuim = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "gabi@" });
  assert.equal(emailRuim.status, 400);

  await registrar({ email: "outra@fazenda.com.br" });
  const emailDeOutro = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "outra@fazenda.com.br" });
  assert.equal(emailDeOutro.status, 409);
  assert.equal((await emailDeOutro.json()).erro, "Já existe uma conta com esse e-mail.");
});

test("perfil sem SMS autorizado permite remover o telefone; preferências não exigem mais o campo notificacoes", async () => {
  const resposta = await registrar({ email: "h@fazenda.com.br", telefone: "(35) 99999-0008" });
  const { token } = await resposta.json();
  const remover = await chamar("PATCH", "/perfil", token, { nome: "Heitor", email: "h@fazenda.com.br", telefone: "" });
  assert.equal((await remover.json()).telefone, null);

  const preferencias = await chamar("PATCH", "/preferencias", token, { culturaFavorita: "soja", unidadeTemperatura: "celsius" });
  assert.deepEqual(await preferencias.json(), { culturaFavorita: "soja", unidadeTemperatura: "celsius" });
  assert.equal((await chamar("PATCH", "/preferencias", token, { culturaFavorita: "trigo", unidadeTemperatura: "celsius" })).status, 400);
});
