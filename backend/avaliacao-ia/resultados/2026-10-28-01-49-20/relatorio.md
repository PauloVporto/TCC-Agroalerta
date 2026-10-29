# Avaliação de assertividade da IA (Claude) — AgroAlerta

- Executado em: 27/10/2026, 22:49:20
- Modelo avaliado: `claude-haiku-4-5-20251001` (prompts: clima-v1, mercado-v2)
- Modelo avaliador (juiz): `claude-sonnet-4-6`, temperatura 0
- Cenários: 30 climáticos e 30 de mercado; 2 execuções por cenário
- Critérios: coerência, clareza, relevância, ausência de informações inventadas e consistência (escala 1–5)

Definição dos critérios:
- **Coerência**: A resposta é correta e coerente com os dados e com o gabarito (níveis, tendência, riscos), sem se contradizer?
- **Clareza**: O texto é simples, objetivo e fácil de entender por um produtor rural?
- **Relevância**: A resposta cobre o que importa para a decisão do produtor (pontos-chave) e evita ruído ou alarmes desnecessários?
- **Ausência de informações inventadas**: A resposta usa só o que está nos dados? Contexto geral só é aceitável se estiver claramente rotulado como geral.
- **Consistência**: concordância entre as 2 execuções do mesmo cenário (nível geral e riscos no clima; mesma tendência no mercado), convertida para a escala 1–5.

## 1. Proveniência das respostas

Cada resposta avaliada tem `requestId` (`req_…`) e `respostaId` (`msg_…`) devolvidos pela API da Anthropic, gravados em `registro-chamadas.jsonl`. A avaliação chama as funções que lançam erro quando a API falha: **não existe caminho de fallback simulado**, então nenhuma resposta simulada foi avaliada como se fosse do Claude. Respostas sem identificadores válidos ou com falha da API são excluídas e contadas abaixo.

| Papel | Modelo | Chamadas bem-sucedidas | Falhas da API | Tokens de entrada | Tokens de saída |
|---|---|---:|---:|---:|---:|
| geracao | claude-haiku-4-5-20251001 | 120 | 0 | 68.886 | 25.192 |
| juiz | claude-sonnet-4-6 | 120 | 0 | 146.276 | 22.628 |

- Respostas geradas e comprovadas como da API: **120**
- Respostas excluídas (falha da API, origem não comprovada ou juiz sem resposta válida): **0**
- Respostas simuladas avaliadas: **0**

## 2. Monitoramento climático (n = 30 cenários, 60 respostas)

### Notas por critério

| Critério | Média (1–5) | Desvio-padrão | % de cenários com nota ≥ 4 |
|---|---:|---:|---:|
| Coerência | 5,00 | 0,00 | 100,0% |
| Clareza | 5,00 | 0,00 | 100,0% |
| Relevância | 4,90 | 0,24 | 100,0% |
| Ausência de informações inventadas | 4,75 | 0,37 | 100,0% |
| Consistência (entre 2 execuções) | 5,00 | 0,00 | 100,0% |
| **Média geral** | **4,93** | | |

**Respostas satisfatórias:** 30 de 30 cenários (**100,0%**; IC 95%: 88,6% a 100,0%). Critério: média dos cinco critérios ≥ 4,0 e nenhum critério abaixo de 3.

### Métricas objetivas (contra o gabarito do motor de regras)

| Métrica | Valor |
|---|---:|
| Respostas em JSON válido | 100,0% |
| Nível geral correto | 100,0% |
| Conjunto de riscos idêntico ao do motor | 100,0% |
| Precisão dos riscos citados | 100,0% |
| Cobertura (recall) dos riscos do motor | 100,0% |
| Respostas com falso alarme (risco sem alerta) | 0,0% |
| Respostas citando número fora dos dados | 0,0% |

### Por categoria de cenário

| Categoria | Cenários | Média geral | Satisfatórios |
|---|---:|---:|---:|
| normal | 7 | 4,99 | 7 de 7 |
| risco_unico | 9 | 4,87 | 9 de 9 |
| limite | 9 | 4,96 | 9 de 9 |
| combinado | 5 | 4,92 | 5 de 5 |

Nenhum cenário excluído.

### Exemplos reais

**Melhor 1 — C05** (limite): Mínima de 5,5 °C, logo acima do limiar de geada

