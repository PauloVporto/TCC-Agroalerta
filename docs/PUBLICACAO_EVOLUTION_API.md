# Publicação da integração Evolution API — 21/10/2026

Branch: `feat/evolution-api-migration`.
Mensagem de commit: `feat: integrar Evolution API e automatizar notificacoes WhatsApp`.

## Validações antes da publicação

- **154 testes unitários e 117 testes de integração aprovados**.
- Integração e migrations executadas somente no PostgreSQL isolado, com dados fictícios.
- Compose principal e override isolado aprovados por `docker compose config --quiet`.
- `git diff --check` aprovado.
- Backend e painel atuais: HTTP 200. Evolution conectada à instância `agroalerta`,
  remetente terminado em 9503 e webhook configurado corretamente.
- Nenhum disparo real executado nesta tarefa. Banco, consentimentos e configurações
  de produção não foram alterados. Pendências históricas continuaram retidas.

## Revisão e segurança

As alterações são da migração e das correções necessárias à sua validação. Não foi
identificada alteração preexistente alheia à migração para incluir neste commit.
As correções de testes acompanham as culturas efetivamente suportadas e o serviço
Open-Meteo usado pelo monitoramento, preservando as regras agronômicas existentes.

Relatórios públicos foram anonimizados: nomes pessoais, telefones completos,
identificadores do provedor e e-mail administrativo real ficaram fora da publicação.
Os relatórios originais foram preservados em diretório privado `.local/`, ignorado.
O script de campanha passou a validar o remetente pelo número completo no ambiente
privado, mantendo a restrição de final 9503, sem fixar um telefone pessoal no código.
Essa correção de fonte não foi implantada nem alterou o container atual nesta tarefa.

O ignore protege `.env` e variantes privadas, `.local/`, `.secrets/`, backups,
logs e diretórios de sessão. Exemplos de configuração e fixtures de teste usam
valores demonstrativos; nenhum segredo privado da Evolution foi adicionado.
A revisão inclui todos os arquivos rastreados e o conteúdo staged.

## Arquivos incluídos

- `.env.whatsapp.example`
- `.gitignore`
- `backend/.dockerignore`
- `backend/Dockerfile`
- `backend/migrations/003_whatsapp_implantacao_controlada.sql`
- `backend/migrations/004_whatsapp_retencao.sql`
- `backend/package.json`
- `backend/scripts/campanha-whatsapp.js`
- `backend/scripts/preparar-evolution.js`
- `backend/scripts/testar-whatsapp.js`
- `backend/scripts/validar-evolution.js`
- `backend/services/monitoramento.js`
- `backend/services/notificacoes/alertas.js`
- `backend/services/notificacoes/ativacao.js`
- `backend/services/notificacoes/controle.js`
- `backend/services/notificacoes/fila.js`
- `backend/services/notificacoes/historico.js`
- `backend/services/notificacoes/provedores/index.js`
- `backend/services/notificacoes/templates.js`
- `backend/services/notificacoes/testeAutorizado.js`
- `backend/tests/e2e/whatsapp.browser.cjs`
- `backend/tests/integracao/admin.routes.test.js`
- `backend/tests/integracao/ativacao.test.js`
- `backend/tests/integracao/atomicidade.test.js`
- `backend/tests/integracao/migracoes.test.js`
- `backend/tests/integracao/monitoramento.test.js`
- `backend/tests/integracao/whatsapp.test.js`
- `backend/tests/notificacoes.alertas.test.js`
- `backend/tests/notificacoes.campanha.test.js`
- `backend/tests/notificacoes.templates.test.js`
- `backend/tests/notificacoes.testeAutorizado.test.js`
- `backend/tests/rules.test.js`
- `backend/tests/weather-llm.test.js`
- `docker-compose.evolution-validation.yml`
- `docker-compose.whatsapp.yml`
- `docs/ATIVACAO_EVOLUTION_API.md`
- `docs/CAMPANHA_TESTE_WHATSAPP_2026-10-21.md`
- `docs/PUBLICACAO_EVOLUTION_API.md`
- `docs/RELATORIO_EVOLUTION_API.md`
- `docs/VALIDACAO_OPERACIONAL_EVOLUTION.md`
- `docs/WHATSAPP_EVOLUTION.md`
- `frontend/Dockerfile`
- `frontend/dashboard.dc.html`
- `frontend/login.dc.html`
- `frontend/serve.js`
- `frontend/whatsapp.css`
- `frontend/whatsapp.html`
- `frontend/whatsapp.js`
