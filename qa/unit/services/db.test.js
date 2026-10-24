const mockQuery = jest.fn();
const mockClienteQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(async () => ({ query: mockClienteQuery, release: mockRelease }));
const mockPool = jest.fn(() => ({ query: mockQuery, connect: mockConnect }));
jest.mock("pg", () => ({ Pool: mockPool }));

describe("db", () => {
  beforeEach(() => {
    jest.resetModules();
    mockQuery.mockReset();
    mockClienteQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockClear();
    mockPool.mockClear();
    delete process.env.DATABASE_URL;
  });

  test("usa a connection string padrão quando DATABASE_URL não está definida", () => {
    require("../../../backend/services/db");
    expect(mockPool).toHaveBeenCalledTimes(1);
    expect(mockPool.mock.calls[0][0].connectionString).toBe("postgres://agroalerta:agroalerta@localhost:5432/agroalerta");
  });

  test("usa DATABASE_URL quando definida", () => {
    process.env.DATABASE_URL = "postgres://u:p@h:1/d";
    require("../../../backend/services/db");
    expect(mockPool.mock.calls[0][0].connectionString).toBe("postgres://u:p@h:1/d");
  });

  test("inicializarBanco cria as 11 tabelas do sistema", async () => {
    mockQuery.mockResolvedValue({});
    const { inicializarBanco } = require("../../../backend/services/db");
    await inicializarBanco();
    const sql = mockQuery.mock.calls[0][0];
    [
      "usuarios",
      "sessoes",
      "talhoes",
      "preferencias_usuario",
      "leituras_clima",
      "cotacoes_mercado",
      "analises_ia",
      "ofertas_insumos",
      "alertas_gerados",
      "mensagens_produtor",
      "envios_alerta",
    ].forEach((t) => expect(sql).toContain("CREATE TABLE IF NOT EXISTS " + t));
  });

  // 1 bloco de CREATE TABLE + 1 de ALTER TABLE + 4 índices + 1 limpeza de sessões.
  test("inicializarBanco executa as 7 etapas de preparação do schema", async () => {
    mockQuery.mockResolvedValue({});
    const { inicializarBanco } = require("../../../backend/services/db");
    await inicializarBanco();
    expect(mockQuery).toHaveBeenCalledTimes(7);
    const indices = mockQuery.mock.calls.filter((c) => String(c[0]).includes("CREATE INDEX IF NOT EXISTS"));
    expect(indices).toHaveLength(4);
  });

  test("inicializarBanco adiciona colunas novas em bases já existentes", async () => {
    mockQuery.mockResolvedValue({});
    const { inicializarBanco } = require("../../../backend/services/db");
    await inicializarBanco();
    const alteracoes = mockQuery.mock.calls[1][0];
    expect(alteracoes).toContain("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cidade TEXT");
    expect(alteracoes).toContain("ALTER TABLE talhoes ADD COLUMN IF NOT EXISTS variedade TEXT");
  });

  test("inicializarBanco descarta sessões expiradas ao subir", async () => {
    mockQuery.mockResolvedValue({});
    const { inicializarBanco } = require("../../../backend/services/db");
    await inicializarBanco();
    const ultima = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0];
    expect(ultima).toContain("DELETE FROM sessoes");
    expect(ultima).toContain("expira_em < NOW()");
  });

  test("inicializarBanco propaga erro de conexão", async () => {
    mockQuery.mockRejectedValue(new Error("ECONNREFUSED"));
    const { inicializarBanco } = require("../../../backend/services/db");
    await expect(inicializarBanco()).rejects.toThrow("ECONNREFUSED");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("emTransacao faz COMMIT e devolve o resultado quando dá certo", async () => {
    mockClienteQuery.mockResolvedValue({});
    const { emTransacao } = require("../../../backend/services/db");
    const resultado = await emTransacao(async () => "pronto");
    expect(resultado).toBe("pronto");
    const comandos = mockClienteQuery.mock.calls.map((c) => c[0]);
    expect(comandos).toEqual(["BEGIN", "COMMIT"]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("emTransacao faz ROLLBACK e libera o cliente quando o bloco lança", async () => {
    mockClienteQuery.mockResolvedValue({});
    const { emTransacao } = require("../../../backend/services/db");
    await expect(emTransacao(async () => {
      throw new Error("falhou no meio");
    })).rejects.toThrow("falhou no meio");
    const comandos = mockClienteQuery.mock.calls.map((c) => c[0]);
    expect(comandos).toEqual(["BEGIN", "ROLLBACK"]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
