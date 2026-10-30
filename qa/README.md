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

### Relação com `backend/tests/`

O projeto tem **duas** suítes, com papéis diferentes:

| Suíte | Papel | Como roda |
|---|---|---|
| `qa/` (esta) | Contrato HTTP das rotas, E2E pelo navegador e unidades de serviço, tudo com dependências simuladas | `npm test` em cada frente |
| `backend/tests/` | Integração profunda contra um Postgres real: fila de envio, webhooks, migrações, monitoramento | `cd backend && npm test` |

As duas se complementam de propósito. O módulo de notificações, por exemplo, é verificado aqui pelo contrato das
rotas (`qa/unit/routes/notificacoes.routes.test.js`) e, lá, pelo comportamento ponta a ponta da fila e dos webhooks —
por isso `services/notificacoes/**` fica fora da medição de cobertura desta suíte (ver "Escopo de cobertura").

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
  routes/     auth | talhoes | alertas-clima | insumos-mercado | notificacoes | relatorios
              admin | insumos.fornecedor | server  (Supertest)
  services/   localizacao (viacep, nominatim, geocoding) | clima (weather, openmeteo, inmet)
              mercado (bcb, stooq, alphavantage, googlenews, market, insumosIA) | db | swagger
  helpers/    http.js (mock de fetch), app.js (app Express de teste)
```

Banco, rede e IA são sempre simulados (`jest.mock` / `fetch` falso): os testes são rápidos e determinísticos.
O helper `app.js` oferece quatro tokens, um por papel — `Bearer ok` e `Bearer outro` (produtores),
`Bearer fornecedor` e `Bearer admin` —, o que permite testar as rotas protegidas por `exigirPapel`.

Casos que valem destacar:

- **Relatórios**: o pdfkit roda de verdade; os testes conferem `Content-Type: application/pdf`,
  o `Content-Disposition` e se o corpo começa com `%PDF-`.
- **Admin**: o foco é autorização (403 para produtor e fornecedor, 200 para admin), já que a lógica
  de cada operação é coberta pelos testes de integração do backend.

Saídas: `unit/coverage/index.html` (cobertura) e `unit/reports/relatorio-unitarios.html`.

### Escopo de cobertura

O `collectCoverageFrom` do `jest.config.js` lista **explicitamente** os módulos que esta suíte se propõe a
testar, em vez de varrer `backend/**`. O motivo é que medir cobertura sobre módulos cobertos por
`backend/tests/` diluiria a métrica sem acrescentar verificação nenhuma. Ficam de fora, de propósito:

- `services/notificacoes/**` — 24 módulos exercitados pelos testes de integração contra banco real;
- `routes/relatorios.js` — centenas de linhas de desenho do PDF, validadas aqui pelo contrato HTTP.

Com esse escopo, o limite mínimo é **85% de linhas, statements e funções, e 70% de branches**.

## 2. API – Postman + Newman (`qa/postman`)

```bash
cd qa/postman && npm install
npm test                # coleção inteira -> reports/newman-relatorio.html
npm run test:publico    # só rotas sem login (Health, Insumos, Mercado, Noticias)
```

A coleção `collections/AgroAlerta.postman_collection.json` está organizada como
**Recurso › `MÉTODO /rota` › cenário** e pode ser importada no Postman junto com
`environments/local.postman_environment.json`. São **136 requisições** e **524 asserções**, em 14 pastas:

| Pasta | Cobre |
|---|---|
| Health, Auth, Clima, Talhoes, Alertas, Insumos, Mercado | CRUD, permissões e erros das rotas do produtor |
| Noticias | notícias por cultura (RSS do Canal Rural e do g1) com resumo e link, cache e 400 para cultura fora do cadastro |
| Relatorios | os 4 tipos de PDF (`Content-Type`, `Content-Disposition`, assinatura `%PDF-`), 404 e 401 |
| Notificacoes | preferências por canal, categorias, histórico e os 400/401 de cada uma |
| Admin | 403 para conta de produtor em todas as rotas `/api/admin/**` |
| Insumos-Fornecedor | conta com `papel: fornecedor` publica, lista e remove oferta; 403 para produtor |
| Docs | `/api-docs.json` (OpenAPI 3, ≥20 rotas) e a página do Swagger UI |
| Limpeza | exclui as contas criadas (produtor, segundo usuário e fornecedor) |

Os cenários rodam **em ordem** e compartilham estado por variáveis (e-mail único por execução, `token`,
`talhaoId`, `tokenFornecedor`, `ofertaId`…); a pasta `Limpeza` precisa chegar ao fim para não deixar
contas órfãs no banco. Cada request valida status, `Content-Type`, corpo e tempo de resposta.

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
    landing/ login/ registro/
    dashboard/ (visao-geral, alertas, talhoes, notificacoes, insumos, mercado, conta, navegacao)
  cypress/step_definitions/<pagina>/*.steps.js   # um arquivo de steps por feature (+ common/)
  cypress/support/                        # comandos (cy.pegar, cy.registrarViaApi…) e estado do cenário
  cypress/fixtures/                       # respostas simuladas (alertas, clima, cotações, análise)
```

- Seletores são atributos `data-cy` adicionados aos HTMLs do frontend (só atributos, sem mudar comportamento).
- Contas de teste são criadas pela API (e-mail único) e removidas ao final de cada cenário. O cadastro exige
  **celular válido com DDD** — é ele que habilita a autorização de WhatsApp (ver `cy.novoUsuario`).
- Clima, alertas, cotações e análise de mercado são **simulados** com `cy.intercept` (determinismo e sem gastar a API de IA);
  o restante (login, cadastro, talhões, conta, insumos, notificações, histórico) roda contra o backend real.
- Na página de notificações, os steps aguardam `GET /notificacoes/preferencias` e `GET /notificacoes/categorias`
  antes de interagir: a tela preenche os controles quando essas respostas chegam e sobrescreveria um clique anterior.
- Fases de talhão aceitas hoje: `plantio`, `floracao`, `colheita`.

> **Windows/VS Code:** se o Cypress falhar com `bad option: --smoke-test`, a variável `ELECTRON_RUN_AS_NODE` está
> definida no terminal. O `npm test` já a remove; ao usar `npx cypress ...` direto, rode `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## Na esteira de CI/CD

As três frentes rodam na esteira do GitHub Actions ([`docs/CI_CD.md`](../docs/CI_CD.md)) com os mesmos comandos
desta página, sem chaves de API:

| Frente | Estágio da esteira | Ambiente |
|---|---|---|
| `npm run check:asserts` (Cypress) | 1 · análise estática | só lê os `.feature`: reprova cenário com menos de 2 verificações |
| Jest (`npm run test:cov`) | 1 · integração contínua | só Node, com banco, rede e IA simulados; os limites do `jest.config.js` reprovam a execução |
| Newman (`npm test`) | 2 · testes de sistema | aplicação completa no Docker Compose, banco novo, modos simulados |
| Cypress (`npm test`) | 2 · testes de sistema | idem, numa instância própria: as duas suítes não compartilham banco |

Os relatórios (HTML e cobertura do Jest, Newman htmlextra, Mochawesome e capturas de tela) ficam como artefatos
de cada execução, em *Actions › execução › Artifacts*.