Dados enviados ao modelo:
> Talhão: Talhão C05 (café arábica, fase vegetativo)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 5.5 °C
> - Chuva acumulada prevista nos próximos 7 dias: 25 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - nenhum alerta disparado

Resposta do Claude (execução 1; requestId `req_011CgTo5TbZpntwT8wnnKsth`):
> Nível geral: baixo
> Resumo: Não há risco relevante no momento para o Talhão C05. As condições meteorológicas previstas nos próximos 7 dias estão dentro dos parâmetros normais para a fase vegetativa do café arábica.
> Riscos: nenhum
> Recomendações: nenhuma

- Gabarito: Nenhum risco esperado; nível geral baixo.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Nível baixo, sem riscos, alinhado ao gabarito e aos dados. Não menciona geada. Sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem simples e acessível ao produtor rural.
  - Relevância: **5** — Cobre o ponto-chave essencial (ausência de risco) sem ruído ou alarmes desnecessários.
  - Ausência de informações inventadas: **5** — Nenhuma informação além dos dados fornecidos. Afirmações genéricas são adequadas e não inventadas.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 2 — C07** (risco_unico): Estiagem moderada fora da fase crítica (12 dias)

Dados enviados ao modelo:
> Talhão: Talhão C07 (café arábica, fase vegetativo)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 14 °C
> - Chuva acumulada prevista nos próximos 7 dias: 8 mm
> - Dias secos consecutivos até ontem: 12
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [medio] Risco de estiagem: 12 dias sem chuva registrados. (janela: últimos 12 dias)

Resposta do Claude (execução 1; requestId `req_011CgTo685abpWopKZusG5FH`):
> Nível geral: medio
> Resumo: Há risco médio de estiagem no Talhão C07. Os 12 dias secos consecutivos, combinados com apenas 8 mm de chuva previstos nos próximos 7 dias e evapotranspiração de 28 mm, indicam deficiência hídrica. A temperatura mínima de 14 °C está adequada e o vento de 15 km/h não apresenta risco.
> Riscos:
> - estiagem (medio): 12 dias consecutivos sem chuva registrados, com apenas 8 mm previstos nos próximos 7 dias contra 28 mm de evapotranspiração esperada.
> Recomendações:
> - Verificar umidade do solo no talhão e considerar irrigação se disponível.
> - Monitorar diariamente a previsão de chuva para os próximos dias.
> - Observar sinais de estresse hídrico nas plantas de café durante a f…

- Gabarito: Nível geral esperado: medio. Riscos esperados (tipo, nível): estiagem (medio).
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Nível médio correto, risco de estiagem identificado, temperatura e vento avaliados adequadamente, sem contradições com dados ou gabarito.
  - Clareza: **5** — Texto organizado, linguagem acessível, estrutura clara com resumo, riscos e recomendações objetivas para produtor rural.
  - Relevância: **5** — Cobre ponto-chave da estiagem moderada, contextualiza ET0 vs chuva prevista, recomendações práticas e pertinentes, sem ruído.
  - Ausência de informações inventadas: **5** — Todos os valores citados constam nos dados fornecidos; nenhuma afirmação sem respaldo nos dados do cenário.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 3 — C08** (limite): 9 dias secos, abaixo do limiar de estiagem

Dados enviados ao modelo:
> Talhão: Talhão C08 (café arábica, fase floracao)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 14 °C
> - Chuva acumulada prevista nos próximos 7 dias: 10 mm
> - Dias secos consecutivos até ontem: 9
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - nenhum alerta disparado

Resposta do Claude (execução 1; requestId `req_011CgTo6FBDmzVfSmbowjA4j`):
> Nível geral: baixo
> Resumo: Não há riscos relevantes identificados para o talhão C08 nos próximos 7 dias. As condições meteorológicas estão dentro dos limites aceitáveis para a fase de floração do café arábica.
> Riscos: nenhum
> Recomendações: nenhuma

- Gabarito: Nenhum risco esperado; nível geral baixo.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Nível baixo, sem riscos, alinhado ao gabarito e aos dados. Sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem simples e acessível ao produtor rural.
  - Relevância: **5** — Cobre o ponto-chave essencial (ausência de risco) sem alarmes desnecessários ou conteúdo supérfluo.
  - Ausência de informações inventadas: **5** — Nenhuma informação além dos dados fornecidos; sem números ou afirmações inventadas.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 1 — S08** (risco_unico): Ventos de 65 km/h

