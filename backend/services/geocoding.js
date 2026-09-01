/**
 * Geocodificação: Google (se houver chave) ou Nominatim/OSM (gratuito).
 * O cadastro pelo mapa pode enviar lat/lng direto e pular esta etapa.
 */

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const FALLBACK_COORDS = { latitude: -22.2461, longitude: -45.7008 };

async function geocodificarEndereco(endereco) {
  if (API_KEY) {
    try {
      return await geocodificarGoogle(endereco);
    } catch (erro) {
      console.error("[geocoding] Google falhou, tentando Nominatim:", erro.message);
    }
  }

  try {
    return await geocodificarNominatim(endereco);
  } catch (erro) {
    console.error("[geocoding] Nominatim falhou, usando Sul de Minas:", erro.message);
    return { ...FALLBACK_COORDS, fonte: "simulado", enderecoFormatado: endereco };
  }
}

async function geocodificarGoogle(endereco) {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(endereco) +
    "&key=" +
    API_KEY;
  const resposta = await fetch(url);
  const dados = await resposta.json();
  if (dados.status !== "OK" || !dados.results || !dados.results[0]) {
    throw new Error("Geocoding Google: " + dados.status);
  }
  const resultado = dados.results[0];
  return {
    latitude: resultado.geometry.location.lat,
    longitude: resultado.geometry.location.lng,
    enderecoFormatado: resultado.formatted_address,
    fonte: "google_maps",
  };
}

async function geocodificarNominatim(endereco) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=" +
    encodeURIComponent(endereco);
  const resposta = await fetch(url, {
    headers: { "User-Agent": "AgroAlerta-TCC/1.0 (trabalho academico)", Accept: "application/json" },
  });
  if (!resposta.ok) throw new Error("Nominatim " + resposta.status);
  const lista = await resposta.json();
  if (!lista[0]) throw new Error("Nominatim sem resultado");
  return {
    latitude: Number(lista[0].lat),
    longitude: Number(lista[0].lon),
    enderecoFormatado: lista[0].display_name,
    fonte: "nominatim",
  };
}

function areaHectares(poligono) {
  if (!Array.isArray(poligono) || poligono.length < 3) return null;
  let soma = 0;
  for (let i = 0; i < poligono.length; i++) {
    const a = poligono[i];
    const b = poligono[(i + 1) % poligono.length];
    soma += a.lng * b.lat - b.lng * a.lat;
  }
  const latMedia = poligono.reduce((acc, p) => acc + p.lat, 0) / poligono.length;
  const metros = 111320;
  const m2 = Math.abs(soma / 2) * metros * metros * Math.cos((latMedia * Math.PI) / 180);
  return Number((m2 / 10000).toFixed(2));
}

module.exports = { geocodificarEndereco, areaHectares };
