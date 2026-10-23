# Implantação Evolution API — 21/10/2026

Registro da implantação inicial, quando os envios estavam bloqueados. Para o estado
ativo posterior, consulte [ATIVACAO_EVOLUTION_API.md](ATIVACAO_EVOLUTION_API.md).

Branch: `feat/evolution-api-migration`. Sem commit, push ou merge.

## Ambiente principal

- Painel: **http://localhost:5173/whatsapp.html**.
- Backend: `http://localhost:3001/api/health`.
- Evolution API v2.3.7, PostgreSQL 16.10 e Redis 7.4.6, fixados por digest no Compose.
- Instância `agroalerta` criada, webhook autenticado configurado, estado `close`.
- Não foi solicitado pareamento, nem gerado QR real, nem enviada mensagem real.
- Remetente esperado: final **9503**; número diferente impede despacho.
- Evolution, seu banco e Redis não publicam portas no host.
- Volumes persistentes separados do PostgreSQL principal; Redis com AOF.
- `.env` da raiz criado com segredos exclusivos e permissão 0600, ignorado pelo Git.
- `AGROALERTA_WHATSAPP_SENDING_ENABLED=false` e `AGROALERTA_WEATHER_MONITOR_ENABLED=false`.
- Controle no banco: `envios_bloqueados=true`, `boas_vindas_ativas=false`, `alertas_ativos=false`.

`backend/.env` foi preservado. Os valores seguros do overlay Docker têm precedência
sobre configurações antigas desse arquivo. Escanear QR não autoriza mensagens.

## Administrador e acesso

Antes da promoção foi confirmada a conta existente: identificador preservado no registro local,
e-mail **<EMAIL_ADMINISTRATIVO_PRIVADO>**, então com papel `produtor`. Apenas essa conta recebeu
papel `admin`, usando o comando administrativo do backend e com registro de auditoria.
Sua senha, salt, contatos e demais campos foram comparados com o backup e preservados.
Não foram criados usuários no banco principal; a outra conta manteve sua permissão.

O smoke test no Chrome usou sessões já existentes, sem obter ou modificar senhas:

- `<EMAIL_ADMINISTRATIVO_PRIVADO>`: página carregada, painel visível, Evolution disponível e API administrativa HTTP 200.
- Produtor: painel oculto e API administrativa HTTP 403.
- Sem sessão: API administrativa HTTP 401.

## Funcionalidades

A integração Evolution, a fila PostgreSQL, o cadastro com consentimento próprio,
o monitoramento climático e o painel integrado já existiam no código da branch
de origem e foram validados. A implementação nesta branch acrescentou:

- Página dedicada `/whatsapp.html` com login, status, QR, remetente, bloqueio,
  contadores e histórico de recibos; layout validado em tela de 390 px.
- Configuração pública da URL do backend em `/config.js`, para separar ambientes.
- Texto exato das boas-vindas solicitado e orientação preventiva nos alertas.
- Migration 003 com padrões de implantação bloqueados; decisões administrativas
  previamente auditadas são preservadas.
- Exclusão concorrente do monitoramento pelo PostgreSQL, evitando episódios
  duplicados entre processos do backend.
- Preparação sem pareamento: `npm run whatsapp:preparar`.
- Compose isolado e smoke tests reais/Chrome reproduzíveis.
- Build com `npm ci` e exclusão de variantes de `.env` e backups da imagem.

Boas-vindas são enfileiradas uma vez por conta autorizada. Alertas WhatsApp só são
gerados quando o motor identifica geada com dados previstos de dia, temperatura e
localização. A regra de geada atual atende café. Revogação e troca de telefone
invalidam o despacho. Resultados incertos não são reenviados automaticamente.

## Testes executados

