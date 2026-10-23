# Notificações por e-mail (Resend) e WhatsApp (Evolution API)

Como o Agro Alerta avisa o agricultor — boas-vindas no cadastro e alertas de risco climático —,
como configurar e testar cada canal e como diagnosticar falhas. A operação do WhatsApp
(instalação, pareamento do número 9503, teste real, ativação dos alertas, rollback) está em
[`WHATSAPP_EVOLUTION.md`](WHATSAPP_EVOLUTION.md).

> O SMS (SMSGo/Twilio) foi substituído pelo WhatsApp. O histórico e os consentimentos de SMS
> continuam no banco, só para consulta: consentimento de SMS **não** autoriza WhatsApp.

## 1. Como funciona

```
Cadastro / Configurar conta                     Monitoramento climático (desligado por padrão)
  celular com DDD, CEP                            Open-Meteo: previsão 7 dias (+ hora da mínima)
  [ ] e-mail   [ ] WhatsApp  (desmarcados)        │  só talhões de quem tem autorização vigente
        │                                         ▼
        ▼                                       leituras_clima → motor de regras → alertas_gerados
  notificacao_consentimentos                      │ episódio novo (ou agravado)
  (uma linha por decisão; no WhatsApp,            ▼
   vale para o número autorizado)          e-mail: todos os riscos · WhatsApp: só geada
        │                                         │
        └──────────►  notificacao_envios  ◄───────┘   (fila persistente + histórico + validade)
                              │
          fila automática (15 s e logo após cada cadastro/alerta), relê consentimento e contato
                              │
            Resend (e-mail) · Evolution API, instância "agroalerta" (WhatsApp)
                              │
     recibos: consulta periódica (e-mail) e webhooks (Resend opcional; Evolution com JWT)
                              │
       painel → Notificações (agricultor) · Administração (administrador)
```

- **Consentimento explícito e por canal**: caixas desmarcadas; cada decisão vira uma linha em
  `notificacao_consentimentos` (trilha de auditoria). Sem linha, o canal está desautorizado.
  No WhatsApp a autorização vale para o celular informado nela: trocou de número, precisa
  autorizar de novo (o painel renova ao salvar). Revogar cancela o que estava na fila.
- **Reverificação antes de cada envio**: consentimento e contato são relidos na hora do envio.
- **Boas-vindas uma única vez por canal e conta** (`boas_vindas:<canal>:usuario:<id>`). No
  WhatsApp, saem na primeira autorização da conta (no cadastro ou depois) e valem 7 dias.
  Entrar de novo ou atualizar o cadastro não gera outra.
- **Alertas sem repetição**: cada risco é um episódio em `alertas_gerados`; só avisa de novo
  se o risco **subir de nível** ou **voltar** após 24 h. WhatsApp: uma mensagem por episódio,
  talhão e destinatário (`alerta:<episódio>:whatsapp`), só para geada, com validade até o fim
  do último dia de risco.
- **Só dados reais**: sem previsão do Open-Meteo, nada é gerado; sem dia, temperatura e local
  da geada, nenhuma mensagem de WhatsApp afirma o risco.

### Estados de um envio

| status | significado |
|---|---|
| `pendente` | na fila; com `erro_codigo`, o motivo da espera (trava fechada, limite, nova tentativa) |
| `processando` | reservado pela fila (trava de 2 min) |
| `simulado` | e-mail em modo simulado — nada saiu do sistema |
| `enviado` | **aceito pela API** do provedor (ainda não é entrega) |
| `confirmado_servidor` | WhatsApp: recebido pelo servidor do WhatsApp |
| `entregue` | o provedor **confirmou** a entrega |
| `lido` | WhatsApp: lido (depende da confirmação de leitura do destinatário) |
| `falhou` | falha definitiva, tentativas esgotadas ou entrega recusada |
| `bloqueado` | barrado antes de sair: sem consentimento ou contato inválido |
| `incerto` | WhatsApp: pode ter saído, sem confirmação — nunca reenviado automaticamente |
| `cancelado` / `expirado` | retirado da fila / venceu a validade |

Cada mudança de estado fica em `notificacao_eventos` (linha do tempo auditável).

## 2. Modos de cada canal

| canal | modo | quando |
|---|---|---|
| e-mail | **simulado** | `EMAIL_SENDING_ENABLED=false` (padrão): fila e histórico funcionam, sem chamada externa |
| e-mail | **real** | `EMAIL_SENDING_ENABLED=true` |
| WhatsApp | **desativado** | `WHATSAPP_SENDING_ENABLED=false` (padrão): as mensagens esperam na fila |
| WhatsApp | **nao_configurado** | trava aberta, mas sem `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` |
| WhatsApp | **real** | trava aberta e Evolution configurada; o painel do administrador decide o que sai |

`GET /api/health` mostra `modoEmail`, `modoWhatsapp` e `monitoramentoClimatico`.

## 3. Variáveis de ambiente (`backend/.env`)

