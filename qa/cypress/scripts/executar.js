// Executa os testes Cypress e, ao final, gera o relatório Mochawesome (independente do resultado).
// Uso: node scripts/executar.js [argumentos extras para "cypress run"]
const { spawnSync } = require("child_process");
const path = require("path");

const raiz = path.join(__dirname, "..");
const cypressBin = path.join(raiz, "node_modules", "cypress", "bin", "cypress");

// ELECTRON_RUN_AS_NODE (herdada do terminal do VS Code) impede o Cypress de abrir
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const executar = (args) => spawnSync(process.execPath, args, { cwd: raiz, stdio: "inherit", env });

executar([path.join(__dirname, "limpar-relatorios.js")]);
const teste = executar([cypressBin, "run", ...process.argv.slice(2)]);
const relatorio = executar([path.join(__dirname, "gerar-relatorio.js")]);

process.exit(teste.status || relatorio.status || 0);
