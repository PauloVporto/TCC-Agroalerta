# AgroAlerta

Protótipo do TCC — Sistema de Monitoramento Climático de Safras com
Recomendação Inteligente de Insumos e Análise de Mercado via IA.

Culturas: café, soja, milho, cana-de-açúcar e feijão. Região: Sul de Minas Gerais.

## Estrutura do projeto

```
agroalerta/
├── backend/          API (Node.js + Express)
│   ├── data/           bases simuladas (insumos, histórico de mercado)
│   ├── routes/          rotas HTTP (auth, talhões, alertas, insumos, mercado)
│   ├── services/         lógica de negócio (auth, clima, regras, geocoding, mercado)
│   └── server.js         ponto de entrada
└── frontend/          interface web (HTML/CSS/JS puro, sem build)
    ├── index.html        inclui tela de login/registro + dashboard
    ├── styles.css
    ├── app.js
    ├── config.example.js  chave do Google Maps (copiar para config.js)
    └── serve.js          servidor estático simples p/ rodar localmente
```

## Como rodar

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

O servidor sobe em `http://localhost:3001`.

### 2. Frontend

Em outro terminal:

```bash
cd frontend
cp config.example.js config.js
node serve.js
```

Acesse `http://localhost:5173` no navegador. Na primeira vez, crie uma conta
pela aba "Criar conta" da tela inicial — os talhões cadastrados ficam
vinculados a cada usuário.

> Não precisa de nenhuma instalação extra no frontend — é HTML/CSS/JS puro,
> sem framework nem etapa de build.

## Modo simulado vs. modo real

O sistema roda **sem nenhuma chave de API configurada** — ele cai automaticamente
em modo simulado (dados fictícios, mas plausíveis) para clima, IA de mercado e
geocodificação. Isso é proposital: permite testar o fluxo inteiro do zero.

**Importante sobre o módulo de IA (mercado e insumos)**: quando `ANTHROPIC_API_KEY`
está configurada, o sistema usa a ferramenta de busca na web da Anthropic
(`web_search`) para pesquisar informação **real e atual** sobre o mercado agrícola
antes de gerar a análise — clima nas regiões produtoras, câmbio, exportação/
importação, estoques mundiais, frete e política agrícola. As fontes usadas
aparecem listadas abaixo de cada análise no app. Sem a chave, o sistema usa uma
lista fixa de notícias cadastradas manualmente (modo simulado), o que é
suficiente para testar o fluxo mas não reflete o cenário real do dia.

Para ligar os dados reais:

**Backend** (`backend/.env`):

| Variável | Serviço | Onde conseguir |
|---|---|---|
| `OPENWEATHER_API_KEY` | Previsão do tempo | https://openweathermap.org/api |
| `ANTHROPIC_API_KEY` | Análise de tendência de mercado (IA) | https://console.anthropic.com |
| `GOOGLE_MAPS_API_KEY` | Geocodificação de endereço do talhão (servidor) | https://console.cloud.google.com/apis/credentials |

**Frontend** (`frontend/config.js`):

| Variável | Serviço | Onde conseguir |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_KEY` | Exibição do mapa com os talhões (navegador) | https://console.cloud.google.com/apis/credentials |

Repare que são **duas chaves diferentes do Google Maps**: uma para o
backend usar na Geocoding API (deve ficar restrita por IP/servidor) e
outra para o frontend usar na Maps JavaScript API (deve ficar restrita
por domínio/referrer, já que roda no navegador do usuário). Configure
as duas restrições no Console do Google para evitar uso indevido.

O rodapé da sidebar no app mostra, em tempo real, se cada fonte está em
modo **real** ou **simulado**.

⚠️ **Nunca** commite `backend/.env` nem `frontend/config.js` com chaves
reais no Git. O `.gitignore` do backend já cobre o `.env`; adicione
`frontend/config.js` ao seu `.gitignore` também.

## Autenticação

- Cadastro e login com e-mail/senha (senha armazenada com hash `scrypt`, nunca em texto puro)
- Sessão via token, guardado no `sessionStorage` do navegador (expira ao fechar a aba)
- Cada usuário só vê e gerencia os próprios talhões — isolamento aplicado no backend, não só na interface
- **Limitação conhecida (documentar no TCC)**: usuários e sessões ficam em memória; reiniciar o backend apaga todas as contas. Evoluir para um banco real remove essa limitação.

## Módulos implementados

| Módulo | O que faz | Onde está |
|---|---|---|
| 0. Autenticação | Cadastro/login, isolamento de dados por usuário | `backend/services/auth.js`, `backend/routes/auth.js` |
| 1. Monitoramento climático | Motor de regras que gera alertas por cultura/fase (café, soja, milho, cana, feijão) | `backend/services/rules.js` |
| 2. Recomendação de insumos | Associa cada tipo de alerta a categorias de insumo | `backend/routes/insumos.js` |
| 3. Comparação de preços | Ranking de fornecedores por menor preço | `backend/data/insumos.json` |
| 4. Análise de mercado (IA + busca web) | Histórico de preço + leitura de tendência com busca em tempo real (clima, câmbio, exportação/importação, estoques, frete, política agrícola), para as 5 culturas | `backend/services/market.js` |
| Insight de compra de insumos (IA + busca web) | Recomendação sobre comprar agora ou esperar, considerando preços coletados e cenário de custo de matéria-prima/mercado | `backend/services/insumosIA.js` |
| Mapa de talhões | Visualização geográfica dos talhões cadastrados (Google Maps) | `frontend/app.js` (`inicializarMapa`) |

## Próximos passos sugeridos (para o desenvolvimento do TCC)

- [ ] Trocar o armazenamento em memória (talhões e usuários) por um banco real (SQLite é o mais simples)
- [ ] Revisar as faixas usadas no motor de regras (`rules.js`) com fontes agronômicas específicas (Embrapa/Epamig) por cultura e citá-las no referencial teórico
- [ ] Ajustar a lista de notícias curadas em `services/market.js` para refletir o cenário real na data da defesa
- [ ] Testar a geocodificação e o mapa com endereços reais da região quando as chaves do Google Maps estiverem configuradas
- [ ] Escrever testes automatizados para o motor de regras e para o fluxo de autenticação (partes mais fáceis de testar e mais valorizadas na banca)
- [ ] Considerar expirar/renovar tokens de sessão (hoje eles não expiram automaticamente)
