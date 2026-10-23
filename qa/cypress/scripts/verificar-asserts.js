// Garante a regra de QA: todo cenário Gherkin precisa ter ao menos 2 verificações (passos "Então"/"E" após "Então").
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "cypress", "e2e");
const features = [];
(function varrer(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) varrer(p);
    else if (f.name.endsWith(".feature")) features.push(p);
  }
})(dir);

let cenarios = 0;
const fracos = [];
for (const arq of features) {
  const linhas = fs.readFileSync(arq, "utf-8").split(/\r?\n/).map((l) => l.trim());
  let atual = null;
  const fechar = () => atual && atual.verificacoes < 2 && fracos.push(`${path.basename(arq)}: ${atual.nome} (${atual.verificacoes})`);
  let modo = "";
  for (const l of linhas) {
    if (/^(Cenário|Esquema do Cenário):/.test(l)) {
      fechar();
      atual = { nome: l, verificacoes: 0 };
      cenarios++;
      modo = "";
    } else if (atual && /^Então /.test(l)) {
      modo = "entao";
      atual.verificacoes++;
    } else if (atual && /^(Dado|Quando) /.test(l)) {
      modo = "";
    } else if (atual && /^E /.test(l) && modo === "entao") {
      atual.verificacoes++;
    }
  }
  fechar();
}
console.log(`${features.length} features, ${cenarios} cenários`);
if (fracos.length) {
  console.error("Cenários com menos de 2 verificações:\n - " + fracos.join("\n - "));
  process.exit(1);
}
console.log("OK: todos os cenários têm pelo menos 2 verificações");
