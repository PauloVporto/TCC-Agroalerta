# Avaliação de assertividade da IA (Claude) — AgroAlerta

- Executado em: 29/10/2026, 16:36:36
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
| geracao | claude-haiku-4-5-20251001 | 120 | 0 | 68.886 | 24.778 |
| juiz | claude-sonnet-4-6 | 120 | 0 | 145.881 | 22.504 |

- Respostas geradas e comprovadas como da API: **120**
- Respostas excluídas (falha da API, origem não comprovada ou juiz sem resposta válida): **0**
- Respostas simuladas avaliadas: **0**

## 2. Monitoramento climático (n = 30 cenários, 60 respostas)

### Notas por critério

| Critério | Média (1–5) | Desvio-padrão | % de cenários com nota ≥ 4 |
|---|---:|---:|---:|
| Coerência | 5,00 | 0,00 | 100,0% |
| Clareza | 4,98 | 0,09 | 100,0% |
| Relevância | 4,88 | 0,31 | 100,0% |
| Ausência de informações inventadas | 4,82 | 0,31 | 100,0% |
| Consistência (entre 2 execuções) | 5,00 | 0,00 | 100,0% |
| **Média geral** | **4,94** | | |

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
| normal | 7 | 4,97 | 7 de 7 |
| risco_unico | 9 | 4,88 | 9 de 9 |
| limite | 9 | 4,94 | 9 de 9 |
| combinado | 5 | 4,98 | 5 de 5 |

Nenhum cenário excluído.

### Exemplos reais

**Melhor 1 — C01** (normal): Café vegetativo com clima ameno

Dados enviados ao modelo:
> Talhão: Talhão C01 (café arábica, fase vegetativo)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 14 °C
> - Chuva acumulada prevista nos próximos 7 dias: 25 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - nenhum alerta disparado

Resposta do Claude (execução 1; requestId `req_011CgX6FfwV95rv4U7VgYqKS`):
> Nível geral: baixo
> Resumo: Não há riscos relevantes identificados para o Talhão C01 nos próximos 7 dias. As condições meteorológicas previstas estão dentro dos limites seguros para a fase vegetativa do café arábica. Continue monitorando conforme o calendário regular.
> Riscos: nenhum
> Recomendações: nenhuma

- Gabarito: Nenhum risco esperado; nível geral baixo.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Nível baixo, sem riscos, alinhado ao gabarito. Não disparou geada nem estiagem indevidamente.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem simples e acessível ao produtor rural.
  - Relevância: **5** — Cobre o ponto-chave (ausência de risco) sem ruído ou alarmes desnecessários.
  - Ausência de informações inventadas: **5** — Nenhuma informação além dos dados fornecidos; sem números ou afirmações inventadas.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 2 — C02** (risco_unico): Geada forte na floração

Dados enviados ao modelo:
> Talhão: Talhão C02 (café arábica, fase floracao)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 0.5 °C
> - Chuva acumulada prevista nos próximos 7 dias: 25 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [alto] Risco de geada: Temperatura mínima prevista de 0.5°C. Risco alto de geada, que pode causar perda severa em lavouras de café. (janela: próximos dias)

Resposta do Claude (execução 1; requestId `req_011CgX6FgAsbNv9JmTiYkyDf`):
> Nível geral: alto
> Resumo: Alerta crítico de geada para o Talhão C02. Temperatura mínima prevista de 0.5°C nos próximos 7 dias representa risco severo para o café em floração. Recomenda-se monitoramento contínuo e adoção de medidas de proteção imediatas.
> Riscos:
> - geada (alto): Temperatura mínima prevista de 0.5°C nos próximos dias pode causar perda severa em café arábica na fase de floração.
> Recomendações:
> - Monitore a temperatura diariamente, especialmente durante a madrugada.
> - Prepare sistemas de proteção contra geada (irrigação, aquecimento ou cobertura).
> - Evite atividades que aumentem a vulnerabilidade das flores à geada.

- Gabarito: Nível geral esperado: alto. Riscos esperados (tipo, nível): geada (alto).
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Nível alto correto, mínima de 0.5°C citada, risco de geada identificado, sem contradições com dados ou gabarito.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor, sem rodeios ou termos técnicos desnecessários.
  - Relevância: **5** — Cobre todos os pontos-chave: geada alto, mínima 0.5°C, fase floração. Recomendações práticas e pertinentes, sem ruído.
  - Ausência de informações inventadas: **5** — Todas as informações derivam dos dados fornecidos. Nenhuma afirmação sem sustentação nos dados do cenário.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 3 — C05** (limite): Mínima de 5,5 °C, logo acima do limiar de geada

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

