# Ativação operacional — 21/10/2026

Painel: **http://localhost:5173/whatsapp.html**. Branch
`feat/evolution-api-migration`, sem commit, push ou merge.

## Autorização e teste real

O proprietário autorizou envio real, boas-vindas automáticas, monitoramento e alertas
reais de geada, sem confirmação por mensagem. A ativação foi condicionada à entrega
de um teste único e à retenção das pendências anteriores.

O teste ID **4**, da autorização anterior, já estava entregue quando a execução foi
retomada. Não foi reenviado como recuperação da interrupção.

Nesta nova autorização houve **uma única transmissão de teste**, ID **5**, usando
Evolution API, instância `agroalerta`:

- Remetente: **final 9503**.
- Destinatária: **final 3362**, consentimento WhatsApp vigente.
- Texto: “Agro Alerta: mensagem de teste. Se você a recebeu, a integração com o WhatsApp está funcionando.”
- ID da Evolution: `<ID_PROVEDOR_NO_HISTORICO_PRIVADO>`.
- Uma tentativa, sem reenvio e sem digitar `ENVIAR`.

| Estado registrado no PostgreSQL | Horário de Brasília em 21/10/2026 |
|---|---|
| Aceito pela Evolution (`enviado`) | 20:05:46.155 |
| Confirmação do servidor (`confirmado_servidor`) | 20:05:46.796 |
| Entrega ao destinatário (`entregue`) | 20:05:47.241 |
| Leitura (`lido`) | Não recebida na conferência inicial |

Os eventos autenticados `send.message` e `messages.update` foram associados ao envio
no PostgreSQL. A entrega foi comprovada antes de liberar as automações. A ausência
de leitura não invalida o recibo de entrega.

O script administrativo aceita `--autorizado --administrador <EMAIL_ADMINISTRATIVO_PRIVADO>` para
um teste previamente autorizado, sem prompt. Exige acesso ao servidor, conta admin,
consentimento vigente, remetente/conexão válidos e limites de envio. A autorização é
auditada. Não foi criado endpoint público para disparar testes. O modo diagnóstico
interativo continua disponível; o fluxo normal automático nunca exige `ENVIAR`.

## Configuração efetiva

| Configuração | Estado |
|---|---|
| `.env`: `AGROALERTA_WHATSAPP_SENDING_ENABLED` | `true` |
| Backend Docker: `WHATSAPP_SENDING_ENABLED` | `true` |
| `.env`: `AGROALERTA_WEATHER_MONITOR_ENABLED` | `true` |
| Backend Docker: `WEATHER_MONITOR_ENABLED` | `true` |
| Remetente esperado | Número completo `<REMETENTE_COMPLETO_NO_ENV_PRIVADO>` |
| Instância | `agroalerta`, conectada |
| Controle `envios_bloqueados` | `false` |
| Controle `boas_vindas_ativas` | `true` |
| Controle `alertas_ativos` | `true` |
| Worker PostgreSQL | Ativo, intervalo de 15 segundos |
| Monitoramento real Open-Meteo | Ativo, intervalo de 60 minutos |
| Serviço WhatsApp antigo | Parado, preservado |
| SMSGo | Não utilizado pelo fluxo atual |

A liberação administrativa ocorreu às **20:06:51**, com auditoria atribuída à conta
administradora autorizada. Os segredos foram preservados e continuam fora do Git.
O Compose efetivo utiliza `docker-compose.yml` + `docker-compose.whatsapp.yml`.
Reinícios normais preservam essas configurações e o controle no banco.

## Retenção sem disparo de mensagens antigas

A migration aditiva `004_whatsapp_retencao.sql` acrescenta `retido_em` e
`retencao_motivo`. O worker não reserva nem expira mensagens retidas. O registro
original e sua chave de idempotência continuam no banco.

- **ID 3:** boas-vindas histórica, continua `pendente`, retida, zero tentativas.
- **ID 7:** boas-vindas criada às 20:06:02, antes da liberação, também retida e sem
  tentativa. Foi preservada para impedir o envio de pendências anteriores.

Nenhuma dessas mensagens foi cancelada, apagada, simulada ou transmitida nesta
ativação. Novos registros produzidos após a liberação entram na fila normalmente.
Não foi executado disparo em massa nem liberação retroativa de pendências.

## Comprovação do fluxo

- Cadastro e consentimento: enfileiramento transacional, uma boas-vindas por conta
  autorizada, validação do telefone e consentimento reavaliado no despacho.
- Fila: reserva com `SKIP LOCKED`, exclusão concorrente, idempotência e recuperação
  de reinicializações. Resultado incerto não provoca reenvio automático.
- Geada: o ciclo real consultou **três talhões**, sem falha do Open-Meteo,
  **zero riscos novos e zero mensagens geradas**. O ciclo periódico também gravou
  leituras reais em torno de 20:07:23; não depende de execução manual.
- Não foram criados produtores fictícios no banco principal para demonstrar envios.
  O fluxo de novos cadastros foi testado com banco e provedor isolados.
- A regra de geada atual é de café. Mensagens dependem de risco real identificado,
  localização e dados de previsão; nenhuma previsão ou alerta fictício foi gerado.
- Limites: 4 segundos entre tentativas, 30/hora, 100/dia, 5 por produtor/dia.
- A conexão e o remetente são reconferidos antes de cada mensagem, inclusive
  depois da espera de ritmo. Queda ou número divergente interrompe novos envios.
- Cancelamento, consentimento, retenção e bloqueio administrativo continuam válidos.
- Painel Chrome: conexão ativa, automações habilitadas, retenções visíveis;
  produtor sem permissão recebe HTTP 403 nas funções administrativas.

## Testes e operação

**151 testes unitários e 117 testes de integração aprovados**, usando dados fictícios
e PostgreSQL isolado. Incluem retenção com a fila liberada, novos envios sem prompt,
revogação, prevenção de duplicidade e interrupção por desconexão ou remetente
divergente no meio de uma rodada. A única transmissão real desta ativação foi o
teste ID 5; novos envios automáticos legítimos estão autorizados a partir da liberação.

Backup anterior à ativação:
`.local/evolution-validation/agroalerta-before-activation.dump`.
Configuração anterior protegida:
`.local/evolution-validation/env-before-activation`.
Nenhum volume, histórico ou serviço legado foi removido definitivamente.

Para interromper imediatamente novos despachos, use **Bloquear todos os envios
agora** no painel. A liberação posterior continua exigindo permissão administrativa.
WhatsApp pode encerrar a sessão e exigir reconexão; leitura depende dos recibos
disponíveis. O relatório de entrega não pressupõe leitura.
