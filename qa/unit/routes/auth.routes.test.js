jest.mock("../../../backend/services/auth", () => ({
  criarUsuario: jest.fn(),
  autenticar: jest.fn(),
  encerrarSessao: jest.fn(),
  obterConfiguracoes: jest.fn(),
  atualizarPerfil: jest.fn(),
  atualizarPreferencias: jest.fn(),
  atualizarLocalizacao: jest.fn(),
  alterarSenha: jest.fn(),
  excluirConta: jest.fn(),
  exigirAutenticacao: (req, res, next) => require("../helpers/app").autenticacaoFalsa(req, res, next),
}));
jest.mock("../../../backend/services/localizacao", () => ({ resolverLocalizacaoPorCep: jest.fn() }));
jest.mock("../../../backend/routes/talhoes", () => ({ criarTalhao: jest.fn() }));
// O cadastro passou a registrar os consentimentos de notificação; sem estes
// mocks o teste subiria a fila de envio de verdade.
jest.mock("../../../backend/services/notificacoes", () => ({ registrarEscolhasDoCadastro: jest.fn() }));
jest.mock("../../../backend/services/notificacoes/consentimentos", () => ({
  contatoDoProdutor: jest.fn(() => ({ email: "ana@x.com", telefone: "35999990000" })),
  obterConsentimentos: jest.fn(async () => ({})),
  autorizacaoVigente: jest.fn(() => false),
}));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const svc = require("../../../backend/services/auth");
const { resolverLocalizacaoPorCep } = require("../../../backend/services/localizacao");
const { criarTalhao } = require("../../../backend/routes/talhoes");
const router = require("../../../backend/routes/auth");

const app = montarApp("/api/auth", router);
const AUTH = { Authorization: "Bearer ok" };
const local = { valido: true, cidade: "Santa Rita", uf: "MG", enderecoFormatado: "Santa Rita, MG", latitude: -22, longitude: -45, cep: "37540-000" };

describe("POST /api/auth/registrar", () => {
  const corpo = {
    nome: "Ana", email: "ana@x.com", senha: "123456", cep: "37540-000",
    cultura: "soja", telefone: "(35) 99999-0000",
  };

  test("cria usuário, talhão inicial e devolve 201 com token", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockResolvedValue({ id: 1, nome: "Ana", email: "ana@x.com" });
    svc.autenticar.mockResolvedValue({ token: "tok" });

    const r = await request(app).post("/api/auth/registrar").send(corpo);

    expect(r.status).toBe(201);
    expect(r.body).toEqual({ usuario: { id: 1, nome: "Ana", email: "ana@x.com" }, token: "tok" });
    expect(criarTalhao).toHaveBeenCalledWith(1, expect.objectContaining({ cultura: "soja", fase: "plantio" }));
  });

  test("sem telefone responde 400", async () => {
    const c = { ...corpo };
    delete c.telefone;
    const r = await request(app).post("/api/auth/registrar").send(c);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/celular com DDD/);
    expect(svc.criarUsuario).not.toHaveBeenCalled();
  });

  test("telefone em formato inválido responde 400", async () => {
    const r = await request(app).post("/api/auth/registrar").send({ ...corpo, telefone: "123" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Telefone inválido/);
  });

  test("e-mail em formato inválido responde 400", async () => {
    const r = await request(app).post("/api/auth/registrar").send({ ...corpo, email: "ana-arroba-x" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/E-mail em formato inválido/);
  });

  test("telefone normalizado é repassado ao serviço", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockResolvedValue({ id: 1 });
    svc.autenticar.mockResolvedValue({ token: "t" });
    await request(app).post("/api/auth/registrar").send(corpo);
    // normalizarTelefone devolve o número em E.164 (ex.: +5535999990000).
    expect(svc.criarUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ telefone: "+5535999990000" })
    );
  });

  test("papel informado é repassado ao serviço", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockResolvedValue({ id: 1, papel: "fornecedor" });
    svc.autenticar.mockResolvedValue({ token: "t" });
    await request(app).post("/api/auth/registrar").send({ ...corpo, papel: "fornecedor" });
    expect(svc.criarUsuario).toHaveBeenCalledWith(expect.objectContaining({ papel: "fornecedor" }));
  });

  // Fornecedor não tem lavoura: só o produtor ganha o talhão inicial.
  test("cadastro de fornecedor não cria talhão", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockResolvedValue({ id: 1, papel: "fornecedor" });
    svc.autenticar.mockResolvedValue({ token: "t" });
    const r = await request(app).post("/api/auth/registrar").send({ ...corpo, papel: "fornecedor" });
    expect(r.status).toBe(201);
    expect(criarTalhao).not.toHaveBeenCalled();
  });

  test("cadastro de produtor cria o talhão inicial", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockResolvedValue({ id: 1, papel: "produtor" });
    svc.autenticar.mockResolvedValue({ token: "t" });
    await request(app).post("/api/auth/registrar").send({ ...corpo, papel: "produtor" });
    expect(criarTalhao).toHaveBeenCalledWith(1, expect.objectContaining({ fase: "plantio" }));
  });

  test("cultura não suportada vira café", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockResolvedValue({ id: 1 });
    svc.autenticar.mockResolvedValue({ token: "t" });
    await request(app).post("/api/auth/registrar").send({ ...corpo, cultura: "milho" });
    expect(criarTalhao.mock.calls[0][1].cultura).toBe("cafe");
  });

  test.each([["nome"], ["email"], ["senha"], ["cep"]])("sem %s responde 400", async (campo) => {
    const c = { ...corpo };
    delete c[campo];
    const r = await request(app).post("/api/auth/registrar").send(c);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Campos obrigatórios/);
    expect(svc.criarUsuario).not.toHaveBeenCalled();
  });

  test("senha curta responde 400", async () => {
    const r = await request(app).post("/api/auth/registrar").send({ ...corpo, senha: "123" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/pelo menos 6/);
  });

  test("CEP inválido responde 400 com a mensagem do serviço", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue({ valido: false, erro: "CEP não encontrado." });
    const r = await request(app).post("/api/auth/registrar").send(corpo);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ erro: "CEP não encontrado." });
  });

  test("e-mail duplicado responde 409", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.criarUsuario.mockRejectedValue(new Error("Já existe uma conta com esse e-mail."));
    const r = await request(app).post("/api/auth/registrar").send(corpo);
    expect(r.status).toBe(409);
    expect(r.body.erro).toBe("Já existe uma conta com esse e-mail.");
  });
});

