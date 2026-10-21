# WhatsApp pela Evolution API — guia de operação

O Agro Alerta envia boas-vindas e alertas de geada pelo WhatsApp usando a
**Evolution API v2.3.7** (WhatsApp Web via Baileys). Existe **uma única instância**,
`agroalerta`, conectada ao WhatsApp do Agro Alerta (número terminado em **9503**).
O agricultor não conecta nada: só informa o celular e autoriza o recebimento.

```
ADMINISTRADOR                     AGRICULTOR                      AGRO ALERTA
Conecta o 9503 por QR Code   →    Cria conta, informa celular,  → Confirma o cadastro
(painel → Administração)          cadastra talhão e autoriza      Boas-vindas pelo 9503
Libera os envios                  o WhatsApp                      Monitora geada → alerta
```

## 1. Arquitetura

```
 navegador ──► frontend (5173) ──► backend (3001) ──► PostgreSQL do Agro Alerta (db)
                                      │  ▲
                 rede "whatsapp"      │  │ webhook com JWT (connection.update,
                                      ▼  │ messages.update, send.message)
                                 evolution-api (8080, sem porta publicada) ──► WhatsApp
                                      │
                 rede interna         ├── evolution-db (PostgreSQL 16.10, só da Evolution)
                 (sem internet)       └── evolution-redis (Redis 7.4.6, AOF)
```

| peça | onde | papel |
|---|---|---|
| `docker-compose.whatsapp.yml` | raiz | Evolution API, banco e Redis próprios, redes, volumes, segredos, health checks |
| `.env` (raiz) | não versionado | os 4 segredos (modelo: `.env.whatsapp.example`) |
| `backend/services/notificacoes/provedores/evolution.js` | backend | cliente HTTP da Evolution (endpoints conferidos no código da v2.3.7) |
| `backend/services/notificacoes/whatsapp.js` | backend | travas do despacho, estado para o painel, conectar/reconectar/desconectar |
| `backend/services/notificacoes/fila.js` | backend | fila persistente (e-mail e WhatsApp), resultado incerto, validade |
| `backend/services/notificacoes/statusEntrega.js` | backend | webhooks (JWT), recibos fora de ordem, duplicados |
| `backend/routes/admin.js` | backend | API do painel do administrador (`/api/admin/*`) |
| `frontend/dashboard.dc.html` → Administração | frontend | conexão, QR Code, controles, histórico, agricultores, registros |

Endpoints da Evolution usados: `POST /instance/create`, `GET /instance/connectionState/{i}`,
`GET /instance/fetchInstances`, `GET /instance/connect/{i}`, `POST /instance/restart/{i}`,
`DELETE /instance/logout/{i}`, `POST /webhook/set/{i}`, `GET /webhook/find/{i}`,
`POST /message/sendText/{i}`. Eventos de webhook: `CONNECTION_UPDATE`, `MESSAGES_UPDATE`,
`SEND_MESSAGE` (mensagens recebidas no 9503 **não** são assinadas).

## 2. Travas: quando uma mensagem sai

Uma mensagem de WhatsApp só sai com **todas** as travas abertas:

1. `WHATSAPP_SENDING_ENABLED=true` no `backend/.env` (trava da implantação; padrão `false`);
2. **Envios liberados** no painel (o padrão da migration é *bloqueado*);
3. tipo liberado no painel (**boas-vindas** e/ou **alertas automáticos**);
4. instância `agroalerta` conectada (`open`);
5. número conectado igual a `WHATSAPP_EXPECTED_SENDER` (padrão `9503`).

Com qualquer trava fechada, as mensagens **esperam na fila** (sem gastar tentativa) até a
validade: boas-vindas valem 7 dias; um alerta de geada vale até o fim do último dia de risco.
Vencida a validade, vira `expirado`. Bloquear no painel vale na hora, inclusive no meio de
uma rodada, sem reiniciar nada.

Ritmo (protege o número de bloqueio): 4 s entre mensagens, 30/hora, 100/dia e 5 por
agricultor/dia (`WHATSAPP_*` no `backend/.env`). Limite atingido adia, não descarta.

## 3. Estados de um envio no WhatsApp

