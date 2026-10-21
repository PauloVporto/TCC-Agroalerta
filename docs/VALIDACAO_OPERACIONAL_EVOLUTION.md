# Preparação do primeiro envio real — 21/10/2026

Registro histórico da preparação. A ativação posterior e os comprovantes de entrega
estão em [ATIVACAO_EVOLUTION_API.md](ATIVACAO_EVOLUTION_API.md).

## Estado confirmado no ambiente principal

- Evolution API disponível, instância `agroalerta` em `open`.
- Remetente conectado: **final 9503**, compatível com o remetente padrão.
- Destinatário único no cadastro: **Produtora com consentimento**, **final 3362**, usuário 4.
- Consentimento atual WhatsApp concedido para esse número, origem `painel`, registrado
  em **21/10/2026 às 19:59:40, horário de Brasília**. Na primeira consulta havia apenas
  consentimento legado; durante a preparação apareceu o consentimento no canal atual.
  Nenhum consentimento foi criado ou convertido pelo agente.
- Webhook autenticado configurado e em dia; eventos reais `connection.update` registrados.
- Serviço WhatsApp antigo preservado e parado; cliente de envio atual usa Evolution.
- Envios da implantação desativados; controle administrativo bloqueado;
  boas-vindas e alertas desativados; monitoramento automático desativado.

## Teste preparado, ainda não transmitido

Mensagem exata:

> Agro Alerta: mensagem de teste. Se você a recebeu, a integração com o WhatsApp está funcionando.

Será **uma única mensagem** do 9503 para o 3362. A confirmação do usuário é uma condição
obrigatória antes da chamada de envio. Não habilita a fila ou o monitoramento.

O script `backend/scripts/testar-whatsapp.js` foi reforçado para:

1. Exigir um único cadastro para o número e consentimento WhatsApp atual e vigente.
2. Mostrar remetente, destinatário e texto antes de pedir `ENVIAR`.
3. Conferir novamente o consentimento após a confirmação.
4. Revalidar conexão e remetente após a confirmação.
5. Registrar a tentativa no PostgreSQL e acompanhar recibos pelo webhook.

Foi executado com entrada encerrada, para validar a preparação: mostrou os dados,
confirmou consentimento e **cancelou sem enviar**. Não há teste Evolution transmitido
nem comprovação de entrega/leitura nesta etapa. Consentimento do destinatário não
substitui a confirmação do operador exigida para este teste.

Após confirmação explícita, executar o script dentro do backend e confirmar uma
única vez. Um timeout ou resultado incerto impede repetição automática; conferir
histórico e celular antes de qualquer nova tentativa.

## Validação após o envio autorizado

- Aceitação da Evolution deve gravar `provedor_id`, remetente e estado `enviado`.
- Conferir eventos autenticados `send.message` / `messages.update` e a associação
  ao envio, sem rebaixar estados por recibos atrasados ou duplicados.
- `confirmado_servidor` não comprova chegada ao celular: aguardar `entregue`.
- `lido` depende das confirmações de leitura do destinatário; sua ausência não
  significa que a mensagem não chegou.
- Se não houver recibo, verificar webhook, registro do provedor e confirmação no
  aparelho do destinatário. Não declarar entrega sem evidência.

## Cadastro, fila e monitoramento

O consentimento atual originou a boas-vindas WhatsApp **ID 3**, `pendente`, usuário 4.
Ela continua retida pelas travas. Não foi descartada, simulada ou transmitida.
Antes de autorizar automações para **novos produtores**, revisar essa pendência
anterior para evitar enviar uma boas-vindas antiga sem decisão explícita.

A fila usa PostgreSQL, chave de idempotência única, reserva com `SKIP LOCKED`,
despacho WhatsApp exclusivo e limites persistentes. Revogação cancela pendências;
o consentimento e o contato são reavaliados no despacho. Resultados incertos não
são reenviados automaticamente. O monitoramento possui trava no PostgreSQL para
evitar ciclos simultâneos entre processos.

Foi consultado o Open-Meteo real para a propriedade de café na localização cadastrada:
**7 dias de previsão, mínima de 13,3 °C, nenhum alerta identificado** naquele momento.
A consulta foi somente leitura: não executou o ciclo de monitoramento, não gerou
alerta nem mensagem. A regra de geada atual atende café; outras culturas não
ganham regras agronômicas automaticamente.

## Ativação preparada, condicionada a nova autorização

Somente depois de comprovar o teste real e receber autorização específica:

1. Revisar consentimentos e pendências anteriores. Decidir explicitamente sobre
   a boas-vindas ID 3 antes de liberar o tipo para novos produtores.
2. Autorizar a flag de implantação `AGROALERTA_WHATSAPP_SENDING_ENABLED` e recriar
   somente o backend. A trava administrativa permanece fechada nessa etapa.
3. Autorizar boas-vindas no controle administrativo e liberar envios apenas para
   o tipo autorizado; alertas permanecem desativados se ainda não autorizados.
4. Para geada, autorizar separadamente `AGROALERTA_WEATHER_MONITOR_ENABLED` e o
   controle `alertas_ativos`. Só previsões reais com risco identificado geram alertas.
5. Acompanhar fila, recibos e falhas. Bloquear pelo painel em caso de indisponibilidade
   ou remetente divergente; não recorrer a SMSGo ou ao serviço WhatsApp antigo.

Nenhuma flag de ativação ou controle de liberação foi alterado nesta preparação.
A confirmação do teste não autoriza mensagens automáticas futuras.

## Verificação executada nesta etapa

- **151 testes unitários aprovados**, incluindo recusa de consentimento ausente,
  revogado, concedido para outro número e cadastro ambíguo.
- **112 testes de integração aprovados** em PostgreSQL isolado com dados fictícios:
  cadastro, consentimento, fila, duplicidade, cancelamento, falhas, webhooks,
  recibos e monitoramento. Nenhum teste automatizado transmitiu mensagens reais.
- Script atualizado disponibilizado no backend principal; execução preparatória
  cancelada antes da transmissão.
- Banco de testes parado ao final, preservando seus dados e volumes.

Pendente: confirmação explícita do teste, envio real único, evidência de entrega e
registro dos recibos desse envio. Depois disso, autorização distinta para automações.
