# Esteira de CI/CD (GitHub Actions)

Workflow: [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml). A cada alteração na `main`, a esteira
constrói a aplicação, executa todas as suítes automatizadas, aplica critérios mínimos de qualidade e, num push na
`main` em que tudo passou, publica as imagens Docker aprovadas no GitHub Container Registry (GHCR).

## 1. Estágios e jobs

```
                   ┌ 1.1 Análise estática e segurança ─────┐
                   ├ 1.2 Testes unitários do backend ──────┤     ┌ 2.3 Testes de API ───────┐
 push / PR  ───►   ├ 1.3 Integração + cobertura backend ───┼──►  ┤                          ├──► 3.1 Publicação no GHCR
 na main           ├ 1.4 Testes unitários de QA ───────────┤     └ 2.4 Testes de interface ─┘     (só push na main)
                   └ 1.5 Build das imagens ── imagens.tar ─┘           (cada um com a aplicação
                        estágio 1: em paralelo                          completa e banco novo)
```

| Job | O que faz | Ferramenta | Reprova quando |
|---|---|---|---|
| 1.1 Análise estática e segurança | `node --check` em todo o JavaScript do backend e do frontend; regra de QA (≥ 2 verificações por cenário Gherkin); `npm audit` nos quatro pacotes | Node 20, npm | erro de sintaxe; cenário com menos de 2 verificações; vulnerabilidade alta ou crítica no backend |
| 1.2 Testes unitários do backend | `npm test` | node:test | algum teste reprovado |
| 1.3 Integração e cobertura do backend | `npm run test:cobertura` (unitários + integração) contra um PostgreSQL 16 em *service container*, banco `agroalerta_teste` | node:test, PostgreSQL 16 | algum teste reprovado; cobertura abaixo do mínimo |
| 1.4 Testes unitários de QA | `npm run test:cov` | Jest + Supertest | algum teste reprovado; cobertura abaixo dos limites do `jest.config.js` |
| 1.5 Build das imagens | `docker compose build` e exportação das duas imagens (`docker save`) para os estágios seguintes | Docker Compose | erro de build |
| 2.3 Testes de API | carrega as imagens do 1.5, sobe a aplicação completa (`docker compose up`, banco novo), espera `GET /api/health` e o frontend, roda a coleção | Postman + Newman | requisição ou asserção reprovada |
| 2.4 Testes de interface | o mesmo ambiente, numa instância própria, roda as features Gherkin no navegador | Cypress + Cucumber + Mochawesome | cenário reprovado |
| 3.1 Publicação das imagens | publica `ghcr.io/paulovporto/tcc-agroalerta/backend` e `.../frontend` com as tags `latest` e o SHA do commit | Docker, GHCR | falha no envio |

O estágio 2 roda como uma matriz de duas suítes, cada uma com a sua instância da aplicação: uma não herda dados da
outra, e uma suíte reprovada não interrompe a outra (os dois relatórios sempre saem). Em caso de falha, os logs
dos contêineres viram artefato; ao final, o ambiente é derrubado com `docker compose down --volumes`.

## 2. Gatilhos e princípios

- **Gatilhos:** push e pull request na `main` e execução manual (*Actions › CI/CD › Run workflow*). Um push novo na
  mesma branch ou no mesmo PR cancela a execução anterior ainda em andamento (`concurrency`).
- **Reprodutibilidade:** Node 20, o mesmo dos Dockerfiles (`node:20-alpine`); PostgreSQL 16, o mesmo do
  `docker-compose.yml`; `npm ci` com os lockfiles; runner fixo (`ubuntu-24.04`); actions fixadas pelo SHA do commit.
- **Falha rápida:** o estágio 1 (jobs baratos, em paralelo) precisa passar inteiro para o estágio 2 (o mais caro)
  começar; a publicação só acontece depois dos dois.
- **Sem segredos obrigatórios:** o `backend/.env` da esteira é criado a partir do `.env.example`, que tem as chaves
  vazias e os envios desligados. A própria aplicação confirma o modo em `GET /api/health`
  (`modoIA=simulado`, `modoEmail=simulado`, `modoWhatsapp=desativado`, `monitoramentoClimatico=desligado`).
  A publicação usa o `GITHUB_TOKEN` gerado pelo GitHub, com `packages: write` apenas no job 3.1; os demais jobs só
  leem o repositório, e o checkout não guarda credenciais.
