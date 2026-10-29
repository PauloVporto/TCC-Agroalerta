// Rotas de oferta de insumo: só contas com papel "fornecedor" podem
// publicar, listar e remover as próprias ofertas.
jest.mock("../../../backend/services/auth", () => {
  const { autenticacaoFalsa } = require("../helpers/app");
  const { exigirPapel } = jest.requireActual("../../../backend/services/auth");
  return { exigirAutenticacao: autenticacaoFalsa, exigirPapel };
});
jest.mock("../../../backend/services/db", () => ({ pool: { query: jest.fn() } }));
jest.mock("../../../backend/services/insumosIA", () => ({ gerarInsightCompra: jest.fn() }));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const { pool } = require("../../../backend/services/db");
const { catalogo } = require("../../../backend/services/insumosCatalog");

const app = montarApp("/api/insumos", require("../../../backend/routes/insumos"));
const FORNECEDOR = { Authorization: "Bearer fornecedor" };
const PRODUTOR = { Authorization: "Bearer ok" };
const OFERTA = { nome: "Adubo 20kg", categoria: "fertilizante", unidade: "saco", preco: 150.5, cidade: "Lavras" };

beforeEach(() => pool.query.mockReset());

describe("permissão das rotas de fornecedor", () => {
  test.each([
    ["get", "/meus"],
    ["post", "/"],
    ["delete", "/9"],
  ])("%s %s sem token => 401", async (metodo, caminho) => {
    const r = await request(app)[metodo]("/api/insumos" + caminho).send(OFERTA);
    expect(r.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([
    ["get", "/meus"],
    ["post", "/"],
    ["delete", "/9"],
  ])("%s %s com conta de produtor => 403", async (metodo, caminho) => {
    const r = await request(app)[metodo]("/api/insumos" + caminho).set(PRODUTOR).send(OFERTA);
    expect(r.status).toBe(403);
    expect(r.body.erro).toMatch(/só para contas de/i);
  });
});

describe("GET /api/insumos/meus", () => {
  test("lista apenas as ofertas do fornecedor logado", async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, nome: "Adubo 20kg" }] });
    const r = await request(app).get("/api/insumos/meus").set(FORNECEDOR);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(pool.query.mock.calls[0][1]).toEqual([3]);
  });
});

describe("POST /api/insumos", () => {
  test("publica a oferta e responde 201", async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 7, ...OFERTA }] });
    const r = await request(app).post("/api/insumos").set(FORNECEDOR).send(OFERTA);
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(7);
    const params = pool.query.mock.calls[0][1];
    expect(params[0]).toBe(3);
    expect(params[5]).toBe(150.5);
  });

  test.each([
    ["sem nome", { ...OFERTA, nome: "" }],
    ["sem categoria", { ...OFERTA, categoria: "" }],
    ["sem unidade", { ...OFERTA, unidade: "" }],
    ["sem cidade", { ...OFERTA, cidade: "" }],
    ["preço zero", { ...OFERTA, preco: 0 }],
    ["preço negativo", { ...OFERTA, preco: -10 }],
    ["preço não numérico", { ...OFERTA, preco: "caro" }],
  ])("%s => 400 sem gravar", async (_, corpo) => {
    const r = await request(app).post("/api/insumos").set(FORNECEDOR).send(corpo);
    expect(r.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  // Quando a oferta aponta para um item do catálogo, nome/categoria/unidade
  // vêm do catálogo para não haver duas grafias do mesmo produto.
  test("oferta vinculada ao catálogo usa os dados do catálogo", async () => {
    const doCatalogo = catalogo.insumos[0];
    pool.query.mockResolvedValue({ rows: [{ id: 8 }] });
    await request(app).post("/api/insumos").set(FORNECEDOR)
      .send({ ...OFERTA, nome: "nome divergente", insumoCatalogoId: doCatalogo.id });
    const params = pool.query.mock.calls[0][1];
    expect(params[1]).toBe(doCatalogo.id);
    expect(params[2]).toBe(doCatalogo.nome);
    expect(params[3]).toBe(doCatalogo.categoria);
  });

  test("id de catálogo desconhecido mantém os dados informados", async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 9 }] });
    await request(app).post("/api/insumos").set(FORNECEDOR)
      .send({ ...OFERTA, insumoCatalogoId: "nao-existe" });
    const params = pool.query.mock.calls[0][1];
    expect(params[1]).toBeNull();
    expect(params[2]).toBe("Adubo 20kg");
  });
});

describe("DELETE /api/insumos/:id", () => {
  test("remove a própria oferta => 204", async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    const r = await request(app).delete("/api/insumos/7").set(FORNECEDOR);
    expect(r.status).toBe(204);
    expect(pool.query.mock.calls[0][1]).toEqual([7, 3]);
  });

  // A exclusão é filtrada por usuário: a oferta de outro fornecedor não é
  // encontrada e, portanto, não é apagada.
  test("oferta inexistente ou de outro fornecedor => 404", async () => {
    pool.query.mockResolvedValue({ rowCount: 0 });
    const r = await request(app).delete("/api/insumos/999").set(FORNECEDOR);
    expect(r.status).toBe(404);
    expect(r.body.erro).toBe("Oferta não encontrada.");
  });
});