describe("POST /api/auth/login", () => {
  test("credenciais corretas devolvem 200 com usuário e token", async () => {
    svc.autenticar.mockResolvedValue({ token: "t", usuario: { id: 1 } });
    const r = await request(app).post("/api/auth/login").send({ email: "a@a.com", senha: "123456" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ usuario: { id: 1 }, token: "t" });
  });

  test("sem e-mail ou senha responde 400", async () => {
    const r = await request(app).post("/api/auth/login").send({ email: "a@a.com" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe("Informe e-mail e senha.");
  });

  test("credenciais inválidas respondem 401", async () => {
    svc.autenticar.mockRejectedValue(new Error("E-mail ou senha inválidos."));
    const r = await request(app).post("/api/auth/login").send({ email: "a@a.com", senha: "x" });
    expect(r.status).toBe(401);
    expect(r.body.erro).toBe("E-mail ou senha inválidos.");
  });
});

describe("rotas protegidas exigem token", () => {
  test.each([
    ["post", "/logout"],
    ["get", "/me"],
    ["get", "/configuracoes"],
    ["patch", "/perfil"],
    ["patch", "/localizacao"],
    ["patch", "/preferencias"],
    ["patch", "/senha"],
    ["delete", "/conta"],
  ])("%s %s sem token => 401", async (metodo, caminho) => {
    const r = await request(app)[metodo]("/api/auth" + caminho).send({});
    expect(r.status).toBe(401);
    expect(r.body.erro).toMatch(/Token/);
  });
});

describe("rotas autenticadas", () => {
  test("POST /logout encerra a sessão e responde 204", async () => {
    const r = await request(app).post("/api/auth/logout").set(AUTH);
    expect(r.status).toBe(204);
    expect(svc.encerrarSessao).toHaveBeenCalledWith("ok");
  });

  test("GET /me devolve o usuário logado", async () => {
    const r = await request(app).get("/api/auth/me").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 1, email: "ana@x.com" });
  });

  test("GET /configuracoes devolve as configurações", async () => {
    svc.obterConfiguracoes.mockResolvedValue({ id: 1, culturaFavorita: "cafe" });
    const r = await request(app).get("/api/auth/configuracoes").set(AUTH);
    expect(r.body).toEqual({ id: 1, culturaFavorita: "cafe" });
    expect(svc.obterConfiguracoes).toHaveBeenCalledWith(1);
  });

  test("PATCH /perfil atualiza nome e e-mail", async () => {
    svc.atualizarPerfil.mockResolvedValue({ id: 1, nome: "N", email: "n@n.com" });
    const r = await request(app).patch("/api/auth/perfil").set(AUTH).send({ nome: "N", email: "n@n.com" });
    expect(r.status).toBe(200);
    // Sem telefone no corpo, o já cadastrado é preservado.
    expect(svc.atualizarPerfil).toHaveBeenCalledWith(1, {
      nome: "N", email: "n@n.com", telefone: "35999990000",
    });
  });

  test("PATCH /perfil com e-mail inválido => 400", async () => {
    const r = await request(app).patch("/api/auth/perfil").set(AUTH).send({ nome: "N", email: "sem-arroba" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/E-mail em formato inválido/);
    expect(svc.atualizarPerfil).not.toHaveBeenCalled();
  });

  test("PATCH /perfil troca o telefone quando informado", async () => {
    svc.atualizarPerfil.mockResolvedValue({ id: 1 });
    const r = await request(app).patch("/api/auth/perfil").set(AUTH)
      .send({ nome: "N", email: "n@n.com", telefone: "(35) 98888-0000" });
    expect(r.status).toBe(200);
    expect(svc.atualizarPerfil.mock.calls[0][1].telefone).toBe("+5535988880000");
  });

  test("PATCH /perfil com telefone inválido => 400", async () => {
    const r = await request(app).patch("/api/auth/perfil").set(AUTH)
      .send({ nome: "N", email: "n@n.com", telefone: "123" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Telefone inválido/);
  });

  test("PATCH /perfil sem campos responde 400 e com e-mail duplicado 409", async () => {
    const semCampos = await request(app).patch("/api/auth/perfil").set(AUTH).send({ nome: "N" });
    expect(semCampos.status).toBe(400);
    svc.atualizarPerfil.mockRejectedValue(new Error("Já existe uma conta com esse e-mail."));
    const dup = await request(app).patch("/api/auth/perfil").set(AUTH).send({ nome: "N", email: "n@n.com" });
    expect(dup.status).toBe(409);
  });

  test("PATCH /localizacao valida o CEP e atualiza", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    svc.atualizarLocalizacao.mockResolvedValue({ cidade: "Santa Rita - MG", cidadeFormatada: "Santa Rita, MG", latitude: -22, longitude: -45 });
    const r = await request(app).patch("/api/auth/localizacao").set(AUTH).send({ cep: "37540-000" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cidade: "Santa Rita - MG", cep: "37540-000", uf: "MG" });
  });

  test("PATCH /localizacao sem CEP => 400 e CEP inválido => 400", async () => {
    const sem = await request(app).patch("/api/auth/localizacao").set(AUTH).send({});
    expect(sem.status).toBe(400);
    expect(sem.body.erro).toBe("Informe o CEP.");
    resolverLocalizacaoPorCep.mockResolvedValue({ valido: false, erro: "CEP inválido." });
    const inv = await request(app).patch("/api/auth/localizacao").set(AUTH).send({ cep: "1" });
    expect(inv.status).toBe(400);
    expect(inv.body.erro).toBe("CEP inválido.");
  });

  test("PATCH /preferencias válidas respondem 200", async () => {
    const prefs = { culturaFavorita: "soja", unidadeTemperatura: "fahrenheit", notificacoes: false };
    svc.atualizarPreferencias.mockResolvedValue(prefs);
    const r = await request(app).patch("/api/auth/preferencias").set(AUTH).send(prefs);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(prefs);
  });

  test.each([
    [{ culturaFavorita: "arroz", unidadeTemperatura: "celsius" }],
    [{ culturaFavorita: "cafe", unidadeTemperatura: "kelvin" }],
    [{ unidadeTemperatura: "celsius" }],
  ])("PATCH /preferencias inválidas %j => 400", async (corpo) => {
    const r = await request(app).patch("/api/auth/preferencias").set(AUTH).send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe("Preferências inválidas.");
  });

  // O consentimento de notificação saiu daqui: agora é do módulo de
  // notificações (PUT /api/notificacoes/preferencias) e é ignorado nesta rota.
  test("PATCH /preferencias ignora o campo notificacoes", async () => {
    svc.atualizarPreferencias.mockResolvedValue({ culturaFavorita: "cafe" });
    const r = await request(app).patch("/api/auth/preferencias").set(AUTH)
      .send({ culturaFavorita: "cafe", unidadeTemperatura: "celsius", notificacoes: "sim" });
    expect(r.status).toBe(200);
    expect(svc.atualizarPreferencias).toHaveBeenCalledWith(1, {
      culturaFavorita: "cafe", unidadeTemperatura: "celsius",
    });
  });

  test("PATCH /senha altera a senha", async () => {
    svc.alterarSenha.mockResolvedValue();
    const r = await request(app).patch("/api/auth/senha").set(AUTH).send({ senhaAtual: "velha12", novaSenha: "nova123" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ mensagem: "Senha alterada com sucesso." });
  });

  test("PATCH /senha com nova senha curta ou senha atual errada => 400", async () => {
    const curta = await request(app).patch("/api/auth/senha").set(AUTH).send({ senhaAtual: "velha12", novaSenha: "123" });
    expect(curta.status).toBe(400);
    svc.alterarSenha.mockRejectedValue(new Error("A senha atual está incorreta."));
    const errada = await request(app).patch("/api/auth/senha").set(AUTH).send({ senhaAtual: "x", novaSenha: "nova123" });
    expect(errada.status).toBe(400);
    expect(errada.body.erro).toBe("A senha atual está incorreta.");
  });

  test("DELETE /conta exclui e responde 204", async () => {
    const r = await request(app).delete("/api/auth/conta").set(AUTH);
    expect(r.status).toBe(204);
    expect(svc.excluirConta).toHaveBeenCalledWith(1);
  });
});
