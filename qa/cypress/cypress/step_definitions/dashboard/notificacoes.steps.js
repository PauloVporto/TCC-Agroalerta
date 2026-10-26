import { Then, When } from "@badeball/cypress-cucumber-preprocessor";
import { estado } from "../../support/estado";

/** Consulta as preferências de notificação direto na API, com o token do cenário. */
function preferenciasDaApi() {
  return cy
    .request({
      url: `${Cypress.env("apiUrl")}/notificacoes/preferencias`,
      headers: { Authorization: `Bearer ${estado.sessao.token}` },
    })
    .then((r) => {
      expect(r.status).to.eq(200);
      return r.body;
    });
}

function categoriasDaApi() {
  return cy
    .request({
      url: `${Cypress.env("apiUrl")}/notificacoes/categorias`,
      headers: { Authorization: `Bearer ${estado.sessao.token}` },
    })
    .then((r) => {
      expect(r.status).to.eq(200);
      return r.body;
    });
}

When("acesso as notificações pelo menu lateral", () => {
  // A previsão por talhão consulta o Open-Meteo; sem interceptar, o cenário
  // dependeria de uma API externa só para abrir a página.
  cy.intercept("GET", "**/api/notificacoes/previsoes", { body: { talhoes: [] } }).as("previsoes");
  cy.intercept("GET", "**/api/notificacoes/preferencias").as("carregarPreferencias");
  cy.intercept("GET", "**/api/notificacoes/categorias").as("carregarCategorias");

  cy.pegar("nav-notificacoes").should("contain", "Notificações").click();
  cy.pegar("page-titulo").should("have.text", "Notificações");
  cy.pegar("preferencias-notificacoes").should("be.visible");

  // A página preenche os controles quando essas respostas chegam. Interagir
  // antes disso faz o carregamento sobrescrever o que foi marcado. As previsões
  // são pedidas depois das categorias, dentro da mesma função: esperar por elas
  // garante que o estado das categorias já foi aplicado.
  cy.wait(["@carregarPreferencias", "@carregarCategorias", "@previsoes"]);
});

Then("a página mostra os canais de e-mail e WhatsApp", () => {
  cy.pegar("canal-email").should("exist");
  cy.pegar("canal-whatsapp").should("exist");
  cy.pegar("canal-card").should("have.length.at.least", 2);
});

Then("nenhum canal começa autorizado", () => {
  cy.pegar("canal-email").should("not.be.checked");
  cy.pegar("canal-whatsapp").should("not.be.checked");
});

Then("o nível mínimo de e-mail está desabilitado", () => {
  cy.pegar("nivel-email").should("be.disabled");
  cy.pegar("canal-email").should("not.be.checked");
});

Then("o nível mínimo de e-mail fica habilitado", () => {
  cy.pegar("nivel-email").should("not.be.disabled");
  cy.pegar("canal-email").should("be.checked");
});

When("autorizo o canal de e-mail", () => {
  cy.pegar("canal-email").check();
  cy.pegar("canal-email").should("be.checked");
});

When("autorizo o canal de WhatsApp", () => {
  cy.pegar("canal-whatsapp").check();
  cy.pegar("canal-whatsapp").should("be.checked");
});

When("escolho receber somente os alertas de risco alto", () => {
  cy.pegar("nivel-email").select("alto");
  cy.pegar("nivel-email").should("have.value", "alto");
});

When("salvo a autorização dos canais", () => {
  cy.intercept("PUT", "**/api/notificacoes/preferencias").as("salvarCanais");
  cy.pegar("salvar-canais").click();
  cy.wait("@salvarCanais").its("response.statusCode").should("eq", 200);
});

When("salvo as categorias", () => {
  cy.intercept("PUT", "**/api/notificacoes/categorias").as("salvarCategorias");
  cy.pegar("salvar-categorias").click();
  cy.wait("@salvarCategorias").its("response.statusCode").should("eq", 200);
});

