# Notificações por e-mail (Resend) e SMS (SMSGo)

Este guia explica como o Agro Alerta avisa o produtor — boas-vindas no cadastro e
alertas de risco climático —, como configurar os provedores, testar sem custo,
ativar os envios reais e diagnosticar falhas.

## 1. Como funciona

```
Cadastro (painel)                                  Monitoramento climático (a cada 60 min)
  nome, e-mail, telefone, CEP                        Open-Meteo: previsão 7 dias + histórico 30 dias
  [ ] e-mail   [ ] SMS   (desmarcados)               │  só talhões de produtores com algum canal autorizado
        │                                            ▼
        ▼                                          leituras_clima → motor de regras (cultura e fase)
  notificacao_consentimentos  ◄─── painel ───┐       │
        │ (uma linha por decisão)            │       ▼
        ▼                                    │     alertas_gerados (um episódio por risco)
  boas-vindas por canal autorizado           │       │ risco novo ou que subiu de nível
        │                                    │       ▼
        └──────────────►  notificacao_envios  ◄──────┘   (fila persistente + histórico)
                                │
             fila automática (a cada 15 s e logo após cada cadastro/alerta)
             relê consentimento e contato · limites e orçamento do SMS
                                │
                 Resend (e-mail) · SMSGo (SMS) · modo simulado
                                │
            confirmação de entrega: consulta periódica (local) e webhooks (opcional)
                                │
                     painel → Notificações (histórico do produtor)
```

- **Destinatários dinâmicos**: e-mail e celular vêm da tabela `usuarios`; ninguém é
  cadastrado manualmente nos provedores.
- **Consentimento explícito e por canal**: as opções começam desmarcadas. Cada decisão
  (autorizar ou revogar) vira uma linha em `notificacao_consentimentos` — o histórico
  completo serve de prova de consentimento. Sem nenhuma linha, o canal está desautorizado.
- **Reverificação antes de cada envio**: a fila relê consentimento, e-mail e celular no
  momento do envio. Revogou depois de enfileirar? O envio fica **bloqueado**.
- **Boas-vindas uma única vez por canal**: a chave `boas_vindas:<canal>:usuario:<id>` é única.
- **Alertas sem repetição**: cada risco vira um episódio em `alertas_gerados`. Enquanto a
  regra continua disparando, só `ultima_deteccao_em` avança. O produtor é avisado de novo
  apenas se o risco **subir de nível** ou **voltar** após 24 h sem ser detectado.
- **Só dados reais**: o monitoramento usa apenas o Open-Meteo. Se a API falhar, o talhão
  fica sem leitura naquele ciclo — nunca há recurso a dados simulados.
- **Gravidade por canal** (padrão): e-mail para risco **médio e alto**; SMS só para risco
  **alto**. O produtor muda isso em *Configurar conta*.
- **Região**: cada talhão guarda `regiao` ("Cidade - UF"). O mesmo risco em vários talhões
  do produtor na mesma cidade vira uma única mensagem por canal, citando todos.

### Estados de um envio

| status | significado |
|---|---|
| `pendente` | na fila; com `erro_codigo`, aguardando nova tentativa automática |
| `processando` | reservado pela fila (trava de 2 min; se o backend cair, volta à fila) |
| `simulado` | processado em modo simulado — nenhuma mensagem saiu do sistema |
| `enviado` | **aceito** pela API do provedor (ainda não é entrega confirmada) |
| `entregue` | o provedor **confirmou** a entrega |
| `falhou` | falha definitiva, tentativas esgotadas ou entrega recusada (`falha_entrega`) |
| `bloqueado` | barrado antes de sair: sem consentimento, contato inválido, limite ou orçamento |

Cada mudança de estado fica em `notificacao_eventos` (linha do tempo auditável).

## 2. Modos de cada canal

