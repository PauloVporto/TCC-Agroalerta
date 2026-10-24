const { test, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// A rota guarda a função de CEP ao ser carregada, então o dublê vem antes do require dela.
const localizacao = require("../services/localizacao");
mock.method(localizacao, "resolverLocalizacaoPorCep", async (cep) =>
  cep === "00000000"
    ? { valido: false, erro: "CEP não encontrado." }
    : { valido: true, enderecoFormatado: "Santa Rita do Sapucaí - MG", latitude: -22.25, longitude: -45.7 }
);

const { pool } = require("../services/db");
const { router, buscarTalhaoPorId, criarTalhao } = require("../routes/talhoes");
const { iniciarApp } = require("./helpers/servidor");

const SESSOES = {
  "token-dono": { id: 1, nome: "Produtor dono" },
  "token-outro": { id: 2, nome: "Outro produtor" },
};

let talhoes;
let servidor;

function talhoesIniciais() {
  return [
    // Fase "vegetativo" é legado: criada antes da lista plantio/floração/colheita.
    { id: 10, usuarioId: 1, nome: "Talhão da encosta", cultura: "cafe", variedade: "Mundo Novo", fase: "vegetativo", areaHa: 8, areaUnidade: "ha", endereco: "Santa Rita" },
    { id: 20, usuarioId: 2, nome: "Talhão do vizinho", cultura: "soja", variedade: null, fase: "floracao", areaHa: null, areaUnidade: "ha", endereco: "Pouso Alegre" },
  ];
}

// Responde às consultas que as rotas e a autenticação fazem, sobre uma lista em memória.
function bancoFalso(sql, params) {
  const consulta = sql.trim();
  if (consulta.includes("FROM sessoes")) {
    const usuario = SESSOES[params[0]];
    return { rows: usuario ? [usuario] : [] };
  }
  if (consulta.includes("WHERE usuario_id = $1")) {
    return { rows: talhoes.filter((t) => t.usuarioId === params[0]) };
  }
  if (consulta.startsWith("INSERT INTO talhoes")) {
    const [usuarioId, nome, cultura, variedade, fase, endereco, latitude, longitude, enderecoFormatado, poligono, areaHa, areaUnidade] = params;
    const novo = { id: 30, usuarioId, nome, cultura, variedade, fase, endereco, latitude, longitude, enderecoFormatado, poligono, areaHa, areaUnidade };
    talhoes.push(novo);
    return { rows: [novo] };
  }
  if (consulta.startsWith("UPDATE talhoes")) {
    const [nome, cultura, variedade, fase, areaHa, areaUnidade, id] = params;
    const talhao = talhoes.find((t) => t.id === id);
    Object.assign(talhao, { nome, cultura, variedade, fase, areaHa, areaUnidade });
    return { rows: [talhao] };
  }
  if (consulta.startsWith("DELETE FROM talhoes")) {
    talhoes = talhoes.filter((t) => t.id !== params[0]);
    return { rows: [] };
  }
  if (consulta.includes("FROM talhoes WHERE id = $1")) {
    const talhao = talhoes.find((t) => t.id === params[0]);
    return { rows: talhao ? [talhao] : [] };
  }
  throw new Error("SQL não previsto no teste: " + consulta);
}

function requisicao(metodo, caminho, { token = "token-dono", corpo } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(servidor.url + "/api/talhoes" + caminho, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

before(async () => {
  mock.method(pool, "query", async (sql, params) => bancoFalso(sql, params));
  servidor = await iniciarApp((app) => app.use("/api/talhoes", router));
});

beforeEach(() => {
  talhoes = talhoesIniciais();
});

after(async () => {
  await servidor.fechar();
  mock.restoreAll();
});

// --- Autenticação ---

test("recusa requisição sem token", async () => {
  const resposta = await requisicao("GET", "/", { token: null });
  assert.equal(resposta.status, 401);
});

test("recusa sessão inexistente", async () => {
  const resposta = await requisicao("GET", "/", { token: "token-invalido" });
  assert.equal(resposta.status, 401);
});

// --- GET / ---

test("GET / lista só os talhões do usuário logado", async () => {
  const resposta = await requisicao("GET", "/");
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.deepEqual(corpo.map((t) => t.id), [10]);
  assert.equal(corpo[0].variedade, "Mundo Novo");
  assert.equal(corpo[0].areaHa, 8);
});

// --- POST / ---

test("POST / exige todos os campos", async () => {
  const resposta = await requisicao("POST", "/", { corpo: { nome: "Novo" } });
  assert.equal(resposta.status, 400);
});

test("POST / recusa cultura fora do motor de regras", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Novo", cultura: "milho", fase: "plantio", cep: "37540000" },
  });
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /Cultura não suportada/);
});

