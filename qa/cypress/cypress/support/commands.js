/**
 * Comandos customizados. Seletores usam sempre data-cy (adicionado aos HTMLs do frontend).
 */

const TOKEN_KEY = "agroalerta_token";
const USUARIO_KEY = "agroalerta_usuario";

/** cy.pegar("login-email") => cy.get('[data-cy="login-email"]') */
Cypress.Commands.add("pegar", (id) => cy.get(`[data-cy="${id}"]`));

/**
 * Gera um usuário único para cada execução.
 * O telefone é obrigatório no cadastro e precisa ser um celular válido: é ele
 * que habilita a autorização de notificações por WhatsApp.
 */
Cypress.Commands.add("novoUsuario", (extra = {}) => {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  return cy.wrap({
    nome: "Teste Cypress QA",
    email: `cy.${ts}@agroalerta.test`,
    senha: "Senha@123",
    cep: Cypress.env("cepValido"),
    cultura: "cafe",
    telefone: "(35) 99999-0000",
    ...extra,
  });
});

/** Registra o usuário direto pela API (rápido) e devolve { usuario, token, dados }. */
Cypress.Commands.add("registrarViaApi", (dados) => {
  return cy
    .request({ method: "POST", url: `${Cypress.env("apiUrl")}/auth/registrar`, body: dados })
    .then((r) => {
      expect(r.status).to.eq(201);
      return { usuario: r.body.usuario, token: r.body.token, dados };
    });
});

/** Abre a página já autenticada, semeando o sessionStorage (pula o login pela UI). */
Cypress.Commands.add("visitarAutenticado", (caminho, sessao) => {
  cy.visit(caminho, {
    onBeforeLoad(win) {
      win.sessionStorage.setItem(TOKEN_KEY, sessao.token);
      win.sessionStorage.setItem(USUARIO_KEY, JSON.stringify(sessao.usuario));
    },
  });
});

/** Remove a conta criada durante o teste (limpeza). */
Cypress.Commands.add("excluirContaViaApi", (token) => {
  return cy.request({
    method: "DELETE",
    url: `${Cypress.env("apiUrl")}/auth/conta`,
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
});

/**
 * Espera o dashboard terminar de carregar os dados da API.
 * O app marca "carregado" antes das respostas chegarem, então usamos sinais reais:
 * a cidade do usuário no cabeçalho (/auth/configuracoes) e o KPI de talhões (/talhoes).
 */
Cypress.Commands.add("aguardarDashboard", () => {
  cy.pegar("page-titulo").should("be.visible");
  cy.pegar("usuario-cidade-header").should("contain", "MG");
  cy.pegar("kpi-valor").eq(1).should("have.text", "1");
});

/**
 * Série de preços do mercado para o gráfico e o simulador de venda.
 * Um ponto por mês, do início do ano corrente até o mês atual, com preços
 * previsíveis (R$ 2.000 + R$ 50 por mês). O último preço é o que o painel usa
 * como cotação atual, então os cenários podem calcular a receita esperada.
 */
export function serieDeMercado() {
  const hoje = new Date();
  const ano = hoje.getUTCFullYear();
  const historico = [];
  for (let mes = 0; mes <= hoje.getUTCMonth(); mes++) {
    historico.push({
      data: `${ano}-${String(mes + 1).padStart(2, "0")}-15`,
      preco: 2000 + mes * 50,
    });
  }
  const projecao = [1, 2, 3].map((n) => ({
    data: `${ano + 1}-${String(n).padStart(2, "0")}-15`,
    preco: 2800 + n * 50,
  }));

  return {
    cultura: "cafe",
    unidade: "saca 60kg (arábica)",
    fonte: "Cepea/Esalq — Indicador do café arábica (série simulada no teste)",
    historico,
    projecao,
    anosProjecao: 1,
    tendenciaAnual: 0.08,
    metodoProjecao: "tendencia+sazonalidade",
  };
}

/** Intercepta as chamadas de dados do dashboard com fixtures determinísticas. */
Cypress.Commands.add("simularDadosDoPainel", ({ alertas = "alertas-vazio.json", clima = true, mercado = true, noticias = "noticias-cafe.json" } = {}) => {
  cy.intercept("GET", "**/api/alertas/*", { fixture: alertas }).as("alertas");
  if (clima) cy.intercept("GET", "**/api/clima", { fixture: "clima-7dias.json" }).as("clima");
  if (mercado) {
    // A série real vai de 2010 até hoje (milhares de pontos diários) e muda a
    // cada dia. Aqui ela é gerada com preços fixos, mas ancorada no ano
    // corrente: o gráfico recorta por ano e depois pela janela do período
    // escolhido, então datas fixas num ano passado deixariam o gráfico vazio.
    cy.intercept("GET", "**/api/mercado/*/serie", { body: serieDeMercado() }).as("serie");
    cy.intercept("GET", "**/api/mercado/*/analise", { fixture: "analise-cafe.json" }).as("analise");
    cy.intercept("GET", "**/api/mercado/cotacoes*", { fixture: "cotacoes.json" }).as("cotacoes");
  }
  // As notícias vêm de RSS de veículos externos: sem fixture, a lista mudaria
  // a cada execução e os cenários não teriam o que afirmar. A página pede a
  // cultura do cadastro, então cada uma tem a sua resposta — o intercept mais
  // específico vem depois porque o Cypress casa as rotas da última para a
  // primeira.
  if (noticias) {
    cy.intercept("GET", "**/api/noticias*", { fixture: noticias }).as("noticias");
    cy.intercept("GET", "**/api/noticias?cultura=soja*", { fixture: "noticias-soja.json" }).as("noticiasSoja");
  }
});
