# Prompts para gerar os diagramas no draw.io

Cada bloco abaixo é um prompt independente. Passe um por vez para a IA, copie o XML
que ela devolver e cole no draw.io em **Extras → Editar Diagrama** (Extras → Edit Diagram).

Os textos, ligações e posições descritos aqui correspondem aos diagramas em PNG/SVG
desta mesma pasta. Se a IA errar algum nome ou ligação, os arquivos prontos continuam valendo.

---

## 1. Diagrama de blocos (arquitetura)

```
Gere o XML mxGraph do draw.io para um diagrama de blocos de arquitetura de aplicação web.
Responda APENAS com o XML, começando em <mxGraphModel> e terminando em </mxGraphModel>,
sem markdown e sem comentários, pronto para colar em "Extras → Editar Diagrama".

ESTILO GERAL (use em todos os elementos):
- Cartões: rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#BFE6EA;shadow=1;arcSize=8;verticalAlign=top;
- Caixinhas internas (chips): rounded=1;whiteSpace=wrap;html=1;fillColor=#F2FAFB;strokeColor=#BFE6EA;fontSize=13;
- Fronteira pontilhada: rounded=1;fillColor=none;strokeColor=#2BB3C0;strokeWidth=3;dashed=1;dashPattern=1 6;verticalAlign=bottom;
- Setas: endArrow=block;endFill=1;html=1;strokeColor=#222222;fontSize=12;labelBackgroundColor=#FFFFFF;
- Fonte padrão: Verdana, cor de texto #2B2B2B. Títulos em negrito (fontStyle=1).

ELEMENTOS (respeite as coordenadas, largura e altura):

1) Ator "Usuários" — shape=actor;fillColor=#D6F1F4;strokeColor=#2BB3C0;
   x=60, y=380, largura=100, altura=130.
   Abaixo dele, uma caixa de texto sem borda (strokeColor=none;fillColor=none;fontSize=12;)
   em x=20, y=520, largura=180, altura=60, com o texto:
   "Produtor rural
   Fornecedor de insumos"

2) Fronteira pontilhada: x=230, y=50, largura=1070, altura=780,
   com o rótulo "Arquitetura da Aplicação Web — AgroAlerta (Docker Compose)".

3) Cartão "Frontend": x=275, y=210, largura=300, altura=510. Texto do cartão:
   "O que o usuário vê e interage
   HTML5 · CSS3 · JavaScript
   Chart.js · Leaflet + OpenStreetMap

   <b>Frontend</b>
   container frontend · porta 5173

   TELAS
   Login e cadastro
   Talhões e alertas (mapa)
   Comparador de insumos
   Mercado e simulador de venda
   Configurações"

4) Cartão "Backend": x=715, y=90, largura=540, altura=695. Texto do topo do cartão:
   "Contém a lógica da aplicação
   Node.js · Express

   <b>Servidor Web (API REST)</b>
   container backend · porta 3001

   MÓDULOS"

5) Dentro do cartão Backend, 9 chips de largura=160 e altura=36, nas posições:
   x=735/905/1075 e y=376/420/464, com os textos, nesta ordem (linha por linha):
   "Autenticação", "Talhões", "Alertas (regras)",
   "Insumos", "Mercado", "IA (LLM)",
   "Notificações", "Painel", "Mensagens".

6) Dentro do cartão Backend, dois blocos de armazenamento:
   - shape=folder;fillColor=#D6F1F4;strokeColor=#2BB3C0; em x=760, y=545, largura=180, altura=110,
     com uma caixa de texto abaixo (x=745, y=660, largura=210, altura=80):
     "<b>Sistema de Arquivos</b>
     Arquivos JSON locais
     histórico de preços
     catálogo de insumos"
   - shape=cylinder3;fillColor=#D6F1F4;strokeColor=#2BB3C0; em x=1050, y=545, largura=140, altura=110,
     com uma caixa de texto abaixo (x=1015, y=660, largura=210, altura=80):
     "<b>Banco de Dados</b>
     PostgreSQL 16
     volume persistente
     (usuários, talhões, alertas…)"
   - Na base do cartão Backend, uma caixa de texto (x=915, y=740, largura=140, altura=30)
     com "<b>Backend</b>" em fontSize=20.

7) Cartão "Serviços Externos": x=1380, y=150, largura=360, altura=565. Texto:
   "Consumidos pelo backend via HTTPS

   <b>Serviços Externos</b>

   <b>Open-Meteo / OpenWeatherMap</b>
   previsão do tempo
   <b>Banco Central (PTAX · SGS)</b>
   câmbio e índices agropecuários
   <b>Yahoo Finance (ICE · CBOT)</b>
   cotações internacionais
   <b>Anthropic Claude</b>
   análise de mercado com IA
   <b>Google Geocoding / Nominatim</b>
   endereço ⇄ coordenadas
   <b>Twilio · SMTP</b>
   alertas por SMS e e-mail

   <i>Sem chave configurada, a integração correspondente usa dados simulados.</i>"

SETAS (todas com rótulo escrito na própria seta):
- Usuários → Frontend, rótulo "Coleta de dados"
- Frontend → Usuários, rótulo "Exibe resultados"
- Frontend → Backend, rótulo "Requisição HTTP"
- Backend → Frontend, rótulo "Resposta JSON"
- Backend → Serviços Externos, rótulo "Consulta HTTPS"
- Serviços Externos → Backend, rótulo "Dados JSON"
- Servidor Web (cartão Backend) ⇄ Sistema de Arquivos: seta dupla (startArrow=block;startFill=1), sem rótulo
- Servidor Web (cartão Backend) ⇄ Banco de Dados: seta dupla (startArrow=block;startFill=1), sem rótulo

REGRAS: não invente blocos, tecnologias, setas ou rótulos além dos listados.
Não altere nenhum texto nem a acentuação. Use html=1 e whiteSpace=wrap em todos os elementos
para que as quebras de linha apareçam.
```

