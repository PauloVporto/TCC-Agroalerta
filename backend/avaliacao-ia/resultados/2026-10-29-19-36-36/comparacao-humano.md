# Comparação humano × juiz — validacao-humana.docx (Iury Teixeira de Souza)

Rodada: `2026-10-29-19-36-36` · 20 cenários · 180 notas · juiz: Claude Sonnet 4.6, comparado na mesma execução que o avaliador viu (Resposta 1 × execução 1, Resposta 2 × execução 2; a consistência é comparada com a calculada entre as duas execuções).

| Recorte | Notas | Diferença média absoluta | Viés (humano − juiz) | Concordância exata | Dentro de ±1 ponto | Spearman |
|---|---:|---:|---:|---:|---:|---:|
| **Todas as notas** | 180 | 0,22 | 0,15 | 66,7% | 98,9% | -0,02 |
| Coerência | 40 | 0,08 | 0,07 | 92,5% | 97,5% | -0,04 |
| Clareza | 40 | 0,24 | 0,17 | 60,0% | 97,5% | 0,26 |
| Relevância | 40 | 0,30 | 0,24 | 60,0% | 100,0% | -0,09 |
| Ausência de informações inventadas | 40 | 0,28 | 0,28 | 72,5% | 100,0% | - |
| Consistência entre as duas respostas | 20 | 0,17 | -0,17 | 30,0% | 100,0% | - |
| Clima | 90 | 0,10 | 0,01 | 75,6% | 100,0% | 0,01 |
| Mercado | 90 | 0,34 | 0,29 | 57,8% | 97,8% | -0,02 |
| Resposta 1 | 80 | 0,18 | 0,14 | 75,0% | 100,0% | -0,03 |
| Resposta 2 | 80 | 0,27 | 0,24 | 67,5% | 97,5% | 0,14 |
| Média por cenário | 20 | 0,18 | 0,15 | 5,0% | 100,0% | 0,01 |

Viés positivo = o humano deu notas mais altas que o juiz; negativo = o juiz foi mais benevolente.

## Cenários com maior diferença

| Cenário | Humano (média) | Juiz (média) | Diferença | Observação do avaliador |
|---|---:|---:|---:|---|
| MS10 | 5,00 | 4,33 | 0,67 | - |
| MC07 | 4,96 | 4,33 | 0,63 | A resposta 2 não apresenta tanta clareza para um produtor conseguir entender. |
| MC10 | 4,94 | 4,56 | 0,38 | A resposta 1 é muito complicada em relação a 2. |
| MS04 | 4,98 | 4,67 | 0,31 | - |
| MS07 | 4,98 | 4,67 | 0,31 | A resposta da 2 foi muito longa para um resumo. |

## Avisos

- Critério 'Ausência de informações inventadas': o avaliador deu a mesma nota (5) em todos os cenários; a correlação fica indefinida e a comparação diz pouco sobre a capacidade de discriminar.