Dados enviados ao modelo:
> Talhão: Talhão S08 (soja, fase vegetativo)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 14 °C
> - Chuva acumulada prevista nos próximos 7 dias: 25 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 65 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [alto] Ventos fortes: Ventos de até 65 km/h previstos. (janela: próximos dias)

Resposta do Claude (execução 1; requestId `req_011CgToBAX5SwBZCXx4ydAxA`):
> Nível geral: alto
> Resumo: Há risco alto de ventos fortes nos próximos dias, com rajadas de até 65 km/h previstas. A chuva acumulada de 25 mm e a evapotranspiração de 28 mm mantêm o balanço hídrico adequado para a fase vegetativa. Não há risco de geada ou estiagem no período.
> Riscos:
> - vento (alto): Ventos máximos de 65 km/h previstos para os próximos dias podem danificar a soja em fase vegetativa.
> Recomendações:
> - Verificar estruturas de suporte e tutoragem na lavoura
> - Evitar aplicações de defensivos durante os picos de vento previstos
> - Monitorar plantas após as rajadas para identificar danos

- Gabarito: Nível geral esperado: alto. Riscos esperados (tipo, nível): vento (alto).
- Notas (média 4,80, satisfatória):
  - Coerência: **5** — Nível alto correto, risco de vento com 65 km/h citado, sem contradições com dados ou gabarito.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor, sem rodeios ou termos técnicos desnecessários.
  - Relevância: **5** — Cobre o ponto-chave do vento alto, recomendações práticas pertinentes, sem alarmes desnecessários ou omissões.
  - Ausência de informações inventadas: **4** — Afirmação sobre tutoragem não tem base nos dados fornecidos; demais informações são sustentadas pelos dados.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 2 — S06** (risco_unico): Colheita com 75% de chance de chuva

Dados enviados ao modelo:
> Talhão: Talhão S06 (soja, fase colheita)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 14 °C
> - Chuva acumulada prevista nos próximos 7 dias: 55 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 75%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [medio] Chuva na janela de colheita: Probabilidade de 75% de chuva nos próximos 7 dias durante a janela de colheita. (janela: próximos dias)

Resposta do Claude (execução 1; requestId `req_011CgToAGqoQnj5pC8W8WSW6`):
> Nível geral: medio
> Resumo: Há risco médio de chuva durante a janela de colheita da soja no Talhão S06. A probabilidade de 75% de precipitação nos próximos 7 dias pode afetar as operações de colheita. As demais condições meteorológicas (temperatura, vento) não apresentam riscos relevantes.
> Riscos:
> - chuva_colheita (medio): Probabilidade de 75% de chuva nos próximos 7 dias coincide com a janela de colheita da soja.
> Recomendações:
> - Acompanhe a previsão diária para otimizar o calendário de colheita
> - Tenha equipamentos de secagem preparados para grãos colhidos com umidade elevada

- Gabarito: Nível geral esperado: medio. Riscos esperados (tipo, nível): chuva_colheita (medio).
- Notas (média 4,80, satisfatória):
  - Coerência: **5** — Nível médio correto, risco chuva_colheita identificado, sem classificação alta. Totalmente alinhado ao gabarito.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem termos técnicos desnecessários.
  - Relevância: **4** — Cobre o risco principal, mas omite a recomendação de antecipar a colheita, ponto-chave do gabarito.
  - Ausência de informações inventadas: **5** — Todos os dados citados estão nos inputs fornecidos. Nenhuma informação inventada ou sem sustentação.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 3 — C11** (combinado): Geada moderada e estiagem moderada

Dados enviados ao modelo:
> Talhão: Talhão C11 (café arábica, fase vegetativo)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 3 °C
> - Chuva acumulada prevista nos próximos 7 dias: 5 mm
> - Dias secos consecutivos até ontem: 11
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [medio] Risco de geada: Temperatura mínima prevista de 3°C. Risco moderado de geada. (janela: próximos dias)
> - [medio] Risco de estiagem: 11 dias sem chuva registrados. (janela: últimos 11 dias)

