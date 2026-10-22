const { defineConfig } = require("cypress");
const createBundler = require("@bahmutov/cypress-esbuild-preprocessor");
const { addCucumberPreprocessorPlugin } = require("@badeball/cypress-cucumber-preprocessor");
const { createEsbuildPlugin } = require("@badeball/cypress-cucumber-preprocessor/esbuild");

module.exports = defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.feature",
    supportFile: "cypress/support/e2e.js",
    viewportWidth: 1440,
    viewportHeight: 900,
    defaultCommandTimeout: 15000, // o runtime React/Babel é carregado do unpkg e renderiza no navegador
    pageLoadTimeout: 60000,
    video: false,
    screenshotOnRunFailure: true,
    screenshotsFolder: "reports/screenshots",
    retries: { runMode: 1, openMode: 0 },
    env: {
      apiUrl: "http://localhost:3001/api",
      cepValido: "37500-001", // Itajubá - MG (existe no ViaCEP)
    },
    // Mochawesome: um JSON por spec em reports/json, mesclado depois por scripts/gerar-relatorio.js
    reporter: "mochawesome",
    reporterOptions: {
      reportDir: "reports/json",
      overwrite: false,
      html: false,
      json: true,
      reportFilename: "[name]",
    },
    async setupNodeEvents(on, config) {
      await addCucumberPreprocessorPlugin(on, config);
      on(
        "file:preprocessor",
        createBundler({ plugins: [createEsbuildPlugin(config)] })
      );
      return config;
    },
  },
});
