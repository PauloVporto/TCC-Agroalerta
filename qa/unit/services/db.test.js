const mockQuery = jest.fn();
const mockPool = jest.fn(() => ({ query: mockQuery }));
jest.mock("pg", () => ({ Pool: mockPool }));

describe("db", () => {
  beforeEach(() => {
    jest.resetModules();
    mockQuery.mockReset();
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

  test("inicializarBanco cria as 4 tabelas do sistema", async () => {
    mockQuery.mockResolvedValue({});
    const { inicializarBanco } = require("../../../backend/services/db");
    await inicializarBanco();
    const sql = mockQuery.mock.calls[0][0];
    expect(mockQuery).toHaveBeenCalledTimes(1);
    ["usuarios", "sessoes", "talhoes", "preferencias_usuario"].forEach((t) =>
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS " + t)
    );
  });

  test("inicializarBanco propaga erro de conexão", async () => {
    mockQuery.mockRejectedValue(new Error("ECONNREFUSED"));
    const { inicializarBanco } = require("../../../backend/services/db");
    await expect(inicializarBanco()).rejects.toThrow("ECONNREFUSED");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