| modo | quando | efeito |
|---|---|---|
| **simulado** | `*_SENDING_ENABLED=false` (padrão) | fila, limites e histórico funcionam; nenhuma chamada externa; sem custo |
| **sandbox** | SMS com `SMS_SENDING_ENABLED=true` e `SMSGO_SANDBOX=true` | API real da SMSGo com a chave `test_…`: responde como em produção, **não cobra nem entrega** |
| **real** | e-mail com `EMAIL_SENDING_ENABLED=true`; SMS com `SMS_SENDING_ENABLED=true` e `SMSGO_SANDBOX=false` | envio de verdade, com custo |

Os canais são independentes: dá para ligar o e-mail real e manter o SMS simulado.
`GET /api/health` mostra `modoEmail` e `modoSms`; o painel mostra o modo em *Notificações*.

## 3. Variáveis de ambiente (`backend/.env`)

| variável | padrão | descrição |
|---|---|---|
| `EMAIL_PROVIDER` | `resend` | único provedor de e-mail suportado |
| `EMAIL_SENDING_ENABLED` | `false` | `true` liga o envio real de e-mail |
| `RESEND_API_KEY` | — | chave da API (resend.com → API Keys). Use acesso total para o diagnóstico ver os domínios |
| `EMAIL_FROM` | — | remetente, ex.: `Agro Alerta <alertas@seudominio.com.br>` (domínio verificado) |
| `RESEND_WEBHOOK_SECRET` | — | (opcional) segredo `whsec_…` do webhook do Resend |
| `SMS_PROVIDER` | `smsgo` | `smsgo` ou `twilio` (legado) |
| `SMS_SENDING_ENABLED` | `false` | `true` liga o SMS pela API (sandbox ou real) |
| `SMSGO_API_KEY` | — | chave de produção (painel SMSGo → Minha conta → API) |
| `SMSGO_TEST_API_KEY` | — | chave de teste `test_…` (sandbox) |
| `SMSGO_SANDBOX` | `true` | `true` usa a chave de teste; SMS real só com `false` explícito |
| `SMSGO_SMS_TYPE_ID` | — | tipo de SMS da tabela da conta (o diagnóstico lista os tipos) |
| `SMSGO_WEBHOOK_SECRET` | — | (opcional) segredo do webhook da SMSGo |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | — | integração legada, usada só com `SMS_PROVIDER=twilio` |
| `SMS_COST_PER_SEGMENT` | — | preço da **sua** conta por segmento, em R$ (obrigatório no modo real) |
| `SMS_MONTHLY_BUDGET` | — | orçamento máximo por mês, em R$ (obrigatório no modo real) |
| `SMS_DAILY_LIMIT` | `20` | SMS por dia, somando todos os produtores |
| `SMS_MONTHLY_LIMIT` | `200` | SMS por mês, somando todos os produtores |
| `SMS_PER_USER_DAILY_LIMIT` | `3` | SMS por produtor por dia |
| `SMS_MAX_SEGMENTS` | `1` | segmentos por mensagem (1 = até 160 caracteres sem acento) |
| `NOTIFICATION_QUEUE_INTERVAL_MS` | `15000` | intervalo da fila |
| `NOTIFICATION_MAX_ATTEMPTS` | `5` | tentativas por envio (esperas de 1, 5, 15 e 60 min) |
| `WEATHER_MONITOR_ENABLED` | `true` | liga o monitoramento climático automático |
| `WEATHER_MONITOR_INTERVAL_MINUTES` | `60` | intervalo entre ciclos (o primeiro roda 1 min após o backend subir) |

O `.env` é carregado pelo Docker Compose (`env_file`) e não entra na imagem nem no Git.
Depois de mudar o `.env`, recrie o backend: `docker compose up -d backend`.

## 4. Configurar o Resend

1. Crie a chave em **resend.com → API Keys** (acesso total permite o diagnóstico ler os domínios).
2. Coloque em `RESEND_API_KEY`.
3. **Remetente**: sem domínio verificado, o Resend só aceita o remetente de teste
   `onboarding@resend.dev`, e **só entrega para o e-mail dono da conta Resend** — qualquer
   outro destinatário é recusado (`remetente_de_teste`). Para enviar aos produtores:

### Verificar um domínio

