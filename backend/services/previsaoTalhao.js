// Previsão estrita: ausências permanecem null; não inventa temperaturas ou chuva.
const { buscarPrevisaoBruta } = require("./openmeteo");
const DESCRICOES = {
  0: "Céu limpo", 1: "Predominantemente limpo", 2: "Parcialmente nublado", 3: "Encoberto",
  45: "Nevoeiro", 48: "Nevoeiro com deposição de gelo", 51: "Garoa fraca", 53: "Garoa moderada", 55: "Garoa intensa",
  61: "Chuva fraca", 63: "Chuva moderada", 65: "Chuva forte", 66: "Chuva congelante", 67: "Chuva congelante forte",
  71: "Neve fraca", 73: "Neve moderada", 75: "Neve forte", 77: "Grãos de neve",
  80: "Pancadas de chuva fracas", 81: "Pancadas moderadas", 82: "Pancadas fortes",
  85: "Pancadas de neve", 86: "Pancadas fortes de neve", 95: "Trovoadas", 96: "Trovoadas com granizo", 99: "Trovoadas fortes com granizo",
};
const naoNegativo = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const probabilidade = v => naoNegativo(v) !== null && v <= 100 ? v : null;
const real = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function coordenadasValidas(lat, lon) {
  return real(lat) !== null && real(lon) !== null && Math.abs(lat)<=90 && Math.abs(lon)<=180;
}
function interpretar(dados) {
  const d = dados.daily || {};
  if (!Array.isArray(d.time) || !d.time.length) throw new Error("Open-Meteo sem previsão diária.");
  return { fonte: "open-meteo", fuso: "America/Sao_Paulo", dias: d.time.map((data,i) => ({
    data, tempMin: real(d.temperature_2m_min?.[i]), tempMax: real(d.temperature_2m_max?.[i]),
    chuvaProbabilidade: probabilidade(d.precipitation_probability_max?.[i]), chuvaMm: naoNegativo(d.precipitation_sum?.[i]),
    ventoMaxKmh: naoNegativo(d.wind_speed_10m_max?.[i]), codigoTempo: real(d.weather_code?.[i]),
    condicoes: DESCRICOES[d.weather_code?.[i]] || "Condições não informadas",
  })).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.data)) };
}
async function buscar(lat,lon) {
  if (!coordenadasValidas(lat,lon)) throw new Error("Coordenadas do talhão inválidas.");
  return interpretar(await buscarPrevisaoBruta(lat,lon));
}
module.exports = { buscar, interpretar, coordenadasValidas };
