// A rota só orquestra: o serviço de notícias é mockado para que o teste não
// dependa dos RSS do Canal Rural e do g1 estarem no ar.
jest.mock("../../../backend/services/noticias", () => ({
  buscarNoticiasCultura: jest.fn(),
  TERMOS: { cafe: ["café"], soja: ["soja"], milho: ["milho"], cana: ["cana"], feijao: ["feijão"] },
}));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const { buscarNoticiasCultura } = require("../../../backend/services/noticias");

describe("rotas de notícias", () => {
  const app = montarApp("/api/noticias", require("../../../backend/routes/noticias"));

  const NOTICIA = {
    titulo: "Preço do café recua e fecha a semana em queda",
    resumo: "Queda das cotações em Nova York pressiona os preços do café no mercado brasileiro.",
    link: "https://www.canalrural.com.br/agricultura/cafe/preco-do-cafe-recua/",
    fonte: "Canal Rural",
    dataTexto: "23 de out. de 2026",
    publicadoEm: "2026-10-23T10:00:00.000Z",
  };

  beforeEach(() => {
    buscarNoticiasCultura.mockReset();
  });

  test("GET /?cultura=cafe devolve as notícias com resumo e link", async () => {
    buscarNoticiasCultura.mockResolvedValue([NOTICIA]);
    const r = await request(app).get("/api/noticias?cultura=cafe");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cultura: "cafe", total: 1 });
    expect(r.body.noticias[0]).toEqual(NOTICIA);
    expect(buscarNoticiasCultura).toHaveBeenCalledWith("cafe");
  });

  test("GET / sem cultura assume café", async () => {
    buscarNoticiasCultura.mockResolvedValue([]);
    const r = await request(app).get("/api/noticias");
    expect(r.status).toBe(200);
    expect(r.body.cultura).toBe("cafe");
    expect(buscarNoticiasCultura).toHaveBeenCalledWith("cafe");
  });

  test.each(["soja", "milho", "cana", "feijao"])("GET /?cultura=%s é aceita", async (cultura) => {
    buscarNoticiasCultura.mockResolvedValue([]);
    const r = await request(app).get("/api/noticias?cultura=" + cultura);
    expect(r.status).toBe(200);
    expect(r.body.cultura).toBe(cultura);
  });

  test("cultura fora da lista responde 400 dizendo quais valem", async () => {
    const r = await request(app).get("/api/noticias?cultura=abacaxi");
    expect(r.status).toBe(400);
    expect(r.body.erro).toContain("cafe");
    expect(buscarNoticiasCultura).not.toHaveBeenCalled();
  });

  test("lista vazia responde 200 com total 0, não 404", async () => {
    buscarNoticiasCultura.mockResolvedValue([]);
    const r = await request(app).get("/api/noticias?cultura=soja");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cultura: "soja", total: 0, noticias: [] });
  });

  test("falha no serviço não derruba a página: 200 com lista vazia", async () => {
    const erro = jest.spyOn(console, "error").mockImplementation(() => {});
    buscarNoticiasCultura.mockRejectedValue(new Error("feeds fora do ar"));
    const r = await request(app).get("/api/noticias?cultura=cafe");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cultura: "cafe", total: 0, noticias: [] });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  test("total acompanha o tamanho da lista", async () => {
    buscarNoticiasCultura.mockResolvedValue([NOTICIA, { ...NOTICIA, titulo: "Outra notícia de café" }]);
    const r = await request(app).get("/api/noticias?cultura=cafe");
    expect(r.body.total).toBe(2);
    expect(r.body.noticias).toHaveLength(2);
  });
});
