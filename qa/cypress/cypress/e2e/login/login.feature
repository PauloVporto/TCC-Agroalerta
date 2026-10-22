# language: pt
Funcionalidade: Login
  Como produtor cadastrado
  Quero entrar no AgroAlerta com meu e-mail e senha
  Para acessar o painel da safra

  Cenário: Exibe o formulário de login
    Dado que acesso a tela de login
    Então vejo os campos de e-mail e senha
    E vejo o botão "Entrar no painel"

  Cenário: Validação de campos vazios
    Dado que acesso a tela de login
    Quando envio o formulário de login sem preencher nada
    Então vejo o erro de e-mail "Informe o e-mail cadastrado."
    E vejo o erro de senha "Informe a senha."

  Cenário: Validação de e-mail em formato inválido
    Dado que acesso a tela de login
    Quando preencho o login com e-mail "produtor@fazenda" e senha "123456"
    E envio o formulário de login
    Então vejo o erro de e-mail "E-mail em formato inválido."
    E permaneço na tela de login

  Cenário: Validação de senha curta
    Dado que acesso a tela de login
    Quando preencho o login com e-mail "produtor@fazenda.com" e senha "123"
    E envio o formulário de login
    Então vejo o erro de senha "A senha deve ter ao menos 6 caracteres."
    E permaneço na tela de login

  Cenário: Credenciais inválidas exibem erro da API
    Dado que acesso a tela de login
    Quando preencho o login com e-mail "nao.existe@agroalerta.test" e senha "SenhaErrada1"
    E envio o formulário de login
    Então vejo o erro geral de login "E-mail ou senha inválidos."
    E nenhum token é guardado na sessão

  Cenário: Login com sucesso leva ao painel
    Dado que tenho uma conta criada pela API
    E que acesso a tela de login
    Quando faço login com a conta criada
    Então sou redirecionado para o painel
    E o token de sessão foi guardado

  Cenário: Botão fica desabilitado enquanto o login é processado
    Dado que tenho uma conta criada pela API
    E que acesso a tela de login
    E que a resposta do login está atrasada
    Quando faço login com a conta criada
    Então o botão de login mostra "Entrando…"
    E o botão de login está desabilitado

  Cenário: Alternar para o cadastro
    Dado que acesso a tela de login
    Quando clico em "Criar conta" na tela de login
    Então vejo o título "Criar conta"
    E vejo o campo de nome completo

  Cenário: Voltar ao site
    Dado que acesso a tela de login
    Quando clico em "Voltar ao site"
    Então a página inicial é exibida
    E vejo o título principal da página inicial
