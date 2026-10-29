// Garante que todo bloco @swagger das rotas é YAML válido. Um erro aqui não derruba o servidor,
// mas o Swagger descarta o bloco inteiro e imprime "Not all input has been taken into account".
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let YAML = null;
try { YAML = require("yaml"); } catch { /* dependência do swagger-jsdoc; ausente fora do container */ }

const pastaRotas = path.join(__dirname, "..", "routes");

function blocosSwagger(codigo) {
  return [...codigo.matchAll(/\/\*\*[ \t]*\r?\n[ \t]*\* @swagger\r?\n([\s\S]*?)\*\//g)]
    .map((m) => m[1].split(/\r?\n/).map((l) => l.replace(/^\s*\* ?/, "")).join("\n"));
}

test("todo bloco @swagger das rotas é YAML válido", (t) => {
  if (!YAML) return t.skip("módulo yaml não instalado (vem com swagger-jsdoc)");
  let total = 0;
  for (const arquivo of fs.readdirSync(pastaRotas).filter((f) => f.endsWith(".js"))) {
    const blocos = blocosSwagger(fs.readFileSync(path.join(pastaRotas, arquivo), "utf8"));
    blocos.forEach((bloco, i) => {
      total++;
      const erros = YAML.parseDocument(bloco).errors;
      assert.equal(erros.length, 0, arquivo + " (bloco " + (i + 1) + "): " + (erros[0] ? erros[0].message.split("\n")[0] : ""));
    });
  }
  assert.ok(total > 0, "nenhum bloco @swagger encontrado: o extrator quebrou");
});

test("o extrator reconhece um bloco com CRLF e detecta o erro de $ref sem aspas", (t) => {
  if (!YAML) return t.skip("módulo yaml não instalado");
  const ruim = "/**\r\n * @swagger\r\n * /x:\r\n *   get:\r\n *     responses:\r\n *       404: { description: nao, content: { a: { $ref: #/c/E } } }\r\n */";
  const [bloco] = blocosSwagger(ruim);
  assert.ok(YAML.parseDocument(bloco).errors.length > 0);
});