1. Tenha um domínio seu (ex.: comprado em Registro.br, Cloudflare ou Namecheap).
2. No Resend: **Domains → Add Domain**. A recomendação do Resend é usar um subdomínio,
   ex.: `alertas.seudominio.com.br`. Escolha a região mais próxima da maioria dos destinatários.
3. A aba **Records** mostra os registros DNS (SPF e DKIM: `TXT` e `MX` ou `CNAME`).
   Crie cada um no painel DNS do seu domínio **copiando os valores exatamente**.
   Em `CNAME` na Cloudflare, desligue o proxy (nuvem laranja).
4. Aguarde a verificação: costuma levar até 15 min, mas DNS pode levar até 72 h. Se travar,
   use **Restart verification** no painel do Resend.
5. Opcional, recomendado: adicione um registro **DMARC** depois de verificado.
6. Use o domínio no remetente: `EMAIL_FROM=Agro Alerta <alertas@alertas.seudominio.com.br>`.
7. Rode o diagnóstico: ele deve mostrar `domínio do remetente (...): verificado`.

Limites e cotas dependem do plano da conta Resend (consulte o painel). Cota diária ou mensal
estourada aparece como `cota_excedida`.

## 5. Configurar a SMSGo

1. No painel (smsgo.com.br → Minha conta → API) copie a **chave de produção** e a
   **chave de teste** (`test_…`) para `SMSGO_API_KEY` e `SMSGO_TEST_API_KEY`.
2. Rode o diagnóstico: ele mostra o modo de cada chave, o **saldo**, os **tipos de SMS com
   preço** (`GET /v1/sms-types`) e o webhook configurado.
3. Escolha o tipo em `SMSGO_SMS_TYPE_ID` (para alertas, o tipo transacional — na conta
   atual, `2 = SMS Token`) e copie o preço para `SMS_COST_PER_SEGMENT`.
4. Defina `SMS_MONTHLY_BUDGET`. Sem custo e orçamento, **nenhum SMS real sai**
   (`custo_nao_configurado` / `orcamento_nao_configurado`).

A SMSGo não exige cadastro de remetente nem dos destinatários: qualquer celular brasileiro
válido pode receber, desde que haja saldo e orçamento.

## 6. Rodar localmente

```bash
docker compose up -d --build backend frontend   # o db continua como está
docker compose logs -f backend                  # migrations, fila e monitoramento
```

- As migrations em `backend/migrations` são aplicadas na subida do backend (uma vez cada,
  registradas em `schema_migrations`). São somente aditivas.
- A fila, a consulta de entregas e o monitoramento sobem junto com o backend; pendências de
  antes de um reinício são retomadas na primeira rodada.
- Painel: http://localhost:5173 · API: http://localhost:3001/api/health

## 7. Testes automatizados (provedores simulados, sem custo)

```bash
cd backend
npm test                     # testes de unidade (sem banco)

# Testes de integração: PostgreSQL de teste separado, descartável
docker run -d --rm --name agroalerta-pg-teste -e POSTGRES_USER=agroalerta \
  -e POSTGRES_PASSWORD=agroalerta -e POSTGRES_DB=agroalerta_teste \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgres://agroalerta:agroalerta@127.0.0.1:55432/agroalerta_teste
npm run test:integracao
npm run test:cobertura       # tudo, com relatório de cobertura
docker stop agroalerta-pg-teste
```

No PowerShell, use `$env:TEST_DATABASE_URL="postgres://..."`. Para rodar dentro do
container: `docker compose exec -e TEST_DATABASE_URL=postgres://agroalerta:agroalerta@host.docker.internal:55432/agroalerta_teste backend npm run test:integracao`.

As suítes de integração **apagam os dados** entre um teste e outro, por isso só rodam se o
nome do banco terminar em `_teste`.

## 8. Testes reais individuais

Rode **dentro do container** (assim o resultado fica no histórico do banco local):

```bash
# Diagnóstico das contas — somente leitura, não envia nada
docker compose exec backend npm run notificacoes:diagnostico

# UM e-mail para o endereço informado (sem domínio verificado: só o e-mail dono da conta Resend)
docker compose exec backend npm run notificacoes:testar-email -- --para voce@exemplo.com

# UM SMS no sandbox (não cobra nem entrega)
docker compose exec backend npm run notificacoes:testar-sms -- --para "(35) 99999-0000" --sandbox

# UM SMS real (cobra 1 SMS da conta SMSGo)
docker compose exec backend npm run notificacoes:testar-sms -- --para "(35) 99999-0000"
```