When("recarrego a página de notificações", () => {
  cy.visitarAutenticado("/dashboard.dc.html", estado.sessao);
  cy.aguardarDashboard();
  cy.pegar("nav-notificacoes").click();
  cy.pegar("preferencias-notificacoes").should("be.visible");
});

Then("vejo o aviso de preferências salvas", () => {
  cy.pegar("aviso-preferencias").should("not.have.text", "");
  cy.pegar("aviso-preferencias").should("have.attr", "role", "status");
});

Then("o canal de e-mail aparece autorizado", () => {
  cy.pegar("canal-email").should("be.checked");
  cy.pegar("nivel-email").should("not.be.disabled");
});

Then("a API confirma que o e-mail está autorizado", () => {
  preferenciasDaApi().then((prefs) => {
    expect(prefs.email.consentido).to.eq(true);
    expect(prefs).to.have.property("whatsapp");
  });
});

Then("a API confirma o nível mínimo {string} para o e-mail", (nivel) => {
  preferenciasDaApi().then((prefs) => {
    expect(prefs.email.nivelMinimo).to.eq(nivel);
    expect(prefs.email.consentido).to.eq(true);
  });
});

Then("a página lista as categorias de aviso climático", () => {
  cy.pegar("categoria-item").should("have.length.at.least", 2);
  cy.get("input[data-categoria=boletim_diario]").should("exist");
});

Then("a categoria {string} começa desligada", (categoria) => {
  cy.get(`input[data-categoria=${categoria}]`).should("not.be.checked");
  categoriasDaApi().then((corpo) => {
    expect(corpo.preferencias[categoria]).to.eq(false);
  });
});

When("marco a categoria {string}", (categoria) => {
  cy.get(`input[data-categoria=${categoria}]`).check();
  cy.get(`input[data-categoria=${categoria}]`).should("be.checked");
});

Then("a API confirma que a categoria {string} está ligada", (categoria) => {
  categoriasDaApi().then((corpo) => {
    expect(corpo.preferencias, "preferências por categoria").to.have.property(categoria);
    expect(corpo.preferencias[categoria]).to.eq(true);
  });
});

// Regra do backend: nenhuma categoria climática pode ser ligada antes de o
// WhatsApp estar autorizado para o celular cadastrado.
When("salvo as categorias esperando recusa", () => {
  cy.intercept("PUT", "**/api/notificacoes/categorias").as("recusaCategorias");
  cy.pegar("salvar-categorias").click();
  cy.wait("@recusaCategorias").its("response.statusCode").should("eq", 400);
});

Then("vejo o aviso de que o WhatsApp precisa ser autorizado", () => {
  cy.pegar("aviso-preferencias").should("contain", "WhatsApp");
  cy.pegar("aviso-preferencias").should("not.contain", "Preferências salvas");
});

Then("a API confirma que a categoria {string} continua desligada", (categoria) => {
  categoriasDaApi().then((corpo) => {
    expect(corpo.preferencias[categoria]).to.eq(false);
    expect(corpo.whatsappValido).to.eq(false);
  });
});

// O painel só envia o PUT quando alguma categoria mudou: salvar sem mexer em
// nada apenas avisa, sem chamar a API.
When("salvo as categorias sem alterar nada", () => {
  cy.intercept("PUT", "**/api/notificacoes/categorias").as("salvarCategorias");
  cy.pegar("salvar-categorias").click();
});

Then("vejo o aviso de que nenhuma categoria foi alterada", () => {
  cy.pegar("aviso-preferencias").should("contain", "Nenhuma alteração");
  cy.get("@salvarCategorias.all").should("have.length", 0);
});

// A área de conteúdo do painel tem rolagem própria, então o rodapé da página
// começa fora da parte visível.
Then("vejo o aviso de que ainda não há notificações", () => {
  cy.pegar("historico-vazio").scrollIntoView().should("be.visible");
  cy.pegar("historico-vazio").should("not.have.text", "");
});

Then("a tabela de histórico não é exibida", () => {
  cy.pegar("historico-envio").should("not.exist");
  cy.pegar("atualizar-historico").scrollIntoView().should("be.visible");
});