| status | significado |
|---|---|
| `pendente` | na fila (com `erro_codigo`, o motivo de estar esperando) |
| `processando` | saindo agora (um despachante por vez) |
| `enviado` | **aceito pela Evolution API** — ainda não é entrega |
| `confirmado_servidor` | o servidor do WhatsApp recebeu (SERVER_ACK) |
| `entregue` | chegou no celular (DELIVERY_ACK) |
| `lido` | lido (READ) — só se o destinatário usa confirmação de leitura |
| `falhou` | erro definitivo (ex.: `numero_sem_whatsapp`, ERROR do WhatsApp) |
| `incerto` | a requisição pode ter saído e a resposta não voltou: **nunca é reenviada sozinha** |
| `bloqueado` | sem consentimento, celular inválido ou trocado depois da autorização |
| `cancelado` / `expirado` | retirado da fila / venceu a validade |

Recibos repetidos ou fora de ordem não rebaixam o estado; recibos que chegam antes da
resposta do envio ficam guardados e são aplicados quando o id da mensagem é gravado. Um
`incerto` se resolve sozinho (sem reenvio) se a Evolution emitir `send.message` com o mesmo
número e texto; caso contrário, o administrador confere no celular do 9503 e decide em
**Administração → Histórico → Reenviar…**. Os horários são os do recebimento pelo backend.

## 4. Instalação (primeira vez)

Pré-requisito: backup do banco atual (seção 9).

```bash
cp .env.whatsapp.example .env           # na raiz; o .gitignore já ignora ".env"
# preencha os 4 valores com: openssl rand -hex 32
```

No `backend/.env`, acrescente (veja `backend/.env.example`):

```
WHATSAPP_SENDING_ENABLED=false
WHATSAPP_EXPECTED_SENDER=9503
```

Suba tudo (o backend aplica a migration `002_whatsapp_evolution.sql` na subida):

```bash
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml ps      # evolution-api: healthy (até ~2 min)
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend npm run notificacoes:diagnostico
```

Crie o administrador (a conta precisa existir — cadastre-se pelo site antes):

```bash
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend npm run admin -- --promover seu-email@exemplo.com
```

Saia e entre de novo no painel: aparece o item **Administração**.

## 5. Conectar o remetente 9503

1. Painel → **Administração** → **Conectar WhatsApp**: cria a instância, configura o webhook
   (com JWT) e mostra o QR Code.
2. No celular **terminado em 9503**: WhatsApp → Configurações → *Aparelhos conectados* →
   *Conectar um aparelho* → aponte para o QR. O aparelho aparece como "Agro Alerta".
3. O painel atualiza sozinho: **Conectado**, número `(35) …-9503`, *Remetente: confere*.
   Se aparecer outro número, os envios ficam bloqueados: use **Desconectar número** e repita.
4. A sessão fica salva (PostgreSQL + Redis com AOF + volume `evolution_instances`): reinícios
   normais não pedem QR de novo. Só é preciso parear outra vez se o aparelho for
   desconectado no celular ou o WhatsApp encerrar a sessão — o painel avisa.

Privacidade: para responder a pedidos de reenvio do WhatsApp, a Evolution guarda no banco
dela as mensagens que passam pelo número (inclusive as recebidas no 9503). Contatos,
conversas antigas e histórico **não** são importados. Para produção, o ideal é um número
dedicado ao Agro Alerta.

## 6. Cadastrar o agricultor de teste (3362)

1. Em outra janela anônima, **Criar conta**: nome, e-mail próprio, CEP de rua (ex.: 37536-074),
   celular `(35) 9xxxx-3362` e marque **Autorizo o Agro Alerta a me enviar mensagens pelo WhatsApp**.
2. A conta é criada mesmo com a Evolution fora do ar; a boas-vindas entra na fila
   (`pendente`, aguardando liberação). Confira em Administração → Histórico.

## 7. Primeiro teste real (só com autorização explícita)

Opção A — mensagem de teste avulsa (não usa a fila, exige digitar `ENVIAR`):

```bash
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend \
  npm run notificacoes:testar-whatsapp -- --para "(35) 9xxxx-3362"
```

Opção B — o fluxo completo de boas-vindas:

