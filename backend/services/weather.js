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

const API_KEY = process.env.OPENWEATHER_API_KEY;
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
      throw new Error("Erro na API de clima: " + resposta.status);
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
 */
function processarRespostaOpenWeather(dados) {
  const lista = dados.list || [];
  const temperaturasMin = lista.map((item) => item.main.temp_min);
  const chuvas = lista.map((item) => (item.rain ? item.rain["3h"] || 0 : 0));
  const ventos = lista.map((item) => (item.wind ? item.wind.speed * 3.6 : 0)); // m/s -> km/h

  const diasComChuva = new Set(
    lista
      .filter((item) => (item.rain ? item.rain["3h"] || 0 : 0) > 0.5)
      .map((item) => item.dt_txt.split(" ")[0])
  ).size;

  const diasTotais = new Set(lista.map((item) => item.dt_txt.split(" ")[0])).size;

  return {
    temperaturaMinima: Math.min(...temperaturasMin),
    chuvaAcumulada7dias: Number(chuvas.reduce((a, b) => a + b, 0).toFixed(1)),
    diasSemChuva: Math.max(0, diasTotais - diasComChuva),
    probabilidadeChuva7dias: Math.round(
      (lista.reduce((acc, item) => acc + (item.pop || 0), 0) / lista.length) * 100
    ),
    ventoMaximoKmh: Math.round(Math.max(...ventos)),
    fonte: "openweathermap",
  };
}

/**
 * Gera dados climáticos simulados, com alguma variação aleatória,
 * para permitir testar o sistema completo sem depender de API externa.
 */
function gerarClimaSimulado(latitude, longitude) {
  // Usa lat/lon como semente simples para dar alguma "consistência" por talhão
  const semente = Math.abs(Math.round((latitude + longitude) * 1000)) % 100;

  return {
    temperaturaMinima: Number((2 + (semente % 15)).toFixed(1)),
    chuvaAcumulada7dias: Number(((semente * 3) % 200).toFixed(1)),
    diasSemChuva: semente % 20,
    probabilidadeChuva7dias: (semente * 7) % 100,
    ventoMaximoKmh: 15 + (semente % 50),
    fonte: "simulado",
  };
}

module.exports = { buscarClimaAtual };
