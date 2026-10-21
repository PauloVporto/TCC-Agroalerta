const banco = require("./helpers/banco");
const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// A rota guarda a função de localização ao ser carregada: o dublê vem antes.
const localizacao = require("../../services/localizacao");
mock.method(localizacao, "resolverLocalizacaoPorCep", async (cep) =>
  cep === "00000000"
    ? { valido: false, erro: "CEP não encontrado. Verifique o número digitado." }
    : { valido: true, cep, cidade: "Santa Rita do Sapucaí", uf: "MG", latitude: -22.252, longitude: -45.703, enderecoFormatado: "Santa Rita do Sapucaí, Minas Gerais, Brasil" }
);
const { router: talhoesRouter } = require("../../routes/talhoes");
const { iniciarApp } = require("../helpers/servidor");

let servidor;

before(async () => {
  await banco.prepararBanco();
  servidor = await iniciarApp((app) => app.use("/api/talhoes", talhoesRouter));
});
beforeEach(() => banco.limparBanco());
after(async () => {
  await servidor.fechar();
  await banco.pool.end();
});

function cadastrar(token, corpo) {
  return fetch(servidor.url + "/api/talhoes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(corpo),
  });
}

test("novo talhão guarda a região (Cidade - UF) usada nas notificações", async () => {
  const p = await banco.criarProdutor({ email: "a@fazenda.com.br" });
  const resposta = await cadastrar(await banco.criarSessao(p.id), { nome: "Encosta", cultura: "cafe", fase: "floracao", cep: "37540000" });
  assert.equal(resposta.status, 201);
  const talhao = await resposta.json();
  assert.equal(talhao.regiao, "Santa Rita do Sapucaí - MG");
  assert.equal(talhao.enderecoFormatado, "Santa Rita do Sapucaí, Minas Gerais, Brasil");
});

test("cadastro de talhão continua validando campos, cultura e CEP", async () => {
  const p = await banco.criarProdutor({ email: "b@fazenda.com.br" });
  const token = await banco.criarSessao(p.id);
  assert.equal((await cadastrar(token, { nome: "Encosta" })).status, 400);
  assert.equal((await cadastrar(token, { nome: "Encosta", cultura: "trigo", fase: "plantio", cep: "37540000" })).status, 400);
  assert.equal((await cadastrar(token, { nome: "Encosta", cultura: "cafe", fase: "plantio", cep: "00000000" })).status, 400);
});
