# language: pt
Funcionalidade: Painel - Navegação, relatórios e sessão
  Como produtor autenticado
  Quero navegar entre as páginas do painel e encerrar minha sessão com segurança
  Para usar o sistema com praticidade e proteger minha conta

  Esquema do Cenário: Menu lateral leva a cada página
    Dado que estou autenticado no painel
    Quando acesso a página "<menu>" pelo menu
    Então vejo o título "<titulo>"
    E o item "<menu>" do menu continua visível

    Exemplos:
      | menu             | titulo               |
      | Visão geral      | Painel da safra      |
      | Alertas          | Alertas climáticos   |
      | Talhões          | Talhões              |
      | Notificações     | Notificações         |
      | Insumos e preços | Insumos e preços     |
      | Mercado          | Tendência de mercado |
      | Relatórios       | Relatórios           |
      | Notícias         | Notícias do agro     |

  Cenário: Recolher e expandir o menu lateral
    Dado que estou autenticado no painel
    Quando clico no botão de recolher o menu
    Então os rótulos do menu ficam ocultos
    E ao expandir novamente os rótulos voltam a aparecer

  Cenário: Página de relatórios oferece os 4 tipos e começa sem histórico
    Dado que estou autenticado no painel
    Quando acesso a página "Relatórios" pelo menu
    Então vejo a seção de relatórios "Disponíveis para exportação"
    E a conta nova ainda não tem relatórios no histórico
    Quando abro o formulário de novo relatório
    Então posso escolher entre 4 tipos, incluindo "Compras e economia de insumos"

  Cenário: Cada relatório do histórico aparece uma única vez
    Dado que estou autenticado no painel com 2 relatórios no histórico
    Quando acesso a página "Relatórios" pelo menu
    Então o histórico lista exatamente 2 relatórios
    Quando abro o primeiro relatório do histórico
    Então vejo as ações de visualizar, baixar e remover

  Cenário: Sair encerra a sessão e volta à página inicial
    Dado que estou autenticado no painel
    Quando clico em sair
    Então a página inicial é exibida
    E a sessão foi encerrada
    E o token antigo não é mais aceito pela API

  Cenário: Painel exige autenticação
    Dado que não estou autenticado
    Quando acesso diretamente o painel
    Então sou redirecionado para a tela de login
    E nenhum token é guardado na sessão
