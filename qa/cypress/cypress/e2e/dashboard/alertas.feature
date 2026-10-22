# language: pt
Funcionalidade: Painel - Alertas climáticos
  Como produtor autenticado
  Quero ver as regras disparadas para o meu talhão
  Para agir antes que o clima prejudique a lavoura

  Cenário: Lista a regra de geada disparada para o talhão
    Dado que estou autenticado no painel com alerta de geada
    Quando acesso a página "Alertas" pelo menu
    Então vejo o título "Alertas climáticos"
    E a tabela de regras lista "Risco de geada" para o talhão "Talhão principal"

  Cenário: Exibe os avisos oficiais do INMET
    Dado que estou autenticado no painel com alerta de geada
    Quando acesso a página "Alertas" pelo menu
    Então vejo o aviso oficial "Onda de frio com declínio de temperatura"
    E o aviso oficial traz a instrução "Proteja as culturas sensíveis ao frio."

  Cenário: Sem riscos, nenhuma regra é listada
    Dado que estou autenticado no painel
    Quando acesso a página "Alertas" pelo menu
    Então vejo o título "Alertas climáticos"
    E nenhuma regra disparada é listada
    E não há avisos oficiais
