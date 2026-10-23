const { test } = require("node:test");
const assert = require("node:assert/strict");
const { exigirPapel, PAPEIS, PAPEL_ADMIN } = require("../services/auth");

function resposta() {
  return {
    codigo: null,
    corpo: null,
    status(codigo) {
      this.codigo = codigo;
      return this;
    },
    json(corpo) {
      this.corpo = corpo;
      return this;
    },
  };
}

function passar(papeis, usuario) {
  const res = resposta();
  let seguiu = false;
  exigirPapel(...papeis)({ usuario }, res, () => {
    seguiu = true;
  });
  return { seguiu, res };
}

test("o administrador não é um papel que o cadastro aceita", () => {
  assert.deepEqual(PAPEIS, ["produtor", "fornecedor"]);
  assert.equal(PAPEL_ADMIN, "admin");
});

test("exigirPapel deixa passar só os papéis pedidos, com mensagem legível", () => {
  assert.equal(passar(["admin"], { papel: "admin" }).seguiu, true);
  const negado = passar(["admin"], { papel: "produtor" });
  assert.deepEqual([negado.seguiu, negado.res.codigo, negado.res.corpo.erro], [false, 403, "Esta ação é só para contas de administrador."]);
  assert.equal(passar(["produtor"], { papel: null }).seguiu, true, "conta antiga sem papel conta como produtor");
  assert.equal(passar(["admin"], undefined).res.codigo, 403, "sem usuário autenticado");
  assert.equal(passar(["auditor", "fornecedor"], { papel: "produtor" }).res.corpo.erro, "Esta ação é só para contas de auditor ou fornecedor.");
});
