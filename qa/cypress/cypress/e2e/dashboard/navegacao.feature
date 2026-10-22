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
      | Insumos e preços | Insumos e preços     |
      | Mercado          | Tendência de mercado |
      | Relatórios       | Relatórios           |

  Cenário: Recolher e expandir o menu lateral
    Dado que estou autenticado no painel
    Quando clico no botão de recolher o menu
    Então os rótulos do menu ficam ocultos
    E ao expandir novamente os rótulos voltam a aparecer

  Cenário: Página de relatórios lista os relatórios disponíveis
    Dado que estou autenticado no painel
    Quando acesso a página "Relatórios" pelo menu
    Então a página lista 4 relatórios, incluindo "Comparativo de preços de insumos"
    E vejo a seção de relatórios "Disponíveis para exportação"

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
