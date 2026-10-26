# language: pt
Funcionalidade: Painel - Notícias do agro
  Como produtor autenticado
  Quero ler as notícias da minha cultura com um trecho de cada matéria
  Para me informar sem precisar abrir cada notícia para descobrir o assunto

  Contexto:
    Dado que estou autenticado no painel
    E acesso a página "Notícias" pelo menu

  Cenário: Lista as notícias da cultura com um preview de cada uma
    Então vejo o título "Notícias do agro"
    E a página lista 3 notícias
    E cada notícia mostra título, fonte, data e um trecho da matéria
    E a primeira notícia é "Preço do café recua e fecha a semana em queda no Brasil"

  Cenário: Cada notícia aponta para a matéria no site do veículo
    Então cada notícia abre o link da matéria em uma nova aba
    E a notícia da fonte "Canal Rural" aponta para "canalrural.com.br"
    E a notícia da fonte "g1 Agronegócios" aponta para "g1.globo.com"

  Cenário: As notícias seguem a cultura cadastrada na conta
    Então o título da seção de notícias é "Notícias de Café"
    Quando acesso o perfil pelo menu lateral
    E escolho a cultura favorita "Soja"
    E salvo as alterações da conta
    E acesso a página "Notícias" pelo menu
    Então o título da seção de notícias é "Notícias de Soja"
    E a primeira notícia é "Soja: preços sobem no Brasil, mas portos saturados limitam os embarques"
    E a página lista 2 notícias

  Cenário: A cultura é escolhida no perfil, não na página de notícias
    Então a página não tem seletor de cultura
    E o atalho para mudar a cultura leva ao perfil

  Cenário: Sem notícias, a página explica em vez de ficar vazia
    Quando as fontes de notícias não devolvem nada
    Então vejo o aviso de que nenhuma notícia foi encontrada
    E nenhum cartão de notícia é exibido

  Cenário: A página de Mercado não lista mais notícias
    Quando acesso a página "Mercado" pelo menu
    Então a página de mercado não tem lista de notícias
    E o resumo da análise cita as fontes usadas