| Verificação | Resultado |
|---|---|
| Unitários | **149 aprovados** |
| Integração PostgreSQL fictício + HTTP + Evolution falsa | **112 aprovados** |
| Evolution Docker real isolada | Autenticação, criação da instância, estado e webhook aprovados |
| Reinício da Evolution, PostgreSQL e Redis isolados | Instância e webhook persistiram; health checks saudáveis |
| Cliente do backend com Evolution real | Instância localizada e webhook configurado, sem QR ou envio |
| Chrome isolado | Login admin, bloqueios, API real, QR fictício interceptado, layout móvel, produtor sem permissão |
| Chrome no principal | Conta autorizada acessa; produtor e anônimo recusados; sem QR real |
| Credenciais/rede | Segredos Evolution ausentes do Docker inspect; serviços internos sem portas; imagem backend sem `.env` |
| Backup/restauração | Dump completo restaurado em outra base; migrations aplicadas com sucesso na cópia |
| Rollback | Imagem anterior iniciou sobre a cópia migrada, health OK e WhatsApp bloqueado; depois foi parada |
| Integridade principal | Todos os registros originais preservados em **23 tabelas** |

Os containers de validação foram parados ao final, mantendo os volumes. O ambiente principal continua ativo.
Os testes automatizados usaram dados fictícios e bases terminadas em `_teste`.
A cópia do banco principal foi usada separadamente para restauração, compatibilidade
e comparação, sem despacho real.

### Ocorrência registrada

Ao iniciar o novo backend, a pendência legada de **e-mail ID 2** passou de `pendente`
para `simulado`, com um novo evento de histórico. Não houve chamada de envio externo.
Seu conteúdo e os registros anteriores foram preservados. A comparação de integridade
considerou explicitamente essa atualização de processamento e a promoção autorizada;
nenhum consentimento, mensagem, recibo legado ou cadastro foi excluído.

## Backup e rollback

Backups locais protegidos e ignorados pelo Git:

- `.local/evolution-validation/agroalerta-before.dump`
- `.local/evolution-validation/agroalerta-predeploy.dump` — inclui a conta admin já cadastrada, antes da promoção.
- `.local/evolution-validation/images-before.txt` — IDs das imagens anteriores.

Imagens preservadas:

- `agroalerta-backend:before-evolution-20261021`
- `agroalerta-frontend:before-evolution-20261021`

Nenhum volume ou serviço antigo foi removido definitivamente. Tabelas WhatsApp
legadas, históricos SMS, consentimentos e imagens antigas continuam disponíveis.
O container ativo do backend foi atualizado; as implementações antigas podem ser
recuperadas pelas imagens preservadas e pelo histórico Git.

Para interromper o WhatsApp, mantenha as flags de implantação falsas e o bloqueio
administrativo ligado. Para rollback de código, preserve o banco migrado e crie um
override local apontando para as imagens anteriores, com:

```yaml
services:
  backend:
    image: agroalerta-backend:before-evolution-20261021
    environment:
      WHATSAPP_SENDING_ENABLED: "false"
      EMAIL_SENDING_ENABLED: "false"
      SMS_SENDING_ENABLED: "false"
      WEATHER_MONITOR_ENABLED: "false"
      NOTIFICATION_PRIMARY_CHANNEL: whatsapp
  frontend:
    image: agroalerta-frontend:before-evolution-20261021
```

Use esse override com `docker-compose.yml`, `--no-build`, e recrie somente backend
e frontend. Pare a Evolution se necessário, preservando seus volumes. A imagem antiga
foi validada na cópia migrada com essas travas. Não restaure dumps sobre o banco ativo
nem reverta migrations após haver novos dados sem uma análise específica.
**Não use `down -v`**. Um rollback não autoriza ativar o serviço Baileys ou SMS antigo.

## Próxima ação do proprietário

1. Abra **http://localhost:5173/whatsapp.html**.
2. Entre com `<EMAIL_ADMINISTRATIVO_PRIVADO>` e a senha existente.
3. Clique em **Conectar e mostrar QR Code**.
4. No celular terminado em **9503**, use WhatsApp → **Aparelhos conectados → Conectar um aparelho**.
5. Escaneie e aguarde **Conectado**, número correto e remetente validado.

A sessão tem armazenamento persistente, mas a persistência de uma **sessão pareada**
ainda não foi testada: depende desse pareamento voluntário. Instância e webhook não
pareados persistiram no teste de reinício. O WhatsApp pode encerrar uma sessão e
exigir novo QR; esta conexão via Baileys/Evolution não é a API oficial da Meta.

Envios reais exigem autorização posterior e liberação das travas de implantação e
administração. Nenhuma dessas liberações foi feita nesta implantação.
