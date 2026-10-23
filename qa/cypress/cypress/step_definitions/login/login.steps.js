import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";

Given("que acesso a tela de login", () => {
  cy.visit("/login.dc.html");
  cy.pegar("login-email").should("be.visible");
});

Given("que a resposta do login está atrasada", () => {
  cy.intercept("POST", "**/api/auth/login", (req) => {
    req.on("response", (res) => res.setDelay(2500));
  }).as("loginLento");
});

Then("vejo os campos de e-mail e senha", () => {
  cy.pegar("login-email").should("be.visible").and("have.attr", "type", "email");
  cy.pegar("login-senha").should("be.visible").and("have.attr", "type", "password");
});

Then("vejo o botão {string} de login", (rotulo) => {
  cy.pegar("login-submit").should("contain", rotulo);
});

When("envio o formulário de login sem preencher nada", () => {
  cy.pegar("login-submit").click();
});

When("preencho o login com e-mail {string} e senha {string}", (email, senha) => {
  cy.pegar("login-email").type(email);
  cy.pegar("login-senha").type(senha);
});

When("envio o formulário de login", () => {
  cy.pegar("login-submit").click();
});

When("faço login com a conta criada", () => {
  cy.pegar("login-email").type(estado.sessao.dados.email);
  cy.pegar("login-senha").type(estado.sessao.dados.senha);
  cy.pegar("login-submit").click();
});

When("clico em {string} na tela de login", (rotulo) => {
  cy.pegar("ir-para-registro").should("contain", rotulo).click();
});

When("clico em {string}", (rotulo) => {
  cy.contains("button", rotulo).click();
});

Then("vejo o erro de e-mail {string}", (msg) => {
  cy.pegar("erro-email").should("be.visible").and("have.text", msg);
});

Then("vejo o erro de senha {string}", (msg) => {
  cy.pegar("erro-senha").should("be.visible").and("have.text", msg);
});

Then("vejo o erro geral de login {string}", (msg) => {
  cy.pegar("erro-login-geral").should("be.visible").and("have.text", msg);
});

Then("permaneço na tela de login", () => {
  cy.location("pathname").should("eq", "/login.dc.html");
  cy.pegar("login-submit").should("be.visible").and("not.be.disabled");
});

Then("nenhum token é guardado na sessão", () => {
  cy.window().then((win) => {
    expect(win.sessionStorage.getItem("agroalerta_token")).to.be.null;
  });
  cy.location("pathname").should("eq", "/login.dc.html");
});

Then("o botão de login mostra {string}", (texto) => {
  cy.pegar("login-submit").should("have.text", texto);
});

Then("o botão de login está desabilitado", () => {
  cy.pegar("login-submit").should("be.disabled");
  cy.wait("@loginLento");
});

Then("vejo o campo de nome completo", () => {
  cy.pegar("registro-nome").should("be.visible").and("have.attr", "placeholder", "Marina Rezende Alves");
  cy.pegar("registro-email").should("be.visible");
});

Then("a página inicial é exibida", () => {
  cy.location("pathname").should("eq", "/AgroAlerta.dc.html");
  cy.pegar("landing-titulo").should("be.visible");
});
