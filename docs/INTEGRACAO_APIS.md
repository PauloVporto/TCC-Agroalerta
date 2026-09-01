# Integração de APIs — AgroAlerta (TCC)

Documento que registra as decisões do planejamento (`TCC_Planejamento_e_Pendencias.docx`).

## Arquitetura

```
Talhão (lat/lng) ──► Open-Meteo ──► motor de regras (alertas)
                                          │
Cultura ──► Mercado interno (R$/saca)     │
         ──► Bolsas ICE/CBOT (Yahoo)      ├─► LLM
         ──► Paridade (contrato × PTAX)   │
         ──► IC-Br Agro (BCB)             │
```

O modelo **não** inventa clima nem preço: o backend monta o contexto em `services/llm.js` com os números das APIs. Sem `ANTHROPIC_API_KEY`, a análise é simulada, mas o mesmo contexto continua visível para a banca (`contextoLlm`).

Responsável sugerido no planejamento: **Kauan / todos** (camada LLM). A implementação ficou no backend, compartilhada pelos módulos de mercado e de insumos.

## API de clima — escolha: Open-Meteo

| Alternativa              | Por que não foi a principal                          |
|--------------------------|------------------------------------------------------|
| OpenWeather              | Exige chave; cota no plano gratuito                  |
| Google Maps Weather      | Exige faturamento no Google Cloud                    |
| Visual Crossing          | Plano gratuito limitado                              |
| **Open-Meteo (escolhida)** | Sem chave para uso acadêmico; diário + histórico   |

Dados usados pelo motor de regras: temperatura mínima, chuva dos 7 dias, dias secos consecutivos, probabilidade de chuva, vento máximo.

Provedor alternativo: `WEATHER_PROVIDER=openweather` + `OPENWEATHER_API_KEY`.

## API de mercado agrícola — Brasil e internacional

| Alternativa         | Papel no sistema                                      |
|---------------------|-------------------------------------------------------|
| SAFRAS / Cedro / Agrolink | Comerciais; fora do escopo gratuito do TCC     |
| Série interna (Cepea) | Mercado interno Brasil, em R$/saca                 |
| **Yahoo Finance**   | Futuros ICE (café, açúcar) e CBOT (soja, milho)       |
| **BCB PTAX + SGS 1** | Câmbio para paridade de exportação em reais         |
| **IC-Br Agro (SGS 27575)** | Índice de commodities agropecuárias no Brasil |

Feijão não tem futuro líquido nas bolsas: só mercado interno.

A tela Mercado compara as duas pontas no mesmo gráfico (R$/saca): preço interno versus paridade internacional.

## Banco de dados

Além de usuários, sessões e talhões:

- `preferencias_usuario` — cultura favorita, unidade de temperatura, notificações
- `leituras_clima` — snapshot Open-Meteo por talhão (quando o alerta é consultado)
- `cotacoes_mercado` — última cotação persistida por cultura/fonte
- `analises_ia` — textos gerados pelo LLM (ou fallback simulado)
- `sessoes.expira_em` — sessão válida por 7 dias

## Testes

```bash
cd backend && npm test
```

Cobre o motor de regras, o parser da Open-Meteo e a montagem do contexto do LLM.