Cada script mostra destinatário, conteúdo, custo (e saldo, no SMS), **exige digitar ENVIAR**,
envia uma única mensagem, registra o resultado (tipo `teste`) e acompanha a entrega por até
1 minuto. Eles não usam a fila nem consultam produtores.

## 9. Ativar os envios automáticos

1. Rode o diagnóstico e resolva os avisos.
2. **E-mail**: verifique o domínio (seção 4), ajuste `EMAIL_FROM`, faça um teste com
   `testar-email` e só então `EMAIL_SENDING_ENABLED=true`.
3. **SMS, sandbox**: `SMS_SENDING_ENABLED=true` com `SMSGO_SANDBOX=true` — o fluxo automático
   passa a chamar a API da SMSGo sem custo.
4. **SMS, real**: confirme saldo, `SMSGO_SMS_TYPE_ID`, `SMS_COST_PER_SEGMENT`,
   `SMS_MONTHLY_BUDGET` e os limites; faça um `testar-sms` real; então `SMSGO_SANDBOX=false`.
5. Recrie o backend (`docker compose up -d backend`) e confira no log:
   `E-mail: REAL · SMS: REAL`.

## 10. Acompanhar o histórico

- **Painel → Notificações**: canais autorizados, modo do servidor e histórico do produtor
  (data, tipo, canal, destinatário, status, região, descrição e motivo da falha). Cada
  produtor vê só os próprios envios.
- **Diagnóstico**: contagem por canal e status, motivos de falha da última semana e consumo
  de SMS no mês.
- **SQL** (`docker compose exec db psql -U agroalerta -d agroalerta`):

```sql
SELECT id, criado_em, tipo, canal, status, modo, erro_codigo, erro_mensagem
FROM notificacao_envios ORDER BY id DESC LIMIT 20;

SELECT tipo, status, detalhe, criado_em FROM notificacao_eventos WHERE envio_id = 42 ORDER BY id;

SELECT usuario_id, canal, concedido, origem, criado_em
FROM notificacao_consentimentos ORDER BY id DESC;
```

## 11. Limites e orçamento do SMS

Antes de cada SMS, a fila calcula os segmentos e o custo e confere, sob um *advisory lock*
do PostgreSQL (dois envios simultâneos não passam juntos de um limite):

1. limite por produtor por dia → `limite_produtor_diario`
2. limite diário global → `limite_diario`
3. limite mensal global → `limite_mensal`
4. no modo real, custo do mês + este SMS ≤ `SMS_MONTHLY_BUDGET` → `orcamento_esgotado`

O consumo vem do próprio histórico (SMS aceitos pelo provedor no dia/mês, no fuso de
Brasília). Cada modo tem sua conta: testes simulados ou no sandbox não consomem o orçamento
real. SMS recusado pelo provedor não conta. Bloqueios ficam no histórico com o motivo.

Os textos de SMS saem sem acentos (alfabeto GSM-7): um único "ç" ou "ã" faria a operadora
usar UCS-2, com 70 caracteres por segmento em vez de 160. Os alertas são montados para
caber em `SMS_MAX_SEGMENTS`.

## 12. Webhooks (opcional — exigem URL HTTPS pública)

A confirmação de entrega já funciona localmente por consulta periódica (a cada 5 min, até
3 dias após o envio). Os webhooks deixam a confirmação imediata, mas o provedor precisa
alcançar o backend por **HTTPS público** — no ambiente local, só com um túnel
(ex.: `cloudflared tunnel --url http://localhost:3001` ou `ngrok http 3001`).

- **Resend**: painel → Webhooks → Add endpoint →
  `https://<url-publica>/api/notificacoes/webhooks/resend`, eventos `email.*`. Copie o
  *signing secret* (`whsec_…`) para `RESEND_WEBHOOK_SECRET`. A assinatura (Svix) é validada
  e eventos repetidos são ignorados.
