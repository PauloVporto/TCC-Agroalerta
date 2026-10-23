import { After, Before, Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado, reiniciarEstado } from "../../support/estado";

/**
 * Steps compartilhados entre as páginas: sessão autenticada, redirecionamentos e títulos.
 */

Before(() => {
  reiniciarEstado();
});

// Limpeza: remove a conta criada pelo cenário (se houver)
After(() => {
  if (estado.sessao) {
    cy.excluirContaViaApi(estado.sessao.token);
  }
});

Given("que tenho uma conta criada pela API", () => {
  cy.novoUsuario()
    .then((dados) => cy.registrarViaApi(dados))
    .then((sessao) => {
      estado.sessao = sessao;
    });
});

/** Cria a conta pela API, simula as fontes externas e abre o painel já autenticado. */
function abrirPainel(opcoes) {
  cy.simularDadosDoPainel(opcoes);
  cy.novoUsuario()
    .then((dados) => cy.registrarViaApi(dados))
    .then((sessao) => {
      estado.sessao = sessao;
      cy.visitarAutenticado("/dashboard.dc.html", sessao);
    });
  cy.aguardarDashboard();
}

Given("que estou autenticado no painel", () => abrirPainel({ alertas: "alertas-vazio.json" }));

Given("que estou autenticado no painel com alerta de geada", () => abrirPainel({ alertas: "alertas-geada.json" }));

When("acesso a página inicial já autenticado", () => {
  cy.visitarAutenticado("/", estado.sessao);
});

Then("sou redirecionado para o painel", () => {
  cy.location("pathname").should("eq", "/dashboard.dc.html");
  cy.pegar("page-titulo").should("be.visible");
});

Then("sou redirecionado para a tela de login", () => {
  cy.location("pathname").should("eq", "/login.dc.html");
  cy.pegar("login-submit").should("be.visible");
});

Then("sou redirecionado para a tela de cadastro", () => {
  cy.location("pathname").should("eq", "/login.dc.html");
  cy.location("search").should("include", "modo=registro");
});

Then("vejo o título {string}", (titulo) => {
  cy.contains("h1", titulo).should("be.visible");
  cy.get("h1").should("have.length.at.least", 1);
});

Then("o token de sessão foi guardado", () => {
  cy.window().then((win) => {
    expect(win.sessionStorage.getItem("agroalerta_token")).to.match(/^[0-9a-f]{64}$/);
    expect(JSON.parse(win.sessionStorage.getItem("agroalerta_usuario"))).to.have.property("email");
  });
});

Then("a sessão foi encerrada", () => {
  cy.window().then((win) => {
    expect(win.sessionStorage.getItem("agroalerta_token")).to.be.null;
    expect(win.sessionStorage.getItem("agroalerta_usuario")).to.be.null;
  });
});