---

## 2. Diagrama de classes

```
Gere o XML mxGraph do draw.io para um diagrama de classes UML.
Responda APENAS com o XML, começando em <mxGraphModel> e terminando em </mxGraphModel>,
sem markdown e sem comentários, pronto para colar em "Extras → Editar Diagrama".

FORMATO DAS CLASSES: use o formato de classe UML do draw.io, ou seja, um swimlane
com estilo:
swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;
startSize=30;horizontalStack=0;resizeParent=1;resizeParentMax=0;html=1;fillColor=#FFFFFF;
strokeColor=#BFE6EA;swimlaneFillColor=#D6F1F4;
Cada atributo e cada método é uma linha filha com estilo:
text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;html=1;fontSize=13;
e altura 26. Entre o último atributo e o primeiro método, insira uma linha separadora com estilo:
line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;strokeColor=#BFE6EA;
Todas as classes têm largura 260. A altura é 30 + 26 × (número de linhas) + 8.
Atributos começam com "− " (sinal de menos) e métodos com "+ ".

CLASSES (nome, posição x/y, atributos, métodos):

Usuario — x=800, y=60 — nome em itálico (é abstrata), com a palavra «abstrata» na linha do título
 Atributos: − id: int / − nome: String / − email: String / − senhaHash: String / − salt: String /
 − papel: Papel / − cidade: String / − telefone: String / − criadoEm: DateTime
 Métodos: + registrar() / + autenticar() / + atualizarPerfil() / + alterarSenha() / + excluirConta()

Sessao — x=430, y=120
 Atributos: − token: String / − criadoEm: DateTime / − expiraEm: DateTime
 Métodos: + validar() / + encerrar()

PreferenciasUsuario — x=1170, y=120
 Atributos: − culturaFavorita: Cultura / − unidadeTemperatura: String / − notificacoes: boolean / − atualizadoEm: DateTime
 Métodos: + atualizar()

Produtor — x=430, y=520 — sem atributos
 Métodos: + cadastrarTalhao() / + consultarPainel() / + consultarAlertas() / + lerMensagens()

Fornecedor — x=1170, y=520 — sem atributos
 Métodos: + publicarOferta() / + listarMinhasOfertas() / + removerOferta()

Talhao — x=430, y=780
 Atributos: − id: int / − nome: String / − cultura: Cultura / − fase: String / − endereco: String /
 − latitude: double / − longitude: double / − enderecoFormatado: String / − poligono: JSON / − areaHa: double
 Métodos: + cadastrar() / + editar() / + excluir() / + geocodificarEndereco() / + calcularAreaHa()

MensagemProdutor — x=60, y=780
 Atributos: − chave: String / − nivel: NivelAlerta / − titulo: String / − corpo: String /
 − recomendacao: String / − lida: boolean / − statusEmail: String / − statusSms: String
 Métodos: + gerarParaTalhao() / + sincronizar() / + marcarLida()

AlertaGerado — x=800, y=840
 Atributos: − regraId: String / − nivel: NivelAlerta / − titulo: String / − mensagem: String / − recomendacao: String
 Métodos: + avaliarAlertas() / + recomendarInsumos()

OfertaInsumo — x=1170, y=780
 Atributos: − id: int / − nome: String / − categoria: String / − unidade: String / − preco: double /
 − cidade: String / − telefone: String
 Métodos: + listarInsumos() / + gerarInsightCompra()

EnvioAlerta — x=60, y=1166
 Atributos: − canal: String / − destino: String / − modo: String / − sucesso: boolean / − detalhe: String
 Métodos: + enviarEmail() / + enviarSms() / + despacharPendentes()

LeituraClima — x=430, y=1246
 Atributos: − fonte: String / − temperaturaMinima: double / − chuvaAcumulada7d: double /
 − diasSemChuva: int / − probabilidadeChuva: int / − ventoMaximoKmh: double
 Métodos: + buscarClimaAtual() / + gerarSimulado()

CotacaoMercado — x=1540, y=610
 Atributos: − cultura: Cultura / − data: Date / − preco: double / − unidade: String / − fonte: String / − ticker: String
 Métodos: + obterHistorico() / + buscarCotacaoAoVivo() / + converterParaReais() / + gerarProjecao()

AnaliseIA — x=1540, y=976
 Atributos: − cultura: Cultura / − resumo: String / − gerarPor: String / − fontes: JSON / − contexto: JSON
 Métodos: + gerarAnaliseTendencia() / + chamarClaudeComBusca()

ENUMERAÇÕES (mesmo formato, com «enumeração» na linha do título, só um compartimento):
Papel — x=1540, y=60 — valores: produtor / fornecedor
NivelAlerta — x=1540, y=194 — valores: baixo / medio / alto
Cultura — x=1540, y=348 — valores: cafe / soja / milho / cana / feijao

RELACIONAMENTOS (use exatamente estes estilos de aresta):
- Generalização: endArrow=block;endFill=0;endSize=16;html=1;strokeColor=#4A4A4A;
  Produtor → Usuario
  Fornecedor → Usuario
- Composição: startArrow=diamondThin;startFill=1;startSize=14;endArrow=none;html=1;strokeColor=#4A4A4A;
  (a ponta do losango fica sempre no "todo")
  Usuario → Sessao, rótulo "possui", multiplicidade "1" na ponta Usuario e "0..*" na ponta Sessao
  Usuario → PreferenciasUsuario, rótulo "define", "1" e "1"
  Produtor → Talhao, rótulo "possui", "1" e "0..*"
  Fornecedor → OfertaInsumo, rótulo "publica", "1" e "0..*"
  Talhao → AlertaGerado, rótulo "gera", "1" e "0..*"
- Agregação: startArrow=diamondThin;startFill=0;startSize=14;endArrow=none;html=1;strokeColor=#4A4A4A;
  Talhao → LeituraClima, rótulo "registra", "0..1" e "0..*"
  MensagemProdutor → EnvioAlerta, rótulo "enviada por", "0..1" e "0..*"
- Associação simples: endArrow=none;html=1;strokeColor=#4A4A4A;
  Produtor → MensagemProdutor, rótulo "recebe", "1" e "0..*"
  Talhao → MensagemProdutor, rótulo "refere-se a", "0..1" e "0..*"
- Dependência: dashed=1;endArrow=open;endFill=0;endSize=12;html=1;strokeColor=#4A4A4A;
  AlertaGerado → OfertaInsumo, rótulo «recomenda»
  AlertaGerado → LeituraClima, rótulo «avalia»
  AnaliseIA → CotacaoMercado, rótulo «utiliza»

As multiplicidades devem ser rótulos posicionados nas pontas da aresta
(um rótulo filho da aresta com x=-1 para a origem e x=1 para o destino).

REGRAS: não invente classes, atributos, métodos, enumerações ou relacionamentos além dos listados.
Não altere nenhum texto, tipo, acentuação ou multiplicidade.
```