Resposta do Claude (execução 1; requestId `req_011CgX6GgH7KrFMSUQvP3Wv2`):
> Nível geral: baixo
> Resumo: Não há risco relevante identificado para o Talhão C05 nos próximos 7 dias. As condições meteorológicas previstas estão dentro dos limites aceitáveis para café em fase vegetativa. Continue monitorando conforme o calendário regular.
> Riscos: nenhum
> Recomendações: nenhuma

- Gabarito: Nenhum risco esperado; nível geral baixo.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Nível baixo, sem riscos, alinhado ao gabarito e aos dados. Sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural.
  - Relevância: **5** — Cobre o ponto-chave essencial (sem risco relevante) sem alarmes desnecessários ou ruído.
  - Ausência de informações inventadas: **5** — Nenhuma informação além dos dados fornecidos; afirmações genéricas são adequadas ao contexto.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 1 — S02** (risco_unico): Estiagem crítica no enchimento de grãos (12 dias)

Dados enviados ao modelo:
> Talhão: Talhão S02 (soja, fase enchimento graos)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 14 °C
> - Chuva acumulada prevista nos próximos 7 dias: 4 mm
> - Dias secos consecutivos até ontem: 12
> - Probabilidade máxima de chuva nos próximos 7 dias: 15%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [alto] Risco de estiagem: 12 dias sem chuva durante enchimento_graos. Fase crítica para definição de produtividade da soja. (janela: últimos 12 dias)

Resposta do Claude (execução 1; requestId `req_011CgX6LF8csRbQwifuYxYUv`):
> Nível geral: alto
> Resumo: Há risco alto de estiagem no talhão S02. A soja está em fase crítica de enchimento de grãos com 12 dias sem chuva e previsão de apenas 4 mm nos próximos 7 dias. A demanda hídrica (28 mm de evapotranspiração) está muito acima da chuva esperada.
> Riscos:
> - estiagem (alto): 12 dias consecutivos sem chuva durante enchimento de grãos, com previsão de apenas 4 mm de chuva e evapotranspiração de 28 mm nos próximos 7 dias.
> Recomendações:
> - Aumentar frequência de irrigação se disponível no talhão S02
> - Monitorar diariamente o estado da cultura para sinais de seca
> - Preparar sistema de irrigação para ativação imediata se continuar sem chuva

- Gabarito: Nível geral esperado: alto. Riscos esperados (tipo, nível): estiagem (alto).
- Notas (média 4,70, satisfatória):
  - Coerência: **5** — Nível alto correto, estiagem identificada, dados usados com precisão, sem contradições com gabarito.
  - Clareza: **4.5** — Texto direto, bem estruturado, linguagem acessível ao produtor, sem termos técnicos desnecessários.
  - Relevância: **4** — Cobre todos os pontos-chave: risco alto, fase crítica, irrigação suplementar recomendada. Sem ruído.
  - Ausência de informações inventadas: **5** — Todos os valores citados (12 dias, 4 mm, 28 mm) estão nos dados fornecidos. Nada inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 2 — C04** (risco_unico): Geada moderada na granação

Dados enviados ao modelo:
> Talhão: Talhão C04 (café arábica, fase granacao)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 4 °C
> - Chuva acumulada prevista nos próximos 7 dias: 25 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [medio] Risco de geada: Temperatura mínima prevista de 4°C. Risco moderado de geada. (janela: próximos dias)

Resposta do Claude (execução 1; requestId `req_011CgX6GV4vDKHGHzD2sVS5M`):
> Nível geral: medio
> Resumo: Há risco moderado de geada nos próximos dias, com temperatura mínima prevista de 4°C. O café arábica em fase de granação é sensível a esta condição. A chuva prevista de 25 mm será insuficiente para compensar a evapotranspiração de 28 mm. Monitore as condições noturnas.
> Riscos:
> - geada (medio): Temperatura mínima prevista de 4°C nos próximos 7 dias indica risco moderado de geada para o café em granação.
> Recomendações:
> - Acompanhe as temperaturas noturnas diariamente
> - Prepare sistemas de proteção caso temperatura caia abaixo de 0°C
> - Monitore a umidade do solo nos próximos dias

