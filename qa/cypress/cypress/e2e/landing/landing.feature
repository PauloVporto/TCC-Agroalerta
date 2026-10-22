# language: pt
Funcionalidade: Página inicial (landing)
  Como visitante
  Quero conhecer o AgroAlerta e chegar às telas de acesso
  Para entrar ou criar minha conta

  Cenário: Exibe o título e as opções de acesso
    Dado que acesso a página inicial
    Então vejo o título principal da página inicial
    E vejo os botões de entrar e criar conta

  Cenário: Botão "Entrar" do cabeçalho leva ao login
    Dado que acesso a página inicial
    Quando clico em "Entrar" no cabeçalho
    Então sou redirecionado para a tela de login
    E vejo o botão "Entrar no painel"

  Cenário: Botão "Criar conta" abre o cadastro
    Dado que acesso a página inicial
    Quando clico em "Criar conta" na página inicial
    Então sou redirecionado para a tela de cadastro
    E vejo o título "Criar conta"

  Cenário: Botão final "Entrar no painel" leva ao login
    Dado que acesso a página inicial
    Quando clico no botão final de chamada para ação
    Então sou redirecionado para a tela de login
    E vejo o botão "Entrar no painel"

  Esquema do Cenário: Links de navegação apontam para as seções da página
    Dado que acesso a página inicial
    Então o link "<link>" aponta para a âncora "<ancora>"
    E a seção "<ancora>" existe na página

    Exemplos:
      | link         | ancora   |
      | recursos     | #modulos |
      | como-funciona | #fluxo   |
      | culturas     | #culturas |
      | sobre        | #sobre   |

  Cenário: Carrossel permite avançar e voltar
    Dado que acesso a página inicial
    Quando avanço o carrossel
    E volto o carrossel
    Então o carrossel continua visível
    E o carrossel tem mais de um indicador

  Cenário: Usuário já autenticado é enviado ao painel
    Dado que tenho uma conta criada pela API
    Quando acesso a página inicial já autenticado
    Então sou redirecionado para o painel
    E vejo o título "Painel da safra"
