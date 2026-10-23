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
const { whatsappBoasVindas } = require("../../services/notificacoes/templates");

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
    body: JSON.stringify({ nome: "Marina Rezende", senha: "segredo1", cep: "37200000", cultura: "cafe", telefone: "(35) 99999-3362", ...corpo }),
  });
}

function chamar(metodo, caminho, token, corpo) {
  return fetch(servidor.url + "/api/auth" + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

test("cadastro com WhatsApp autorizado: consentimento do número e boas-vindas na fila", async () => {
  const resposta = await registrar({ email: "agricultor@teste.com", telefone: "35 99999-3362", notificacoes: { whatsapp: true } });
  assert.equal(resposta.status, 201);
  const { usuario } = await resposta.json();
  assert.equal(usuario.telefone, "+5535999993362");

  const consentimentos = await obterConsentimentos(usuario.id);
  assert.deepEqual([consentimentos.whatsapp.concedido, consentimentos.whatsapp.destino], [true, "+5535999993362"]);
  assert.equal(consentimentos.email.concedido, false);
  const { rows } = await banco.pool.query("SELECT origem FROM notificacao_consentimentos WHERE usuario_id = $1", [usuario.id]);
  assert.deepEqual(rows, [{ origem: "cadastro" }]);

  const [envio, ...outros] = await banco.listarEnvios();
  assert.equal(outros.length, 0);
  assert.deepEqual(
    [envio.canal, envio.tipo, envio.status, envio.destino, envio.chave_idempotencia],
    ["whatsapp", "boas_vindas", "pendente", "+5535999993362", `boas_vindas:whatsapp:usuario:${usuario.id}`]
  );
  assert.equal(envio.conteudo, whatsappBoasVindas());
  const validadeDias = (new Date(envio.expira_em) - new Date(envio.criado_em)) / 86400000;
  assert.ok(Math.abs(validadeDias - 7) < 0.01, "boas-vindas valem 7 dias");

  const whatsapp = banco.provedorFalso({ nome: "evolution", reenvioSeguro: false });
  await banco.processar({ whatsapp });
  assert.deepEqual(whatsapp.enviados.map((m) => m.destino), ["+5535999993362"]);
  assert.equal((await banco.listarEnvios())[0].status, "enviado");
});

test("cadastro só com e-mail autorizado: boas-vindas por e-mail e nada no WhatsApp", async () => {
  const resposta = await registrar({ email: "marina@fazenda.com.br", notificacoes: { email: true, whatsapp: false } });
  const { usuario } = await resposta.json();
  assert.equal((await obterConsentimentos(usuario.id)).whatsapp.concedido, false);
  const [envio, ...outros] = await banco.listarEnvios();
  assert.equal(outros.length, 0);
  assert.deepEqual([envio.canal, envio.tipo, envio.destino, envio.assunto], ["email", "boas_vindas", "marina@fazenda.com.br", "Bem-vindo ao Agro Alerta!"]);
});

test("sem marcar nenhum canal (o padrão), nada é autorizado nem enfileirado", async () => {
  const resposta = await registrar({ email: "pedro@fazenda.com.br", notificacoes: { sms: true } });
  assert.equal(resposta.status, 201);
  const { usuario } = await resposta.json();
  assert.deepEqual(await banco.listarEnvios(), []);
  const consentimentos = await obterConsentimentos(usuario.id);
  assert.equal(consentimentos.email.concedido || consentimentos.whatsapp.concedido, false);
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS total FROM notificacao_consentimentos");
  assert.equal(rows[0].total, 0, "o antigo campo sms não autoriza nada");

  const talhao = await banco.pool.query("SELECT regiao FROM talhoes WHERE usuario_id = $1", [usuario.id]);
  assert.equal(talhao.rows[0].regiao, "Lavras - MG");
});

test("agricultores diferentes recebem cada um no próprio número", async () => {
  await registrar({ email: "a@fazenda.com.br", telefone: "(35) 99999-0011", notificacoes: { whatsapp: true } });
  await registrar({ nome: "Bruno Lima", email: "b@sitio.com.br", telefone: "(31) 98888-0022", notificacoes: { whatsapp: true } });
  const whatsapp = banco.provedorFalso({ nome: "evolution", reenvioSeguro: false });
  await banco.processar({ whatsapp });
  assert.deepEqual(whatsapp.enviados.map((m) => m.destino), ["+5535999990011", "+5531988880022"]);
});

test("telefone é obrigatório e validado (DDD inclusive); WhatsApp exige celular", async () => {
  const semTelefone = await registrar({ email: "c@fazenda.com.br", telefone: "" });
  assert.equal(semTelefone.status, 400);
  assert.match((await semTelefone.json()).erro, /Informe o celular com DDD/);

  for (const telefone of ["(20) 99999-0000", "(35) 1234", "abc"]) {
    const invalido = await registrar({ email: "c@fazenda.com.br", telefone });
    assert.equal(invalido.status, 400, telefone);
    assert.match((await invalido.json()).erro, /Telefone inválido/);
  }

  const fixo = await registrar({ email: "c@fazenda.com.br", telefone: "(35) 3471-0000", notificacoes: { whatsapp: true } });
  assert.equal(fixo.status, 400);
  assert.equal((await fixo.json()).erro, "Para receber pelo WhatsApp, informe um celular válido com DDD.");

  const fixoSemWhatsapp = await registrar({ email: "c@fazenda.com.br", telefone: "(35) 3471-0000" });
  assert.equal(fixoSemWhatsapp.status, 201, "fixo é aceito quando o WhatsApp não foi pedido");
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS total FROM usuarios");
  assert.equal(rows[0].total, 1);
});

test("demais validações do cadastro continuam valendo", async () => {
  assert.equal((await registrar({ email: "" })).status, 400);
  const emailRuim = await registrar({ email: "marina@fazenda", notificacoes: { email: true } });
  assert.equal((await emailRuim.json()).erro, "E-mail em formato inválido.");
  assert.equal((await registrar({ email: "d@fazenda.com.br", senha: "123" })).status, 400);
  const cep = await registrar({ email: "d@fazenda.com.br", cep: "00000000" });
  assert.equal(cep.status, 400);
  assert.match((await cep.json()).erro, /CEP não encontrado/);
  await registrar({ email: "d@fazenda.com.br" });
  const duplicado = await registrar({ email: "d@fazenda.com.br" });
  assert.equal(duplicado.status, 409);
});

test("boas-vindas saem uma única vez por conta: repetir o registro, entrar de novo ou atualizar o cadastro não duplica", async () => {
  const resposta = await registrar({ email: "e@fazenda.com.br", telefone: "(35) 99999-0005", notificacoes: { email: true, whatsapp: true } });
  const { usuario, token } = await resposta.json();
  // Repetir o registro das escolhas (ex.: um retry) não cria nova mensagem.
  await registrarOriginal({ ...usuario, telefone: "+5535999990005" }, { email: true, whatsapp: true });

  const login = await fetch(servidor.url + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "e@fazenda.com.br", senha: "segredo1" }),
  });
  assert.equal(login.status, 200);
  await chamar("PATCH", "/perfil", token, { nome: "Eva", email: "e@fazenda.com.br", telefone: "(35) 99999-0005" });
  assert.deepEqual((await banco.listarEnvios()).map((e) => e.canal), ["email", "whatsapp"]);

  const email = banco.provedorFalso({ nome: "resend" });
  const whatsapp = banco.provedorFalso({ nome: "evolution", reenvioSeguro: false });
  await banco.processar({ email, whatsapp });
  await banco.processar({ email, whatsapp });
  assert.equal(email.enviados.length + whatsapp.enviados.length, 2);
});

