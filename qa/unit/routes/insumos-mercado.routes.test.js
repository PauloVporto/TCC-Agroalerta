jest.mock("../../../backend/services/insumosIA", () => ({ gerarInsightCompra: jest.fn() }));
jest.mock("../../../backend/services/market", () => ({ obterHistorico: jest.fn(), gerarAnaliseTendencia: jest.fn() }));
jest.mock("../../../backend/services/alphavantage", () => ({ buscarCotacaoAV: jest.fn() }));
jest.mock("../../../backend/services/stooq", () => ({ buscarCotacaoStooq: jest.fn(), buscarHistoricoMensalStooq: jest.fn() }));
jest.mock("../../../backend/services/bcb", () => ({ buscarPtax: jest.fn(), buscarIndiceCommoditiesAgro: jest.fn() }));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const { gerarInsightCompra } = require("../../../backend/services/insumosIA");
const { obterHistorico, gerarAnaliseTendencia } = require("../../../backend/services/market");
const { buscarCotacaoAV } = require("../../../backend/services/alphavantage");
const { buscarCotacaoStooq, buscarHistoricoMensalStooq } = require("../../../backend/services/stooq");
const { buscarPtax, buscarIndiceCommoditiesAgro } = require("../../../backend/services/bcb");

describe("rotas de insumos", () => {
  const app = montarApp("/api/insumos", require("../../../backend/routes/insumos"));

  test("GET / lista insumos com ofertas ordenadas e melhorPreco", async () => {
    const r = await request(app).get("/api/insumos");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(5);
    r.body.forEach((i) => {
      const precos = i.ofertas.map((o) => o.preco);
      expect(precos).toEqual([...precos].sort((a, b) => a - b));
      expect(i.melhorPreco).toEqual(i.ofertas[0]);
    });
  });

  test("GET /?categoria= filtra pela categoria", async () => {
    const r = await request(app).get("/api/insumos?categoria=fungicida");
    expect(r.body).toHaveLength(1);
    expect(r.body[0].categoria).toBe("fungicida");
    expect((await request(app).get("/api/insumos?categoria=nao_existe")).body).toEqual([]);
  });

  test("GET /recomendados/cafe_geada devolve proteção térmica", async () => {
    const r = await request(app).get("/api/insumos/recomendados/cafe_geada");
    expect(r.status).toBe(200);
    expect(r.body.every((i) => i.categoria === "protecao_termica")).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  test("GET /recomendados/cafe_estiagem devolve irrigação e hidrogel", async () => {
    const r = await request(app).get("/api/insumos/recomendados/cafe_estiagem");
    expect(r.body.map((i) => i.categoria).sort()).toEqual(["hidrogel", "irrigacao"]);
    expect(r.body[0].melhorPreco).toBeDefined();
  });

  test("regra sem categoria (soja_vento_forte) devolve lista vazia", async () => {
    const r = await request(app).get("/api/insumos/recomendados/soja_vento_forte");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  test("regra desconhecida => 404", async () => {
    const r = await request(app).get("/api/insumos/recomendados/xyz");
    expect(r.status).toBe(404);
    expect(r.body.erro).toBe("Regra de alerta desconhecida");
  });

  test("GET /analise/:categoria devolve a análise", async () => {
    gerarInsightCompra.mockResolvedValue({ categoria: "fungicida", gerarPor: "simulado" });
    const r = await request(app).get("/api/insumos/analise/fungicida");
    expect(r.status).toBe(200);
    expect(r.body.categoria).toBe("fungicida");
    expect(gerarInsightCompra).toHaveBeenCalledWith("fungicida");
  });

  test("GET /analise com categoria inválida => 400", async () => {
    gerarInsightCompra.mockRejectedValue(new Error("Categoria de insumo não encontrada: x"));
    const r = await request(app).get("/api/insumos/analise/x");
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/não encontrada/);
  });
});

describe("rotas de mercado", () => {
  const app = montarApp("/api/mercado", require("../../../backend/routes/mercado"));

  describe("GET /cotacoes", () => {
    test("agrega PTAX, IC-Br e cotação internacional", async () => {
      buscarPtax.mockResolvedValue({ cotacaoVenda: 5 });
      buscarIndiceCommoditiesAgro.mockResolvedValue({ valorAtual: 100 });
      buscarCotacaoAV.mockResolvedValue({ fonte: "Alpha Vantage" });
      buscarCotacaoStooq.mockResolvedValue({ fonte: "Stooq" });
      const r = await request(app).get("/api/mercado/cotacoes");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ptax: { cotacaoVenda: 5 }, icbr: { valorAtual: 100 }, cotacaoInternacional: { fonte: "Alpha Vantage" } });
      expect(buscarCotacaoAV).toHaveBeenCalledWith("cafe");
    });

    test("cai para Stooq quando Alpha Vantage não retorna e respeita ?cultura", async () => {
      buscarPtax.mockResolvedValue(null);
      buscarIndiceCommoditiesAgro.mockResolvedValue(null);
      buscarCotacaoAV.mockResolvedValue(null);
      buscarCotacaoStooq.mockResolvedValue({ fonte: "Stooq" });
      const r = await request(app).get("/api/mercado/cotacoes?cultura=soja");
      expect(r.body.cotacaoInternacional).toEqual({ fonte: "Stooq" });
      expect(buscarCotacaoStooq).toHaveBeenCalledWith("soja");
    });

    test("fontes que lançam erro viram null sem derrubar a rota", async () => {
      buscarPtax.mockRejectedValue(new Error("x"));
      buscarIndiceCommoditiesAgro.mockRejectedValue(new Error("x"));
      buscarCotacaoAV.mockRejectedValue(new Error("x"));
      buscarCotacaoStooq.mockRejectedValue(new Error("x"));
      const r = await request(app).get("/api/mercado/cotacoes");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ptax: null, icbr: null, cotacaoInternacional: null });
    });
  });

  describe("GET /:cultura/historico", () => {
    test("devolve o histórico real do Stooq quando disponível", async () => {
      buscarHistoricoMensalStooq.mockResolvedValue({ historico: [{ data: "2026-01-01", preco: 1 }], fonte: "Stooq" });
      const r = await request(app).get("/api/mercado/cafe/historico");
      expect(r.status).toBe(200);
      expect(r.body.fonte).toBe("Stooq");
      expect(obterHistorico).not.toHaveBeenCalled();
    });

    test.each([
      ["Stooq nulo", () => buscarHistoricoMensalStooq.mockResolvedValue(null)],
      ["Stooq vazio", () => buscarHistoricoMensalStooq.mockResolvedValue({ historico: [] })],
      ["Stooq lançando erro", () => buscarHistoricoMensalStooq.mockRejectedValue(new Error("x"))],
    ])("%s usa o histórico local", async (_, preparar) => {
      preparar();
      obterHistorico.mockReturnValue({ historico: [{ preco: 1 }], fonte: "local" });
      const r = await request(app).get("/api/mercado/milho/historico");
      expect(r.status).toBe(200);
      expect(r.body.fonte).toBe("local");
      expect(obterHistorico).toHaveBeenCalledWith("milho");
    });

    test("cultura inexistente => 404", async () => {
      buscarHistoricoMensalStooq.mockResolvedValue(null);
      obterHistorico.mockReturnValue(null);
      const r = await request(app).get("/api/mercado/arroz/historico");
      expect(r.status).toBe(404);
      expect(r.body.erro).toBe("Cultura não encontrada");
    });
  });

  describe("GET /:cultura/analise", () => {
    test("devolve a análise de tendência", async () => {
      gerarAnaliseTendencia.mockResolvedValue({ cultura: "cafe", variacaoPercentual: 1.5 });
      const r = await request(app).get("/api/mercado/cafe/analise");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ cultura: "cafe", variacaoPercentual: 1.5 });
    });

    test("cultura não suportada => 400", async () => {
      gerarAnaliseTendencia.mockRejectedValue(new Error("Cultura não suportada para análise de mercado: x"));
      const r = await request(app).get("/api/mercado/x/analise");
      expect(r.status).toBe(400);
      expect(r.body.erro).toMatch(/não suportada/);
    });
  });
});
