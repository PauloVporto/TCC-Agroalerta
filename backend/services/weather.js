/**
 * Serviço de clima.
 *
 * Se OPENWEATHER_API_KEY estiver configurada no .env, busca dados reais
 * na OpenWeatherMap. Caso contrário, gera dados simulados (porém plausíveis)
 * para que o sistema inteiro possa ser testado sem depender de chave de API.
 *
 * Isso é uma decisão de escopo proposital: no TCC, vale documentar isso
 * como "modo de demonstração" no capítulo de limitações.
 */

// .trim() evita 401 "silencioso" quando a chave vem com espaço/quebra de
// linha extra (comum ao colar em .env editados no Windows).
const API_KEY = (process.env.OPENWEATHER_API_KEY || "").trim() || undefined;
const BASE_URL = "https://api.openweathermap.org/data/2.5";

async function buscarClimaAtual(latitude, longitude) {
  if (!API_KEY) {
    return gerarClimaSimulado(latitude, longitude);
  }

  try {
    const url =
      BASE_URL +
      "/forecast?lat=" +
      latitude +
      "&lon=" +
      longitude +
      "&appid=" +
      API_KEY +
      "&units=metric&lang=pt_br";

    const resposta = await fetch(url);
    if (!resposta.ok) {
      const corpo = await resposta.text();
      const dica = resposta.status === 401
        ? " - chave inválida ou ainda não ativada (a OpenWeatherMap pode levar até 2h para ativar uma chave nova)"
        : "";
      throw new Error("Erro na API de clima: " + resposta.status + dica + " - " + corpo.slice(0, 200));
    }
    const dados = await resposta.json();
    return processarRespostaOpenWeather(dados);
  } catch (erro) {
    console.error("[weather] Falha ao buscar clima real, usando fallback simulado:", erro.message);
    return gerarClimaSimulado(latitude, longitude);
  }
}

/**
 * Converte a resposta bruta da OpenWeatherMap (previsão de 5 dias / 3h)
 * nos indicadores que o motor de regras precisa.
 *
 * A API devolve os horários em UTC (dt_txt e dt). Como o Brasil está em
 * UTC-3, agrupar direto pela data UTC jogava blocos da madrugada local
 * (21h-23h59 local = 00h-02h59 UTC do dia seguinte) para o dia errado.
 * Por isso convertemos cada bloco para a data local usando o offset de
 * fuso que a própria OpenWeatherMap devolve em `city.timezone`.
 */
function processarRespostaOpenWeather(dados) {
  const lista = dados.list || [];
  const fusoSegundos = dados.city ? dados.city.timezone || 0 : 0;
  const diaLocal = (item) => dataLocalISO(item.dt, fusoSegundos);

  const temperaturasMin = lista.map((item) => item.main.temp_min);
  const chuvas = lista.map((item) => (item.rain ? item.rain["3h"] || 0 : 0));
  const ventos = lista.map((item) => (item.wind ? item.wind.speed * 3.6 : 0)); // m/s -> km/h

  const diasComChuva = new Set(
    lista.filter((item) => (item.rain ? item.rain["3h"] || 0 : 0) > 0.5).map(diaLocal)
  ).size;

  const diasTotais = new Set(lista.map(diaLocal)).size;

  return {
    temperaturaMinima: Math.min(...temperaturasMin),
    chuvaAcumulada7dias: Number(chuvas.reduce((a, b) => a + b, 0).toFixed(1)),
    diasSemChuva: Math.max(0, diasTotais - diasComChuva),
    probabilidadeChuva7dias: Math.round(
      (lista.reduce((acc, item) => acc + (item.pop || 0), 0) / lista.length) * 100
    ),
    ventoMaximoKmh: Math.round(Math.max(...ventos)),
    previsaoDiaria: agruparPorDia(lista, fusoSegundos),
    fonte: "openweathermap",
  };
}

// Data (YYYY-MM-DD) no fuso local do talhão, a partir de um timestamp unix (UTC).
function dataLocalISO(dtUnix, fusoSegundos) {
  return new Date((dtUnix + fusoSegundos) * 1000).toISOString().slice(0, 10);
}

/**
 * Agrupa a lista de blocos de 3h da OpenWeatherMap por dia local, com
 * máxima/mínima de temperatura e probabilidade/volume de chuva do dia.
 * Usado para alimentar o card de previsão no dashboard.
 *
 * O plano gratuito da OpenWeatherMap só cobre ~5 dias à frente (40 blocos
 * de 3h). O primeiro dia (hoje) costuma vir incompleto, cobrindo só o
 * restante do dia a partir do horário da consulta - isso distorce a
 * mínima/máxima (ex: já passou a madrugada, que teria a menor temperatura).
 * Por isso descartamos dias incompletos quando há dias completos disponíveis.
 */
function agruparPorDia(lista, fusoSegundos) {
  const porDia = new Map();

  for (const item of lista) {
    const data = dataLocalISO(item.dt, fusoSegundos);
    if (!porDia.has(data)) porDia.set(data, []);
    porDia.get(data).push(item);
  }

  const dias = Array.from(porDia.entries()).map(([data, itens]) => {
    const temps = itens.map((i) => i.main.temp);
    const chuvaMm = itens.reduce((acc, i) => acc + (i.rain ? i.rain["3h"] || 0 : 0), 0);
    const chuvaProb = Math.round(
      (itens.reduce((acc, i) => acc + (i.pop || 0), 0) / itens.length) * 100
    );
    return {
      data,
      tempMax: Math.round(Math.max(...temps)),
      tempMin: Math.round(Math.min(...temps)),
      chuvaMm: Number(chuvaMm.toFixed(1)),
      chuvaProbabilidade: chuvaProb,
      blocos: itens.length,
    };
  });

  // Um dia com 3h de bloco tem no máximo 8 registros (24h / 3h). Considera
  // "completo" a partir de 6 para tolerar o último dia, que também costuma
  // vir parcial.
  const completos = dias.filter((d) => d.blocos >= 6);
  const escolhidos = completos.length >= 3 ? completos : dias;

  return escolhidos.slice(0, 7).map(({ blocos, ...resto }) => resto);
}

/**
 * Gera dados climáticos simulados, com alguma variação aleatória,
 * para permitir testar o sistema completo sem depender de API externa.
 */
function gerarClimaSimulado(latitude, longitude) {
  // Usa lat/lon como semente simples para dar alguma "consistência" por talhão
  const semente = Math.abs(Math.round((latitude + longitude) * 1000)) % 100;

  const hoje = new Date();
  const previsaoDiaria = Array.from({ length: 7 }, (_, i) => {
    const s = (semente + i * 13) % 100;
    const data = new Date(hoje);
    data.setUTCDate(data.getUTCDate() + i);
    return {
      data: data.toISOString().split("T")[0],
      tempMax: 18 + (s % 14),
      tempMin: 2 + (s % 15),
      chuvaMm: Number(((s * 2) % 40).toFixed(1)),
      chuvaProbabilidade: (s * 7) % 100,
    };
  });

  return {
    temperaturaMinima: Number((2 + (semente % 15)).toFixed(1)),
    chuvaAcumulada7dias: Number(((semente * 3) % 200).toFixed(1)),
    diasSemChuva: semente % 20,
    probabilidadeChuva7dias: (semente * 7) % 100,
    ventoMaximoKmh: 15 + (semente % 50),
    previsaoDiaria,
    fonte: "simulado",
  };
}

module.exports = { buscarClimaAtual };
