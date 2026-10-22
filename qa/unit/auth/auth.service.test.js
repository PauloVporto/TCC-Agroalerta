jest.mock("../../../backend/services/db", () => ({ pool: { query: jest.fn() } }));

const crypto = require("crypto");
const { pool } = require("../../../backend/services/db");
const auth = require("../../../backend/services/auth");

const hash = (senha, salt) => crypto.scryptSync(senha, salt, 64).toString("hex");

describe("auth.criarUsuario", () => {
  test("insere o usuário com hash/salt e cria preferências, sem vazar senha", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, nome: "Ana", email: "ana@x.com", salt: "s", criadoEm: "t" }] })
      .mockResolvedValueOnce({ rows: [] });

    const usuario = await auth.criarUsuario({ nome: "Ana", email: "ANA@x.com", senha: "123456", cidade: "Lavras - MG" });

    expect(usuario).toEqual({ id: 1, nome: "Ana", email: "ana@x.com", criadoEm: "t" });
    expect(usuario.salt).toBeUndefined();
    expect(pool.query).toHaveBeenCalledTimes(2);
    const params = pool.query.mock.calls[0][1];
    expect(params[2]).toMatch(/^[0-9a-f]{128}$/); // hash scrypt de 64 bytes
    expect(params[2]).not.toBe("123456");
    expect(pool.query.mock.calls[1][1]).toEqual([1]);
  });

  test("converte violação de unicidade (23505) em mensagem de e-mail duplicado", async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(auth.criarUsuario({ nome: "A", email: "a@a.com", senha: "123456" }))
      .rejects.toThrow("Já existe uma conta com esse e-mail.");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("propaga outros erros de banco", async () => {
    pool.query.mockRejectedValueOnce(new Error("conexão caiu"));
    await expect(auth.criarUsuario({ nome: "A", email: "a@a.com", senha: "123456" }))
      .rejects.toThrow("conexão caiu");
  });
});

describe("auth.autenticar", () => {
  const salt = "abc";
  const linha = { id: 7, nome: "Ana", email: "ana@x.com", senhaHash: hash("segredo", salt), salt, criadoEm: "t" };

  test("credenciais corretas devolvem token de 64 hex e usuário sem hash", async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha] }).mockResolvedValueOnce({ rows: [] });
    const { token, usuario } = await auth.autenticar({ email: "ana@x.com", senha: "segredo" });

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(usuario).toEqual({ id: 7, nome: "Ana", email: "ana@x.com", criadoEm: "t" });
    expect(pool.query.mock.calls[1][1]).toEqual([token, 7]);
  });

  test("senha errada lança erro genérico e não cria sessão", async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha] });
    await expect(auth.autenticar({ email: "ana@x.com", senha: "errada" }))
      .rejects.toThrow("E-mail ou senha inválidos.");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("e-mail inexistente lança a mesma mensagem (sem revelar qual campo falhou)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(auth.autenticar({ email: "x@x.com", senha: "segredo" }))
      .rejects.toThrow("E-mail ou senha inválidos.");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe("auth - sessão e consultas", () => {
  test("encerrarSessao apaga o token informado", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await auth.encerrarSessao("tok");
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/DELETE FROM sessoes/);
    expect(pool.query.mock.calls[0][1]).toEqual(["tok"]);
  });

  test("usuarioPorToken devolve o usuário ou null", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, nome: "A", email: "a@a.com", criadoEm: "t" }] });
    expect(await auth.usuarioPorToken("ok")).toMatchObject({ id: 1, email: "a@a.com" });
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await auth.usuarioPorToken("ruim")).toBeNull();
  });

  test("obterConfiguracoes devolve a linha ou null", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, culturaFavorita: "cafe" }] });
    expect(await auth.obterConfiguracoes(1)).toEqual({ id: 1, culturaFavorita: "cafe" });
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await auth.obterConfiguracoes(99)).toBeNull();
  });
});