- Gabarito: Nível geral esperado: medio. Riscos esperados (tipo, nível): geada (medio).
- Notas (média 4,70, satisfatória):
  - Coerência: **5** — Nível médio correto, geada moderada identificada, sem classificação alta. Coerente com dados e gabarito sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem termos técnicos desnecessários.
  - Relevância: **4** — Cobre pontos-chave de geada e monitoramento. Menção ao déficit hídrico é pertinente mas não era ponto-chave esperado.
  - Ausência de informações inventadas: **4.5** — Todos os dados citados (4°C, 25mm, 28mm) estão nos dados fornecidos. Nenhuma informação inventada.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 3 — C03** (limite): Mínima exatamente no limiar de geada alta (2 °C)

Dados enviados ao modelo:
> Talhão: Talhão C03 (café arábica, fase vegetativo)
> Leitura meteorológica (fonte cenario-controlado):
> - Temperatura mínima prevista nos próximos 7 dias: 2 °C
> - Chuva acumulada prevista nos próximos 7 dias: 25 mm
> - Dias secos consecutivos até ontem: 2
> - Probabilidade máxima de chuva nos próximos 7 dias: 40%
> - Vento máximo previsto: 15 km/h
> - Evapotranspiração (ET0) prevista em 7 dias: 28 mm
> Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
> - [alto] Risco de geada: Temperatura mínima prevista de 2°C. Risco alto de geada, que pode causar perda severa em lavouras de café. (janela: próximos dias)

Resposta do Claude (execução 1; requestId `req_011CgX6Fg8A4qTavZzQaG7Wz`):
> Nível geral: alto
> Resumo: Alerta alto para risco de geada nos próximos dias com temperatura mínima prevista de 2°C. O café em fase vegetativa é muito sensível ao frio. Chuva prevista é baixa (25 mm em 7 dias). Recomenda-se monitoramento constante e medidas de proteção.
> Riscos:
> - geada (alto): Temperatura mínima prevista de 2°C nos próximos 7 dias representa risco alto de geada para café arábica em fase vegetativo.
> Recomendações:
> - Monitorar temperatura diária e ativar sistema de proteção contra geada se necessário
> - Verificar funcionamento de equipamentos de irrigação para uso em caso de geada
> - Evitar adubações nitrogenadas que estimulem novo crescimento
> - Inspecionar plantas diariamente ap…

- Gabarito: Nível geral esperado: alto. Riscos esperados (tipo, nível): geada (alto).
- Notas (média 4,70, satisfatória):
  - Coerência: **5** — Nível alto correto, geada identificada com 2°C, sem contradições com dados ou gabarito.
  - Clareza: **5** — Texto organizado, linguagem simples e direta, adequado para produtor rural.
  - Relevância: **4.5** — Cobre o ponto-chave da geada, recomendações práticas pertinentes, sem alarmes desnecessários.
  - Ausência de informações inventadas: **4** — Sensibilidade do café ao frio é contexto geral válido, mas não está rotulado explicitamente como tal.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

## 3. Mercado (n = 30 cenários, 60 respostas)

### Notas por critério

| Critério | Média (1–5) | Desvio-padrão | % de cenários com nota ≥ 4 |
|---|---:|---:|---:|
| Coerência | 4,92 | 0,23 | 100,0% |
| Clareza | 4,70 | 0,45 | 96,7% |
| Relevância | 4,58 | 0,37 | 100,0% |
| Ausência de informações inventadas | 4,57 | 0,37 | 96,7% |
| Consistência (entre 2 execuções) | 5,00 | 0,00 | 100,0% |
| **Média geral** | **4,75** | | |

**Respostas satisfatórias:** 30 de 30 cenários (**100,0%**; IC 95%: 88,6% a 100,0%). Critério: média dos cinco critérios ≥ 4,0 e nenhum critério abaixo de 3.

### Métricas objetivas (contra a regra de classificação ±2%)

| Métrica | Valor |
|---|---:|
| Respostas em JSON válido | 100,0% |
| Tendência correta (alta, queda ou estável) | 100,0% |
| Respostas citando número fora dos dados | 5,0% |

Matriz de confusão (linhas = gabarito; colunas = resposta do Claude):

| Gabarito \ Claude | alta | estável | queda | sem formato |
|---|---:|---:|---:|---:|
| alta | 20 | 0 | 0 | 0 |
| estavel | 0 | 20 | 0 | 0 |
| queda | 0 | 0 | 20 | 0 |

### Por categoria de cenário

