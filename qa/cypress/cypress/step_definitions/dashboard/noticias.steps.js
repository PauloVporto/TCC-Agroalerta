import { Then, When } from "@badeball/cypress-cucumber-preprocessor";

/** Espera a lista terminar de carregar antes de contar os cartões. */
function aguardarLista() {
  cy.pegar("noticias-titulo").should("be.visible");
}

Then("a página lista {int} notícias", (qtd) => {
  aguardarLista();
  cy.pegar("noticias-item").should("have.length", qtd);
  cy.pegar("noticias-vazio").should("not.exist");
});

// O preview é a razão de ser da página: antes só havia a manchete, e era
// preciso abrir a matéria para saber do que se tratava.
Then("cada notícia mostra título, fonte, data e um trecho da matéria", () => {
  cy.pegar("noticias-item").each(($cartao) => {
    const dentro = (id) => cy.wrap($cartao).find(`[data-cy="${id}"]`);
    dentro("noticias-item-titulo").invoke("text").should("have.length.at.least", 10);
    dentro("noticias-item-fonte").invoke("text").should("match", /\S/);
    dentro("noticias-item-resumo").invoke("text").then((resumo) => {
      expect(resumo.trim().length, "trecho da notícia").to.be.greaterThan(40);
      expect(resumo.trim().length).to.be.at.most(320);
    });
  });
  cy.pegar("noticias-item").each(($cartao) => {
    cy.wrap($cartao).should("contain", "de out. de 2026");
  });
});

Then("a primeira notícia é {string}", (titulo) => {
  cy.pegar("noticias-item-titulo").first().should("have.text", titulo);
  cy.pegar("noticias-item-titulo").should("have.length.at.least", 1);
});

Then("cada notícia abre o link da matéria em uma nova aba", () => {
  cy.pegar("noticias-item").each(($cartao) => {
    cy.wrap($cartao)
      .should("have.attr", "target", "_blank")
      .and("have.attr", "rel")
      .and("contain", "noopener");
    cy.wrap($cartao).invoke("attr", "href").should("match", /^https?:\/\//);
  });
});

Then("a notícia da fonte {string} aponta para {string}", (fonte, dominio) => {
  cy.pegar("noticias-item")
    .filter((_, el) => el.querySelector('[data-cy="noticias-item-fonte"]').textContent.trim() === fonte)
    .should("have.length.at.least", 1)
    .each(($cartao) => {
      cy.wrap($cartao).invoke("attr", "href").should("include", dominio);
    });
});

When("escolho a cultura {string} nas notícias", (label) => {
  cy.intercept("GET", "**/api/noticias?cultura=soja*", { fixture: "noticias-soja.json" }).as("noticiasSoja");
  cy.pegar("noticias-cultura").contains(label).click();
  cy.wait("@noticiasSoja");
});

Then("o título da seção de notícias é {string}", (titulo) => {
  cy.pegar("noticias-titulo").should("have.text", titulo);
  cy.pegar("noticias-item").should("have.length.at.least", 1);
});

// Os dois feeds podem estar fora do ar ao mesmo tempo; a rota responde 200 com
// lista vazia justamente para a página explicar a situação em vez de quebrar.
When("as fontes de notícias não devolvem nada", () => {
  cy.intercept("GET", "**/api/noticias*", { body: { cultura: "cafe", total: 0, noticias: [] } }).as("noticiasVazias");
  cy.pegar("nav-noticias").click();
  cy.wait("@noticiasVazias");
});

Then("vejo o aviso de que nenhuma notícia foi encontrada", () => {
  cy.pegar("noticias-vazio").should("be.visible").and("contain", "Nenhuma notícia encontrada");
});

Then("nenhum cartão de notícia é exibido", () => {
  cy.pegar("noticias-item").should("not.exist");
  cy.pegar("noticias-titulo").should("be.visible");
});

// Regressão: as notícias eram uma lista lateral da página de Mercado. Ao ganhar
// página própria, elas saíram de lá de vez.
Then("a página de mercado não tem lista de notícias", () => {
  cy.pegar("mercado-titulo").should("be.visible");
  cy.get('[data-cy="mercado-noticia-titulo"]').should("not.exist");
  cy.get('[data-cy="noticias-item"]').should("not.exist");
});

Then("o resumo da análise cita as fontes usadas", () => {
  cy.pegar("mercado-fontes").should("be.visible").and("contain", "Fontes usadas:");
  cy.pegar("mercado-resumo").should("be.visible");
});
