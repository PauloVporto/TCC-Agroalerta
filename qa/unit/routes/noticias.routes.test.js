// A rota só orquestra: o serviço de notícias é mockado para que o teste não
// dependa dos RSS do Canal Rural e do g1 estarem no ar.
jest.mock("../../../backend/services/noticias", () => ({
  buscarNoticiasCultura: jest.fn(),
  // O serviço só cobre as duas culturas do cadastro.
  TERMOS: { cafe: ["café"], soja: ["soja"] },
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

  test("GET /?cultura=soja é aceita", async () => {
    buscarNoticiasCultura.mockResolvedValue([]);
    const r = await request(app).get("/api/noticias?cultura=soja");
    expect(r.status).toBe(200);
    expect(r.body.cultura).toBe("soja");
  });

  // Só café e soja: são as culturas que o cadastro oferece, e a página de
  // notícias acompanha a que o produtor declarou.
  test.each(["milho", "cana", "feijao", "abacaxi"])(
    "cultura fora da lista (%s) responde 400 dizendo quais valem",
    async (cultura) => {
      const r = await request(app).get("/api/noticias?cultura=" + cultura);
      expect(r.status).toBe(400);
      expect(r.body.erro).toContain("cafe");
      expect(r.body.erro).toContain("soja");
      expect(buscarNoticiasCultura).not.toHaveBeenCalled();
    }
  );

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
