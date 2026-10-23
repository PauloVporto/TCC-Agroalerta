const path = require("path");
const request = require("supertest");

const SERVER = path.resolve(__dirname, "..", "..", "..", "backend", "server.js");

jest.mock("../../../backend/services/db", () => ({ inicializarBanco: jest.fn(), pool: { query: jest.fn() } }));
jest.mock("../../../backend/routes/talhoes", () => ({ router: require("express").Router() }));
jest.mock("../../../backend/routes/alertas", () => require("express").Router());
jest.mock("../../../backend/routes/insumos", () => require("express").Router());
jest.mock("../../../backend/routes/mercado", () => require("express").Router());
jest.mock("../../../backend/routes/auth", () => require("express").Router());
jest.mock("../../../backend/routes/clima", () => require("express").Router());

/** Carrega o server.js interceptando app.listen para obter o app sem abrir porta. */
async function subirServidor() {
  jest.resetModules();
  const express = require("express");
  const listen = jest.spyOn(express.application, "listen").mockImplementation(function (porta, cb) {
    if (cb) cb();
    return {};
  });
  const { inicializarBanco } = require("../../../backend/services/db");
  require(SERVER);
  await new Promise((r) => setImmediate(r));
  return { app: listen.mock.contexts[0], listen, inicializarBanco };
}

afterEach(() => {
  delete process.env.OPENWEATHER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.PORT;
});

describe("server.js", () => {
  test("inicializa o banco e escuta na porta 3001 por padrão", async () => {
    const { listen, inicializarBanco } = await subirServidor();
    expect(inicializarBanco).toHaveBeenCalledTimes(1);
    expect(listen.mock.calls[0][0]).toBe(3001);
  });

  test("respeita a variável PORT", async () => {
    process.env.PORT = "4000";
    const { listen } = await subirServidor();
    expect(listen.mock.calls[0][0]).toBe("4000");
  });

  test("GET /api/health informa os modos simulados sem chaves", async () => {
    const { app } = await subirServidor();
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok", modoClima: "simulado", modoIA: "simulado", modoMapas: "nominatim" });
  });

  test("GET /api/health informa modo real quando há chaves", async () => {
    process.env.OPENWEATHER_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    const { app } = await subirServidor();
    const r = await request(app).get("/api/health");
    expect(r.body.modoClima).toBe("real");
    expect(r.body.modoIA).toBe("real");
  });

  test("GET /api/culturas lista café e soja", async () => {
    const { app } = await subirServidor();
    const r = await request(app).get("/api/culturas");
    expect(r.status).toBe(200);
    expect(r.body).toEqual(["cafe", "soja"]);
  });

  test("rota inexistente responde 404 em JSON", async () => {
    const { app } = await subirServidor();
    const r = await request(app).get("/api/nao-existe");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ erro: "Rota não encontrada" });
  });

  test("envia cabeçalho CORS", async () => {
    const { app } = await subirServidor();
    const r = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(r.headers["access-control-allow-origin"]).toBe("*");
  });

  test("falha ao conectar no banco encerra o processo com código 1", async () => {
    jest.resetModules();
    const express = require("express");
    jest.spyOn(express.application, "listen").mockImplementation(() => ({}));
    const exit = jest.spyOn(process, "exit").mockImplementation(() => {});
    require("../../../backend/services/db").inicializarBanco.mockRejectedValue(new Error("sem banco"));
    require(SERVER);
    await new Promise((r) => setImmediate(r));
    expect(exit).toHaveBeenCalledWith(1);
    expect(express.application.listen).not.toHaveBeenCalled();
  });
});
