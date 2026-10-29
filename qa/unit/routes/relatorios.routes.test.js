// Estes testes conferem o CONTRATO HTTP dos relatórios (tipo de conteúdo,
// nome do arquivo e se o corpo é mesmo um PDF). O conteúdo desenhado em cada
// página não é verificado aqui: o pdfkit roda de verdade e isso já garante
// que o documento fecha sem erro.
jest.mock("../../../backend/services/auth", () => ({
  exigirAutenticacao: (req, res, next) => require("../helpers/app").autenticacaoFalsa(req, res, next),
  obterConfiguracoes: jest.fn(async () => ({
    nome: "Ana", email: "ana@x.com", cidade: "Lavras - MG", culturaFavorita: "cafe",
  })),
}));
jest.mock("../../../backend/services/db", () => ({ pool: { query: jest.fn(async () => ({ rows: [] })) } }));
jest.mock("../../../backend/services/openmeteo", () => ({
  buscarClimaOpenMeteo: jest.fn(async () => ({ temperaturaMinima: 10, previsaoDiaria: [] })),
  buscarSerieDiaria: jest.fn(async () => ({ daily: {} })),
}));
jest.mock("../../../backend/services/weather", () => ({
  buscarClimaAtual: jest.fn(async () => ({ temperaturaMinima: 10, previsaoDiaria: [] })),
}));
jest.mock("../../../backend/services/inmet", () => ({
  buscarAlertasINMET: jest.fn(async () => []),
  extrairUF: jest.fn(() => "MG"),
}));
jest.mock("../../../backend/services/rules", () => ({ avaliarAlertas: jest.fn(() => []) }));
// O relatório de mercado calcula variação, faixa e volatilidade, então a
// série precisa ter mais de um ponto.
jest.mock("../../../backend/services/market", () => ({
  obterHistorico: jest.fn(() => ({
    unidade: "R$/sc",
    historico: Array.from({ length: 12 }, (_, i) => ({
      data: "2026-" + String(i + 1).padStart(2, "0") + "-01",
      preco: 1000 + i * 25,
    })),
  })),
  gerarAnaliseTendencia: jest.fn(async () => ({ resumo: "estável", fatoresConsiderados: [] })),
}));
jest.mock("../../../backend/services/stooq", () => ({
  buscarHistoricoMensalStooq: jest.fn(async () => null),
  buscarCotacaoStooq: jest.fn(async () => null),
}));
jest.mock("../../../backend/services/alphavantage", () => ({ buscarCotacaoAV: jest.fn(async () => null) }));
jest.mock("../../../backend/services/bcb", () => ({
  buscarPtax: jest.fn(async () => null),
  buscarIndiceCommoditiesAgro: jest.fn(async () => null),
}));

const request = require("supertest");
const { montarApp } = require("../helpers/app");

// O pdfkit carrega fontes do disco; a geração real é mais lenta que o padrão.
jest.setTimeout(30000);

const app = montarApp("/api/relatorios", require("../../../backend/routes/relatorios"));
const AUTH = { Authorization: "Bearer ok" };

const TIPOS = [
  ["alertas", "Risco-Climatico"],
  ["insumos", "Compras-de-Insumos"],
  ["mercado", "Mercado"],
  ["validacoes", "Laudo-Tecnico"],
];

describe("GET /api/relatorios/:tipo", () => {
  test.each(TIPOS)("%s devolve um PDF para download", async (tipo, arquivo) => {
    const r = await request(app).get("/api/relatorios/" + tipo).set(AUTH).buffer().parse((res, cb) => {
      const partes = [];
      res.on("data", (c) => partes.push(c));
      res.on("end", () => cb(null, Buffer.concat(partes)));
    });

    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toContain('attachment; filename="AgroAlerta-' + arquivo);
    // Todo PDF começa com a assinatura %PDF-.
    expect(r.body.slice(0, 5).toString()).toBe("%PDF-");
    expect(r.body.length).toBeGreaterThan(1000);
  });

  test("tipo desconhecido => 404 em JSON", async () => {
    const r = await request(app).get("/api/relatorios/inventado").set(AUTH);
    expect(r.status).toBe(404);
    expect(r.body.erro).toBe("Tipo de relatório desconhecido.");
  });

  test("sem token => 401 e nenhum PDF é gerado", async () => {
    const r = await request(app).get("/api/relatorios/alertas");
    expect(r.status).toBe(401);
    expect(r.headers["content-type"]).toMatch(/json/);
  });

  test("falha ao montar o relatório vira 500 em JSON", async () => {
    const { obterHistorico } = require("../../../backend/services/market");
    obterHistorico.mockImplementationOnce(() => {
      throw new Error("histórico indisponível");
    });
    const r = await request(app).get("/api/relatorios/mercado").set(AUTH);
    expect(r.status).toBe(500);
    expect(r.body.erro).toBe("Não foi possível gerar o relatório.");
  });
});