test("POST / recusa fase fora de plantio, floração e colheita", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Novo", cultura: "cafe", fase: "vegetativo", cep: "37540000" },
  });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "Fase inválida. Use uma de: plantio, floracao, colheita");
});

test("POST / recusa CEP não encontrado", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Novo", cultura: "cafe", fase: "plantio", cep: "00000000" },
  });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "CEP não encontrado.");
});

test("POST / cadastra o talhão com cultura e fase", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Talhão novo", cultura: "soja", fase: "colheita", cep: "37540000" },
  });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 201);
  assert.equal(corpo.cultura, "soja");
  assert.equal(corpo.fase, "colheita");
  assert.equal(corpo.usuarioId, 1);
  assert.equal(corpo.enderecoFormatado, "Santa Rita do Sapucaí - MG");
  assert.equal(corpo.variedade, null);
  assert.equal(corpo.areaHa, null);
  assert.equal(corpo.areaUnidade, "ha");
});

test("POST / guarda a unidade m² escolhida, com a área sempre em hectares", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Horta", cultura: "cafe", fase: "plantio", cep: "37540000", areaHa: 0.5, areaUnidade: "m2" },
  });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 201);
  assert.equal(corpo.areaHa, 0.5);
  assert.equal(corpo.areaUnidade, "m2");
});

test("POST / recusa unidade de área desconhecida", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Horta", cultura: "cafe", fase: "plantio", cep: "37540000", areaHa: 1, areaUnidade: "alqueire" },
  });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "Unidade de área inválida. Use uma de: ha, m2");
});

test("POST / grava variedade e área quando informadas", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Talhão novo", cultura: "cafe", fase: "plantio", cep: "37540000", variedade: "  Catuaí Vermelho 144  ", areaHa: "12.5" },
  });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 201);
  assert.equal(corpo.variedade, "Catuaí Vermelho 144");
  assert.equal(corpo.areaHa, 12.5);
});

test("POST / trata variedade e área vazias como não informadas", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Talhão novo", cultura: "cafe", fase: "plantio", cep: "37540000", variedade: "   ", areaHa: "" },
  });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 201);
  assert.equal(corpo.variedade, null);
  assert.equal(corpo.areaHa, null);
});

for (const areaInvalida of [0, -3, "abc"]) {
  test(`POST / recusa área inválida (${JSON.stringify(areaInvalida)})`, async () => {
    const resposta = await requisicao("POST", "/", {
      corpo: { nome: "Talhão novo", cultura: "cafe", fase: "plantio", cep: "37540000", areaHa: areaInvalida },
    });
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "A área deve ser um número de hectares maior que zero.");
  });
}

test("POST / recusa variedade com mais de 60 caracteres", async () => {
  const resposta = await requisicao("POST", "/", {
    corpo: { nome: "Talhão novo", cultura: "cafe", fase: "plantio", cep: "37540000", variedade: "x".repeat(61) },
  });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "A variedade deve ter no máximo 60 caracteres.");
});

// --- PATCH /:id ---

test("PATCH /:id altera cultura e fase do talhão", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { cultura: "soja", fase: "floracao" } });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.cultura, "soja");
  assert.equal(corpo.fase, "floracao");
  assert.equal(corpo.nome, "Talhão da encosta");
});

