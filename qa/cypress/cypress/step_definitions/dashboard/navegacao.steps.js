import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";
import { NAV } from "../../support/navegacao";

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

// A página deixou de listar um catálogo fixo: agora mostra o histórico de
// relatórios que o produtor gerou, e os tipos ficam no formulário de geração.
Then("a conta nova ainda não tem relatórios no histórico", () => {
  cy.pegar("relatorios-historico-titulo").should("contain", "Histórico de relatórios gerados");
  cy.pegar("relatorios-vazio").should("be.visible");
  cy.pegar("relatorio-titulo").should("not.exist");
});

When("abro o formulário de novo relatório", () => {
  cy.pegar("relatorio-novo").click();
  cy.pegar("relatorio-tipo").should("be.visible");
});

Then("posso escolher entre {int} tipos, incluindo {string}", (qtd, label) => {
  cy.pegar("relatorio-tipo-opcao").should("have.length", qtd);
  cy.pegar("relatorio-tipo").find("option").contains(label).should("exist");
});

/** Relatórios gerados ficam no localStorage do navegador, por usuário. */
function relatorioFalso(id, titulo, hora) {
  return {
    id, titulo, tipo: "alertas",
    periodo: "01/01/2026 a 23/10/2026", de: "2026-01-01", ate: "2026-10-23",
    cultura: "", geradoEm: `2026-10-23T${hora}:00.000Z`,
  };
}

Given("que estou autenticado no painel com {int} relatórios no histórico", (qtd) => {
  const itens = Array.from({ length: qtd }, (_, i) =>
    relatorioFalso(String(i + 1), "Relatório de risco climático", String(10 + i).padStart(2, "0") + ":00")
  );
  cy.simularDadosDoPainel({ alertas: "alertas-vazio.json" });
  cy.novoUsuario()
    .then((dados) => cy.registrarViaApi(dados))
    .then((sessao) => {
      estado.sessao = sessao;
      cy.visit("/dashboard.dc.html", {
        onBeforeLoad(win) {
          win.sessionStorage.setItem("agroalerta_token", sessao.token);
          win.sessionStorage.setItem("agroalerta_usuario", JSON.stringify(sessao.usuario));
          win.localStorage.setItem("agroalerta_relatorios_" + sessao.usuario.id, JSON.stringify(itens));
        },
      });
    });
  cy.aguardarDashboard();
});

// Regressão: o markup da linha do histórico já veio duplicado de um merge,
// e cada relatório aparecia aninhado dentro de outra cópia de si mesmo.
Then("o histórico lista exatamente {int} relatórios", (qtd) => {
  cy.pegar("relatorio-titulo").should("have.length", qtd);
  cy.pegar("relatorios-vazio").should("not.exist");
});

When("abro o primeiro relatório do histórico", () => {
  cy.pegar("relatorio-titulo").first().click();
});

Then("vejo as ações de visualizar, baixar e remover", () => {
  cy.contains("button", "Visualizar").should("be.visible");
  cy.contains("button", "Baixar PDF").should("be.visible");
  cy.contains("button", "Remover do histórico").should("be.visible");
});

// "Baixar PDF" só aparece por relatório já gerado, então não serve de âncora
// numa conta nova: o que sempre existe é o título e o botão de gerar.
Then("vejo a seção de relatórios {string}", (titulo) => {
  cy.pegar("relatorios-titulo").should("be.visible").and("have.text", titulo);
  cy.pegar("relatorio-novo").should("be.visible");
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
