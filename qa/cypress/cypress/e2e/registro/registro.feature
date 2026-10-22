# language: pt
Funcionalidade: Cadastro de conta
  Como novo produtor
  Quero criar minha conta informando meus dados e o CEP da propriedade
  Para começar a receber alertas climáticos

  Contexto:
    Dado que acesso a tela de cadastro

  Cenário: Exibe o formulário completo de cadastro
    Então vejo o título "Criar conta"
    E vejo todos os campos do cadastro
    E vejo as cinco culturas disponíveis

  Cenário: Validação de todos os campos vazios
    Quando envio o cadastro sem preencher nada
    Então vejo o erro de cadastro "nome" com "Informe nome e sobrenome."
    E vejo o erro de cadastro "cep" com "Informe o CEP."
    E vejo o erro de cadastro "telefone" com "Informe um telefone."
    E vejo o erro de cadastro "email" com "Informe um e-mail."
    E vejo o erro de cadastro "termos" com "É necessário aceitar os termos."

  Cenário: Nome sem sobrenome é recusado
    Quando preencho o cadastro válido com nome "Marina"
    E envio o cadastro
    Então vejo o erro de cadastro "nome" com "Informe nome e sobrenome."
    E permaneço na tela de cadastro

  Cenário: CEP com menos de 8 dígitos é recusado
    Quando preencho o cadastro válido com CEP "1234"
    E envio o cadastro
    Então vejo o erro de cadastro "cep" com "CEP deve ter 8 dígitos."
    E permaneço na tela de cadastro

  Cenário: Telefone incompleto é recusado
    Quando preencho o cadastro válido com telefone "(34) 9999"
    E envio o cadastro
    Então vejo o erro de cadastro "telefone" com "Telefone incompleto."
    E permaneço na tela de cadastro

  Cenário: Senhas diferentes são recusadas
    Quando preencho o cadastro válido com confirmação de senha "Outra@999"
    E envio o cadastro
    Então vejo o erro de cadastro "confirmar-senha" com "As senhas não coincidem."
    E permaneço na tela de cadastro

  Cenário: Senha curta é recusada
    Quando preencho o cadastro válido com senha "123" e confirmação "123"
    E envio o cadastro
    Então vejo o erro de cadastro "senha" com "A senha deve ter ao menos 6 caracteres."
    E permaneço na tela de cadastro

  Cenário: Sem aceitar os termos o cadastro não é enviado
    Quando preencho o cadastro válido sem aceitar os termos
    E envio o cadastro
    Então vejo o erro de cadastro "termos" com "É necessário aceitar os termos."
    E nenhuma requisição de cadastro foi feita

  Cenário: Escolher cultura e unidade de temperatura
    Quando escolho a cultura "Soja"
    E escolho a unidade "°F"
    Então a cultura "Soja" está selecionada
    E a unidade "°F" está selecionada

  Cenário: Alternar entre produtor e fornecedor muda a descrição
    Quando escolho o tipo de conta "Fornecedor"
    Então vejo a nota "Publica e gerencia ofertas de insumos"
    E ao escolher o tipo de conta "Produtor" vejo a nota "Cadastra talhões, recebe alertas climáticos"

  Cenário: E-mail já cadastrado exibe erro da API
    Dado que tenho uma conta criada pela API
    Quando preencho o cadastro válido com o e-mail da conta existente
    E envio o cadastro
    Então vejo o erro geral de cadastro "Já existe uma conta com esse e-mail."
    E permaneço na tela de cadastro

  Cenário: CEP inexistente exibe o erro no campo de CEP
    Quando preencho o cadastro válido com CEP "00000-000"
    E envio o cadastro
    Então vejo o erro de cadastro "cep" com "CEP não encontrado. Verifique o número digitado."
    E permaneço na tela de cadastro

  Cenário: Cadastro com sucesso cria a conta e leva ao painel
    Quando preencho o cadastro válido
    E envio o cadastro
    Então sou redirecionado para o painel
    E o token de sessão foi guardado
    E a conta recém-criada é removida ao final

  Cenário: Preferências escolhidas no cadastro são salvas
    Quando preencho o cadastro válido
    E escolho a cultura "Soja"
    E escolho a unidade "°F"
    E envio o cadastro
    Então sou redirecionado para o painel
    E as preferências salvas na API são cultura "soja" e unidade "fahrenheit"

  Cenário: Voltar para o login
    Quando clico em "Entrar" no rodapé do cadastro
    Então vejo o botão "Entrar no painel"
    E vejo os campos de e-mail e senha