test("PATCH /:id permite renomear talhão com fase legada sem exigir nova fase", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { nome: "  Encosta norte  " } });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.nome, "Encosta norte");
  assert.equal(corpo.fase, "vegetativo");
  assert.equal(corpo.variedade, "Mundo Novo");
  assert.equal(corpo.areaHa, 8);
});

test("PATCH /:id altera variedade e área", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { variedade: "Catuaí Amarelo", areaHa: 15.75 } });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.variedade, "Catuaí Amarelo");
  assert.equal(corpo.areaHa, 15.75);
});

test("PATCH /:id apaga variedade e área enviadas vazias", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { variedade: "", areaHa: null } });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.variedade, null);
  assert.equal(corpo.areaHa, null);
});

test("PATCH /:id troca só a unidade de exibição, sem alterar a área gravada", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { areaUnidade: "m2" } });
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.areaUnidade, "m2");
  assert.equal(corpo.areaHa, 8);
});

test("PATCH /:id volta para hectares quando a unidade vem vazia", async () => {
  talhoes.find((t) => t.id === 10).areaUnidade = "m2";
  const resposta = await requisicao("PATCH", "/10", { corpo: { areaUnidade: "" } });
  assert.equal((await resposta.json()).areaUnidade, "ha");
});

test("PATCH /:id recusa unidade de área desconhecida", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { areaUnidade: "acre" } });
  assert.equal(resposta.status, 400);
  assert.equal(talhoes.find((t) => t.id === 10).areaUnidade, "ha");
});

test("PATCH /:id recusa área inválida", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { areaHa: -1 } });
  assert.equal(resposta.status, 400);
  assert.equal(talhoes.find((t) => t.id === 10).areaHa, 8);
});

test("PATCH /:id recusa fase inválida", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { fase: "granacao" } });
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /Fase inválida/);
});

test("PATCH /:id recusa cultura não suportada", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { cultura: "feijao" } });
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /Cultura não suportada/);
});

test("PATCH /:id recusa nome vazio", async () => {
  const resposta = await requisicao("PATCH", "/10", { corpo: { nome: "   " } });
  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "Informe o nome do talhão.");
});

test("PATCH /:id responde 404 para talhão inexistente", async () => {
  const resposta = await requisicao("PATCH", "/999", { corpo: { fase: "plantio" } });
  assert.equal(resposta.status, 404);
});

test("PATCH /:id impede editar talhão de outro usuário", async () => {
  const resposta = await requisicao("PATCH", "/20", { corpo: { fase: "plantio" } });
  assert.equal(resposta.status, 403);
  assert.equal(talhoes.find((t) => t.id === 20).fase, "floracao");
});

// --- DELETE /:id ---

test("DELETE /:id remove o talhão do próprio usuário", async () => {
  const resposta = await requisicao("DELETE", "/10");
  assert.equal(resposta.status, 204);
  assert.equal(talhoes.some((t) => t.id === 10), false);
});

test("DELETE /:id responde 404 para talhão inexistente", async () => {
  const resposta = await requisicao("DELETE", "/999");
  assert.equal(resposta.status, 404);
});

test("DELETE /:id impede remover talhão de outro usuário", async () => {
  const resposta = await requisicao("DELETE", "/20");
  assert.equal(resposta.status, 403);
});

// --- Funções exportadas ---

test("buscarTalhaoPorId devolve o talhão ou null", async () => {
  assert.equal((await buscarTalhaoPorId("10")).nome, "Talhão da encosta");
  assert.equal(await buscarTalhaoPorId(999), null);
});

test("criarTalhao grava polígono e área quando informados", async () => {
  const poligono = [[-22.25, -45.7], [-22.26, -45.71], [-22.25, -45.72]];
  const talhao = await criarTalhao(1, {
    nome: "Desenhado", cultura: "cafe", fase: "plantio", endereco: "Mapa",
    coordenadas: { latitude: -22.25, longitude: -45.7, enderecoFormatado: "Mapa" },
    poligono, areaHa: 2.5,
  });
  assert.equal(talhao.poligono, JSON.stringify(poligono));
  assert.equal(talhao.areaHa, 2.5);
});