Resposta do Claude (execução 1; requestId `req_011CgTo7CeT3sQm63kapZEDA`):
> Nível geral: medio
> Resumo: O Talhão C11 apresenta risco moderado de geada nos próximos dias, com temperatura mínima prevista de 3°C. Há também risco moderado de estiagem, com 11 dias secos consecutivos e apenas 5 mm de chuva previstos para a próxima semana. A evapotranspiração de 28 mm aumenta a demanda hídrica da cultura.
> Riscos:
> - geada (medio): Temperatura mínima prevista de 3°C nos próximos 7 dias apresenta risco moderado de geada para a fase vegetativa do café arábica.
> - estiagem (medio): 11 dias secos consecutivos com apenas 5 mm de chuva prevista e evapotranspiração de 28 mm indicam deficiência hídrica.
> Recomendações:
> - Monitorar termômetro nas próximas noites para temperaturas crític…

- Gabarito: Nível geral esperado: medio. Riscos esperados (tipo, nível): geada (medio); estiagem (medio).
- Notas (média 4,80, satisfatória):
  - Coerência: **5** — Níveis corretos (medio), riscos alinhados ao gabarito, sem contradições com dados ou classificação indevida como alto.
  - Clareza: **5** — Texto bem estruturado, linguagem acessível, organização clara em resumo, riscos e recomendações.
  - Relevância: **5** — Cobre geada e estiagem conforme pontos-chave, sem alarmes desnecessários ou omissões relevantes.
  - Ausência de informações inventadas: **4** — Recomendação de proteção abaixo de 0°C é contextual válida, mas não está explicitamente nos dados fornecidos.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

## 3. Mercado (n = 30 cenários, 60 respostas)

### Notas por critério

| Critério | Média (1–5) | Desvio-padrão | % de cenários com nota ≥ 4 |
|---|---:|---:|---:|
| Coerência | 4,90 | 0,24 | 100,0% |
| Clareza | 4,70 | 0,39 | 100,0% |
| Relevância | 4,60 | 0,38 | 100,0% |
| Ausência de informações inventadas | 4,50 | 0,44 | 93,3% |
| Consistência (entre 2 execuções) | 5,00 | 0,00 | 100,0% |
| **Média geral** | **4,74** | | |

**Respostas satisfatórias:** 30 de 30 cenários (**100,0%**; IC 95%: 88,6% a 100,0%). Critério: média dos cinco critérios ≥ 4,0 e nenhum critério abaixo de 3.

### Métricas objetivas (contra a regra de classificação ±2%)

| Métrica | Valor |
|---|---:|
| Respostas em JSON válido | 100,0% |
| Tendência correta (alta, queda ou estável) | 100,0% |
| Respostas citando número fora dos dados | 6,7% |

Matriz de confusão (linhas = gabarito; colunas = resposta do Claude):

| Gabarito \ Claude | alta | estável | queda | sem formato |
|---|---:|---:|---:|---:|
| alta | 20 | 0 | 0 | 0 |
| estavel | 0 | 20 | 0 | 0 |
| queda | 0 | 0 | 20 | 0 |

### Por categoria de cenário

| Categoria | Cenários | Média geral | Satisfatórios |
|---|---:|---:|---:|
| alta | 6 | 4,68 | 6 de 6 |
| queda | 6 | 4,80 | 6 de 6 |
| estavel | 6 | 4,63 | 6 de 6 |
| lateral_volatil | 2 | 4,55 | 2 de 2 |
| reversao | 4 | 4,85 | 4 de 4 |
| alta_com_realizacao | 2 | 4,85 | 2 de 2 |
| queda_com_repique | 2 | 4,90 | 2 de 2 |
| reversao_estavel | 2 | 4,75 | 2 de 2 |

Nenhum cenário excluído.

### Exemplos reais

**Melhor 1 — MS13** (alta_com_realizacao): Alta com realização no fim, fechando em +4%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 133.12; variação: 4%
> Mínimo: 128 em 2026-09-01; máximo: 136.82 em 2026-09-08
> Série: 2026-09-01=128; 2026-09-02=129.35; 2026-09-03=130.43; 2026-09-04=131.79; 2026-09-05=133.2; 2026-09-06=134.66; 2026-09-07=136.6; 2026-09-08=136.82; 2026-09-09=135.98; 2026-09-10=135.27; 2026-09-11=134.66; 2026-09-12=134.37; 2026-09-13=133.9; 2026-09-14=133.12

