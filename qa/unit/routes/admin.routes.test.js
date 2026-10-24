// O foco aqui é a AUTORIZAÇÃO do painel administrativo: quem pode entrar.
// A lógica de cada operação já é coberta pelos testes de integração do backend.
jest.mock("../../../backend/services/auth", () => {
  const { autenticacaoFalsa } = require("../helpers/app");
  // exigirPapel é o middleware real: é exatamente ele que está sob teste.
  const { exigirPapel, PAPEL_ADMIN } = jest.requireActual("../../../backend/services/auth");
  return { exigirAutenticacao: autenticacaoFalsa, exigirPapel, PAPEL_ADMIN };
});
jest.mock("../../../backend/services/notificacoes/config", () => ({ lerConfiguracao: jest.fn(() => ({})) }));
jest.mock("../../../backend/services/notificacoes/whatsapp", () => ({
  estadoParaPainel: jest.fn(async () => ({ conectado: true })),
  conectar: jest.fn(async () => ({ ok: true })),
  reconectar: jest.fn(async () => ({ ok: true })),
  desconectar: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../../backend/services/notificacoes/controle", () => ({
  CAMPOS: ["boletinsPausados", "alertasPausados"],
  lerControle: jest.fn(async () => ({})),
  atualizarControle: jest.fn(async () => ({})),
  listarEventosAdmin: jest.fn(async () => []),
}));
jest.mock("../../../backend/services/notificacoes/eventos", () => ({ eventosDoEnvio: jest.fn(async () => []) }));
jest.mock("../../../backend/services/notificacoes/fila", () => ({ acordarFila: jest.fn() }));
jest.mock("../../../backend/services/notificacoes/administracao", () => ({
  resumoDoWhatsapp: jest.fn(async () => ({ pendentes: 0 })),
  listarEnvios: jest.fn(async () => ({ envios: [] })),
  listarAgricultores: jest.fn(async () => ({ agricultores: [] })),
  cancelarEnvio: jest.fn(async () => ({})),
  reenfileirarEnvio: jest.fn(async () => ({})),
  cancelarPendentes: jest.fn(async () => ({})),
}));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const whatsapp = require("../../../backend/services/notificacoes/whatsapp");

const app = montarApp("/api/admin", require("../../../backend/routes/admin"));
const ADMIN = { Authorization: "Bearer admin" };
const PRODUTOR = { Authorization: "Bearer ok" };
const FORNECEDOR = { Authorization: "Bearer fornecedor" };

const ROTAS = [
  ["get", "/whatsapp"],
  ["post", "/whatsapp/conectar"],
  ["post", "/whatsapp/desconectar"],
  ["get", "/notificacoes/resumo"],
  ["get", "/notificacoes"],
  ["get", "/agricultores"],
  ["get", "/logs"],
];

describe("acesso ao painel administrativo", () => {
  test.each(ROTAS)("%s %s sem token => 401", async (metodo, caminho) => {
    const r = await request(app)[metodo]("/api/admin" + caminho).send({});
    expect(r.status).toBe(401);
    expect(whatsapp.conectar).not.toHaveBeenCalled();
  });

  test.each(ROTAS)("%s %s com conta de produtor => 403", async (metodo, caminho) => {
    const r = await request(app)[metodo]("/api/admin" + caminho).set(PRODUTOR).send({});
    expect(r.status).toBe(403);
    expect(r.body.erro).toMatch(/só para contas de/i);
  });

  test("conta de fornecedor também é barrada", async () => {
    const r = await request(app).get("/api/admin/whatsapp").set(FORNECEDOR);
    expect(r.status).toBe(403);
    expect(whatsapp.estadoParaPainel).not.toHaveBeenCalled();
  });
});

describe("operações liberadas para o administrador", () => {
  test("GET /whatsapp devolve o estado da conexão", async () => {
    const r = await request(app).get("/api/admin/whatsapp").set(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.conectado).toBe(true);
  });

  test("GET /logs responde com a lista de eventos", async () => {
    const r = await request(app).get("/api/admin/logs").set(ADMIN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.eventos)).toBe(true);
  });

  test("POST /whatsapp/conectar identifica quem pediu a ação", async () => {
    const r = await request(app).post("/api/admin/whatsapp/conectar").set(ADMIN).send({});
    expect(r.status).toBe(200);
    expect(whatsapp.conectar).toHaveBeenCalledWith(expect.anything(), 4);
  });
});