test("o cadastro não depende da Evolution API: fora do ar, a conta é criada e as boas-vindas aguardam", async () => {
  const resposta = await registrar({ email: "f@fazenda.com.br", notificacoes: { whatsapp: true } });
  assert.equal(resposta.status, 201);
  const foraDoAr = banco.provedorFalso({
    nome: "evolution", reenvioSeguro: false, liberacao: { tipos: [], motivo: "Evolution API indisponível: sem conexão.", remetente: null },
  });
  await banco.processar({ whatsapp: foraDoAr });
  const [envio] = await banco.listarEnvios();
  assert.deepEqual([envio.status, envio.tentativas], ["pendente", 0]);
  assert.equal(foraDoAr.enviados.length, 0);
});

test("falha ao gravar as notificações não desfaz o cadastro", async () => {
  const resposta = await registrar({ email: "banco.instavel@exemplo.com", notificacoes: { whatsapp: true } });
  assert.equal(resposta.status, 201);
  assert.ok((await resposta.json()).token);
  assert.deepEqual(await banco.listarEnvios(), []);
});

test("perfil: telefone normalizado, mantido quando omitido e protegido enquanto o WhatsApp estiver autorizado", async () => {
  const resposta = await registrar({ email: "g@fazenda.com.br", telefone: "(35) 99999-0007", notificacoes: { whatsapp: true } });
  const { token } = await resposta.json();

  const configuracoes = await (await chamar("GET", "/configuracoes", token)).json();
  assert.equal(configuracoes.telefone, "+5535999990007");
  assert.equal("notificacoes" in configuracoes, false);

  const remover = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "" });
  assert.equal(remover.status, 400);
  assert.match((await remover.json()).erro, /desative o WhatsApp antes/);
  const fixo = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "(35) 3471-0000" });
  assert.equal(fixo.status, 400);

  // Outro celular é aceito: a autorização antiga deixa de valer até ser renovada.
  const troca = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "(35) 98888-1234" });
  assert.equal((await troca.json()).telefone, "+5535988881234");
  const semCampo = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br" });
  assert.equal((await semCampo.json()).telefone, "+5535988881234");
  const liberado = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "" });
  assert.equal(liberado.status, 200, "sem autorização vigente, o telefone pode sair");

  const invalido = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "g@fazenda.com.br", telefone: "123" });
  assert.equal(invalido.status, 400);
  const emailRuim = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "gabi@" });
  assert.equal(emailRuim.status, 400);
  assert.equal((await chamar("PATCH", "/perfil", token, { nome: "Gabi" })).status, 400);

  await registrar({ email: "outra@fazenda.com.br" });
  const emailDeOutro = await chamar("PATCH", "/perfil", token, { nome: "Gabi", email: "outra@fazenda.com.br" });
  assert.equal(emailDeOutro.status, 409);
  assert.equal((await emailDeOutro.json()).erro, "Já existe uma conta com esse e-mail.");
});

