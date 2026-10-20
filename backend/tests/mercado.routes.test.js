const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mercadoRouter = require("../routes/mercado");
const { iniciarApp } = require("./helpers/servidor");

let servidor;

before(async () => {
  servidor = await iniciarApp((app) => app.use("/api/mercado", mercadoRouter));
});

after(() => servidor.fechar());

test("GET /:cultura/serie devolve histórico e projeção em R$/saca", async () => {
  const resposta = await fetch(servidor.url + "/api/mercado/cafe/serie");
  const corpo = await resposta.json();

  assert.equal(resposta.status, 200);
  assert.match(corpo.unidade, /saca/);
  assert.ok(corpo.historico.length > 0);
  assert.equal(corpo.projecao.length, 24);
  assert.ok(corpo.historico.at(-1).data < corpo.projecao[0].data);
});

test("GET /:cultura/serie responde 404 para cultura inexistente", async () => {
  const resposta = await fetch(servidor.url + "/api/mercado/arroz/serie");
  assert.equal(resposta.status, 404);
  assert.deepEqual(await resposta.json(), { erro: "Cultura não encontrada" });
});

test("GET /:cultura/serie não trata propriedades internas do objeto como cultura", async () => {
  const resposta = await fetch(servidor.url + "/api/mercado/constructor/serie");
  assert.equal(resposta.status, 404);
});
