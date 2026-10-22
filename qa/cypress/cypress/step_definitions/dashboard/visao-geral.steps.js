import { Then } from "@badeball/cypress-cucumber-preprocessor";

/** Localiza o cartão de KPI pelo rótulo e devolve o bloco que o contém. */
function kpi(rotulo) {
  return cy.contains('[data-cy="kpi-rotulo"]', rotulo).parent();
}

Then(
  "vejo os indicadores {string}, {string}, {string} e {string}",
  (a, b, c, d) => {
    cy.pegar("kpi-rotulo").should("have.length", 4);
    [a, b, c, d].forEach((rotulo) => cy.contains('[data-cy="kpi-rotulo"]', rotulo).should("be.visible"));
  }
);

Then("o indicador {string} mostra {string}", (rotulo, valor) => {
  kpi(rotulo).find('[data-cy="kpi-valor"]').should("have.text", valor);
  kpi(rotulo).find('[data-cy="kpi-nota"]').should("be.visible");
});

Then("o indicador {string} mostra {string} com a nota {string}", (rotulo, valor, nota) => {
  kpi(rotulo).find('[data-cy="kpi-valor"]').should("have.text", valor);
  kpi(rotulo).find('[data-cy="kpi-nota"]').should("contain", nota);
});

Then("o menu lateral mostra o nome {string} e a cidade {string}", (nome, cidade) => {
  cy.pegar("usuario-nome").should("have.text", nome);
  cy.pegar("usuario-cidade-sidebar").should("have.text", cidade);
});

Then("o cabeçalho mostra a cidade {string}", (cidade) => {
  cy.pegar("usuario-cidade-header").should("be.visible").and("have.text", cidade);
});

Then("vejo o alerta {string} com a recomendação de proteção contra geada", (titulo) => {
  cy.pegar("alerta-titulo").should("have.length", 1).and("have.text", titulo);
  cy.pegar("alerta-detalhe").should("contain", "Temperatura mínima prevista de 1°C");
  cy.pegar("alerta-insumo").should("contain", "proteção contra geada");
});

Then("a previsão exibe {string}", (titulo) => {
  cy.pegar("previsao-titulo").should("have.text", titulo);
  cy.pegar("previsao-dia").should("have.length", 7);
});

Then("a previsão lista os dias {string}", (dias) => {
  cy.pegar("previsao-dia").then(($d) => {
    expect([...$d].map((e) => e.textContent.trim()).join(", ")).to.eq(dias);
  });
  cy.pegar("previsao-max").first().should("have.text", "27°");
});

Then("o resumo mostra chuva acumulada {string} e mínima prevista {string}", (chuva, minima) => {
  cy.pegar("resumo-chuva").should("have.text", chuva);
  cy.pegar("resumo-minima").should("have.text", minima);
});

Then("o mapa da propriedade é um iframe do OpenStreetMap", () => {
  cy.pegar("mapa-iframe").should("have.prop", "tagName", "IFRAME");
  cy.pegar("mapa-iframe").should("have.attr", "src").and("include", "openstreetmap.org");
});

Then("o mapa tem título acessível {string}", (titulo) => {
  cy.pegar("mapa-iframe").should("have.attr", "title", titulo);
  cy.pegar("mapa-iframe").should("be.visible");
});