Resposta do Claude (execução 1; requestId `req_011CgToNfKUerdEbE9dk2vfL`):
> Tendência: alta
> Resumo: O preço da soja apresentou alta de 4% no período, subindo de R$ 128,00 para R$ 133,12 a saca de 60kg. A cotação saiu de R$ 128,00 no início (1º de setembro) e atingiu o máximo de R$ 136,82 no dia 8 de setembro, apresentando uma reversão clara a partir dali com queda gradual até o final do período. Apesar da queda dos últimos dias, o preço permanece R$ 5,12 acima do valor inicial. Recomenda-se acompanhar os próximos pregões com atenção, pois o comportamento recente sugere pressão para baixo; considere suas necessidades de comercialização no contexto dessa volatilidade de curto prazo.

- Gabarito: Tendência esperada pela regra: alta (variação líquida de 4%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Alta com realização no fim, fechando em +4%.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Tendência correta, números exatos, pico e reversão descritos com precisão, sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem jargões desnecessários.
  - Relevância: **5** — Cobre variação líquida, pico, reversão e alerta de comercialização; nada supérfluo.
  - Ausência de informações inventadas: **5** — Todos os valores e afirmações derivam diretamente dos dados fornecidos, sem acréscimos externos.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 2 — MS14** (queda_com_repique): Queda com repique no fim, fechando em -4%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 122.88; variação: -4%
> Mínimo: 119.08 em 2026-09-08; máximo: 128 em 2026-09-01
> Série: 2026-09-01=128; 2026-09-02=126.74; 2026-09-03=125.48; 2026-09-04=124.22; 2026-09-05=122.84; 2026-09-06=121.42; 2026-09-07=119.75; 2026-09-08=119.08; 2026-09-09=119.91; 2026-09-10=120.24; 2026-09-11=121.26; 2026-09-12=121.55; 2026-09-13=122.64; 2026-09-14=122.88

Resposta do Claude (execução 1; requestId `req_011CgToNn5HNQrFagPQ2K6vf`):
> Tendência: queda
> Resumo: O preço da soja apresentou queda de 4% no período, caindo de R$ 128,00 para R$ 122,88 por saca de 60kg. A cotação iniciou em R$ 128,00 no dia 1º e atingiu o mínimo de R$ 119,08 no dia 8, seguido de uma reversão com recuperação gradual até R$ 122,88. Houve clara reversão de tendência a partir do dia 9, com recuperação dos preços nos últimos seis dias da série. Recomenda-se cautela, monitorando se a recuperação se consolida nas próximas semanas antes de tomar decisões de comercialização.

- Gabarito: Tendência esperada pela regra: queda (variação líquida de -4%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Queda com repique no fim, fechando em -4%.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Tendência correta, números exatos, descreve queda com repique final sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural.
  - Relevância: **5** — Cobre tendência, mínimo, repique e recomendação prática sem informações supérfluas.
  - Ausência de informações inventadas: **5** — Todos os dados citados constam na série fornecida; nenhuma causa ou contexto externo inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 3 — MC03** (alta): Alta leve (+3,2%)

Dados enviados ao modelo:
> Cultura: café arábica
> Unidade: saca 60kg (arábica)
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 1680; preço final: 1733.76; variação: 3.2%
> Mínimo: 1680 em 2026-09-01; máximo: 1734.13 em 2026-09-13
> Série: 2026-09-01=1680; 2026-09-02=1682.46; 2026-09-03=1685.49; 2026-09-04=1696.63; 2026-09-05=1701.01; 2026-09-06=1701.08; 2026-09-07=1708.5; 2026-09-08=1708.19; 2026-09-09=1717.99; 2026-09-10=1722.09; 2026-09-11=1717.67; 2026-09-12=1723.68; 2026-09-13=1734.13; 2026-09-14=1733.76

Resposta do Claude (execução 1; requestId `req_011CgToDwFwcCLWpDHKh4Y62`):
> Tendência: alta
> Resumo: O preço do café arábica apresentou alta de 3,2% no período, saindo de R$ 1.680,00 a saca de 60kg em 1º de setembro e fechando em R$ 1.733,76 em 14 de setembro. O valor mínimo foi R$ 1.680,00 no início do período, enquanto o máximo atingiu R$ 1.734,13 em 13 de setembro, demonstrando uma trajetória consistentemente ascendente ao longo dos 14 dias. Não houve reversão significativa, apenas uma leve queda no último dia. Recomenda-se acompanhar de perto o comportamento nos próximos dias para confirmar se a tendência de alta se mantém estável neste patamar.

- Gabarito: Tendência esperada pela regra: alta (variação líquida de 3.2%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Alta leve (+3,2%).
- Notas (média 4,90, satisfatória):
  - Coerência: **5** — Tendência, percentual, datas, mínimo, máximo e leve recuo final todos corretos e coerentes com os dados.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem jargões desnecessários.
  - Relevância: **5** — Cobre tendência, variação, extremos e recomendação prática sem informações supérfluas ou alarmes desnecessários.
  - Ausência de informações inventadas: **4.5** — Todos os dados citados constam na série fornecida; nenhuma causa ou contexto externo foi inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 1 — MS07** (estavel): Estável, leve alta de +0,4%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 128.51; variação: 0.4%
> Mínimo: 127.72 em 2026-09-02; máximo: 128.67 em 2026-09-09
> Série: 2026-09-01=128; 2026-09-02=127.72; 2026-09-03=128.08; 2026-09-04=128.01; 2026-09-05=127.83; 2026-09-06=127.99; 2026-09-07=128.18; 2026-09-08=128.59; 2026-09-09=128.67; 2026-09-10=128.67; 2026-09-11=128.19; 2026-09-12=128.21; 2026-09-13=128.4; 2026-09-14=128.51

Resposta do Claude (execução 1; requestId `req_011CgToLWPAcjiLnoQTVJFUd`):
> Tendência: estavel
> Resumo: O preço da soja apresentou comportamento estável no período de 1º a 14 de setembro, com variação de apenas 0,4% entre o preço inicial de R$ 128,00 e final de R$ 128,51 a saca. A cotação oscilou entre o mínimo de R$ 127,72 (02/09) e máximo de R$ 128,67 (09/10), refletindo pequenas variações sem tendência clara de movimento. Houve uma leve recuperação no meio do período, com pico no dia 9 de setembro, seguida de pequena correção e posterior estabilização nos últimos dias. Para o curto prazo, o produtor deve monitorar se a cotação consegue sustentar-se acima de R$ 128,50 ou se voltará aos patamares de R$ 127,70, pois o mercado ainda busca direção definida.

- Gabarito: Tendência esperada pela regra: estavel (variação líquida de 0.4%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Estável, leve alta de +0,4%.
- Notas (média 4,30, satisfatória):
  - Coerência: **4.5** — Tendência correta e dados precisos, mas '09/10' deveria ser '09/09'; erro de digitação na data do máximo.
  - Clareza: **4** — Texto bem organizado e acessível, mas a frase final sobre 'busca de direção' contradiz levemente a conclusão de estabilidade.
  - Relevância: **4** — Cobre os pontos essenciais; a recomendação de monitorar níveis específicos é útil, mas levemente especulativa para o contexto.
  - Ausência de informações inventadas: **4** — Todos os números têm base nos dados; 'mercado ainda busca direção' é interpretação sem sustentação explícita nos dados fornecidos.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 2 — MS10** (lateral_volatil): Lateral com oscilações de ±3% e fechamento em +0,3%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 128.38; variação: 0.3%
> Mínimo: 125.02 em 2026-09-06; máximo: 131.22 em 2026-09-09
> Série: 2026-09-01=128; 2026-09-02=129.2; 2026-09-03=130.76; 2026-09-04=130.57; 2026-09-05=127.68; 2026-09-06=125.02; 2026-09-07=126.81; 2026-09-08=129.34; 2026-09-09=131.22; 2026-09-10=128.53; 2026-09-11=125.08; 2026-09-12=125.4; 2026-09-13=126.64; 2026-09-14=128.38

Resposta do Claude (execução 1; requestId `req_011CgToMcpPYcbb1zfxZECvB`):
> Tendência: estavel
> Resumo: O preço da soja manteve-se estável no período, variando apenas 0,3% entre o início (R$ 128,00) e o final (R$ 128,38 por saca de 60kg). A série apresentou forte volatilidade, com o preço oscilando entre R$ 125,02 (mínimo em 06/09) e R$ 131,22 (máximo em 09/09), caracterizando reversões significativas ao longo dos 14 dias. Houve recuperação expressiva no meio do período (até 09/09) seguida de queda e posterior estabilização nos últimos dias. Recomenda-se cautela nas próximas operações, acompanhando atentamente os movimentos do mercado, pois a alta volatilidade indica incerteza e demanda atenção constante.

- Gabarito: Tendência esperada pela regra: estavel (variação líquida de 0.3%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Lateral com oscilações de ±3% e fechamento em +0,3%.
- Notas (média 4,40, satisfatória):
  - Coerência: **4** — Tendência correta (estável, 0,3%), mínimo, máximo e datas conferem; descrição da volatilidade lateral é precisa e sem contradições.
  - Clareza: **4** — Texto bem organizado e acessível, mas termos como 'reversões significativas' podem ser menos intuitivos para produtores rurais.
  - Relevância: **4** — Cobre tendência, volatilidade e recomenda cautela; a recomendação genérica de 'acompanhar o mercado' é levemente supérflua.
  - Ausência de informações inventadas: **5** — Todos os valores e afirmações derivam diretamente dos dados fornecidos; nenhuma causa ou contexto externo inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 3 — MS03** (alta): Alta leve (+3,2%)

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 132.1; variação: 3.2%
> Mínimo: 128 em 2026-09-01; máximo: 132.1 em 2026-09-14
> Série: 2026-09-01=128; 2026-09-02=128.24; 2026-09-03=128.99; 2026-09-04=128.6; 2026-09-05=129.22; 2026-09-06=129.21; 2026-09-07=129.86; 2026-09-08=130.35; 2026-09-09=130.54; 2026-09-10=130.71; 2026-09-11=131.23; 2026-09-12=131.19; 2026-09-13=131.44; 2026-09-14=132.1

Resposta do Claude (execução 1; requestId `req_011CgToJqL93BSeFc4TSNEVa`):
> Tendência: alta
> Resumo: O preço da soja está em alta, com variação de +3,2% no período de 14 dias. O preço inicial foi R$ 128,00 por saca de 60kg, atingindo R$ 132,10 no último dia, com mínimo de R$ 128,00 (01/09) e máximo de R$ 132,10 (14/09). A trajetória foi consistentemente ascendente sem reversões significativas, com ganhos graduais e contínuos ao longo dos dias. Como estratégia prudente de curto prazo, o produtor pode acompanhar se a alta se sustenta nos próximos dias antes de tomar decisões de venda, considerando que movimentos de recuperação podem encontrar resistência técnica.

- Gabarito: Tendência esperada pela regra: alta (variação líquida de 3.2%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Alta leve (+3,2%).
- Notas (média 4,40, satisfatória):
  - Coerência: **4.5** — Tendência e números corretos, mas mencionar 'resistência técnica' é conceito de análise técnica não sustentado pelos dados simples.
  - Clareza: **4.5** — Texto bem organizado e acessível, mas 'resistência técnica' é jargão inadequado para produtor rural.
  - Relevância: **4.5** — Cobre os pontos essenciais, mas a menção a 'movimentos de recuperação e resistência técnica' é ruído desnecessário para o contexto.
  - Ausência de informações inventadas: **3.5** — 'Resistência técnica' é conceito externo não derivável dos dados fornecidos, introduzindo análise não solicitada.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

## 4. Limitações

- O gabarito do módulo climático é calculado pelo motor de regras do AgroAlerta, e o modelo recebe esses alertas no contexto. Portanto o resultado mede a **fidelidade da interpretação ao motor**, não a verdade agronômica.
- O avaliador é outro LLM (modelo diferente do avaliado, temperatura 0). Pode ter vieses próprios; por isso o arquivo `validacao-humana.csv` traz uma amostra para a equipe pontuar e comparar com o juiz.
- São 30 cenários por módulo, amostra pequena: os intervalos de confiança de Wilson mostram a incerteza dos percentuais. O desvio entre execuções (consistência) é medido com apenas 2 repetições por cenário.
- Os prompts foram refinados antes da medição (versões registradas nos metadados). Os números valem para as versões indicadas e o modelo informado.
- Cenários agronomicamente ambíguos foram deixados de fora de propósito para o gabarito ser inequívoco; o desempenho em situações ambíguas não foi medido.

## 5. Como reproduzir

```
cd backend
npm run ia:avaliar            # 30 + 30 cenários, 2 execuções cada
npm run ia:avaliar -- --piloto # 2 cenários por módulo, para validar o funcionamento
```
