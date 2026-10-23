# Integração e ativação do boletim e dos alertas — 21/10/2026

## Publicação

- Implementação: `74ca3f7b96a4e712ffdb1b6acaae936f583a477b`.
- Merge: `ef40e1894bdd14b9b083ea024ed5277bfb13567f`.
- Push da origem `feat/boletim-diario-alertas-climaticos`: concluído.
- Push da integração `feat/evolution-api-migration`: concluído, sem force push.
- Branch final: `feat/evolution-api-migration`.
- `main` e `origin/main` permaneceram em
  `35376fe17e46756f03bcf39e5ce95298fab34501`. Nenhum merge ou PR para main.
- Quarenta arquivos da implementação revisados; nenhum `.env` privado, segredo,
  sessão, backup ou dado pessoal de produtor incluído. Apenas exemplos públicos
  de configuração. `git diff --check` aprovado.

## Validação e preservação

Antes da integração: **162 testes unitários, 135 de integração e 25 verificações
Chrome aprovados**. Após merge: **162 unitários e 135 de integração aprovados**;
Compose válido, código do merge idêntico ao da branch de origem.
Testes automatizados exclusivamente com PostgreSQL isolado e Evolution simulada.

Backup completo protegido em `.local/clima-activation/predeploy.dump`, ignorado pelo
Git. Restaurado em `agroalerta_clima_restore_teste`, dentro do PostgreSQL isolado.
Contagens e hashes dos registros das **27 tabelas** iguais ao principal.
A migration 005 passou nessa cópia, preservando os registros originais.

A migration 005 foi então aplicada ao principal em **uma transação**, com timeout
de lock e de execução. Uma comparação posterior das colunas originais confirmou
os mesmos registros nas 27 tabelas originais, descontando somente a inclusão
esperada da versão 005 no controle de migrations. Nenhum consentimento foi criado
ou convertido; nenhum cadastro ou histórico foi apagado.

Imagens anteriores preservadas como `agroalerta-backend:before-clima-20261021`
e `agroalerta-frontend:before-clima-20261021`; configuração privada anterior em
`.local/clima-activation/env-before`. Evidências de integridade permanecem no mesmo
diretório protegido. Não houve restauração sobre o banco principal.

## Ambiente efetivo

Atualizados somente os containers de backend e frontend, usando o Compose existente
com overlay WhatsApp. Evolution API, PostgreSQL principal, PostgreSQL Evolution e
Redis mantiveram seus containers, volumes e sessão. O serviço WhatsApp antigo
permanece parado; SMSGo não participa do fluxo.

Health do backend: **OK**. Instância Evolution **agroalerta**, conexão **open**,
remetente esperado validado **final 9503**, webhook autenticado em dia. Existiam
17 eventos Evolution persistidos na consulta; os recibos das novas categorias
foram validados com o provedor simulado. Nenhum envio de teste real foi feito para
produzir recibos adicionais nesta ativação.

| Flag no `.env` privado | Variável correspondente no backend | Valor efetivo |
|---|---|---|
| AGROALERTA_WHATSAPP_SENDING_ENABLED | WHATSAPP_SENDING_ENABLED | true |
| AGROALERTA_WEATHER_MONITOR_ENABLED | WEATHER_MONITOR_ENABLED | true |
| AGROALERTA_WEATHER_BULLETIN_ENABLED | WEATHER_BULLETIN_ENABLED | true |
| AGROALERTA_WEATHER_EXTENDED_ALERTS_ENABLED | WEATHER_EXTENDED_ALERTS_ENABLED | true |

| Controle administrativo | Estado |
|---|---|
| Bloqueio geral de envios | false |
| Boas-vindas automáticas | true |
| Alertas existentes de geada | true |
| Boletins pausados | false |
| Novos alertas pausados | false |

A liberação dos controles climáticos foi auditada às **20h52min39s de Brasília**,
com a conta administradora já autorizada. Nenhuma preferência individual foi
alterada. A autorização global usa os critérios operacionais descritos no
[relatório de implementação](BOLETIM_ALERTAS_CLIMATICOS.md), como limites internos
iniciais, sem caracterizá-los como avisos oficiais ou recomendações universais.

## Operação automática e destinatários

Worker PostgreSQL iniciado com o backend, intervalo **15 segundos**. Monitoramento
real periódico ativo, intervalo **60 minutos**. O primeiro ciclo automático após
a atualização processou **quatro talhões**, **zero riscos novos** e **zero mensagens
na fila**. Uma consulta adicional somente leitura à Open-Meteo retornou sete dias
de previsão real, com mínima de 13,6 °C e máxima de 25,4 °C no primeiro dia consultado.
Nenhuma previsão, risco ou produtor fictício foi criado no principal.

Boletim ativo às **06h30, America/Sao_Paulo**, janela padrão até 07h00.
Próxima execução: **22/10/2026 às 06h30 de Brasília**
(`2026-10-22T09:30:00.000Z`). Ainda não houve execução diária em produção porque
a ativação ocorreu à noite; nenhum boletim retroativo foi disparado.

| Categoria | Produtores com autorização vigente |
|---|---:|
| Geada | 3 |
| Boletim diário | 0 |
| Chuva intensa | 0 |
| Vento forte | 0 |
| Calor extremo | 0 |

Os três produtores preservaram a geada já autorizada. As novas categorias estão
globalmente ativas, mas só enviarão depois de cada produtor conceder a preferência
correspondente com WhatsApp vigente. Não é necessário digitar ENVIAR por mensagem.
Boas-vindas continuam automáticas para novos cadastros autorizados.

Na conferência pós-ativação, nenhuma nova notificação havia sido criada desde a
implantação. A fila mantinha seu histórico, inclusive um teste antigo ainda em
`enviado`, sem reenvio. Os IDs **3 e 7** continuam **cancelados, retidos e com zero
tentativas**, sem liberação ou processamento. Permanecem válidos limites,
prioridades, idempotência, cancelamentos, expiração e prevenção de reenvios incertos.

## Telas e permissões

- Administrador: **http://localhost:5173/whatsapp.html**.
- Produtor: **http://localhost:5173/clima-produtor.html**.

Smoke test em Chrome no ambiente principal: **27 verificações aprovadas**, desktop
1280 px e celular 390 px. Foram reutilizadas sessões existentes sem acessar senhas
ou criar usuários. Painel administrativo visível, flags e pausas conferidas,
bloqueio geral disponível, previsão real por talhão, preferências e histórico
carregados. Produtor recebe **403** nas funções administrativas; anônimo recebe
**401**. Nenhuma preferência foi salva e nenhuma mensagem de teste foi solicitada.
As capturas com dados privados ficaram apenas em `.local/clima-activation/`.

O PostgreSQL isolado dos testes foi parado ao final, preservando volumes. Os
serviços principais permanecem ativos. Para interromper novos despachos, o botão
**Bloquear todos os envios agora** continua disponível ao administrador.
