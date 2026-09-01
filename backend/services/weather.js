/**
 * Serviço de clima.
 *
 * API escolhida para o TCC: Open-Meteo (https://open-meteo.com/).
 * Motivos em relação às alternativas levantadas:
 * - OpenWeather: exige chave; plano gratuito tem limite diário.
 * - Google Maps Weather: exige faturamento no Google Cloud.
 * - Visual Crossing: plano gratuito limitado.
 * - Open-Meteo: código aberto, sem chave para uso acadêmico, previsão
 *   diária/horária e histórico suficientes para o motor de regras.
 *
 * OPENWEATHER_API_KEY ainda pode forçar o provedor antigo via
 * WEATHER_PROVIDER=openweather.
 */

const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const PROVIDER = (process.env.WEATHER_PROVIDER || "openmeteo").toLowerCase();
const CACHE_MS = 15 * 60 * 1000;
const cacheClima = new Map();

function chaveCache(latitude, longitude) {
  return latitude.toFixed(3) + "," + longitude.toFixed(3) + ":" + fonteClimaAtiva();
}

async function buscarClimaAtual(latitude, longitude) {
  const chave = chaveCache(latitude, longitude);
  const cached = cacheClima.get(chave);
  if (cached && Date.now() - cached.em < CACHE_MS) {
    return cached.clima;
  }

  const usarOpenWeather = PROVIDER === "openweather" && OPENWEATHER_KEY;

  try {
    const clima = usarOpenWeather
      ? await buscarOpenWeather(latitude, longitude)
      : await buscarOpenMeteo(latitude, longitude);
    cacheClima.set(chave, { em: Date.now(), clima });
    return clima;
  } catch (erro) {
    console.error("[weather] Falha na API de clima, usando fallback simulado:", erro.message);
    return gerarClimaSimulado(latitude, longitude);
  }
}

function fonteClimaAtiva() {
  if (PROVIDER === "openweather" && OPENWEATHER_KEY) return "openweathermap";
  return "open-meteo";
}

async function buscarOpenMeteo(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: [
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
    ].join(","),
    past_days: "7",
    forecast_days: "7",
    timezone: "America/Sao_Paulo",
    wind_speed_unit: "kmh",
  });

  const resposta = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!resposta.ok) {
    throw new Error("Erro na Open-Meteo: " + resposta.status);
  }
  return processarRespostaOpenMeteo(await resposta.json());
}

function processarRespostaOpenMeteo(dados) {
  const daily = dados.daily || {};
  const datas = daily.time || [];
  const mins = daily.temperature_2m_min || [];
  const chuvas = daily.precipitation_sum || [];
  const probs = daily.precipitation_probability_max || [];
  const ventos = daily.wind_speed_10m_max || [];

  const hoje = new Date().toISOString().slice(0, 10);
  const idxsPassado = [];
  const idxsFuturo = [];

  datas.forEach((data, i) => {
    if (data < hoje) idxsPassado.push(i);
    else idxsFuturo.push(i);
  });

  const chuvasPassado = idxsPassado.map((i) => chuvas[i] || 0);
  const chuvaAcumulada7dias = Number(chuvasPassado.reduce((a, b) => a + b, 0).toFixed(1));

  let diasSemChuva = 0;
  for (let i = idxsPassado.length - 1; i >= 0; i--) {
    if ((chuvas[idxsPassado[i]] || 0) < 0.5) diasSemChuva += 1;
    else break;
  }

  const tempsFuturo = (idxsFuturo.length ? idxsFuturo : datas.map((_, i) => i)).map((i) => mins[i]);
  const temperaturaMinima = Number(Math.min(...tempsFuturo.filter((n) => typeof n === "number")).toFixed(1));

  const probsFuturo = idxsFuturo.map((i) => probs[i]).filter((n) => typeof n === "number");
  const probabilidadeChuva7dias = probsFuturo.length
    ? Math.round(probsFuturo.reduce((a, b) => a + b, 0) / probsFuturo.length)
    : 0;

  const ventoMaximoKmh = Math.round(Math.max(...ventos.filter((n) => typeof n === "number"), 0));

  return {
    temperaturaMinima,
    chuvaAcumulada7dias,
    diasSemChuva,
    probabilidadeChuva7dias,
    ventoMaximoKmh,
    fonte: "open-meteo",
  };
}

async function buscarOpenWeather(latitude, longitude) {
  const url =
    "https://api.openweathermap.org/data/2.5/forecast?lat=" +
    latitude +
    "&lon=" +
    longitude +
    "&appid=" +
    OPENWEATHER_KEY +
    "&units=metric&lang=pt_br";

  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error("Erro na API de clima: " + resposta.status);
  }
  return processarRespostaOpenWeather(await resposta.json());
}

function processarRespostaOpenWeather(dados) {
  const lista = dados.list || [];
  const temperaturasMin = lista.map((item) => item.main.temp_min);
  const chuvas = lista.map((item) => (item.rain ? item.rain["3h"] || 0 : 0));
  const ventos = lista.map((item) => (item.wind ? item.wind.speed * 3.6 : 0));

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

function gerarClimaSimulado(latitude, longitude) {
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

module.exports = {
  buscarClimaAtual,
  fonteClimaAtiva,
  processarRespostaOpenMeteo,
  processarRespostaOpenWeather,
  gerarClimaSimulado,
};
