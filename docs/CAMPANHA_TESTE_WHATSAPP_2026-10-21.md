# Campanha real de teste — 21/10/2026

Campanha: `8cd6f1ba-fc7a-4acf-a118-ef9c4dcc05d0`.
Execução expressamente autorizada pelo proprietário, sem confirmação individual.
Instância exclusiva `agroalerta`, remetente conectado terminado em **9503**.

## Destinatários e resultados

- Produtores encontrados no PostgreSQL principal: **2**.
- Produtores com consentimento WhatsApp atual e válido: **2**.
- Números distintos elegíveis: **2**.
- Mensagens aceitas pela Evolution: **2**.
- Confirmadas pelo servidor: **2**.
- Entregues: **2**.
- Leitura confirmada na conferência final: **0**.
- Falhas: **0**.
- Resultados incertos: **0**.
- Mensagens sem confirmação de entrega: **0**.
- Destinatários impedidos por limites ou revogação durante esta execução: **0**.

| Número mascarado | Envio PostgreSQL | Aceitação — Brasília | Entrega — Brasília | Tentativas |
|---|---|---|---|---|
| (35) 9****-3362 | 8 | 20:13:57.338 | 20:13:58.009 | 1 |
| (12) 9****-6164 | 9 | 20:14:01.621 | 20:14:04.943 | 1 |

Os recibos autenticados de `messages.update` foram processados e associados aos
envios no PostgreSQL. Entrega não pressupõe leitura; não havia recibos de leitura
na conferência realizada após a campanha.

## Mensagem transmitida

🌱 Agro Alerta — Teste de Notificações

Olá! Estamos realizando um teste do sistema Agro Alerta.

Seu WhatsApp está cadastrado para receber notificações autorizadas sobre as condições climáticas e riscos de geada na sua propriedade.

Esta é apenas uma mensagem de teste. Não representa um alerta climático real.

## Proteções verificadas

- Consulta exclusiva de contas com papel `produtor`, usando a última decisão de
  consentimento do canal WhatsApp. Nenhum consentimento foi criado ou alterado.
- Deduplicação por telefone normalizado; consentimento e contato reconsultados
  imediatamente antes de cada despacho, depois de qualquer espera de ritmo.
- Remetente e conexão revalidados antes de cada mensagem; webhook conferido.
- Chave única `campanha:<identificador>:whatsapp:<telefone-normalizado>` para cada
  número. Cada envio ficou com uma única tentativa e `max_tentativas=1`.
- Uso da mesma trava PostgreSQL do worker WhatsApp e dos limites existentes:
  4 segundos entre tentativas, 30/hora, 100/dia e 5 por produtor/dia.
- Não houve reenvio. A retomada com o mesmo identificador não transmite novamente
  registros existentes; uma reserva interrompida é tratada como incerta.
- Reservas e auditoria registradas antes do despacho; resultados e recibos no banco.
- IDs **3 e 7** continuam `pendente`, com retenção persistente, zero tentativas e
  sem data de envio. Nenhuma boas-vindas histórica foi liberada.
- As automações já autorizadas continuam ativas, com os mesmos controles e flags.
- Não foram alteradas configurações nem reiniciados containers. O script foi copiado
  para o backend existente e executado com autorização administrativa do servidor.
- SMSGo e o serviço WhatsApp antigo não foram utilizados. Nenhum risco climático
  foi criado para a campanha.

Script: `backend/scripts/campanha-whatsapp.js`. Os dois testes de seleção,
deduplicação e conteúdo exato passaram antes da execução. O identificador desta
campanha está registrado na auditoria administrativa e nas chaves dos despachos.
Uma campanha com outro identificador exige nova autorização; esta execução terminou.