1. Em Administração, cancele pendências antigas se houver (**Cancelar pendentes do WhatsApp**).
2. `WHATSAPP_SENDING_ENABLED=true` no `backend/.env` e recrie o backend:
   `docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml up -d backend`.
3. Em Administração, deixe **Alertas automáticos** desmarcado e marque **Envios liberados**.
4. Em até 15 s a boas-vindas sai: `Aceito pela API` → `Recebido pelo servidor` → `Entregue`
   (e `Lido`, se o 3362 tiver confirmação de leitura). Confira no celular do 3362 que o
   remetente é o 9503 e veja a linha do tempo do envio em `GET /api/admin/notificacoes/{id}/eventos`.

Para parar na hora: desmarque **Envios liberados**.

## 8. Ativar os alertas automáticos de geada (depois da validação)

1. `WEATHER_MONITOR_ENABLED=true` no `backend/.env` (padrão `false`) e recrie o backend.
   O primeiro ciclo roda 1 min depois e então a cada `WEATHER_MONITOR_INTERVAL_MINUTES`.
2. Em Administração, marque **Alertas automáticos de geada**.

Só talhões de agricultores com autorização vigente são consultados no Open-Meteo. O alerta
sai apenas para risco de geada (regra `cafe_geada`: mínima ≤ 5 °C = médio, ≤ 2 °C = alto),
com o dia, a hora prevista da mínima e a temperatura vindos da previsão; sem esses dados,
nenhuma mensagem afirma geada. Um alerta por episódio, talhão e destinatário; o mesmo risco
não se repete — só um agravamento ou o retorno após 24 h avisa de novo. Limitação: o motor de
regras avalia geada só para café.

## 9. Backup, restauração e rollback

Backup antes de qualquer migration (somente leitura):

```bash
docker compose exec db pg_dump -U agroalerta -d agroalerta -Fc -f /tmp/agroalerta.dump
docker compose cp db:/tmp/agroalerta.dump ./agroalerta-AAAA-MM-DD.dump
```

Rollback, do mais leve ao mais completo:

1. **Parar envios**: desmarcar *Envios liberados* (ou `WHATSAPP_SENDING_ENABLED=false`).
2. **Desligar a Evolution sem perder a sessão**:
   `docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml stop evolution-api evolution-db evolution-redis`
   e voltar a usar só `docker compose up -d` (sem o arquivo do WhatsApp). Não use `down -v`:
   isso apagaria os volumes da sessão.
3. **Voltar o código** para a branch anterior (`LuizHenrique`). A migration 002 é aditiva:
   o código antigo roda sobre o banco migrado (verificado com a suíte de integração antiga).
   Antes, cancele os envios de WhatsApp pendentes (o código antigo não os conhece).
4. **Desfazer o esquema** (só se o WhatsApp ainda não gerou dados — o script recusa e não muda
   nada se houver qualquer dado dele):
   ```bash
   docker compose exec -T db psql -U agroalerta -d agroalerta -v ON_ERROR_STOP=1 --single-transaction \
     < backend/migrations/rollback/002_whatsapp_evolution.down.sql
   ```
5. **Restaurar o backup** feito antes da migration, numa base vazia (`pg_restore --no-owner`).

## 10. Segurança

- Nenhuma porta da Evolution, do banco ou do Redis é publicada; banco e Redis não têm saída
  para a internet. O Manager e a documentação da Evolution ficam desligados.
- Segredos como Docker secrets: não aparecem em `docker inspect`, nos logs nem nos argumentos
  de processo (verificado no smoke test). A senha do Redis entra pela entrada padrão.
- `CORS_ORIGIN=*` é exigência da v2.3.7 para chamadas servidor a servidor (sem `Origin`);
  quem protege a API é a rede interna e a `apikey`.
- Webhook: JWT HS256 com validade de 10 min, instância conferida, eventos deduplicados e só
  recibos de mensagens enviadas por este sistema são guardados.
- O painel nunca recebe tokens, `apikey` ou o segredo do webhook (há teste para isso).
- Administrador só é criado pelo servidor (`npm run admin`); o cadastro do site não aceita esse papel.
- Logs da Evolution sem `VERBOSE`/`WEBHOOKS` (que copiariam o conteúdo das mensagens), em
  JSON do Docker com rotação (10 MB × 5).
