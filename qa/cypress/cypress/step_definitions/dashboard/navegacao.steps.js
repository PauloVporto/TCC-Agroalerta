import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";

const NAV = {
  "Visão geral": "nav-visao",
  Alertas: "nav-alertas",
  Talhões: "nav-talhoes",
  "Insumos e preços": "nav-insumos",
  Mercado: "nav-mercado",
  Relatórios: "nav-relatorios",
};

Then("o item {string} do menu continua visível", (menu) => {
  cy.pegar(NAV[menu]).should("be.visible").and("contain", menu === "Alertas" ? "Alertas" : menu);
  cy.pegar("nav-sair").should("be.visible");
});

When("clico no botão de recolher o menu", () => {
  cy.pegar("toggle-sidebar").should("have.text", "«").click();
});

Then("os rótulos do menu ficam ocultos", () => {
  cy.pegar("nav-visao").find("span").should("not.be.visible");
  cy.pegar("toggle-sidebar").should("have.text", "»");
});

Then("ao expandir novamente os rótulos voltam a aparecer", () => {
  cy.pegar("toggle-sidebar").click();
  cy.pegar("nav-visao").find("span").should("be.visible").and("have.text", "Visão geral");
  cy.pegar("toggle-sidebar").should("have.text", "«");
});

Then("a página lista {int} relatórios, incluindo {string}", (qtd, titulo) => {
  cy.pegar("relatorio-titulo").should("have.length", qtd);
  cy.contains('[data-cy="relatorio-titulo"]', titulo).should("be.visible");
});

Then("vejo a seção de relatórios {string}", (titulo) => {
  cy.pegar("relatorios-titulo").should("be.visible").and("have.text", titulo);
  cy.contains("button", "Baixar PDF").should("exist");
});

When("clico em sair", () => {
  cy.intercept("POST", "**/api/auth/logout").as("logout");
  estado.extra.tokenAntigo = estado.sessao.token;
  cy.pegar("nav-sair").click();
});

Then("o token antigo não é mais aceito pela API", () => {
  cy.wait("@logout").its("response.statusCode").should("eq", 204);
  cy.request({
    url: `${Cypress.env("apiUrl")}/auth/me`,
    headers: { Authorization: `Bearer ${estado.extra.tokenAntigo}` },
    failOnStatusCode: false,
  }).then((r) => {
    expect(r.status).to.eq(401);
    expect(r.body.erro).to.eq("Sessão inválida ou expirada.");
  });
});

Given("que não estou autenticado", () => {
  cy.clearAllSessionStorage();
});

When("acesso diretamente o painel", () => {
  cy.visit("/dashboard.dc.html");
});
