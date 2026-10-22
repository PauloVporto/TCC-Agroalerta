jest.mock("../../../backend/services/auth", () => ({
  exigirAutenticacao: (req, res, next) => require("../helpers/app").autenticacaoFalsa(req, res, next),
  obterConfiguracoes: jest.fn(),
}));
jest.mock("../../../backend/routes/talhoes", () => ({ buscarTalhaoPorId: jest.fn() }));
jest.mock("../../../backend/services/weather", () => ({ buscarClimaAtual: jest.fn() }));
jest.mock("../../../backend/services/openmeteo", () => ({ buscarClimaOpenMeteo: jest.fn() }));
jest.mock("../../../backend/services/inmet", () => ({
  buscarAlertasINMET: jest.fn(),
  extrairUF: jest.requireActual("../../../backend/services/inmet").extrairUF,
}));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const { buscarTalhaoPorId } = require("../../../backend/routes/talhoes");
const { buscarClimaAtual } = require("../../../backend/services/weather");
const { buscarClimaOpenMeteo } = require("../../../backend/services/openmeteo");
const { buscarAlertasINMET } = require("../../../backend/services/inmet");
const { obterConfiguracoes } = require("../../../backend/services/auth");

const AUTH = { Authorization: "Bearer ok" };

describe("GET /api/alertas/:talhaoId", () => {
  const app = montarApp("/api/alertas", require("../../../backend/routes/alertas"));
  const talhao = { id: 3, usuarioId: 1, nome: "T", cultura: "cafe", fase: "vegetativo", latitude: -21, longitude: -45, enderecoFormatado: "Lavras - MG" };
  const frio = { temperaturaMinima: 1, diasSemChuva: 0, chuvaAcumulada7dias: 0, probabilidadeChuva7dias: 0, ventoMaximoKmh: 0, fonte: "open-meteo" };

  test("sem token => 401", async () => {
    const r = await request(app).get("/api/alertas/3");
    expect(r.status).toBe(401);
    expect(buscarTalhaoPorId).not.toHaveBeenCalled();
  });

  test("devolve talhão, clima e alertas gerados pelo motor de regras", async () => {
    buscarTalhaoPorId.mockResolvedValue(talhao);
    buscarClimaOpenMeteo.mockResolvedValue(frio);
    buscarClimaAtual.mockResolvedValue({ fonte: "owm" });
    buscarAlertasINMET.mockResolvedValue([{ nivel: "alto", descricao: "Geada" }]);

    const r = await request(app).get("/api/alertas/3").set(AUTH);

    expect(r.status).toBe(200);
    expect(r.body.talhao).toMatchObject({ id: 3, cultura: "cafe", enderecoFormatado: "Lavras - MG" });
    expect(r.body.alertas[0]).toMatchObject({ id: "cafe_geada", nivel: "alto" });
    expect(r.body.alertasOficiais).toEqual([{ nivel: "alto", descricao: "Geada" }]);
    expect(buscarAlertasINMET).toHaveBeenCalledWith("MG");
  });

  test("Open-Meteo fora do ar usa OpenWeather como fallback", async () => {
    buscarTalhaoPorId.mockResolvedValue(talhao);
    buscarClimaOpenMeteo.mockRejectedValue(new Error("fora"));
    buscarClimaAtual.mockResolvedValue({ ...frio, fonte: "owm", temperaturaMinima: 20 });
    buscarAlertasINMET.mockRejectedValue(new Error("fora"));

    const r = await request(app).get("/api/alertas/3").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.clima.fonte).toBe("owm");
    expect(r.body.alertas).toEqual([]);
    expect(r.body.alertasOficiais).toEqual([]);
  });

  test("nenhuma fonte de clima => 503", async () => {
    buscarTalhaoPorId.mockResolvedValue(talhao);
    buscarClimaOpenMeteo.mockRejectedValue(new Error("x"));
    buscarClimaAtual.mockRejectedValue(new Error("y"));
    buscarAlertasINMET.mockResolvedValue([]);
    const r = await request(app).get("/api/alertas/3").set(AUTH);
    expect(r.status).toBe(503);
    expect(r.body.erro).toMatch(/indisponíveis/);
  });

  test("talhão inexistente => 404 e de outro usuário => 403", async () => {
    buscarTalhaoPorId.mockResolvedValueOnce(null);
    expect((await request(app).get("/api/alertas/9").set(AUTH)).status).toBe(404);
    buscarTalhaoPorId.mockResolvedValueOnce({ ...talhao, usuarioId: 2 });
    const r = await request(app).get("/api/alertas/3").set(AUTH);
    expect(r.status).toBe(403);
    expect(buscarClimaOpenMeteo).not.toHaveBeenCalled();
  });

  test("erro inesperado => 500", async () => {
    buscarTalhaoPorId.mockResolvedValue({ ...talhao, cultura: "cafe" });
    buscarClimaOpenMeteo.mockResolvedValue(null); // clima nulo + OWM nulo => 503, então forçamos exceção no INMET síncrono
    buscarClimaAtual.mockResolvedValue(frio);
    buscarAlertasINMET.mockImplementation(() => { throw new Error("síncrono"); });
    const r = await request(app).get("/api/alertas/3").set(AUTH);
    expect(r.status).toBe(500);
    expect(r.body.erro).toBe("Erro ao gerar alertas para o talhão");
  });
});

describe("GET /api/clima", () => {
  const app = montarApp("/api/clima", require("../../../backend/routes/clima"));

  test("sem token => 401", async () => {
    const r = await request(app).get("/api/clima");
    expect(r.status).toBe(401);
    expect(obterConfiguracoes).not.toHaveBeenCalled();
  });

  test("devolve o clima da cidade cadastrada", async () => {
    obterConfiguracoes.mockResolvedValue({ cidade: "Lavras - MG", cidadeFormatada: "Lavras, MG", latitude: -21, longitude: -45 });
    buscarClimaAtual.mockResolvedValue({ fonte: "simulado" });
    const r = await request(app).get("/api/clima").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cidade: "Lavras - MG", cidadeFormatada: "Lavras, MG", clima: { fonte: "simulado" } });
    expect(buscarClimaAtual).toHaveBeenCalledWith(-21, -45);
  });

  test.each([
    ["sem configuração", null],
    ["sem latitude", { latitude: null, longitude: -45 }],
    ["sem longitude", { latitude: -21, longitude: null }],
  ])("%s => 404", async (_, config) => {
    obterConfiguracoes.mockResolvedValue(config);
    const r = await request(app).get("/api/clima").set(AUTH);
    expect(r.status).toBe(404);
    expect(r.body.erro).toBe("Cidade não cadastrada para este usuário.");
  });
});
