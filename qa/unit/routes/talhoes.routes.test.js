jest.mock("../../../backend/services/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../../../backend/services/auth", () => ({
  exigirAutenticacao: (req, res, next) => require("../helpers/app").autenticacaoFalsa(req, res, next),
}));
jest.mock("../../../backend/services/localizacao", () => ({ resolverLocalizacaoPorCep: jest.fn() }));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const { pool } = require("../../../backend/services/db");
const { resolverLocalizacaoPorCep } = require("../../../backend/services/localizacao");
const { router, buscarTalhaoPorId, criarTalhao } = require("../../../backend/routes/talhoes");

const app = montarApp("/api/talhoes", router);
const AUTH = { Authorization: "Bearer ok" };
const talhao = { id: 10, usuarioId: 1, nome: "T1", cultura: "cafe", fase: "floracao" };
const local = { valido: true, enderecoFormatado: "Lavras, MG", latitude: -21, longitude: -45 };

describe("autenticação do router de talhões", () => {
  test.each([["get", "/"], ["post", "/"], ["patch", "/1"], ["delete", "/1"]])("%s %s sem token => 401", async (m, p) => {
    const r = await request(app)[m]("/api/talhoes" + p).send({});
    expect(r.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("GET /api/talhoes", () => {
  test("lista somente os talhões do usuário logado", async () => {
    pool.query.mockResolvedValue({ rows: [talhao] });
    const r = await request(app).get("/api/talhoes").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([talhao]);
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
  });
});

describe("POST /api/talhoes", () => {
  const corpo = { nome: "Novo", cultura: "soja", fase: "colheita", cep: "37540-000" };

  test("cria o talhão e responde 201", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue(local);
    pool.query.mockResolvedValue({ rows: [{ id: 5, ...corpo }] });
    const r = await request(app).post("/api/talhoes").set(AUTH).send(corpo);
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(5);
    expect(pool.query.mock.calls[0][1]).toEqual([1, "Novo", "soja", "colheita", "Lavras, MG", -21, -45, "Lavras, MG"]);
  });

  test.each([["nome"], ["cultura"], ["fase"], ["cep"]])("sem %s => 400", async (campo) => {
    const c = { ...corpo };
    delete c[campo];
    const r = await request(app).post("/api/talhoes").set(AUTH).send(c);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Campos obrigatórios/);
  });

  test("cultura não suportada => 400 listando as aceitas", async () => {
    const r = await request(app).post("/api/talhoes").set(AUTH).send({ ...corpo, cultura: "milho" });
    expect(r.status).toBe(400);
    expect(r.body.erro).toContain("cafe, soja");
  });

  test("CEP inválido => 400", async () => {
    resolverLocalizacaoPorCep.mockResolvedValue({ valido: false, erro: "CEP não encontrado." });
    const r = await request(app).post("/api/talhoes").set(AUTH).send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe("CEP não encontrado.");
  });
});

describe("DELETE /api/talhoes/:id", () => {
  test("dono remove o talhão => 204", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 10, usuarioId: 1 }] }).mockResolvedValueOnce({ rows: [] });
    const r = await request(app).delete("/api/talhoes/10").set(AUTH);
    expect(r.status).toBe(204);
    expect(pool.query.mock.calls[1][0]).toMatch(/DELETE FROM talhoes/);
  });

  test("talhão inexistente => 404", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const r = await request(app).delete("/api/talhoes/99").set(AUTH);
    expect(r.status).toBe(404);
    expect(r.body.erro).toBe("Talhão não encontrado");
  });

  test("talhão de outro usuário => 403 e nada é apagado", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 10, usuarioId: 2 }] });
    const r = await request(app).delete("/api/talhoes/10").set(AUTH);
    expect(r.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/talhoes/:id", () => {
  test("dono atualiza nome e fase", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, usuarioId: 1, nome: "Velho", fase: "vegetativo" }] })
      .mockResolvedValueOnce({ rows: [{ id: 10, nome: "Novo", fase: "floracao" }] });
    const r = await request(app).patch("/api/talhoes/10").set(AUTH).send({ nome: "Novo", fase: "floracao" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nome: "Novo", fase: "floracao" });
    expect(pool.query.mock.calls[1][1]).toEqual(["Novo", "floracao", 10]);
  });

  test("campos omitidos mantêm os valores atuais", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, usuarioId: 1, nome: "Velho", fase: "vegetativo" }] })
      .mockResolvedValueOnce({ rows: [{}] });
    await request(app).patch("/api/talhoes/10").set(AUTH).send({});
    expect(pool.query.mock.calls[1][1]).toEqual(["Velho", "vegetativo", 10]);
  });

  test("inexistente => 404 e de outro dono => 403", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect((await request(app).patch("/api/talhoes/1").set(AUTH).send({})).status).toBe(404);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, usuarioId: 2 }] });
    const r = await request(app).patch("/api/talhoes/1").set(AUTH).send({ nome: "x" });
    expect(r.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe("helpers exportados", () => {
  test("buscarTalhaoPorId devolve o talhão ou null e converte id para número", async () => {
    pool.query.mockResolvedValueOnce({ rows: [talhao] });
    expect(await buscarTalhaoPorId("10")).toEqual(talhao);
    expect(pool.query.mock.calls[0][1]).toEqual([10]);
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await buscarTalhaoPorId(1)).toBeNull();
  });

  test("criarTalhao grava com as coordenadas informadas", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const r = await criarTalhao(3, { nome: "N", cultura: "cafe", fase: "f", endereco: "e", coordenadas: { latitude: 1, longitude: 2, enderecoFormatado: "ef" } });
    expect(r).toEqual({ id: 1 });
    expect(pool.query.mock.calls[0][1]).toEqual([3, "N", "cafe", "f", "e", 1, 2, "ef"]);
  });
});
