import { Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";

function configuracoesDaApi() {
  return cy
    .request({
      url: `${Cypress.env("apiUrl")}/auth/configuracoes`,
      headers: { Authorization: `Bearer ${estado.sessao.token}` },
    })
    .then((r) => {
      expect(r.status).to.eq(200);
      return r.body;
    });
}

When("acesso o perfil pelo menu lateral", () => {
  cy.pegar("nav-conta").should("contain", "Acessar perfil").click();
  cy.pegar("page-titulo").should("have.text", "Configurar conta");
  cy.pegar("conta-cidade").should("not.have.text", "");
});

Then("os campos mostram o nome {string} e o e-mail da conta criada", (nome) => {
  cy.pegar("conta-nome").should("have.value", nome);
  cy.pegar("conta-email").should("have.value", estado.sessao.dados.email);
});

Then("a cidade cadastrada é {string}", (cidade) => {
  cy.pegar("conta-cidade").should("have.text", cidade);
});

Then("a cultura {string} está marcada como favorita", (rotulo) => {
  cy.contains('[data-cy="conta-cultura"]', rotulo).should("have.css", "background-color", "rgb(47, 110, 143)");
  cy.pegar("conta-cultura").should("have.length", 2);
});

When("altero o nome para {string}", (nome) => {
  cy.pegar("conta-nome").clear().type(nome);
});

When("escolho a cultura favorita {string}", (rotulo) => {
  cy.contains('[data-cy="conta-cultura"]', rotulo).click();
});

When("desmarco as notificações", () => {
  cy.pegar("conta-notificacoes").should("be.checked").uncheck();
});

When("salvo as alterações da conta", () => {
  cy.pegar("conta-salvar").should("have.text", "Salvar alterações").click();
});

When("verifico o CEP {string}", (cep) => {
  cy.pegar("conta-cep").clear().type(cep);
  cy.pegar("conta-verificar-cep").click();
});

Then("o botão de salvar mostra {string}", (rotulo) => {
  cy.pegar("conta-salvar").should("have.text", rotulo);
});

Then("a API retorna o nome {string}", (nome) => {
  configuracoesDaApi().then((cfg) => {
    expect(cfg.nome).to.eq(nome);
    expect(cfg.email).to.eq(estado.sessao.dados.email);
  });
});

Then("a API retorna a cultura favorita {string}", (cultura) => {
  configuracoesDaApi().then((cfg) => {
    expect(cfg.culturaFavorita).to.eq(cultura);
    expect(cfg.unidadeTemperatura).to.eq("celsius");
  });
});

Then("a API retorna notificações desativadas", () => {
  configuracoesDaApi().then((cfg) => {
    expect(cfg.notificacoes).to.eq(false);
    expect(cfg.culturaFavorita).to.eq("cafe");
  });
});

Then("o status do CEP mostra {string}", (msg) => {
  cy.pegar("conta-cep-status").should("have.text", msg);
  cy.pegar("conta-verificar-cep").should("be.visible");
});