describe("auth - atualizações", () => {
  test("atualizarPerfil devolve o usuário atualizado", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, nome: "Novo", email: "n@n.com", criadoEm: "t" }] });
    const r = await auth.atualizarPerfil(1, { nome: "Novo", email: "N@n.com" });
    expect(r.nome).toBe("Novo");
    expect(pool.query.mock.calls[0][1]).toEqual(["Novo", "N@n.com", 1]);
  });

  test("atualizarPerfil retorna null quando o usuário não existe", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await auth.atualizarPerfil(9, { nome: "N", email: "n@n.com" })).toBeNull();
  });

  test("atualizarPerfil converte 23505 em e-mail duplicado e propaga outros erros", async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    await expect(auth.atualizarPerfil(1, { nome: "N", email: "n@n.com" }))
      .rejects.toThrow("Já existe uma conta com esse e-mail.");
    pool.query.mockRejectedValueOnce(new Error("boom"));
    await expect(auth.atualizarPerfil(1, { nome: "N", email: "n@n.com" })).rejects.toThrow("boom");
  });

  test("atualizarPreferencias faz upsert e devolve as preferências", async () => {
    const prefs = { culturaFavorita: "soja", unidadeTemperatura: "celsius", notificacoes: false };
    pool.query.mockResolvedValueOnce({ rows: [prefs] });
    expect(await auth.atualizarPreferencias(1, prefs)).toEqual(prefs);
    expect(pool.query.mock.calls[0][0]).toMatch(/ON CONFLICT/);
    expect(pool.query.mock.calls[0][1]).toEqual([1, "soja", "celsius", false]);
  });

  test("atualizarLocalizacao devolve a linha ou null", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, cidade: "Lavras - MG" }] });
    const r = await auth.atualizarLocalizacao(1, { cidade: "Lavras - MG", latitude: 1, longitude: 2 });
    expect(r.cidade).toBe("Lavras - MG");
    expect(pool.query.mock.calls[0][1]).toEqual(["Lavras - MG", null, 1, 2, 1]);
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await auth.atualizarLocalizacao(2, { cidade: "x", latitude: 1, longitude: 2 })).toBeNull();
  });

  test("excluirConta remove o usuário pelo id", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await auth.excluirConta(5);
    expect(pool.query.mock.calls[0][0]).toMatch(/DELETE FROM usuarios/);
    expect(pool.query.mock.calls[0][1]).toEqual([5]);
  });
});

describe("auth.alterarSenha", () => {
  const salt = "salt1";
  const linha = { senhaHash: hash("atual123", salt), salt };

  test("com a senha atual correta grava novo hash e novo salt", async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha] }).mockResolvedValueOnce({ rows: [] });
    await auth.alterarSenha(1, "atual123", "nova1234");

    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE usuarios SET senha_hash/);
    expect(params[1]).not.toBe(salt);
    expect(params[0]).toBe(hash("nova1234", params[1]));
  });

  test("senha atual incorreta lança erro e não faz UPDATE", async () => {
    pool.query.mockResolvedValueOnce({ rows: [linha] });
    await expect(auth.alterarSenha(1, "errada", "nova1234")).rejects.toThrow("A senha atual está incorreta.");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("usuário inexistente também lança erro", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(auth.alterarSenha(99, "x", "nova1234")).rejects.toThrow("A senha atual está incorreta.");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe("auth.exigirAutenticacao (middleware)", () => {
  const criarRes = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  test("sem header Authorization responde 401 'ausente'", async () => {
    const res = criarRes();
    const next = jest.fn();
    await auth.exigirAutenticacao({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ erro: "Token de autenticação ausente." });
    expect(next).not.toHaveBeenCalled();
  });

  test("header sem prefixo Bearer é tratado como ausente", async () => {
    const res = criarRes();
    await auth.exigirAutenticacao({ headers: { authorization: "Basic abc" } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ erro: "Token de autenticação ausente." });
  });

  test("token que não existe no banco responde 401 'inválida'", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = criarRes();
    const next = jest.fn();
    await auth.exigirAutenticacao({ headers: { authorization: "Bearer xyz" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ erro: "Sessão inválida ou expirada." });
    expect(next).not.toHaveBeenCalled();
  });

  test("token válido popula req.usuario e chama next()", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 3, nome: "A", email: "a@a.com", criadoEm: "t" }] });
    const req = { headers: { authorization: "Bearer valido" } };
    const next = jest.fn();
    await auth.exigirAutenticacao(req, criarRes(), next);
    expect(req.usuario).toMatchObject({ id: 3, email: "a@a.com" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual(["valido"]);
  });
});
