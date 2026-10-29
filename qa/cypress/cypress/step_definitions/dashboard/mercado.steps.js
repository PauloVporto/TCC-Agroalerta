import { Then, When } from "@badeball/cypress-cucumber-preprocessor";

const brl = (t) => Number(t.replace("R$", "").trim().replace(/\./g, "").replace(",", "."));
const precoSaca = (t) => Number(t.replace(/[^\d]/g, "")); // "R$ 1.692/sc" -> 1692

/** Aguarda o histórico real carregar (a última cotação deixa de ser "carregando…"). */
function aguardarSerie() {
  cy.pegar("mercado-ultima-cotacao").should("not.contain", "carregando");
}

Then("o gráfico se chama {string}", (titulo) => {
  cy.pegar("mercado-titulo").should("be.visible").and("have.text", titulo);
  aguardarSerie();
});

Then("o gráfico tem de 1 a 12 barras mensais, cada uma com mês e valor", () => {
  aguardarSerie();
  cy.pegar("mercado-barra-mes").its("length").should("be.within", 1, 12);
  cy.pegar("mercado-barra-valor").its("length").should("be.within", 1, 12);
  cy.pegar("mercado-barra-valor").each(($v) => expect($v.text().trim()).to.match(/^[\d.,]+$/));
  cy.pegar("mercado-barra-mes").each(($m) => expect($m.text().trim()).to.match(/^[A-Za-zçÇ]+$/));
});

Then("a última cotação está no formato de saca {string}", (_exemplo) => {
  aguardarSerie();
  cy.pegar("mercado-ultima-cotacao").invoke("text").should("match", /^R\$ [\d.]+\/sc$/);
  cy.pegar("mercado-ultima-cotacao").invoke("text").then((t) => expect(precoSaca(t)).to.be.greaterThan(0));
});

Then("a variação do período está no formato de percentual com sinal", () => {
  aguardarSerie();
  cy.pegar("mercado-variacao").invoke("text").should("match", /^[+−]\d+,\d%$/);
  cy.pegar("mercado-variacao").should("be.visible");
});

Then("a máxima do período não é menor que a última cotação", () => {
  aguardarSerie();
  cy.pegar("mercado-ultima-cotacao").invoke("text").then((ultima) => {
    cy.pegar("mercado-maxima").invoke("text").then((maxima) => {
      expect(maxima).to.match(/^R\$ [\d.]+\/sc$/);
      expect(precoSaca(maxima)).to.be.at.least(precoSaca(ultima));
    });
  });
});

Then("o indicador PTAX mostra {string}", (texto) => {
  cy.pegar("mercado-ptax").should("have.text", texto);
});

Then("a cotação internacional mostra {string}", (texto) => {
  cy.pegar("mercado-cotacao-intl").should("have.text", texto);
});

Then("o IC-Br mostra {string}", (texto) => {
  cy.pegar("mercado-icbr").should("have.text", texto);
});

Then("o simulador está com {int} sacas", (qtd) => {
  cy.pegar("mercado-sacas").should("have.value", String(qtd));
  cy.pegar("mercado-sacas").should("have.attr", "type", "number");
});

When("informo {int} sacas no simulador", (qtd) => {
  aguardarSerie();
  cy.pegar("mercado-sacas").clear().type(String(qtd));
});

/** Receita = sacas × preço médio do último mês; a cotação exibida é arredondada (±0,50 por saca). */
function conferirReceita(sacas) {
  aguardarSerie();
  cy.pegar("mercado-ultima-cotacao").invoke("text").then((ultima) => {
    const preco = precoSaca(ultima);
    cy.pegar("mercado-receita").invoke("text").should((receita) => {
      expect(receita).to.match(/^R\$ [\d.]+,\d{2}$/);
      expect(brl(receita)).to.be.closeTo(sacas * preco, sacas * 0.51);
    });
  });
}

Then("a receita simulada é aproximadamente {int} vezes a última cotação", (sacas) => {
  conferirReceita(sacas);
});

Then("a receita simulada é {string}", (valor) => {
  cy.pegar("mercado-receita").should("have.text", valor);
  cy.pegar("mercado-sacas").should("have.value", "0");
});

Then("o resumo de mercado é {string}", (texto) => {
  cy.pegar("mercado-resumo").should("have.text", texto);
});

// As notícias saíram desta página e ganharam a sua própria (noticias.feature);
// aqui resta a procedência da análise, que vem dos fatores considerados.
Then("as fontes usadas da análise são {string}", (texto) => {
  cy.pegar("mercado-fontes").should("be.visible").and("have.text", "Fontes usadas: " + texto);
});