- **Rastreabilidade:** cada execução fica ligada ao commit, guarda os relatórios como artefatos (seção 4) e escreve
  um resumo com os números de cada job na aba *Summary*. As imagens publicadas levam o SHA do commit como tag.
- **A imagem publicada é a imagem testada:** o 1.5 constrói as imagens uma única vez; o estágio 2 e a publicação
  carregam esse mesmo arquivo (`imagens.tar`), sem novo build.
- **Integridade:** nenhum teste foi alterado, desativado ou pulado para a esteira passar.

## 3. Critérios de aprovação (quality gates)

| Critério | Regra | Job |
|---|---|---|
| Testes (todas as suítes) | 0 reprovados | 1.2, 1.3, 1.4, 2.3, 2.4 |
| Cobertura Jest | mínimos do `jest.config.js`: 85% statements, 70% branches, 85% functions, 85% lines | 1.4 |
| Cobertura do backend (com integração) | mínimo de 80% linhas, 90% branches e 80% funções do código da aplicação | 1.3 |
| Build Docker | sem erro | 1.5 |
| Vulnerabilidades altas/críticas | backend: reprova; pacotes de QA: registra e alerta | 1.1 |
| Publicação | só depois dos estágios 1 e 2 aprovados, e só em push na `main` | 3.1 |

### 3.1 Cobertura do backend: como é medida e por que 80/90/80

No Node 20, a tabela do `--experimental-test-coverage` soma os próprios arquivos de teste na linha `all files`
(eles aparecem quase 100% cobertos), e a opção para excluí-los (`--test-coverage-exclude`) só existe a partir do
Node 22.5. Por isso o `npm run test:cobertura` também grava `coverage/lcov.info`, e a esteira calcula a cobertura
somando as linhas, branches e funções dos arquivos fora de `tests/`.

| Medição em 2026-10-30 (Node 20.20.2, 334 testes) | Linhas | Branches | Funções |
|---|---:|---:|---:|
| Tabela do Node 20 (inclui os arquivos de teste) | 88,42% | 94,75% | 91,55% |
| **Código da aplicação** (lcov, sem `tests/`) | **81,45%** (7.205/8.846) | **93,06%** (1.865/2.004) | **83,89%** (531/633) |

O limite proposto, **80% / 90% / 80%**, é o valor medido arredondado para baixo, com folga de 1,5 a 4 pontos: barra
uma queda real de cobertura (um módulo novo sem testes, por exemplo) sem reprovar por variações pequenas. A ideia é
subir o limite à medida que a cobertura subir. Os valores ficam em variáveis no topo do job 1.3.

Duas ressalvas para a leitura do número: a cobertura do node:test só conta os arquivos que os testes carregam (um
módulo que nenhum teste importa, como os de `scripts/`, não entra no denominador), e a do Jest se restringe, de
propósito, aos módulos listados em `collectCoverageFrom` (ver [`qa/README.md`](../qa/README.md)).

### 3.2 `npm audit`: o que bloqueia e por quê

Resultado em 2026-10-30, já com o ajuste do backend descrito na seção 7:

| Pacote | Críticas | Altas | Moderadas | Baixas | Regra |
|---|---:|---:|---:|---:|---|
| `backend` (dependências de produção) | 0 | 0 | 0 | 0 | reprova em alta ou crítica |
| `qa/unit` | 0 | 0 | 0 | 6 | só alerta |
| `qa/postman` | 1 | 12 | 8 | 0 | só alerta |
| `qa/cypress` | 0 | 4 | 9 | 1 | só alerta |

- **Backend: bloqueia.** As dependências dele vão para a imagem publicada e atendem requisições da rede. Antes da
  esteira havia 1 crítica (`proxy-addr`), 1 alta (`body-parser`) e 1 moderada (`qs`), todas trazidas pelo
  `express` 4.22.2 e com correção dentro das faixas do `package.json`; foram corrigidas (seção 7).
