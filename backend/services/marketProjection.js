/**
 * Série de preços do gráfico de Mercado: histórico real (data/mercado.json, em R$/saca)
 * + projeção mensal para os anos de ANOS_PROJECAO, na mesma unidade.
 *
 * A projeção é ilustrativa e usa só o próprio histórico, em três partes:
 * 1. Sazonalidade: razão entre o preço de cada mês e a média móvel centrada de 12 meses
 *    (decomposição clássica). Separa o efeito safra/entressafra da tendência.
 * 2. Tendência: regressão log-linear das médias anuais dessazonalizadas, que dá uma taxa
 *    de crescimento anual constante.
 * 3. Ponto de partida: nível dessazonalizado dos últimos meses, para a projeção continuar
 *    do preço atual em vez de saltar para a reta da tendência.
 */

const ANOS_PROJECAO = [2027, 2028];
const MESES_PONTO_DE_PARTIDA = 3;
const SEM_SAZONALIDADE = Array(12).fill(1);

const METODO_PROJECAO =
  "Parte do nível dos últimos " + MESES_PONTO_DE_PARTIDA + " meses e aplica a tendência anual " +
  "(regressão log-linear das médias anuais) e a sazonalidade mensal (razão sobre média móvel " +
  "centrada de 12 meses), ambas medidas no histórico.";

function media(valores) {
  return valores.reduce((soma, v) => soma + v, 0) / valores.length;
}

function indiceDoMes({ ano, mes }) {
  return ano * 12 + (mes - 1);
}

function mediasMensais(historico) {
  const porMes = new Map();
  for (const { data, preco } of historico) {
    const chave = data.slice(0, 7);
    if (!porMes.has(chave)) porMes.set(chave, []);
    porMes.get(chave).push(preco);
  }
  return [...porMes.keys()].sort().map((chave) => ({
    ano: Number(chave.slice(0, 4)),
    mes: Number(chave.slice(5, 7)),
    preco: media(porMes.get(chave)),
  }));
}

// A média móvel centrada 2x12 remove tendência e ciclos; a razão preço/média isola o
// efeito de cada mês do ano. Pressupõe série mensal contínua (o indicador Cepea é diário).
function fatoresSazonais(mensais) {
  const razoesPorMes = Array.from({ length: 12 }, () => []);
  for (let i = 6; i < mensais.length - 6; i++) {
    let soma = (mensais[i - 6].preco + mensais[i + 6].preco) / 2;
    for (let j = i - 5; j <= i + 5; j++) soma += mensais[j].preco;
    razoesPorMes[mensais[i].mes - 1].push(mensais[i].preco / (soma / 12));
  }
  if (razoesPorMes.some((razoes) => razoes.length === 0)) return SEM_SAZONALIDADE;

  const brutos = razoesPorMes.map(media);
  const mediaDosBrutos = media(brutos);
  return brutos.map((fator) => fator / mediaDosBrutos);
}

// Regressão de ln(média anual) contra o ano: a inclinação vira taxa de crescimento anual.
function taxaAnualDeTendencia(dessazonalizados) {
  const porAno = new Map();
  for (const { ano, nivel } of dessazonalizados) {
    if (!porAno.has(ano)) porAno.set(ano, []);
    porAno.get(ano).push(nivel);
  }
  if (porAno.size < 2) return 0;

  const pontos = [...porAno].map(([ano, niveis]) => ({ x: ano, y: Math.log(media(niveis)) }));
  const mediaX = media(pontos.map((p) => p.x));
  const mediaY = media(pontos.map((p) => p.y));
  const covariancia = pontos.reduce((soma, p) => soma + (p.x - mediaX) * (p.y - mediaY), 0);
  const variancia = pontos.reduce((soma, p) => soma + (p.x - mediaX) ** 2, 0);
  return Math.exp(covariancia / variancia) - 1;
}

function projetar(mensais) {
  if (mensais.length === 0) return { projecao: [], tendenciaAnual: 0 };

  const sazonal = fatoresSazonais(mensais);
  const dessazonalizados = mensais.map((m) => ({ ...m, nivel: m.preco / sazonal[m.mes - 1] }));
  const tendenciaAnual = taxaAnualDeTendencia(dessazonalizados);

  const partida = dessazonalizados.slice(-MESES_PONTO_DE_PARTIDA);
  const nivelDePartida = media(partida.map((m) => m.nivel));
  const mesDePartida = indiceDoMes(partida[0]) + (partida.length - 1) / 2;

  const projecao = [];
  for (const ano of ANOS_PROJECAO) {
    for (let mes = 1; mes <= 12; mes++) {
      const anosAFrente = (indiceDoMes({ ano, mes }) - mesDePartida) / 12;
      const preco = nivelDePartida * Math.pow(1 + tendenciaAnual, anosAFrente) * sazonal[mes - 1];
      projecao.push({ data: `${ano}-${String(mes).padStart(2, "0")}-15`, preco: Number(preco.toFixed(2)) });
    }
  }
  return { projecao, tendenciaAnual };
}

function montarSerieComProjecao(base, cultura) {
  const historico = base.historico.map(({ data, preco }) => ({ data, preco }));
  const { projecao, tendenciaAnual } = projetar(mediasMensais(historico));

  return {
    cultura,
    unidade: base.unidade,
    fonte: base.fonte,
    historico,
    projecao,
    anosProjecao: ANOS_PROJECAO,
    tendenciaAnual: Number(tendenciaAnual.toFixed(4)),
    metodoProjecao: METODO_PROJECAO,
  };
}

module.exports = { montarSerieComProjecao, fatoresSazonais, taxaAnualDeTendencia, mediasMensais };