| variável | padrão | descrição |
|---|---|---|
| `EMAIL_PROVIDER` | `resend` | único provedor de e-mail suportado |
| `EMAIL_SENDING_ENABLED` | `false` | `true` liga o envio real de e-mail |
| `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` | — | Resend (seção 5) |
| `WHATSAPP_SENDING_ENABLED` | `false` | trava da implantação do WhatsApp |
| `WHATSAPP_EXPECTED_SENDER` | — | número (ou final, ex.: `9503`) que deve estar conectado; vazio bloqueia tudo |
| `WHATSAPP_MIN_INTERVAL_MS` | `4000` | intervalo mínimo entre mensagens |
| `WHATSAPP_HOURLY_LIMIT` / `WHATSAPP_DAILY_LIMIT` | `30` / `100` | mensagens por hora / dia (todos os agricultores) |
| `WHATSAPP_PER_USER_DAILY_LIMIT` | `5` | mensagens por agricultor por dia |
| `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_URL` | — / `agroalerta` | definidas pelo `docker-compose.whatsapp.yml` |
| `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` (ou `*_FILE`) | — | segredos; no Docker vêm de `/run/secrets` |
| `EVOLUTION_REQUEST_TIMEOUT_MS` | `30000` | tempo limite das chamadas à Evolution |
| `NOTIFICATION_QUEUE_INTERVAL_MS` | `15000` | intervalo da fila |
| `NOTIFICATION_MAX_ATTEMPTS` | `5` | tentativas por envio (esperas de 1, 5, 15 e 60 min) |
| `WEATHER_MONITOR_ENABLED` | `false` | liga o monitoramento climático automático (só com autorização) |
| `WEATHER_MONITOR_INTERVAL_MINUTES` | `60` | intervalo entre ciclos (o primeiro roda 1 min após subir) |

## 4. Testes automatizados (provedores falsos, sem custo)

```bash
cd backend
npm test                     # unidade (sem banco)

# Integração: PostgreSQL de teste separado e descartável
docker run -d --rm --name agroalerta-pg-teste -e POSTGRES_USER=agroalerta \
  -e POSTGRES_PASSWORD=agroalerta -e POSTGRES_DB=agroalerta_teste \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgres://agroalerta:agroalerta@127.0.0.1:55432/agroalerta_teste
npm run test:integracao      # inclui uma Evolution API falsa (HTTP de verdade) e webhooks com JWT
npm run test:cobertura
docker stop agroalerta-pg-teste
```

No PowerShell, use `$env:TEST_DATABASE_URL="postgres://..."`. As suítes de integração
**apagam os dados** entre testes, por isso só rodam num banco cujo nome termina em `_teste`.

## 5. Configurar o Resend

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
estourada aparece como `cota_excedida`. O webhook do Resend é opcional (exige URL HTTPS
pública): `https://<url-publica>/api/notificacoes/webhooks/resend`, segredo em `RESEND_WEBHOOK_SECRET`.

## 6. Testes reais individuais e diagnóstico

```bash
# Diagnóstico — somente leitura, não envia nada
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend npm run notificacoes:diagnostico

# UM e-mail (sem domínio verificado: só para o e-mail dono da conta Resend)
docker compose exec backend npm run notificacoes:testar-email -- --para voce@exemplo.com

# UMA mensagem de WhatsApp pelo número conectado (confere o remetente; exige digitar ENVIAR)
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend \
  npm run notificacoes:testar-whatsapp -- --para "(35) 99999-0000"
```

Os scripts mostram tudo antes, enviam uma única mensagem, registram o resultado (tipo `teste`)
e acompanham a entrega por até 1 minuto. Não usam a fila nem consultam agricultores.

## 7. Diagnóstico de falhas

| `erro_codigo` | status | o que significa / o que fazer |
|---|---|---|
| `sem_consentimento` | bloqueado | o agricultor não autorizou o canal ou revogou |
| `telefone_alterado` | bloqueado | o celular mudou depois da autorização do WhatsApp |
| `email_invalido`, `telefone_invalido` | bloqueado | contato ausente/inválido; WhatsApp exige celular |
| `envios_bloqueados` | pendente | o administrador bloqueou durante a rodada |
| `limite_produtor_diario`, `limite_por_hora`, `limite_diario` | pendente | ritmo do WhatsApp: adiado, não descartado |
| `numero_sem_whatsapp` | falhou | o número não tem conta no WhatsApp |
| `falha_entrega` | falhou | o provedor confirmou que não entregou |
| `sem_resposta`, `resultado_incerto` | incerto | pode ter saído: confira no 9503 antes de reenviar pelo painel |
| `falha_conexao`, `credencial_invalida`, `instancia_inexistente`, `erro_provedor` | pendente → falhou | comprovadamente antes do envio: nova tentativa automática |
| `validade_vencida` | expirado | a mensagem não saiu a tempo (ex.: a noite da geada já passou) |
| `remetente_de_teste`, `dominio_nao_verificado`, `cota_excedida` | falhou | Resend (seção 5) |

O log do backend mostra cada envio com o destino mascarado e, quando o WhatsApp fica retido,
o motivo (uma linha por mudança). Nunca mostra chaves.

## 8. Decisões de projeto e limitações (para o TCC)

- **Consentimento (LGPD)**: opt-in explícito por canal, caixas desmarcadas, revogação a
  qualquer momento, trilha de auditoria; no WhatsApp, vinculado ao número autorizado.
- **Fila no PostgreSQL**: `FOR UPDATE SKIP LOCKED`, trava com prazo e, no WhatsApp, um
  despachante exclusivo (advisory lock) — concorrência segura e recuperação após queda.
- **Sem reenvio às cegas**: a Evolution API não tem chave de idempotência; por isso, quando a
  mensagem pode ter saído, o envio fica `incerto` e só o administrador decide reenviar. No
  e-mail, a `Idempotency-Key` do Resend permite retentar com segurança.
- **Aceito ≠ entregue ≠ lido**: cada etapa só aparece com o recibo do próprio WhatsApp.
- **WhatsApp não oficial**: a Evolution usa o WhatsApp Web (Baileys), não a API oficial da
  Meta; o ritmo limitado reduz o risco de bloqueio do número, mas não o elimina.
- **Região do risco** = município do talhão (geocodificação pela cidade). Geada só é avaliada
  para café no motor de regras atual.
