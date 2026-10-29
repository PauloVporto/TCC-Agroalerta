jest.mock("../../../backend/services/auth", () => ({
  exigirAutenticacao: (req, res, next) => require("../helpers/app").autenticacaoFalsa(req, res, next),
}));
jest.mock("../../../backend/services/notificacoes/config", () => ({ lerConfiguracao: jest.fn(() => ({})) }));
jest.mock("../../../backend/services/notificacoes/consentimentos", () => ({
  NIVEIS_MINIMOS: ["medio", "alto"],
  resumoDasPreferencias: jest.fn(),
  contatoDoProdutor: jest.fn(),
}));
jest.mock("../../../backend/services/notificacoes", () => ({ salvarEscolhasDoPainel: jest.fn() }));
jest.mock("../../../backend/services/notificacoes/historico", () => ({ listarHistorico: jest.fn() }));
jest.mock("../../../backend/services/notificacoes/categorias", () => ({ consultar: jest.fn(), salvar: jest.fn() }));
jest.mock("../../../backend/services/notificacoes/climaPainel", () => ({ previsoes: jest.fn() }));
jest.mock("../../../backend/services/contato", () => ({ ehCelular: jest.fn() }));

const request = require("supertest");
const { montarApp } = require("../helpers/app");
const { resumoDasPreferencias, contatoDoProdutor } = require("../../../backend/services/notificacoes/consentimentos");
const { salvarEscolhasDoPainel } = require("../../../backend/services/notificacoes");
const { listarHistorico } = require("../../../backend/services/notificacoes/historico");
const categorias = require("../../../backend/services/notificacoes/categorias");
const climaPainel = require("../../../backend/services/notificacoes/climaPainel");
const { ehCelular } = require("../../../backend/services/contato");

const app = montarApp("/api/notificacoes", require("../../../backend/routes/notificacoes"));
const AUTH = { Authorization: "Bearer ok" };
const PREFERENCIAS_OK = {
  email: { consentido: true, nivelMinimo: "medio" },
  whatsapp: { consentido: false, nivelMinimo: "alto" },
};

describe("autenticação do router de notificações", () => {
  test.each([
    ["get", "/preferencias"],
    ["put", "/preferencias"],
    ["get", "/historico"],
    ["get", "/categorias"],
    ["put", "/categorias"],
    ["get", "/previsoes"],
  ])("%s %s sem token => 401", async (metodo, caminho) => {
    const r = await request(app)[metodo]("/api/notificacoes" + caminho).send({});
    expect(r.status).toBe(401);
    expect(resumoDasPreferencias).not.toHaveBeenCalled();
  });
});

describe("GET /api/notificacoes/preferencias", () => {
  test("devolve o resumo dos canais do produtor logado", async () => {
    resumoDasPreferencias.mockResolvedValue({ email: { consentido: true }, whatsapp: { consentido: false } });
    const r = await request(app).get("/api/notificacoes/preferencias").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.email.consentido).toBe(true);
    expect(resumoDasPreferencias).toHaveBeenCalledWith(1, expect.anything());
  });

  test("falha no serviço vira 500 com mensagem amigável", async () => {
    resumoDasPreferencias.mockRejectedValue(new Error("banco fora"));
    const r = await request(app).get("/api/notificacoes/preferencias").set(AUTH);
    expect(r.status).toBe(500);
    expect(r.body.erro).toMatch(/preferências de notificação/);
  });
});

