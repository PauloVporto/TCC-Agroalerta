# QA – AgroAlerta

Suíte de qualidade do projeto, dividida em três frentes independentes (cada uma com seu próprio `package.json`):

| Pasta | Ferramenta | O que testa | Relatório |
|---|---|---|---|
| [`cypress/`](cypress) | Cypress + Cucumber (Gherkin) | Frontend (E2E), por página | Mochawesome (HTML) |
| [`postman/`](postman) | Postman + Newman | Endpoints da API, por rota e método | Newman htmlextra (HTML) |
| [`unit/`](unit) | Jest + Supertest | Código do backend, por módulo | Cobertura + relatório HTML |

> **Por que Jest e não Pytest?** O backend é 100% Node.js/JavaScript; o Pytest só executa código Python.
> O Jest cumpre o mesmo papel (testes unitários com `expect`, mocks, cobertura e relatórios).

Regra adotada em todas as frentes: **cada teste tem pelo menos 2 asserts coerentes**.

## Pré-requisitos

- Node 20+ e Docker Desktop
- `backend/.env` criado a partir de `backend/.env.example` (as chaves de API são opcionais)
- Subir a aplicação (necessário para Cypress e Newman; **não** para os unitários):

```bash
docker compose up -d --build     # frontend :5173 | backend :3001 | postgres
```

- Cypress e Newman precisam de internet: o frontend carrega React/Babel do unpkg e o cadastro consulta ViaCEP.
- CEP usado nos testes: `37500-001` (Itajubá-MG). O CEP de exemplo do app (`37540-000`) **não existe** no ViaCEP.

## 1. Unitários – Jest (`qa/unit`)

```bash
cd qa/unit && npm install
npm test               # roda tudo
npm run test:cov       # com cobertura (limite mínimo: 85% linhas)
npm run test:rules     # só motor de regras   | test:auth | test:routes | test:services
```

Organização por parte do código:

```
unit/
  rules/      rules.test.js                  # services/rules.js (limites de cada regra)
  auth/       auth.service.test.js           # hash scrypt, sessões, middleware 401
  routes/     auth | talhoes | alertas-clima | insumos-mercado | server  (Supertest)
  services/   localizacao (viacep, nominatim, geocoding) | clima (weather, openmeteo, inmet)
              mercado (bcb, stooq, alphavantage, googlenews, market, insumosIA) | db
  helpers/    http.js (mock de fetch), app.js (app Express de teste)
```

Banco, rede e IA são sempre simulados (`jest.mock` / `fetch` falso): os testes são rápidos e determinísticos.
Saídas: `unit/coverage/index.html` (cobertura) e `unit/reports/relatorio-unitarios.html`.

## 2. API – Postman + Newman (`qa/postman`)

```bash
cd qa/postman && npm install
npm test                # coleção inteira -> reports/newman-relatorio.html
npm run test:publico    # só rotas sem login (Health, Insumos, Mercado)
```

A coleção `collections/AgroAlerta.postman_collection.json` está organizada como
**Recurso › `MÉTODO /rota` › cenário** (Health, Auth, Clima, Talhoes, Alertas, Insumos, Mercado, Limpeza) e pode ser
importada no Postman junto com `environments/local.postman_environment.json`.

Os cenários rodam **em ordem** e compartilham estado por variáveis (e-mail único por execução, `token`, `talhaoId`…);
a pasta `Limpeza` exclui as contas criadas. Cada request valida status, `Content-Type`, corpo e tempo de resposta.

## 3. Frontend – Cypress + Cucumber + Mochawesome (`qa/cypress`)

```bash
cd qa/cypress && npm install
npm test                      # tudo + relatório -> reports/html/relatorio-cypress.html
npm run test:login            # por página: landing | login | registro | dashboard
npm run cy:open               # modo interativo
npm run check:asserts         # garante >= 2 verificações por cenário Gherkin
```

```
cypress/
  cypress/e2e/<pagina>/*.feature          # Gherkin em português, um arquivo por página/seção
    landing/ login/ registro/ dashboard/ (visao-geral, alertas, talhoes, insumos, mercado, conta, navegacao)
  cypress/step_definitions/<pagina>/*.steps.js   # um arquivo de steps por feature (+ common/)
  cypress/support/                        # comandos (cy.pegar, cy.registrarViaApi…) e estado do cenário
  cypress/fixtures/                       # respostas simuladas (alertas, clima, cotações, análise)
```

- Seletores são atributos `data-cy` adicionados aos HTMLs do frontend (só atributos, sem mudar comportamento).
- Contas de teste são criadas pela API (e-mail único) e removidas ao final de cada cenário.
- Clima, alertas, cotações e análise de mercado são **simulados** com `cy.intercept` (determinismo e sem gastar a API de IA);
  o restante (login, cadastro, talhões, conta, insumos, histórico) roda contra o backend real.

> **Windows/VS Code:** se o Cypress falhar com `bad option: --smoke-test`, a variável `ELECTRON_RUN_AS_NODE` está
> definida no terminal. O `npm test` já a remove; ao usar `npx cypress ...` direto, rode `Remove-Item Env:ELECTRON_RUN_AS_NODE`.
