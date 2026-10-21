# Boletim diário e alertas climáticos — 21/10/2026

Branch: `feat/boletim-diario-alertas-climaticos`, criada sobre
`927456734784512afa83e4159e7e667e4806fdcd`, também registrado em
`origin/feat/evolution-api-migration`. Nenhum commit, push ou merge nesta etapa.

## Implementação

- Boletim diário às **06h30, America/Sao_Paulo**, com janela padrão até 07h00.
  Um produtor recebe seus talhões agrupados; mensagens extensas são divididas
  em partes de aproximadamente 3.500 caracteres. Inclui mínima, máxima,
  probabilidade de chuva, precipitação diária, vento máximo, condições WMO,
  avaliação de geada para café e identificação da Open-Meteo.
- A previsão nova usa dados estritos da Open-Meteo: ausência permanece ausente,
  coordenadas inválidas são recusadas e previsão diária incompleta impede o
  boletim daquele produtor. Uma falha de fonte não vira clima simulado.
- Chuva intensa, vento forte e calor extremo têm categorias próprias, gravidade,
  período previsto, registro do evento e despacho. A geada reutiliza a regra
  existente de café; outras culturas não recebem avaliação agronômica inventada.
- Cinco preferências independentes, auditoria e autorização vinculada ao telefone.
  Boletim, chuva, vento e calor começam desativados. A geada existente permanece
  herdada da autorização WhatsApp vigente até escolha explícita do produtor.
  Nenhum consentimento SMS foi convertido.
- A fila PostgreSQL mantém limites, recibos, retenções e controle geral; alertas
  têm prioridade 100, boletins 10 e boas-vindas 0. A autorização é reconferida
  após a espera de ritmo, inclusive telefone, categoria e expiração.
- Execuções diárias persistentes e trava PostgreSQL impedem boletins duplicados.
  Reinício dentro da janela recupera execução parcial; fora da janela não recupera
  dias anteriores. Chaves por data/produtor/parte impedem repetição. Resultado
  incerto não recebe nova tentativa automática.
- Os novos alertas usam trava transacional por talhão/categoria. Detecção contínua
  mantém o episódio sem novo envio; mudança de moderado para alto ou aumento
  mínimo configurado permite nova notificação. O período de continuidade é de
  24 horas desde a última detecção. Previsões de dias passados são ignoradas.

## Critérios operacionais configuráveis

| Categoria | Moderado | Alto | Aumento relevante |
|---|---:|---:|---:|
| Chuva | 50 mm/dia | 100 mm/dia | 20 mm/dia |
| Vento máximo | 40 km/h | 60 km/h | 20 km/h |
| Temperatura máxima | 35 °C | 40 °C | 3 °C |

Esses valores são **critérios meteorológicos iniciais do aplicativo**, não avisos
oficiais nem recomendações agronômicas universais. Especialmente calor precisa
ser calibrado para região, cultura e exposição antes de autorizar produção.
Acumulado diário não determina intensidade horária: o aplicativo não apresenta
50 mm/dia como equivalente a 50 mm/h. Os níveis são rótulos internos.

Os parâmetros `WEATHER_RAIN_*`, `WEATHER_WIND_*`, `WEATHER_HEAT_*` e
`WEATHER_BULLETIN_WINDOW_MINUTES` estão documentados em `backend/.env.example`
e são repassados pelo Compose. Critérios incoerentes recusam a avaliação.