describe("PUT /api/notificacoes/preferencias", () => {
  test("salva as escolhas e devolve o resumo atualizado", async () => {
    resumoDasPreferencias.mockResolvedValue({ email: { consentido: true } });
    const r = await request(app).put("/api/notificacoes/preferencias").set(AUTH).send(PREFERENCIAS_OK);
    expect(r.status).toBe(200);
    expect(salvarEscolhasDoPainel).toHaveBeenCalledWith(1, PREFERENCIAS_OK);
  });

  test.each([
    ["corpo vazio", {}],
    ["sem whatsapp", { email: { consentido: true, nivelMinimo: "medio" } }],
    ["consentido não booleano", { email: { consentido: "sim", nivelMinimo: "medio" }, whatsapp: { consentido: false, nivelMinimo: "alto" } }],
    ["nível fora da lista", { email: { consentido: true, nivelMinimo: "baixo" }, whatsapp: { consentido: false, nivelMinimo: "alto" } }],
  ])("%s => 400 sem gravar nada", async (_, corpo) => {
    const r = await request(app).put("/api/notificacoes/preferencias").set(AUTH).send(corpo);
    expect(r.status).toBe(400);
    expect(salvarEscolhasDoPainel).not.toHaveBeenCalled();
  });

  // Autorizar WhatsApp sem celular cadastrado deixaria o produtor achando que
  // receberia mensagens que nunca chegariam.
  test("autorizar WhatsApp sem celular válido => 400 apontando para Dados da conta", async () => {
    contatoDoProdutor.mockResolvedValue({ telefone: "+553533330000" });
    ehCelular.mockReturnValue(false);
    const corpo = { ...PREFERENCIAS_OK, whatsapp: { consentido: true, nivelMinimo: "alto" } };
    const r = await request(app).put("/api/notificacoes/preferencias").set(AUTH).send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Dados da conta/);
    expect(salvarEscolhasDoPainel).not.toHaveBeenCalled();
  });

  test("autorizar WhatsApp com celular válido grava normalmente", async () => {
    contatoDoProdutor.mockResolvedValue({ telefone: "+5535999990000" });
    ehCelular.mockReturnValue(true);
    resumoDasPreferencias.mockResolvedValue({});
    const corpo = { ...PREFERENCIAS_OK, whatsapp: { consentido: true, nivelMinimo: "alto" } };
    const r = await request(app).put("/api/notificacoes/preferencias").set(AUTH).send(corpo);
    expect(r.status).toBe(200);
    expect(salvarEscolhasDoPainel).toHaveBeenCalledWith(1, corpo);
  });
});

describe("GET /api/notificacoes/historico", () => {
  test("usa limite 50 por padrão e devolve os envios", async () => {
    listarHistorico.mockResolvedValue([{ id: 1, canal: "email" }]);
    const r = await request(app).get("/api/notificacoes/historico").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.envios).toHaveLength(1);
    expect(listarHistorico).toHaveBeenCalledWith(1, 50);
  });

  test.each([
    ["acima do teto vira 200", "999", 200],
    ["negativo vira 1", "-5", 1],
    ["texto cai no padrão 50", "abc", 50],
    ["zero cai no padrão 50", "0", 50],
    ["valor dentro da faixa é respeitado", "25", 25],
  ])("%s", async (_, pedido, esperado) => {
    listarHistorico.mockResolvedValue([]);
    await request(app).get("/api/notificacoes/historico?limite=" + pedido).set(AUTH);
    expect(listarHistorico).toHaveBeenCalledWith(1, esperado);
  });
});

describe("categorias e previsões", () => {
  test("GET /categorias devolve o que o serviço informa", async () => {
    categorias.consultar.mockResolvedValue({ categorias: [{ id: "geada", ativo: true }] });
    const r = await request(app).get("/api/notificacoes/categorias").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.categorias[0].id).toBe("geada");
  });

  test("PUT /categorias repassa o corpo ao serviço", async () => {
    categorias.salvar.mockResolvedValue({ ok: true });
    const corpo = { geada: true, boletim_diario: false };
    const r = await request(app).put("/api/notificacoes/categorias").set(AUTH).send(corpo);
    expect(r.status).toBe(200);
    expect(categorias.salvar).toHaveBeenCalledWith(1, corpo);
  });

  // O serviço sinaliza erro de validação pelo campo `status` do erro.
  test("PUT /categorias propaga o status e a mensagem do serviço", async () => {
    categorias.salvar.mockRejectedValue(Object.assign(new Error("Categoria desconhecida."), { status: 400 }));
    const r = await request(app).put("/api/notificacoes/categorias").set(AUTH).send({ xyz: true });
    expect(r.status).toBe(400);
    expect(r.body.erro).toBe("Categoria desconhecida.");
  });

  test("PUT /categorias esconde erro inesperado atrás de 500", async () => {
    categorias.salvar.mockRejectedValue(new Error("coluna inexistente"));
    const r = await request(app).put("/api/notificacoes/categorias").set(AUTH).send({ geada: true });
    expect(r.status).toBe(500);
    expect(r.body.erro).toBe("Não foi possível salvar categorias.");
  });

  test("GET /previsoes devolve a previsão por talhão", async () => {
    climaPainel.previsoes.mockResolvedValue([{ nome: "Talhão 1", dias: [] }]);
    const r = await request(app).get("/api/notificacoes/previsoes").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.talhoes[0].nome).toBe("Talhão 1");
    expect(climaPainel.previsoes).toHaveBeenCalledWith(1);
  });
});
