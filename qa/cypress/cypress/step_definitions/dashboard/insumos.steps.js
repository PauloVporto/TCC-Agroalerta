import { Then } from "@badeball/cypress-cucumber-preprocessor";

const textos = ($els) => [...$els].map((e) => e.textContent.trim());
const brl = (t) => Number(t.replace("R$", "").trim().replace(/\./g, "").replace(",", "."));

Then("vejo a seção {string}", (titulo) => {
  cy.pegar("insumos-titulo").should("be.visible").and("have.text", titulo);
  cy.pegar("preco-produto").should("have.length.greaterThan", 0);
});

Then("o ranking lista {int} ofertas do produto {string}", (qtd, produto) => {
  cy.pegar("preco-produto").should("have.length", qtd);
  cy.pegar("preco-produto").each(($p) => expect($p.text().trim()).to.eq(produto));
});

Then("os preços unitários estão em ordem crescente", () => {
  cy.pegar("preco-unitario").then(($p) => {
    const valores = textos($p).map(brl);
    expect(valores).to.have.length(3);
    expect(valores).to.deep.equal([...valores].sort((a, b) => a - b));
  });
});

Then("a primeira oferta é de {string} por {string}", (fornecedor, preco) => {
  cy.pegar("preco-fornecedor").first().should("contain", fornecedor);
  cy.pegar("preco-unitario").first().should("have.text", preco);
});

Then("o ranking mostra as cidades {string}, {string} e {string}", (a, b, c) => {
  cy.pegar("preco-fornecedor").then(($f) => {
    const todos = textos($f).join("|");
    [a, b, c].forEach((cidade) => expect(todos).to.include(cidade));
  });
  cy.pegar("preco-fornecedor").should("have.length", 3);
});

Then("o ranking contém os fornecedores {string}, {string} e {string}", (a, b, c) => {
  cy.pegar("preco-fornecedor").then(($f) => {
    const nomes = textos($f).join("|");
    [a, b, c].forEach((n) => expect(nomes).to.include(n));
  });
});