test("papel de administrador não pode ser escolhido no cadastro", async () => {
  const resposta = await registrar({ email: "esperto@fazenda.com.br", papel: "admin" });
  assert.equal(resposta.status, 201);
  assert.equal((await resposta.json()).usuario.papel, "produtor");
  const fornecedor = await registrar({ email: "loja@insumos.com.br", papel: "fornecedor" });
  assert.equal((await fornecedor.json()).usuario.papel, "fornecedor");
});

test("perfil sem WhatsApp autorizado permite remover o telefone; preferências não exigem o campo notificacoes", async () => {
  const resposta = await registrar({ email: "h@fazenda.com.br", telefone: "(35) 99999-0008" });
  const { token } = await resposta.json();
  const remover = await chamar("PATCH", "/perfil", token, { nome: "Heitor", email: "h@fazenda.com.br", telefone: "" });
  assert.equal((await remover.json()).telefone, null);

  const preferencias = await chamar("PATCH", "/preferencias", token, { culturaFavorita: "soja", unidadeTemperatura: "celsius" });
  assert.deepEqual(await preferencias.json(), { culturaFavorita: "soja", unidadeTemperatura: "celsius" });
  assert.equal((await chamar("PATCH", "/preferencias", token, { culturaFavorita: "trigo", unidadeTemperatura: "celsius" })).status, 400);
});