Referências para revisão operacional:
[Open-Meteo: variáveis, unidades e códigos WMO](https://open-meteo.com/en/docs) e
[Guia de proteção e defesa civil](https://www.gov.br/mdr/pt-br/centrais-de-conteudo/publicacoes/protecao-e-defesa-civil-sedec/copy_of_guiapraticodesastres.pdf).
A parametrização de calor é uma decisão operacional inicial e não foi atribuída
a um limiar agronômico oficial.

## Telas e APIs

- Perfil: link em **Configurar conta** para `/clima-produtor.html`;
  preferências por categoria, cancelamento independente, previsão de cada talhão
  e histórico do próprio produtor.
- Administração: `/whatsapp.html` ganha horário, próxima janela, última execução,
  elegíveis com talhão válido e consentimento, boletins enviados/entregues,
  histórico filtrável e pausas independentes para boletins e novos alertas.
  As flags de implantação e o bloqueio geral continuam prevalecendo.
- Autenticado: `GET/PUT /api/notificacoes/categorias`,
  `GET /api/notificacoes/previsoes`, histórico existente.
- Exclusivo de administrador: `GET /api/admin/clima` e
  `PUT /api/admin/clima/controles`. Controles gravam autor na auditoria.

As novas telas estão no código desta branch e foram abertas no ambiente isolado.
**Não foram instaladas no frontend de produção nesta etapa.** O painel existente
continua em **http://localhost:5173/whatsapp.html**.

## Migration e estado de produção

`005_boletim_alertas_climaticos.sql` adiciona preferências e auditoria por categoria,
controle climático separado, execuções diárias, categoria/prioridade da fila e
intensidade dos novos episódios. Amplia o CHECK dos tipos sem apagar registros.
Foi aplicada e revalidada apenas no PostgreSQL isolado terminado em `_teste`.
**Não foi aplicada no banco principal.**

As novas flags têm padrão falso:

```dotenv
AGROALERTA_WEATHER_BULLETIN_ENABLED=false
AGROALERTA_WEATHER_EXTENDED_ALERTS_ENABLED=false
```

O controle novo também nasce com ambas as pausas ligadas. A nova branch não foi
implantada, nenhum `.env` privado foi modificado e nenhum container de produção
foi reiniciado. Não houve envio real, alerta fictício ou mudança de consentimento
no banco principal durante esta implementação.

Verificação somente leitura da produção: health OK; Evolution `agroalerta` em
`open`, remetente validado final **9503**; boas-vindas e geada permanecem ativas.
O serviço antigo continua parado; SMSGo não foi utilizado.
Os IDs **3 e 7** foram encontrados **cancelados, ainda retidos e com zero
 tentativas**. Essa é a situação consultada, sem alteração nesta tarefa;
eles não foram liberados nem despachados.

## Validação

- **162 testes unitários aprovados**.
- **135 testes de integração aprovados** em PostgreSQL isolado e Evolution falsa.
- **25 verificações Chrome aprovadas**, em 1280 px e 390 px: preferências,
  previsão agrupada, autenticação, painel administrativo visível e acesso negado
  ao produtor. Revisão visual das capturas desktop/celular; zero transmissões.
- Compose validado com `config --quiet`; `git diff --check` sem problemas.

A integração cobre janela/fuso, recuperação de execução, vários talhões,
coordenadas e previsão inválidas, falha da fonte, concorrência, idempotência,
consentimento, revogação, troca de telefone, prioridade/expiração, chuva/vento/calor,
agravamento, recibos autenticados e resultado incerto da Evolution.
As suítes existentes continuam cobrindo cadastro, geada, boas-vindas, limites,
reinício de worker, desconexão, remetente divergente e retenções.

Para repetir: `npm test` e `npm run test:integracao` no backend (o segundo exige
`TEST_DATABASE_URL` de uma base exclusivamente fictícia terminada em `_teste`).
Para Chrome: `npm run test:e2e:clima`, com a mesma base isolada e
`PLAYWRIGHT_MODULE` apontando para Playwright instalado. O teste inicia apenas
serviços locais fictícios e encerra-os no final. Usa a porta frontend 55174.
Não execute integração e navegador simultaneamente na mesma base de testes.

## Antes de ativar notificações novas

1. Revisar e autorizar os critérios operacionais, especialmente calor.
2. Fazer backup protegido do banco principal e comprovar restauração em outra
   base antes de aplicar a migration 005. Essa operação de produção permanece
   pendente; nenhum dump será restaurado sobre o banco ativo.
3. Implantar o código e as telas mantendo as novas flags falsas e pausas ligadas,
   preservando sessão Evolution, flags existentes e retenções.
4. Após autorização específica do proprietário, habilitar separadamente as flags
   de boletim e/ou novos alertas e retirar a pausa correspondente. Exigir opt-in
   explícito dos produtores por categoria e WhatsApp vigente.
5. Acompanhar fila, próxima janela, eventos e recibos. A autorização anterior da
   geada e das boas-vindas não foi usada para liberar novas categorias.

Não há necessidade de digitar ENVIAR no fluxo automático. A liberação administrativa
não substitui consentimentos, limites, número remetente correto ou autorização
para a implantação das novas funcionalidades.

## Arquivos criados e modificados

- `.env.whatsapp.example`
- `backend/.env.example`
- `backend/migrations/005_boletim_alertas_climaticos.sql`
- `backend/package.json`
- `backend/routes/admin.js`
- `backend/routes/notificacoes.js`
- `backend/services/monitoramento.js`
- `backend/services/notificacoes/administracao.js`
- `backend/services/notificacoes/alertas.js`
- `backend/services/notificacoes/boletim.js`
- `backend/services/notificacoes/categorias.js`
- `backend/services/notificacoes/climaControle.js`
- `backend/services/notificacoes/climaPainel.js`
- `backend/services/notificacoes/climaRegras.js`
- `backend/services/notificacoes/config.js`
- `backend/services/notificacoes/fila.js`
- `backend/services/notificacoes/historico.js`
- `backend/services/notificacoes/index.js`
- `backend/services/notificacoes/novosAlertas.js`
- `backend/services/notificacoes/provedores/index.js`
- `backend/services/notificacoes/whatsapp.js`
- `backend/services/openmeteo.js`
- `backend/services/previsaoTalhao.js`
- `backend/tests/boletim.test.js`
- `backend/tests/e2e/clima.browser.cjs`
- `backend/tests/integracao/boletim-clima.test.js`
- `backend/tests/integracao/clima-api-evolution.test.js`
- `backend/tests/integracao/helpers/banco.js`
- `backend/tests/integracao/migracoes.test.js`
- `backend/tests/integracao/whatsapp.test.js`
- `docker-compose.whatsapp.yml`
- `docs/BOLETIM_ALERTAS_CLIMATICOS.md`
- `frontend/Dockerfile`
- `frontend/clima-admin.js`
- `frontend/clima-produtor.html`
- `frontend/clima-produtor.js`
- `frontend/dashboard.dc.html`
- `frontend/serve.js`
- `frontend/whatsapp.css`
- `frontend/whatsapp.html`
