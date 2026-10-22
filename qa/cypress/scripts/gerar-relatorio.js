// Mescla os JSONs do Mochawesome (um por feature) e gera o relatório HTML final.
const fs = require("fs");
const path = require("path");
const { merge } = require("mochawesome-merge");
const generator = require("mochawesome-report-generator");

const raiz = path.join(__dirname, "..", "reports");
const jsonDir = path.join(raiz, "json");

(async () => {
  if (!fs.existsSync(jsonDir) || fs.readdirSync(jsonDir).length === 0) {
    console.error("Nenhum JSON do Mochawesome em reports/json. Rode os testes antes (npm test).");
    process.exit(1);
  }
  const relatorio = await merge({ files: [path.join(jsonDir, "*.json")] });
  fs.writeFileSync(path.join(raiz, "mochawesome-merged.json"), JSON.stringify(relatorio, null, 2));
  await generator.create(relatorio, {
    reportDir: path.join(raiz, "html"),
    reportFilename: "relatorio-cypress",
    reportTitle: "AgroAlerta - Testes E2E (Cypress + Cucumber)",
    reportPageTitle: "AgroAlerta - E2E",
    charts: true,
    inline: true,
    saveJson: false,
  });
  const s = relatorio.stats;
  console.log(`Relatório: reports/html/relatorio-cypress.html | ${s.passes}/${s.tests} passaram, ${s.failures} falharam`);
  process.exit(s.failures > 0 ? 1 : 0);
})();