- **Pacotes de QA: só alertam.** São `devDependencies` das ferramentas de teste (Newman, Cypress, Jest): não entram
  nas imagens nem em produção e só rodam no runner descartável, contra a aplicação local e com entradas do próprio
  repositório. As correções disponíveis exigem trocar a versão principal das ferramentas (Cypress 13 → 16,
  cypress-cucumber-preprocessor 22 → 28, mochawesome 7 → 8; para o Newman, o `npm audit` só oferece voltar à 4.6.1),
  o que pede revalidar as suítes inteiras. Bloquear deixaria a esteira vermelha por algo que não está no produto. A
  atualização fica como trabalho futuro, e cada execução registra os números (artefato `npm-audit` e alerta no resumo).
- O resultado depende da base de alertas no dia da execução: um alerta novo pode reprovar o backend sem mudança de
  código. Para o backend, esse é o comportamento desejado, porque avisa de um risco novo no que vai para produção.

## 4. Artefatos de cada execução

| Artefato | Conteúdo | Job |
|---|---|---|
| `npm-audit` | resultado do `npm audit --json` de cada pacote | 1.1 |
| `cobertura-backend` | `lcov.info` e a saída do node:test com a tabela de cobertura por arquivo | 1.3 |
| `relatorio-jest` | `coverage/` (HTML e lcov) e `reports/relatorio-unitarios.html` | 1.4 |
| `imagens-docker` | `imagens.tar` com as duas imagens (guardado por 7 dias) | 1.5 |
| `relatorio-api` | `newman-relatorio.html` (htmlextra) e `newman-relatorio.json` | 2.3 |
| `relatorio-interface` | `html/relatorio-cypress.html` (Mochawesome), os JSONs e as capturas de tela das falhas | 2.4 |
| `logs-conteineres-api`, `logs-conteineres-interface` | logs do PostgreSQL, do backend e do frontend (só quando a suíte falha) | 2.3, 2.4 |

## 5. Como reproduzir localmente

Os jobs usam os mesmos comandos do dia a dia:

```bash
# 1.1 análise estática e segurança
git ls-files 'backend/*.js' 'backend/*.cjs' 'frontend/*.js' | xargs -n 1 node --check
(cd qa/cypress && npm run check:asserts)
(cd backend && npm audit --omit=dev --audit-level=high)

# 1.2 e 1.3 (o 1.3 precisa de TEST_DATABASE_URL; ver "Testes" no README)
cd backend && npm ci && npm test && npm run test:cobertura

# 1.4
npm ci --prefix backend && npm ci --prefix qa/unit && (cd qa/unit && npm run test:cov)
```

Para os estágios 1.5 e 2, use um clone ou `git worktree` separado: a esteira copia o `.env.example` por cima do
`backend/.env`, o que apagaria um `.env` com chaves reais. O nome de projeto `agroalerta` mantém contêineres e
volume separados do ambiente de desenvolvimento:

```bash
cp backend/.env.example backend/.env
docker compose -p agroalerta build
docker compose -p agroalerta up -d --no-build
curl http://localhost:3001/api/health
(cd qa/postman && npm ci && npm test)
(cd qa/cypress && npm ci && npm test)
docker compose -p agroalerta down --volumes
```

## 6. Proteção da branch `main`

Exigir a esteira antes do merge é uma configuração do repositório, que só um administrador (o dono, PauloVporto)
pode fazer. Ela precisa que o workflow já tenha rodado ao menos uma vez, para os nomes dos checks aparecerem na busca.

Pela interface: *Settings › Rules › Rulesets › New ruleset › New branch ruleset* → nome `main protegida`,
*Enforcement status* = *Active*, *Target branches* = *Include default branch* → marcar **Require a pull request
before merging** e **Require status checks to pass** (com *Require branches to be up to date before merging*) e
adicionar estes checks:

```
1.1 Análise estática e segurança
1.2 Testes unitários do backend (node:test)
1.3 Testes de integração e cobertura do backend (node:test + PostgreSQL 16)
1.4 Testes unitários de QA (Jest + Supertest)
1.5 Build das imagens Docker
2.3 Testes de API (Postman + Newman)
2.4 Testes de interface (Cypress + Cucumber)
```

O 3.1 (publicação) fica de fora, porque não roda em pull request. Se o nome de um job mudar no workflow, a regra
precisa ser atualizada com o nome novo.

Pela linha de comando (mesmo efeito, com o `gh` autenticado como administrador):

