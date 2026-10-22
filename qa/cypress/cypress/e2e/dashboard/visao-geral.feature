# language: pt
Funcionalidade: Painel - Visão geral
  Como produtor autenticado
  Quero ver o resumo da minha safra assim que entro no painel
  Para saber rapidamente se há riscos nas minhas áreas

  Cenário: Exibe os quatro indicadores principais
    Dado que estou autenticado no painel
    Então vejo o título "Painel da safra"
    E vejo os indicadores "Alertas em aberto", "Talhões cadastrados", "Insumos monitorados" e "Café"

  Cenário: Indicadores refletem os dados da conta
    Dado que estou autenticado no painel
    Então o indicador "Talhões cadastrados" mostra "1"
    E o indicador "Insumos monitorados" mostra "5"
    E o indicador "Alertas em aberto" mostra "0" com a nota "nenhum risco identificado"

  Cenário: Identifica o usuário e a cidade cadastrada
    Dado que estou autenticado no painel
    Então o menu lateral mostra o nome "Teste Cypress QA" e a cidade "Itajubá - MG"
    E o cabeçalho mostra a cidade "Itajubá - MG"

  Cenário: Exibe o alerta de geada gerado pelo motor de regras
    Dado que estou autenticado no painel com alerta de geada
    Então o indicador "Alertas em aberto" mostra "1" com a nota "Alto"
    E vejo o alerta "Risco de geada" com a recomendação de proteção contra geada

  Cenário: Mostra a previsão de 7 dias e o resumo climático
    Dado que estou autenticado no painel
    Então a previsão exibe "Previsão · 7 dias"
    E a previsão lista os dias "Seg, Ter, Qua, Qui, Sex, Sáb, Dom"
    E o resumo mostra chuva acumulada "32.4 mm" e mínima prevista "8.5 °C"

  Cenário: Exibe o mapa da localização cadastrada
    Dado que estou autenticado no painel
    Então o mapa da propriedade é um iframe do OpenStreetMap
    E o mapa tem título acessível "Mapa da localização cadastrada"
