# Apêndice: prompts literais enviados à IA

Os textos abaixo foram gerados pelas **mesmas funções do código** que enviam as requisições à API da Anthropic (versões avaliadas: `clima-v1` e `mercado-v2`). Cada prompt é uma única mensagem do usuário; não há prompt de sistema. O que varia de um cenário para outro são apenas os **dados** no fim do texto; as instruções são fixas.

Gerado por `npm run ia:prompts` (`backend/avaliacao-ia/exportar-prompts.js`).

## Parâmetros das chamadas

| Prompt | Função | Modelo | `max_tokens` | Temperatura |
|---|---|---|---:|---|
| A. Mercado | `montarPromptTendencia` (`backend/services/market.js`) | `claude-haiku-4-5-20251001` | 900 | padrão da API (não definida) |
| B. Clima | `promptAnaliseClimatica` e `montarContextoClima` (`backend/services/climaIA.js`) | `claude-haiku-4-5-20251001` | 900 | padrão da API (não definida) |
| C. Avaliador | `promptJuiz` (`backend/avaliacao-ia/criterios.js`) | `claude-sonnet-4-6` | 900 | 0 |

## A. Prompt de mercado (`mercado-v2`)

Exemplo com o cenário controlado **MC01** (Alta forte e contínua (+9,5%); café, 14 observações). Variam por cenário: cultura, unidade, número de observações e datas, preços inicial e final, variação, mínimo, máximo e a série completa.

```text
Você é um analista de mercado agrícola brasileiro, escrevendo para um produtor rural do Sul de Minas Gerais. Analise SOMENTE a série de preços abaixo.

Regra de classificação da tendência do período (use exatamente esta): compare o preço final com o inicial; variação de +2% ou mais = "alta"; variação de -2% ou menos = "queda"; entre -2% e +2% = "estavel".

Responda APENAS com JSON válido, sem markdown: {"tendencia":"alta|queda|estavel","resumo":"..."}.
No resumo (3 a 5 frases, português simples): diga primeiro se o preço está em alta, queda ou estável e quanto variou; cite preço inicial, final, mínimo e máximo quando útil; se houve reversão no meio do período, diga; termine com uma orientação prudente de curto prazo para o produtor.
Use apenas os números dos dados. Não cite eventos, países, estoques, câmbio, clima ou notícias que não estejam nos dados. Se quiser mencionar fatores gerais do mercado, use linguagem condicional ("pode", "costuma") e deixe claro que é contexto geral, não dado da série.

Dados:
Cultura: café arábica
Unidade: saca 60kg (arábica)
Observações: 14 (de 2026-09-01 a 2026-09-14)
Preço inicial: 1680; preço final: 1839.6; variação: 9.5%
Mínimo: 1680 em 2026-09-01; máximo: 1839.6 em 2026-09-14
Série: 2026-09-01=1680; 2026-09-02=1686.25; 2026-09-03=1700.65; 2026-09-04=1710.3; 2026-09-05=1726.3; 2026-09-06=1744.02; 2026-09-07=1761.66; 2026-09-08=1767.59; 2026-09-09=1784.15; 2026-09-10=1793.47; 2026-09-11=1800.25; 2026-09-12=1809.26; 2026-09-13=1820.52; 2026-09-14=1839.6
```

## B. Prompt de clima (`clima-v1`)

Exemplo com o cenário controlado **C04** (Geada moderada na granação). Variam por cenário: talhão, cultura e fase, os valores meteorológicos, a lista de alertas do motor de regras e, quando houver, os avisos do INMET.

```text
Você é o assistente de monitoramento climático do AgroAlerta, escrevendo para um produtor rural do Sul de Minas Gerais.
Interprete SOMENTE os dados abaixo: temperatura, chuva, vento e os alertas já calculados pelo motor de regras. Não invente números, datas, eventos nem riscos que não constem nos dados. Se nenhum alerta foi disparado, diga que não há risco relevante no momento.

Responda APENAS com JSON válido, sem markdown, neste formato:
{"nivelGeral":"baixo|medio|alto","resumo":"até 4 frases em português simples","riscos":[{"tipo":"geada|estiagem|excesso_chuva|vento|chuva_colheita","nivel":"medio|alto","justificativa":"1 frase usando os números dos dados"}],"recomendacoes":["ação prática e curta"]}
Regras: liste em "riscos" apenas os riscos que constam nos alertas do motor de regras, mantendo o nível de cada um; "nivelGeral" é o maior nível entre os riscos ("baixo" se não houver nenhum); "recomendacoes" fica vazio quando não há risco.

Dados:
Talhão: Talhão C04 (café arábica, fase granacao)
Leitura meteorológica (fonte cenario-controlado):
- Temperatura mínima prevista nos próximos 7 dias: 4 °C
- Chuva acumulada prevista nos próximos 7 dias: 25 mm
- Dias secos consecutivos até ontem: 2
- Probabilidade máxima de chuva nos próximos 7 dias: 40%
- Vento máximo previsto: 15 km/h
- Evapotranspiração (ET0) prevista em 7 dias: 28 mm
Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
- [medio] Risco de geada: Temperatura mínima prevista de 4°C. Risco moderado de geada. (janela: próximos dias)
```

