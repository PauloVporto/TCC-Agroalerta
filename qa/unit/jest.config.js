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
  collectCoverageFrom: [
    "backend/server.js",
    "backend/routes/**/*.js",
    "backend/services/**/*.js",
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
