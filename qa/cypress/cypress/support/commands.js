/**
 * Comandos customizados. Seletores usam sempre data-cy (adicionado aos HTMLs do frontend).
 */

const TOKEN_KEY = "agroalerta_token";
const USUARIO_KEY = "agroalerta_usuario";

/** cy.pegar("login-email") => cy.get('[data-cy="login-email"]') */
Cypress.Commands.add("pegar", (id) => cy.get(`[data-cy="${id}"]`));

/** Gera um usuário único para cada execução. */
Cypress.Commands.add("novoUsuario", (extra = {}) => {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  return cy.wrap({
    nome: "Teste Cypress QA",
    email: `cy.${ts}@agroalerta.test`,
    senha: "Senha@123",
    cep: Cypress.env("cepValido"),
    cultura: "cafe",
    ...extra,
  });
});

/** Registra o usuário direto pela API (rápido) e devolve { usuario, token, dados }. */
Cypress.Commands.add("registrarViaApi", (dados) => {
  return cy
    .request({ method: "POST", url: `${Cypress.env("apiUrl")}/auth/registrar`, body: dados })
    .then((r) => {
      expect(r.status).to.eq(201);
      return { usuario: r.body.usuario, token: r.body.token, dados };
    });
});

/** Abre a página já autenticada, semeando o sessionStorage (pula o login pela UI). */
Cypress.Commands.add("visitarAutenticado", (caminho, sessao) => {
  cy.visit(caminho, {
    onBeforeLoad(win) {
      win.sessionStorage.setItem(TOKEN_KEY, sessao.token);
      win.sessionStorage.setItem(USUARIO_KEY, JSON.stringify(sessao.usuario));
    },
  });
});

/** Remove a conta criada durante o teste (limpeza). */
Cypress.Commands.add("excluirContaViaApi", (token) => {
  return cy.request({
    method: "DELETE",
    url: `${Cypress.env("apiUrl")}/auth/conta`,
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
});

/**
 * Espera o dashboard terminar de carregar os dados da API.
 * O app marca "carregado" antes das respostas chegarem, então usamos sinais reais:
 * a cidade do usuário no cabeçalho (/auth/configuracoes) e o KPI de talhões (/talhoes).
 */
Cypress.Commands.add("aguardarDashboard", () => {
  cy.pegar("page-titulo").should("be.visible");
  cy.pegar("usuario-cidade-header").should("contain", "MG");
  cy.pegar("kpi-valor").eq(1).should("have.text", "1");
});

/** Intercepta as chamadas de dados do dashboard com fixtures determinísticas. */
Cypress.Commands.add("simularDadosDoPainel", ({ alertas = "alertas-vazio.json", clima = true, mercado = true } = {}) => {
  cy.intercept("GET", "**/api/alertas/*", { fixture: alertas }).as("alertas");
  if (clima) cy.intercept("GET", "**/api/clima", { fixture: "clima-7dias.json" }).as("clima");
  if (mercado) {
    cy.intercept("GET", "**/api/mercado/*/analise", { fixture: "analise-cafe.json" }).as("analise");
    cy.intercept("GET", "**/api/mercado/cotacoes*", { fixture: "cotacoes.json" }).as("cotacoes");
  }
});