- **SMSGo**: configure a URL pela API e guarde o `secret` devolvido em `SMSGO_WEBHOOK_SECRET`:

```bash
TOKEN=$(curl -s https://api.smsgo.com.br/v1/auth/token -H "SMSGo-key: $SMSGO_API_KEY" | jq -r .token)
curl -s -X PUT https://api.smsgo.com.br/v1/account/webhook \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://<url-publica>/api/notificacoes/webhooks/smsgo"}'
```

Sem o segredo configurado, o endpoint responde `503` e não processa nada.

## 13. Diagnóstico de falhas

| `erro_codigo` | status | o que significa / o que fazer |
|---|---|---|
| `sem_consentimento` | bloqueado | o produtor não autorizou ou revogou o canal |
| `email_invalido`, `telefone_invalido` | bloqueado | contato ausente/inválido; SMS exige celular |
| `limite_produtor_diario`, `limite_diario`, `limite_mensal` | bloqueado | limite de frequência atingido |
| `orcamento_esgotado` | bloqueado | orçamento mensal do SMS acabou |
| `custo_nao_configurado`, `orcamento_nao_configurado` | bloqueado | defina `SMS_COST_PER_SEGMENT` e `SMS_MONTHLY_BUDGET` |
| `mensagem_longa` | bloqueado | texto acima de `SMS_MAX_SEGMENTS` |
| `configuracao_ausente` | falhou | variável obrigatória vazia ou provedor não suportado |
| `credencial_invalida` | falhou | chave recusada pelo provedor |
| `remetente_de_teste` | falhou | `onboarding@resend.dev` só entrega ao dono da conta: verifique um domínio |
| `dominio_nao_verificado` | falhou | o domínio de `EMAIL_FROM` não está verificado no Resend |
| `cota_excedida` | falhou | cota diária/mensal do plano Resend |
| `saldo_insuficiente` | falhou | recarregue a conta SMSGo |
| `requisicao_invalida` | falhou | dados recusados; o detalhe vem na mensagem |
| `falha_entrega` | falhou | o provedor confirmou que não entregou (bounce, número inexistente) |
| `falha_conexao`, `limite_taxa`, `erro_provedor`, `provedor_indisponivel`, `requisicao_em_andamento`, `erro_interno` | pendente → falhou | temporárias: nova tentativa automática; após o limite, `falhou` |
| `tentativas_esgotadas` | falhou | o envio caiu repetidamente durante o processamento |

Outros sinais:

- O log do backend mostra cada envio com o destino mascarado e o código do erro; nunca chaves.
- `[monitoramento] ... sem dados do Open-Meteo`: a API falhou para algum talhão; nada foi gerado.
- Cadastro recusando um CEP terminado em `-000`: o ViaCEP não tem CEP geral para cidades com
  CEP por logradouro — use o CEP da rua.

## 14. Decisões de projeto e limitações (para o TCC)

- **Consentimento (LGPD)**: opt-in explícito por canal, caixas desmarcadas, revogação a
  qualquer momento e trilha de auditoria. Reclamação de spam no e-mail revoga o canal.
- **Fila no PostgreSQL** (sem broker externo): `FOR UPDATE SKIP LOCKED` e trava com prazo
  dão concorrência segura e recuperação após queda, com a mesma infraestrutura do projeto.
- **Entrega "pelo menos uma vez"**: se o backend cair entre o aceite do provedor e a gravação
  no banco, a mensagem pode sair de novo. No e-mail, a `Idempotency-Key` do Resend evita a
  duplicata por 24 h; a API da SMSGo não oferece chave de idempotência, então essa janela
  (de milissegundos) continua existindo para SMS.
- **Aceito ≠ entregue**: o histórico só mostra "Entregue" com confirmação do provedor.
- **Região do risco**: os talhões são geocodificados pela cidade (Nominatim), então "região
  afetada" = município do talhão.
- **Twilio** permanece como alternativa legada (`SMS_PROVIDER=twilio`), sem consulta de entrega.
