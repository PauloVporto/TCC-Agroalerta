# language: pt
Funcionalidade: Painel - Insumos e preços
  Como produtor autenticado
  Quero comparar os preços de insumos dos fornecedores
  Para comprar com melhor custo-benefício

  Contexto:
    Dado que estou autenticado no painel
    E acesso a página "Insumos e preços" pelo menu

  Cenário: Exibe o ranking de custo-benefício
    Então vejo o título "Insumos e preços"
    E vejo a seção "Ranking de custo-benefício"

  Cenário: Ranking traz as ofertas do fungicida ordenadas do menor para o maior preço
    Então o ranking lista 3 ofertas do produto "Fungicida à base de cobre"
    E os preços unitários estão em ordem crescente
    E a primeira oferta é de "CoopMinas Insumos" por "R$ 64,50"

  Cenário: Os fornecedores do ranking são os cadastrados na base
    Então o ranking contém os fornecedores "CoopMinas Insumos", "Agropecuária Sul de Minas" e "AgroBoa Vista"
    E o ranking mostra as cidades "Pouso Alegre", "Santa Rita do Sapucaí" e "Varginha"
