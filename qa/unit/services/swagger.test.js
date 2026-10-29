const path = require("path");
const { execFileSync } = require("child_process");

// A especificação é montada a partir dos comentários @swagger das rotas. O
// glob que varre esses arquivos já quebrou por depender do diretório de
// execução e por separador de caminho do Windows, então estes testes cobrem
// justamente isso: a spec precisa sair completa independente de onde o
// processo foi iniciado.
describe("especificação OpenAPI", () => {
  const spec = require("../../../backend/swagger");

  test("declara OpenAPI 3 e identifica a API", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe("AgroAlerta API");
  });

  test("encontra as rotas documentadas", () => {
    const caminhos = Object.keys(spec.paths);
    expect(caminhos.length).toBeGreaterThanOrEqual(20);
    expect(caminhos).toEqual(expect.arrayContaining([
      "/auth/registrar", "/auth/login", "/talhoes", "/talhoes/{id}",
      "/alertas/{talhaoId}", "/clima", "/insumos", "/mercado/cotacoes",
    ]));
  });

  test("descreve o esquema de autenticação por token", () => {
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  test("marca as rotas protegidas como autenticadas", () => {
    expect(spec.paths["/talhoes"].get.security).toEqual([{ bearerAuth: [] }]);
    // O cadastro é público: não pode exigir token.
    expect(spec.paths["/auth/registrar"].post.security).toBeUndefined();
  });

  // Regressão: o glob já apontou para "./routes/*.js" (relativo ao diretório
  // de execução) e já usou o separador do Windows. Nos dois casos a spec saía
  // vazia e a página /api-docs aparecia sem nenhuma rota.
  test("sai completa mesmo gerada de outro diretório", () => {
    const backend = path.resolve(__dirname, "..", "..", "..", "backend");
    const saida = execFileSync(
      process.execPath,
      ["-e", "process.stdout.write(String(Object.keys(require(process.argv[1]).paths).length))", path.join(backend, "swagger.js")],
      { cwd: path.resolve(backend, ".."), encoding: "utf-8" }
    );
    expect(Number(saida)).toBeGreaterThanOrEqual(20);
  });
});