## C. Prompt do avaliador (juiz)

Usado na avaliação de assertividade, não pelo usuário final. Exemplo com o cenário **C04**, execução 1 da rodada `2026-10-29-19-36-36`. Varia por cenário: os dados enviados, o gabarito, os pontos-chave, o que a resposta não deve fazer, o texto da resposta avaliada e a lista de números suspeitos.

```text
Você é um avaliador técnico e independente das respostas de um assistente de IA do AgroAlerta, sistema de alertas para produtores rurais. Seja criterioso e não complacente: use toda a escala de 1 a 5 e dê 5 apenas quando não houver ressalva.

Módulo avaliado: monitoramento climático: o assistente interpreta temperatura, chuva, vento e os alertas do motor de regras de um talhão e devolve um parecer ao produtor.

## Dados que o assistente recebeu
Talhão: Talhão C04 (café arábica, fase granacao)
Leitura meteorológica (fonte cenario-controlado):
- Temperatura mínima prevista nos próximos 7 dias: 4 °C
- Chuva acumulada prevista nos próximos 7 dias: 25 mm
- Dias secos consecutivos até ontem: 2
- Probabilidade máxima de chuva nos próximos 7 dias: 40%
- Vento máximo previsto: 15 km/h
- Evapotranspiração (ET0) prevista em 7 dias: 28 mm
Alertas calculados pelo motor de regras (avaliação determinística da cultura e fase):
- [medio] Risco de geada: Temperatura mínima prevista de 4°C. Risco moderado de geada. (janela: próximos dias)

## Gabarito do cenário (referência)
Nível geral esperado: medio. Riscos esperados (tipo, nível): geada (medio).
Pontos-chave esperados: risco moderado de geada; monitorar a previsão
A resposta NÃO deve: classificar como risco alto

## Resposta do assistente (texto exibido ao produtor; o JSON técnico já foi convertido em texto, não avalie o formato)
<<<
Nível geral: medio
Resumo: Há risco moderado de geada nos próximos dias, com temperatura mínima prevista de 4°C. O café arábica em fase de granação é sensível a esta condição. A chuva prevista de 25 mm será insuficiente para compensar a evapotranspiração de 28 mm. Monitore as condições noturnas.
Riscos:
- geada (medio): Temperatura mínima prevista de 4°C nos próximos 7 dias indica risco moderado de geada para o café em granação.
Recomendações:
- Acompanhe as temperaturas noturnas diariamente
- Prepare sistemas de proteção caso temperatura caia abaixo de 0°C
- Monitore a umidade do solo nos próximos dias
>>>

## Verificação automática de números
Todos os números citados aparecem nos dados ou são derivações simples deles.

## Critérios (nota inteira de 1 a 5)
- coerencia (Coerência): A resposta é correta e coerente com os dados e com o gabarito (níveis, tendência, riscos), sem se contradizer? 5 = totalmente coerente com dados e gabarito, sem contradições; 3 = pequena imprecisão ou ressalva que não muda a conclusão; 1 = contradiz os dados ou o gabarito.
- clareza (Clareza): O texto é simples, objetivo e fácil de entender por um produtor rural? 5 = direto, bem organizado, linguagem simples; 3 = compreensível, mas com rodeios ou termos desnecessários; 1 = confuso ou ilegível.
- relevancia (Relevância): A resposta cobre o que importa para a decisão do produtor (pontos-chave) e evita ruído ou alarmes desnecessários? 5 = cobre todos os pontos-chave e nada fora de lugar; 3 = cobre parte do essencial ou traz conteúdo supérfluo; 1 = omite o essencial ou foge do assunto.
- ausenciaInvencao (Ausência de informações inventadas): A resposta usa só o que está nos dados? Contexto geral só é aceitável se estiver claramente rotulado como geral. 5 = nada fora dos dados fornecidos; 3 = uma afirmação específica sem sustentação nos dados; 1 = várias invenções (números, eventos, causas).

Responda APENAS com JSON válido, sem markdown, neste formato (justificativa com no máximo 25 palavras):
{"coerencia":{"nota":0,"justificativa":""},"clareza":{"nota":0,"justificativa":""},"relevancia":{"nota":0,"justificativa":""},"ausenciaInvencao":{"nota":0,"justificativa":""}}
```
