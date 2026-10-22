# language: pt
Funcionalidade: Painel - Configurar conta
  Como produtor autenticado
  Quero editar meus dados, minha localização e minhas preferências
  Para manter o AgroAlerta alinhado à minha propriedade

  Contexto:
    Dado que estou autenticado no painel
    E acesso o perfil pelo menu lateral

  Cenário: Exibe os dados atuais da conta
    Então vejo o título "Configurar conta"
    E os campos mostram o nome "Teste Cypress QA" e o e-mail da conta criada
    E a cidade cadastrada é "Itajubá - MG"
    E a cultura "Café" está marcada como favorita

  Cenário: Alterar o nome e salvar
    Quando altero o nome para "Nome Alterado QA"
    E salvo as alterações da conta
    Então o botão de salvar mostra "Alterações salvas"
    E a API retorna o nome "Nome Alterado QA"

  Cenário: Alterar a cultura favorita para soja
    Quando escolho a cultura favorita "Soja"
    E salvo as alterações da conta
    Então o botão de salvar mostra "Alterações salvas"
    E a API retorna a cultura favorita "soja"

  Cenário: Desativar as notificações
    Quando desmarco as notificações
    E salvo as alterações da conta
    Então o botão de salvar mostra "Alterações salvas"
    E a API retorna notificações desativadas

  Cenário: Atualizar a localização por CEP válido
    Quando verifico o CEP "30130-010"
    Então o status do CEP mostra "✓ Localização atualizada"
    E a cidade cadastrada é "Belo Horizonte - MG"

  Cenário: CEP incompleto não é consultado
    Quando verifico o CEP "1234"
    Então o status do CEP mostra "Informe os 8 dígitos do CEP."
    E a cidade cadastrada é "Itajubá - MG"

  Cenário: CEP inexistente exibe erro e mantém a localização
    Quando verifico o CEP "00000-000"
    Então o status do CEP mostra "CEP não encontrado. Verifique o número digitado."
    E a cidade cadastrada é "Itajubá - MG"
