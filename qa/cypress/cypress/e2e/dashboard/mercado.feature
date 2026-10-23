# language: pt
Funcionalidade: Painel - Tendência de mercado
  Como produtor autenticado
  Quero acompanhar o preço da minha cultura e simular uma venda
  Para decidir o melhor momento de vender

  Contexto:
    Dado que estou autenticado no painel
    E acesso a página "Mercado" pelo menu

  Cenário: Exibe o gráfico de preços do café
    Então vejo o título "Tendência de mercado"
    E o gráfico se chama "Café · saca 60kg (arábica)"
    E o gráfico tem de 1 a 12 barras mensais, cada uma com mês e valor

  Cenário: Exibe as estatísticas do período
    Então a última cotação está no formato de saca "R$ 1.234/sc"
    E a variação do período está no formato de percentual com sinal
    E a máxima do período não é menor que a última cotação

  Cenário: Exibe os indicadores externos (PTAX, cotação internacional e IC-Br)
    Então o indicador PTAX mostra "R$ 5,0140 / US$"
    E a cotação internacional mostra "359,16 cents per pound"
    E o IC-Br mostra "+29.2%"

  Cenário: Simulador calcula a receita com 500 sacas por padrão
    Então o simulador está com 500 sacas
    E a receita simulada é aproximadamente 500 vezes a última cotação

  Cenário: Alterar a quantidade de sacas recalcula a receita
    Quando informo 100 sacas no simulador
    Então a receita simulada é aproximadamente 100 vezes a última cotação
    E o simulador está com 100 sacas

  Cenário: Zero sacas resulta em receita zero
    Quando informo 0 sacas no simulador
    Então a receita simulada é "R$ 0,00"
    E o simulador está com 0 sacas

  Cenário: Exibe o resumo e as notícias da curadoria
    Então o resumo de mercado é "Resumo de teste: o preço do café arábica apresentou tendência de alta nas últimas semanas."
    E a curadoria lista 3 notícias, incluindo "Câmbio favorece exportadores brasileiros"
