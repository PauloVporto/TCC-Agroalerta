import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";

Given("que acesso a página inicial", () => {
  cy.visit("/");
  cy.pegar("landing-titulo").should("be.visible");
});

Then("vejo o título principal da página inicial", () => {
  cy.pegar("landing-titulo").should("be.visible").invoke("text").should("have.length.greaterThan", 10);
  cy.title().should("not.be.undefined");
});

Then("vejo os botões de entrar e criar conta", () => {
  cy.pegar("landing-entrar-header").should("be.visible").and("contain", "Entrar");
  cy.pegar("landing-criar-conta").should("be.visible").and("contain", "Criar conta");
});

When("clico em {string} no cabeçalho", (rotulo) => {
  cy.pegar("landing-entrar-header").should("contain", rotulo).click();
});

When("clico em {string} na página inicial", (rotulo) => {
  cy.pegar("landing-criar-conta").should("contain", rotulo).click();
});

When("clico no botão final de chamada para ação", () => {
  cy.pegar("landing-cta-final").scrollIntoView().should("be.visible").click();
});

Then("vejo o botão {string}", (rotulo) => {
  cy.pegar("login-submit").should("be.visible").and("contain", rotulo);
});

Then("o link {string} aponta para a âncora {string}", (link, ancora) => {
  cy.pegar(`landing-link-${link}`).should("have.attr", "href", ancora);
  cy.pegar(`landing-link-${link}`).should("be.visible");
});

Then("a seção {string} existe na página", (ancora) => {
  cy.get(ancora).should("exist");
  cy.get(ancora).should("have.length", 1);
});

When("avanço o carrossel", () => {
  cy.pegar("carrossel-proximo").scrollIntoView().click();
});

When("volto o carrossel", () => {
  cy.pegar("carrossel-anterior").click();
});

Then("o carrossel continua visível", () => {
  cy.pegar("carrossel-anterior").should("be.visible");
  cy.pegar("carrossel-proximo").should("be.visible");
});

Then("o carrossel tem mais de um indicador", () => {
  cy.pegar("carrossel-indicador").should("have.length.greaterThan", 1);
  cy.pegar("carrossel-indicador").first().should("be.visible");
});