| Categoria | Cenários | Média geral | Satisfatórios |
|---|---:|---:|---:|
| alta | 6 | 4,70 | 6 de 6 |
| queda | 6 | 4,82 | 6 de 6 |
| estavel | 6 | 4,63 | 6 de 6 |
| lateral_volatil | 2 | 4,50 | 2 de 2 |
| reversao | 4 | 4,90 | 4 de 4 |
| alta_com_realizacao | 2 | 4,90 | 2 de 2 |
| queda_com_repique | 2 | 4,90 | 2 de 2 |
| reversao_estavel | 2 | 4,75 | 2 de 2 |

Nenhum cenário excluído.

### Exemplos reais

**Melhor 1 — MC11** (reversao): Sobe até +6% no meio e devolve tudo, fechando em -5%

Dados enviados ao modelo:
> Cultura: café arábica
> Unidade: saca 60kg (arábica)
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 1680; preço final: 1596; variação: -5%
> Mínimo: 1596 em 2026-09-14; máximo: 1772.28 em 2026-09-07
> Série: 2026-09-01=1680; 2026-09-02=1700.46; 2026-09-03=1712.76; 2026-09-04=1730.63; 2026-09-05=1745.16; 2026-09-06=1755.35; 2026-09-07=1772.28; 2026-09-08=1764; 2026-09-09=1733.25; 2026-09-10=1704.74; 2026-09-11=1684.89; 2026-09-12=1652.51; 2026-09-13=1623.84; 2026-09-14=1596

Resposta do Claude (execução 1; requestId `req_011CgX6U4KidkGtBpc3jErHL`):
> Tendência: queda
> Resumo: O preço do café arábica está em queda, recuando 5% no período de 14 dias. O preço inicial foi 1680 reais por saca, chegando a 1596 reais no final, com máxima de 1772,28 reais no dia 7 de setembro. Houve reversão clara: após sete dias de alta contínua, o mercado inverteu e caiu de forma consistente até o final do período. Recomenda-se cautela e acompanhamento próximo antes de decisões de venda, pois a queda foi acentuada e acelerada nos últimos dias.

