# language: pt
Funcionalidade: Painel - Notificações
  Como produtor autenticado
  Quero autorizar os canais e escolher quais avisos climáticos recebo
  Para só ser notificado do que realmente me interessa

  Contexto:
    Dado que estou autenticado no painel
    E acesso as notificações pelo menu lateral

  Cenário: Exibe os canais de notificação disponíveis
    Então vejo o título "Notificações"
    E a página mostra os canais de e-mail e WhatsApp
    E nenhum canal começa autorizado

  Cenário: A gravidade mínima só fica disponível com o canal autorizado
    Então o nível mínimo de e-mail está desabilitado
    Quando autorizo o canal de e-mail
    Então o nível mínimo de e-mail fica habilitado

  Cenário: Autorizar o e-mail e salvar
    Quando autorizo o canal de e-mail
    E salvo a autorização dos canais
    Então vejo o aviso de preferências salvas
    E a API confirma que o e-mail está autorizado

  Cenário: Escolher a gravidade mínima dos alertas por e-mail
    Quando autorizo o canal de e-mail
    E escolho receber somente os alertas de risco alto
    E salvo a autorização dos canais
    Então vejo o aviso de preferências salvas
    E a API confirma o nível mínimo "alto" para o e-mail

  Cenário: A autorização sobrevive ao recarregar a página
    Quando autorizo o canal de e-mail
    E salvo a autorização dos canais
    E recarrego a página de notificações
    Então o canal de e-mail aparece autorizado
    E a API confirma que o e-mail está autorizado

  Cenário: Ligar uma categoria depois de autorizar o WhatsApp
    Então a página lista as categorias de aviso climático
    E a categoria "boletim_diario" começa desligada
    Quando autorizo o canal de WhatsApp
    E salvo a autorização dos canais
    E marco a categoria "boletim_diario"
    E salvo as categorias
    Então vejo o aviso de preferências salvas
    E a API confirma que a categoria "boletim_diario" está ligada

  Cenário: Categoria exige a autorização do WhatsApp antes
    Quando marco a categoria "boletim_diario"
    E salvo as categorias esperando recusa
    Então vejo o aviso de que o WhatsApp precisa ser autorizado
    E a API confirma que a categoria "boletim_diario" continua desligada

  Cenário: Salvar sem mexer nas categorias avisa que nada mudou
    Quando salvo as categorias sem alterar nada
    Então vejo o aviso de que nenhuma categoria foi alterada
    E a API confirma que a categoria "boletim_diario" continua desligada

  Cenário: Histórico vazio para quem nunca recebeu notificação
    Então vejo o aviso de que ainda não há notificações
    E a tabela de histórico não é exibida
