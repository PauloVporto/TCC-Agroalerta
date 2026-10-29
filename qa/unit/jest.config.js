const path = require("path");

// rootDir na raiz do repositório para que o Jest consiga medir cobertura do backend/
const raiz = path.resolve(__dirname, "..", "..");

module.exports = {
  rootDir: raiz,
  roots: ["<rootDir>/qa/unit", "<rootDir>/backend"],
  modulePathIgnorePatterns: ["<rootDir>/backend/node_modules"],
  coveragePathIgnorePatterns: ["/node_modules/"],
  testEnvironment: "node",
  testMatch: ["<rootDir>/qa/unit/**/*.test.js"],
  // Permite que os testes enxerguem express/pg instalados em backend/node_modules
  modulePaths: ["<rootDir>/backend/node_modules"],
  // Lista explícita em vez de "backend/**": a cobertura mede só os módulos que
  // esta suíte se propõe a testar unitariamente. O que ficou de fora é
  // verificado por contrato HTTP aqui e com profundidade nos testes de
  // integração do backend (backend/tests/), que rodam contra um Postgres real —
  // incluí-los aqui diluiria a métrica sem acrescentar verificação.
  // Fora de propósito: routes/relatorios.js (centenas de linhas de desenho do
  // PDF, checado pelo contrato em routes/relatorios.routes.test.js) e
  // services/notificacoes/** (24 módulos cobertos por backend/tests/integracao).
  collectCoverageFrom: [
    "backend/server.js",
    "backend/routes/auth.js",
    "backend/routes/talhoes.js",
    "backend/routes/alertas.js",
    "backend/routes/clima.js",
    "backend/routes/insumos.js",
    "backend/routes/mercado.js",
    "backend/routes/noticias.js",
    "backend/routes/notificacoes.js",
    "backend/routes/admin.js",
    "backend/services/rules.js",
    "backend/services/auth.js",
    "backend/services/anthropic.js",
    "backend/services/db.js",
    "backend/services/weather.js",
    "backend/services/openmeteo.js",
    "backend/services/inmet.js",
    "backend/services/bcb.js",
    "backend/services/stooq.js",
    "backend/services/alphavantage.js",
    "backend/services/noticias.js",
    "backend/services/market.js",
    "backend/services/insumosIA.js",
    "backend/services/insumosCatalog.js",
    "backend/services/viacep.js",
    "backend/services/nominatim.js",
    "backend/services/geocoding.js",
    "backend/services/localizacao.js",
  ],
  // v8: o provider padrão (babel-plugin-istanbul) ignora arquivos fora do cwd (backend/)
  coverageProvider: "v8",
  coverageDirectory: "<rootDir>/qa/unit/coverage",
  coverageReporters: ["text", "text-summary", "html", "lcov"],
  coverageThreshold: {
    global: { statements: 85, branches: 70, functions: 85, lines: 85 },
  },
  reporters: [
    "default",
    [require.resolve("jest-html-reporter"), {
      pageTitle: "AgroAlerta - Testes Unitários",
      outputPath: path.join(__dirname, "reports", "relatorio-unitarios.html"),
      includeFailureMsg: true,
      sort: "titleAsc",
    }],
  ],
  clearMocks: true,
  restoreMocks: true,
  silent: true,
};
