import { Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";

Then(
  "a tabela lista 1 talhão com nome {string}, cultura {string} e fase {string}",
  (nome, cultura, fase) => {
    cy.pegar("talhao-nome-celula").should("have.length", 1).and("contain", nome);
    cy.pegar("talhao-cultura-celula").should("contain", cultura);
    cy.pegar("talhao-fase-celula").should("have.text", fase);
  }
);

When("clico no botão de novo talhão", () => {
  cy.pegar("talhao-novo-toggle").click();
  cy.pegar("talhao-form").should("be.visible");
});

Then("o formulário de talhão está visível e o botão mostra {string}", (rotulo) => {
  cy.pegar("talhao-form").should("be.visible");
  cy.pegar("talhao-novo-toggle").should("have.text", rotulo);
});

Then("ao clicar novamente o formulário some e o botão volta a {string}", (rotulo) => {
  cy.pegar("talhao-novo-toggle").click();
  cy.pegar("talhao-form").should("not.exist");
  cy.pegar("talhao-novo-toggle").should("have.text", rotulo);
});

Then("a lista de culturas do talhão contém apenas {string} e {string}", (a, b) => {
  cy.pegar("talhao-cultura").find("option").should("have.length", 2);
  cy.pegar("talhao-cultura").find("option").then(($o) => {
    expect([...$o].map((o) => o.textContent.trim())).to.deep.equal([a, b]);
  });
});

Then("os campos de nome, fase e CEP do talhão começam vazios", () => {
  ["talhao-nome", "talhao-fase", "talhao-cep"].forEach((id) => cy.pegar(id).should("have.value", ""));
  cy.pegar("talhao-submit").should("have.text", "Cadastrar");
});

When("envio o formulário de talhão vazio", () => {
  cy.pegar("talhao-submit").click();
});

When("envio o formulário de talhão", () => {
  cy.pegar("talhao-submit").click();
});

When("preencho o talhão {string} cultura {string} fase {string} e CEP {string}", (nome, cultura, fase, cep) => {
  cy.pegar("talhao-nome").type(nome);
  cy.pegar("talhao-cultura").select(cultura);
  cy.pegar("talhao-fase").type(fase);
  cy.pegar("talhao-cep").type(cep);
});

Then("vejo o erro de talhão {string}", (msg) => {
  cy.pegar("talhao-erro").should("be.visible").and("have.text", msg);
});

Then("a tabela continua com 1 talhão", () => {
  cy.pegar("talhao-nome-celula").should("have.length", 1);
  cy.pegar("talhao-form").should("be.visible");
});

Then("a tabela lista 2 talhões", () => {
  cy.pegar("talhao-nome-celula").should("have.length", 2);
});

Then("a tabela contém o talhão {string} com cultura {string} e fase {string}", (nome, cultura, fase) => {
  cy.contains('[data-cy="talhao-nome-celula"]', nome)
    .parent()
    .within(() => {
      cy.pegar("talhao-cultura-celula").should("contain", cultura);
      cy.pegar("talhao-fase-celula").should("have.text", fase);
    });
});

Then("a API confirma {int} talhões para o usuário", (qtd) => {
  cy.request({
    url: `${Cypress.env("apiUrl")}/talhoes`,
    headers: { Authorization: `Bearer ${estado.sessao.token}` },
  }).then((r) => {
    expect(r.status).to.eq(200);
    expect(r.body).to.have.length(qtd);
    expect(r.body.map((t) => t.nome)).to.include("Talhão QA Soja");
  });
});
