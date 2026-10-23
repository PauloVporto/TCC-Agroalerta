import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";

const TELEFONE_OK = "(34) 99999-0000";

/** Preenche o cadastro com valores válidos, permitindo sobrescrever campos. */
function preencherCadastro(sobrescrever = {}) {
  return cy.novoUsuario().then((u) => {
    const v = {
      nome: "Marina Rezende Alves",
      email: u.email,
      telefone: TELEFONE_OK,
      cep: Cypress.env("cepValido"),
      senha: "Senha@123",
      confirmar: "Senha@123",
      termos: true,
      ...sobrescrever,
    };
    estado.extra.cadastro = v;
    cy.pegar("registro-nome").clear().type(v.nome);
    cy.pegar("registro-email").clear().type(v.email);
    cy.pegar("registro-telefone").clear().type(v.telefone);
    cy.pegar("registro-cep").clear().type(v.cep);
    cy.pegar("registro-senha").clear().type(v.senha);
    cy.pegar("registro-confirmar-senha").clear().type(v.confirmar);
    if (v.termos) cy.pegar("registro-termos").check();
  });
}

Given("que acesso a tela de cadastro", () => {
  cy.intercept("POST", "**/api/auth/registrar").as("registrar");
  cy.visit("/login.dc.html?modo=registro");
  cy.pegar("registro-titulo").should("be.visible");
});

Then("vejo todos os campos do cadastro", () => {
  ["registro-nome", "registro-email", "registro-telefone", "registro-cep", "registro-senha", "registro-confirmar-senha"]
    .forEach((id) => cy.pegar(id).should("be.visible"));
  cy.pegar("registro-termos").should("exist").and("not.be.checked");
  cy.pegar("registro-submit").should("contain", "Criar conta");
});

Then("vejo as cinco culturas disponíveis", () => {
  cy.pegar("registro-cultura").should("have.length", 5);
  cy.pegar("registro-cultura").then(($b) => {
    expect([...$b].map((b) => b.textContent.trim())).to.deep.equal(["Café", "Soja", "Milho", "Cana", "Feijão"]);
  });
});

When("envio o cadastro sem preencher nada", () => {
  cy.pegar("registro-submit").click();
});

When("envio o cadastro", () => {
  cy.pegar("registro-submit").click();
});

When("preencho o cadastro válido", () => preencherCadastro());
When("preencho o cadastro válido com nome {string}", (nome) => preencherCadastro({ nome }));
When("preencho o cadastro válido com CEP {string}", (cep) => preencherCadastro({ cep }));
When("preencho o cadastro válido com telefone {string}", (telefone) => preencherCadastro({ telefone }));
When("preencho o cadastro válido com confirmação de senha {string}", (confirmar) => preencherCadastro({ confirmar }));
When("preencho o cadastro válido com senha {string} e confirmação {string}", (senha, confirmar) =>
  preencherCadastro({ senha, confirmar })
);
When("preencho o cadastro válido sem aceitar os termos", () => preencherCadastro({ termos: false }));
When("preencho o cadastro válido com o e-mail da conta existente", () =>
  preencherCadastro({ email: estado.sessao.dados.email })
);

When("escolho a cultura {string}", (rotulo) => {
  cy.contains('[data-cy="registro-cultura"]', rotulo).click();
});

When("escolho a unidade {string}", (rotulo) => {
  cy.contains('[data-cy^="registro-unidade-"]', rotulo).click();
});

When("escolho o tipo de conta {string}", (tipo) => {
  cy.pegar(`registro-papel-${tipo.toLowerCase()}`).click();
});

When("clico em {string} no rodapé do cadastro", (rotulo) => {
  cy.pegar("ir-para-login").should("contain", rotulo).click();
});

// ---- verificações ----
Then("vejo o erro de cadastro {string} com {string}", (campo, msg) => {
  cy.pegar(`erro-registro-${campo}`).should("be.visible").and("have.text", msg);
});

Then("vejo o erro geral de cadastro {string}", (msg) => {
  cy.pegar("erro-registro-geral").should("be.visible").and("have.text", msg);
});

Then("permaneço na tela de cadastro", () => {
  cy.location("pathname").should("eq", "/login.dc.html");
  cy.pegar("registro-titulo").should("be.visible");
});

Then("nenhuma requisição de cadastro foi feita", () => {
  cy.get("@registrar.all").should("have.length", 0);
  cy.pegar("registro-submit").should("not.be.disabled");
});

Then("a cultura {string} está selecionada", (rotulo) => {
  cy.contains('[data-cy="registro-cultura"]', rotulo).should("have.css", "background-color", "rgb(31, 61, 43)");
  cy.contains('[data-cy="registro-cultura"]', "Café").should("have.css", "background-color", "rgb(255, 255, 255)");
});

Then("a unidade {string} está selecionada", (rotulo) => {
  cy.contains('[data-cy^="registro-unidade-"]', rotulo).should("have.css", "background-color", "rgb(31, 61, 43)");
  cy.contains('[data-cy^="registro-unidade-"]', "°C").should("have.css", "background-color", "rgb(255, 255, 255)");
});

Then("vejo a nota {string}", (trecho) => {
  cy.contains("span", trecho).should("be.visible");
  cy.pegar("registro-papel-fornecedor").should("have.css", "background-color", "rgb(31, 61, 43)");
});

Then("ao escolher o tipo de conta {string} vejo a nota {string}", (tipo, trecho) => {
  cy.pegar(`registro-papel-${tipo.toLowerCase()}`).click();
  cy.contains("span", trecho).should("be.visible");
  cy.pegar(`registro-papel-${tipo.toLowerCase()}`).should("have.css", "background-color", "rgb(31, 61, 43)");
});

Then("a conta recém-criada é removida ao final", () => {
  cy.wait("@registrar").then(({ response }) => {
    expect(response.statusCode).to.eq(201);
    expect(response.body.usuario.email).to.eq(estado.extra.cadastro.email.toLowerCase());
    estado.sessao = { token: response.body.token };
  });
});

Then("as preferências salvas na API são cultura {string} e unidade {string}", (cultura, unidade) => {
  cy.wait("@registrar").then(({ response }) => {
    estado.sessao = { token: response.body.token };
    cy.request({
      url: `${Cypress.env("apiUrl")}/auth/configuracoes`,
      headers: { Authorization: `Bearer ${response.body.token}` },
    }).then((r) => {
      expect(r.status).to.eq(200);
      expect(r.body.culturaFavorita).to.eq(cultura);
      expect(r.body.unidadeTemperatura).to.eq(unidade);
    });
  });
});