```bash
gh api -X POST repos/PauloVporto/TCC-Agroalerta/rulesets --input - <<'EOF'
{
  "name": "main protegida",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false, "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "1.1 Análise estática e segurança" },
          { "context": "1.2 Testes unitários do backend (node:test)" },
          { "context": "1.3 Testes de integração e cobertura do backend (node:test + PostgreSQL 16)" },
          { "context": "1.4 Testes unitários de QA (Jest + Supertest)" },
          { "context": "1.5 Build das imagens Docker" },
          { "context": "2.3 Testes de API (Postman + Newman)" },
          { "context": "2.4 Testes de interface (Cypress + Cucumber)" }
        ] } }
  ]
}
EOF
```

Depois da primeira publicação, os pacotes aparecem em *github.com/PauloVporto › Packages* como **privados**, que é o
padrão do GHCR. Para baixar as imagens sem login, o dono muda a visibilidade em
*Package settings › Change visibility › Public*.

## 7. Ajustes no projeto para viabilizar a esteira

1. **`backend/package-lock.json`: correção das vulnerabilidades do backend** (`npm audit fix`, só o lockfile):
   `express` 4.22.2 → 4.22.3, `body-parser` 1.20.6 → 1.20.9, `proxy-addr` 2.0.7 → 2.0.8 e `qs` 6.15.3 → 6.16.2.
   Todas as versões ficam dentro das faixas já declaradas no `package.json`, que não mudou. Sem isso, a regra de
   segurança do 1.1 reprovaria a esteira. As quatro suítes passaram depois da atualização.
2. **`backend/package.json`: o `test:cobertura` passa a gravar `coverage/lcov.info`.** Foram acrescentados o
   reporter `spec` no console (a saída de sempre) e o `lcov` em arquivo, mais um `pretest:cobertura` que cria a pasta
   `coverage/` (o Node 20 não cria a pasta de destino do relatório; o `node -e` funciona no Windows e no Linux). É o
   que permite medir a cobertura do código da aplicação sem os arquivos de teste (seção 3.1). A pasta `coverage/`
   já era ignorada pelo `.gitignore`.
3. Nenhum teste e nenhum código da aplicação foram alterados.

## 8. Limitações: o que fica fora da esteira

- **Integrações pagas ou com credencial:** a IA da Anthropic roda no modo simulado, e a avaliação de assertividade
  (`npm run ia:avaliar`) exige chave e tem custo, por isso continua manual ([`AVALIACAO_IA.md`](AVALIACAO_IA.md)).
  E-mail real (Resend), WhatsApp pela Evolution API (`docker-compose.whatsapp.yml`, que a esteira não sobe; os
  envios ficam travados), OpenWeather e Alpha Vantage também não são exercitados com credenciais.
- **`backend/tests/e2e/*.browser.cjs`:** os três roteiros de navegador dependem do `playwright-core`, que não está no
  `package.json`, e de um caminho do Chrome do macOS fixo no código. Ficam como verificação manual.
- **Serviços externos sem chave são chamados de verdade no estágio 2:** ViaCEP e Nominatim (cadastro e troca de
  CEP), Open-Meteo e INMET (alertas do talhão), RSS do Canal Rural e do g1 (notícias), Banco Central e Stooq
  (cotações) e o unpkg (React e Babel carregados pelo navegador). O Cypress simula clima, alertas, mercado e
  notícias com `cy.intercept`; o Newman, não. Uma indisponibilidade desses serviços reprova o estágio 2 sem defeito no produto;
  os relatórios e os logs dos contêineres mostram qual chamada falhou. Simular essas fontes exigiria mudar os
  testes, o que a esteira não faz.
- **Sem linter:** o projeto não tem ESLint configurado; a análise estática se limita à sintaxe e à regra de QA.
- **Node 20 está fora de suporte desde 2026-04-30.** A esteira acompanha os Dockerfiles; migrar Dockerfiles e
  esteira para uma versão LTS (22 ou 24) fica como trabalho futuro. No Node 22.5 ou mais novo, a própria tabela de
  cobertura já exclui os arquivos de teste.
- **O CD termina na publicação das imagens:** não há servidor de produção, e o deploy em ambiente real fica como
  trabalho futuro.
- **Escopo dos testes de sistema:** o Cypress roda só no Electron, sem matriz de navegadores; não há testes de carga
  nem de segurança dinâmica (DAST).