- Gabarito: Tendência esperada pela regra: queda (variação líquida de -5%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Sobe até +6% no meio e devolve tudo, fechando em -5%.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Tendência correta, números exatos, reversão descrita com precisão, sem contradições com dados ou gabarito.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem jargões desnecessários.
  - Relevância: **5** — Cobre tendência, variação, pico e recomendação prática de cautela, sem informações supérfluas.
  - Ausência de informações inventadas: **5** — Todos os dados citados constam na série fornecida; nenhuma causa ou evento externo inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 2 — MS12** (reversao): Cai até -6% no meio e recupera, fechando em +5%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 134.4; variação: 5%
> Mínimo: 121.08 em 2026-09-07; máximo: 134.4 em 2026-09-14
> Série: 2026-09-01=128; 2026-09-02=126.74; 2026-09-03=125.62; 2026-09-04=124.23; 2026-09-05=123.5; 2026-09-06=122.23; 2026-09-07=121.08; 2026-09-08=121.62; 2026-09-09=123.7; 2026-09-10=125.75; 2026-09-11=127.84; 2026-09-12=129.78; 2026-09-13=132.46; 2026-09-14=134.4

Resposta do Claude (execução 1; requestId `req_011CgX6YzzSBtzRxKhzZafp6`):
> Tendência: alta
> Resumo: O preço da soja apresentou alta de 5% no período, saindo de R$ 128,00 e fechando em R$ 134,40 por saca de 60kg. A série registrou mínima de R$ 121,08 em 2026-09-07 e máxima de R$ 134,40 em 2026-09-14. Houve clara reversão no meio do período: quedas até o dia 7 de setembro, seguidas de recuperação consistente até o final. Para o curto prazo, mantenha atenção nas próximas cotações para confirmar se a tendência de alta se sustenta ou se há consolidação em patamares menores.

- Gabarito: Tendência esperada pela regra: alta (variação líquida de 5%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Cai até -6% no meio e recupera, fechando em +5%.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Tendência correta, números exatos, descreve precisamente o padrão de queda e recuperação conforme o gabarito.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem jargões desnecessários.
  - Relevância: **5** — Cobre tendência, variação, mínima, máxima e orientação prática sem informações supérfluas.
  - Ausência de informações inventadas: **5** — Todos os dados citados estão presentes na série fornecida; nenhuma causa ou contexto externo inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Melhor 3 — MS13** (alta_com_realizacao): Alta com realização no fim, fechando em +4%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 133.12; variação: 4%
> Mínimo: 128 em 2026-09-01; máximo: 136.82 em 2026-09-08
> Série: 2026-09-01=128; 2026-09-02=129.35; 2026-09-03=130.43; 2026-09-04=131.79; 2026-09-05=133.2; 2026-09-06=134.66; 2026-09-07=136.6; 2026-09-08=136.82; 2026-09-09=135.98; 2026-09-10=135.27; 2026-09-11=134.66; 2026-09-12=134.37; 2026-09-13=133.9; 2026-09-14=133.12

Resposta do Claude (execução 1; requestId `req_011CgX6ZfCqsydsH5pFkLkja`):
> Tendência: alta
> Resumo: O preço da soja apresentou alta de 4% no período, subindo de R$ 128,00 para R$ 133,12 por saca. A cotação iniciou em R$ 128,00 no dia 1º e atingiu o pico de R$ 136,82 no dia 8, seguido de reversão com queda gradual até o final do período. Apesar da retração nos últimos dias, o preço encerrou ainda bem acima do nível inicial. Como produtor, monitore se essa queda recente se intensifica nos próximos dias, pois pode indicar perda de momentum da alta.

- Gabarito: Tendência esperada pela regra: alta (variação líquida de 4%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Alta com realização no fim, fechando em +4%.
- Notas (média 5,00, satisfatória):
  - Coerência: **5** — Tendência correta, números exatos, pico e reversão descritos com precisão, sem contradições.
  - Clareza: **5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem jargões desnecessários.
  - Relevância: **5** — Cobre alta líquida, pico, reversão e alerta prático sobre momentum, sem ruído.
  - Ausência de informações inventadas: **5** — Todos os valores e observações derivam diretamente dos dados fornecidos, nada inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 1 — MS10** (lateral_volatil): Lateral com oscilações de ±3% e fechamento em +0,3%

Dados enviados ao modelo:
> Cultura: soja
> Unidade: saca 60kg
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 128; preço final: 128.38; variação: 0.3%
> Mínimo: 125.02 em 2026-09-06; máximo: 131.22 em 2026-09-09
> Série: 2026-09-01=128; 2026-09-02=129.2; 2026-09-03=130.76; 2026-09-04=130.57; 2026-09-05=127.68; 2026-09-06=125.02; 2026-09-07=126.81; 2026-09-08=129.34; 2026-09-09=131.22; 2026-09-10=128.53; 2026-09-11=125.08; 2026-09-12=125.4; 2026-09-13=126.64; 2026-09-14=128.38

Resposta do Claude (execução 1; requestId `req_011CgX6YhwmCyrQCZw395GoQ`):
> Tendência: estavel
> Resumo: O preço da soja manteve-se estável no período, com variação de apenas 0,3%, saindo de R$ 128,00 e fechando em R$ 128,38 a saca. A série apresentou forte volatilidade, oscilando entre R$ 125,02 (mínimo em 6 de setembro) e R$ 131,22 (máximo em 9 de setembro), evidenciando reversões significativas ao longo dos 14 dias. Após atingir o pico no meio do período, o preço recuou e se estabilizou nos últimos dias próximo ao valor inicial. Como produtor, é prudente monitorar se o preço consegue se firmar acima de R$ 128,00 ou se volta a testar os níveis mais baixos, evitando decisões precipitadas neste momento de consolidação.

- Gabarito: Tendência esperada pela regra: estavel (variação líquida de 0.3%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Lateral com oscilações de ±3% e fechamento em +0,3%.
- Notas (média 4,40, satisfatória):
  - Coerência: **4** — Tendência correta, números exatos, volatilidade descrita com precisão, sem contradições com dados ou gabarito.
  - Clareza: **4** — Texto bem organizado e acessível, mas termos como 'consolidação' e 'reversões' podem ser menos familiares ao produtor rural.
  - Relevância: **4.5** — Cobre tendência, volatilidade, referências de preço e orientação prática sem ruído ou informações desnecessárias.
  - Ausência de informações inventadas: **4.5** — Todos os dados citados estão presentes na série fornecida; nenhuma causa ou evento externo foi inventado.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 2 — MC07** (estavel): Estável, leve alta de +0,4%

Dados enviados ao modelo:
> Cultura: café arábica
> Unidade: saca 60kg (arábica)
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 1680; preço final: 1686.72; variação: 0.4%
> Mínimo: 1677.51 em 2026-09-04; máximo: 1688.06 em 2026-09-11
> Série: 2026-09-01=1680; 2026-09-02=1684.26; 2026-09-03=1678.44; 2026-09-04=1677.51; 2026-09-05=1681.33; 2026-09-06=1679.13; 2026-09-07=1678.53; 2026-09-08=1678.85; 2026-09-09=1684.99; 2026-09-10=1679.75; 2026-09-11=1688.06; 2026-09-12=1681.5; 2026-09-13=1682.8; 2026-09-14=1686.72

Resposta do Claude (execução 1; requestId `req_011CgX6SonphEAFLYh1jwCeY`):
> Tendência: estavel
> Resumo: O preço do café arábica manteve-se estável no período de 1º a 14 de setembro, com variação de apenas 0,4%, saindo de R$ 1.680,00 e fechando em R$ 1.686,72 a saca de 60kg. A cotação oscilou entre o mínimo de R$ 1.677,51 (4 de setembro) e máximo de R$ 1.688,06 (11 de setembro), revelando um movimento de reversão no dia 11, seguido de leve recuo nos dias 12 e 13. Para o curto prazo, recomenda-se manter cautela e acompanhar o comportamento da resistência próxima a R$ 1.688,00, sem tomar decisões precipitadas neste cenário de baixa volatilidade.

- Gabarito: Tendência esperada pela regra: estavel (variação líquida de 0.4%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Estável, leve alta de +0,4%.
- Notas (média 4,40, satisfatória):
  - Coerência: **5** — Tendência correta, números exatos, sem contradições. Identifica corretamente estabilidade com leve alta de 0,4%.
  - Clareza: **3.5** — Bem organizado e objetivo, mas termos como 'resistência' e 'reversão' podem ser pouco acessíveis ao produtor rural.
  - Relevância: **4** — Cobre pontos essenciais, mas a menção à 'resistência técnica' é conceito de análise gráfica, supérfluo para o público-alvo.
  - Ausência de informações inventadas: **4.5** — Todos os dados citados estão presentes na série fornecida. Nenhuma informação externa ou inventada.
  - Consistência (entre 2 execuções): **5,00** (concordância 100,0%)

**Pior 3 — MC02** (alta): Alta moderada (+5%)

Dados enviados ao modelo:
> Cultura: café arábica
> Unidade: saca 60kg (arábica)
> Observações: 14 (de 2026-09-01 a 2026-09-14)
> Preço inicial: 1680; preço final: 1764; variação: 5%
> Mínimo: 1680 em 2026-09-01; máximo: 1764 em 2026-09-14
> Série: 2026-09-01=1680; 2026-09-02=1685.57; 2026-09-03=1693.38; 2026-09-04=1698.26; 2026-09-05=1704.43; 2026-09-06=1712.29; 2026-09-07=1720.19; 2026-09-08=1723.16; 2026-09-09=1727.49; 2026-09-10=1743.26; 2026-09-11=1739.06; 2026-09-12=1755.55; 2026-09-13=1756.46; 2026-09-14=1764

Resposta do Claude (execução 1; requestId `req_011CgX6QzJ3HqYVvXewUF2C7`):
> Tendência: alta
> Resumo: O preço do café arábica está em alta, com variação de +5% no período de 14 dias. O preço iniciou em R$ 1.680 por saca de 60kg em 1º de setembro e fechou em R$ 1.764 em 14 de setembro, atingindo máximo de R$ 1.764 no último dia. A trajetória foi consistentemente ascendente, sem reversões significativas que pudessem interromper a tendência. Para o curto prazo, recomenda-se acompanhar atentamente se o preço consegue manter esse patamar, considerando possíveis consolidações após esse movimento de alta.

- Gabarito: Tendência esperada pela regra: alta (variação líquida de 5%; alta ≥ +2%, queda ≤ −2%, estável entre os dois). Formato da série: Alta moderada (+5%).
- Notas (média 4,40, satisfatória):
  - Coerência: **5** — Tendência, variação, preços inicial e final conferem exatamente com os dados e gabarito. Sem contradições.
  - Clareza: **4.5** — Texto direto, bem estruturado, linguagem acessível ao produtor rural, sem jargões desnecessários.
  - Relevância: **4** — Cobre os pontos essenciais, mas a menção a 'consolidações' é vaga e pouco acionável para o produtor.
  - Ausência de informações inventadas: **3.5** — 'Sem reversões significativas' é interpretação discutível: houve queda em 11/09. Nenhum número inventado.
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