---

## 3. Diagrama de casos de uso

```
Gere o XML mxGraph do draw.io para um diagrama de casos de uso UML, simples.
Responda APENAS com o XML, começando em <mxGraphModel> e terminando em </mxGraphModel>,
sem markdown e sem comentários, pronto para colar em "Extras → Editar Diagrama".

ESTILOS:
- Casos de uso: ellipse;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#2BB3C0;strokeWidth=2;fontSize=14;
- Atores: shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;
  fillColor=#D6F1F4;strokeColor=#2BB3C0;strokeWidth=2;fontStyle=1;
- Fronteira do sistema: rounded=1;fillColor=none;strokeColor=#2BB3C0;strokeWidth=3;
  dashed=1;dashPattern=1 6;verticalAlign=top;fontStyle=1;fontSize=16;
- Associação ator–caso: endArrow=none;html=1;strokeColor=#4A4A4A;
- Generalização entre atores: endArrow=block;endFill=0;endSize=16;html=1;strokeColor=#4A4A4A;
- «include» e «extend»: dashed=1;endArrow=open;endFill=0;endSize=12;html=1;strokeColor=#4A4A4A;fontSize=12;

FRONTEIRA DO SISTEMA: x=300, y=50, largura=890, altura=1040, rótulo "Sistema AgroAlerta".
Todos os casos de uso ficam dentro dela. Os três atores ficam fora, à esquerda.

ATORES (largura=80, altura=120):
- "Fornecedor de insumos" — x=110, y=100
- "Usuário" — x=110, y=435 — nome em itálico (ator abstrato)
- "Produtor rural" — x=110, y=870

CASOS DE USO (altura=64):
- "Publicar ofertas de insumos" — x=567, y=118, largura=266
- "Fazer login" — x=590, y=268, largura=220
- "Configurar conta" — x=580, y=358, largura=240
- "Comparar preços de insumos" — x=555, y=448, largura=290
- "Consultar mercado" — x=580, y=538, largura=240
- "Simular venda" — x=590, y=658, largura=220
- "Gerar análise com IA" — x=910, y=538, largura=240
- "Gerenciar talhões" — x=580, y=808, largura=240
- "Consultar alertas climáticos" — x=560, y=898, largura=280
- "Receber alertas por e-mail/SMS" — x=550, y=988, largura=300

ASSOCIAÇÕES (linha sem seta, sem rótulo):
- Fornecedor de insumos → "Publicar ofertas de insumos"
- Usuário → "Fazer login", "Configurar conta", "Comparar preços de insumos",
  "Consultar mercado", "Simular venda"
- Produtor rural → "Gerenciar talhões", "Consultar alertas climáticos",
  "Receber alertas por e-mail/SMS"

GENERALIZAÇÃO ENTRE ATORES (triângulo vazio apontando para Usuário):
- Fornecedor de insumos → Usuário
- Produtor rural → Usuário

RELAÇÕES ENTRE CASOS DE USO:
- "Consultar mercado" → "Gerar análise com IA", rótulo «include»
- "Simular venda" → "Consultar mercado", rótulo «extend»

REGRAS: não invente atores, casos de uso ou ligações além dos listados. Não altere nenhum texto.
Nenhuma linha deve atravessar uma elipse — os casos de uso estão agrupados em três faixas
horizontais, cada uma na altura do seu ator, justamente para evitar isso.
```
