const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");

// A rota guarda a função de clima ao ser carregada, então o dublê vem antes do require dela.
const weather = require("../services/weather");
mock.method(weather, "buscarClimaAtual", async (latitude, longitude) => ({ fonte: "teste", latitude, longitude }));

const { pool } = require("../services/db");
const { obterConfiguracoes } = require("../services/auth");
const climaRouter = require("../routes/clima");
const { iniciarApp } = require("./helpers/servidor");

const SESSOES = { "token-com-cidade": { id: 1 }, "token-sem-cidade": { id: 2 } };
const CONFIGURACOES = {
  1: { id: 1, cidade: "Santa Rita do Sapucaí - MG", cidadeFormatada: "Santa Rita do Sapucaí, MG", latitude: -22.25, longitude: -45.71 },
  2: { id: 2, cidade: null, cidadeFormatada: null, latitude: null, longitude: null },
};

let sqlConfiguracoes;
let servidor;

function bancoFalso(sql, params) {
  if (sql.includes("FROM sessoes")) {
    const usuario = SESSOES[params[0]];
    return { rows: usuario ? [usuario] : [] };
  }
  if (sql.includes("FROM usuarios u")) {
    sqlConfiguracoes = sql;
    return { rows: [CONFIGURACOES[params[0]]] };
  }
  throw new Error("SQL não previsto no teste: " + sql);
}

function buscarClima(token) {
  return fetch(servidor.url + "/api/clima", { headers: { Authorization: "Bearer " + token } });
}

before(async () => {
  mock.method(pool, "query", async (sql, params) => bancoFalso(sql, params));
  servidor = await iniciarApp((app) => app.use("/api/clima", climaRouter));
});

after(async () => {
  await servidor.fechar();
  mock.restoreAll();
});

test("GET /api/clima usa as coordenadas da cidade do usuário", async () => {
  const resposta = await buscarClima("token-com-cidade");
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.cidade, "Santa Rita do Sapucaí - MG");
  assert.deepEqual(corpo.clima, { fonte: "teste", latitude: -22.25, longitude: -45.71 });
});

test("GET /api/clima responde 404 quando o usuário não tem cidade cadastrada", async () => {
  const resposta = await buscarClima("token-sem-cidade");
  assert.equal(resposta.status, 404);
});

// Regressão: sem estes campos o painel não mostra mapa nem previsão, e /api/clima sempre dá 404.
test("obterConfiguracoes busca cidade formatada e coordenadas do usuário", async () => {
  await obterConfiguracoes(1);
  assert.match(sqlConfiguracoes, /u\.latitude/);
  assert.match(sqlConfiguracoes, /u\.longitude/);
  assert.match(sqlConfiguracoes, /cidade_formatada/);
});
