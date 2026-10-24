# language: pt
Funcionalidade: Painel - Talhões
  Como produtor autenticado
  Quero cadastrar e acompanhar meus talhões
  Para receber alertas específicos de cada área

  Contexto:
    Dado que estou autenticado no painel
    E acesso a página "Talhões" pelo menu

  Cenário: Lista o talhão criado no cadastro da conta
    Então vejo o título "Talhões"
    E a tabela lista 1 talhão com nome "Talhão principal - Itajubá", cultura "Café" e fase "Plantio"

  Cenário: Cada talhão ocupa uma única linha da tabela
    Então a tabela tem 1 linha de talhão, e ela é clicável
    E a linha mostra nome, cultura e fase na mesma célula de origem

  Cenário: Abrir e fechar o formulário de novo talhão
    Quando clico no botão de novo talhão
    Então o formulário de talhão está visível e o botão mostra "Cancelar"
    E ao clicar novamente o formulário some e o botão volta a "Cadastrar talhão"

  Cenário: Formulário só oferece as culturas suportadas
    Quando clico no botão de novo talhão
    Então a lista de culturas do talhão contém apenas "Café" e "Soja"
    E os campos de nome, fase e CEP do talhão começam vazios

  Cenário: Validação de campos obrigatórios
    Quando clico no botão de novo talhão
    E envio o formulário de talhão vazio
    Então vejo o erro de talhão "Preencha nome, fase e um CEP válido (8 dígitos)."
    E a tabela continua com 1 talhão

  Cenário: CEP inexistente é recusado
    Quando clico no botão de novo talhão
    E preencho o talhão "Talhão CEP ruim" cultura "Soja" fase "floracao" e CEP "00000-000"
    E envio o formulário de talhão
    Então vejo o erro de talhão "CEP não encontrado. Verifique o número digitado."
    E a tabela continua com 1 talhão

  Cenário: Cadastro de um novo talhão de soja
    Quando clico no botão de novo talhão
    E preencho o talhão "Talhão QA Soja" cultura "Soja" fase "floracao" e CEP "37500-001"
    E envio o formulário de talhão
    Então a tabela lista 2 talhões
    E a tabela contém o talhão "Talhão QA Soja" com cultura "Soja" e fase "Floração"
    E a API confirma 2 talhões para o usuário
