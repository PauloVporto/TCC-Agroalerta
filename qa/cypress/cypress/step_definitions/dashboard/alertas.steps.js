import { Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { NAV } from "../../support/navegacao";

When("acesso a página {string} pelo menu", (rotulo) => {
  cy.pegar(NAV[rotulo]).should("contain", rotulo).click();
});

Then("a tabela de regras lista {string} para o talhão {string}", (risco, talhao) => {
  cy.pegar("regra-risco").should("have.length", 1).and("have.text", risco);
  cy.pegar("regra-talhao").should("contain", talhao);
  cy.pegar("regra-id").should("contain", "Risco alto de geada");
});

Then("vejo o aviso oficial {string}", (descricao) => {
  cy.contains("Avisos oficiais INMET").should("be.visible");
  cy.contains(descricao).should("be.visible");
});

Then("o aviso oficial traz a instrução {string}", (instrucao) => {
  cy.contains(instrucao).should("be.visible");
  cy.contains("Válido: 20 out – 22 out").should("be.visible");
});

Then("nenhuma regra disparada é listada", () => {
  cy.pegar("alertas-titulo").should("be.visible");
  cy.pegar("regra-risco").should("not.exist");
});

Then("não há avisos oficiais", () => {
  cy.contains("Avisos oficiais INMET").should("not.exist");
  cy.pegar("alertas-titulo").should("contain", "Regras disparadas");
});
