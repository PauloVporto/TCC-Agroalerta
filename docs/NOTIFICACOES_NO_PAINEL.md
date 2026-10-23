# Notificações integradas ao painel

As autorizações agora ficam em **Notificações** no painel principal, para produtores
e administradores: `http://localhost:5173/dashboard.dc.html#notificacoes`.

- Produtor: autorizações dos canais, preferências independentes de boletim, geada,
  chuva, vento e calor, previsão dos talhões e histórico. Somente categorias
  modificadas são enviadas ao salvar, preservando as demais decisões e a geada herdada.
- Administrador: agendamento, elegíveis, recibos e histórico por categoria, pausas
  climáticas, conexão WhatsApp e controles gerais já existentes na própria seção.
- Os endereços antigos `/clima-produtor.html` e `/whatsapp.html` redirecionam para
  Notificações. Não é necessário acessar páginas separadas para autorizar serviços.

Atualizado apenas o frontend no Docker; backend, Evolution, agendamento e banco
principal mantidos. Nenhuma autorização foi concedida ou revogada por esta mudança,
nenhuma mensagem foi enviada e nenhuma migration foi necessária.

Validação: **31 verificações Chrome aprovadas** em desktop e celular, com PostgreSQL
isolado e Evolution simulada, cobrindo alteração, cancelamento, persistência,
controles administrativos, previsão, permissões e redirecionamentos. A entrada
`npm run test:e2e:clima` agora executa `tests/e2e/notificacoes-dashboard.browser.cjs`
(porta frontend isolada 55175, exige TEST_DATABASE_URL terminada em `_teste`).

Sem commit ou push desta alteração de interface.
