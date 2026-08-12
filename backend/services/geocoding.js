/**
 * Serviço de geocodificação (endereço -> latitude/longitude) usando a
 * Google Maps Geocoding API. Necessário para o cadastro de talhões,
 * onde o produtor informa um endereço/localização em vez de coordenadas.
 *
 * Se a chave não estiver configurada, cai em modo simulado: retorna
 * coordenadas aproximadas do centro de Minas Gerais, para não travar
 * o restante do fluxo de teste.
 */

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// Centro aproximado de MG - usado apenas como fallback em modo simulado
const FALLBACK_COORDS = { latitude: -18.5122, longitude: -44.555 };

async function geocodificarEndereco(endereco) {
  if (!API_KEY) {
    console.warn("[geocoding] GOOGLE_MAPS_API_KEY não configurada - retornando coordenada simulada.");
    return { ...FALLBACK_COORDS, fonte: "simulado", enderecoFormatado: endereco };
  }

  try {
    const url = BASE_URL + "?address=" + encodeURIComponent(endereco) + "&key=" + API_KEY;
    const resposta = await fetch(url);
    const dados = await resposta.json();

    if (dados.status !== "OK" || !dados.results || dados.results.length === 0) {
      throw new Error("Geocoding retornou status: " + dados.status);
    }

    const resultado = dados.results[0];
    return {
      latitude: resultado.geometry.location.lat,
      longitude: resultado.geometry.location.lng,
      enderecoFormatado: resultado.formatted_address,
      fonte: "google_maps",
    };
  } catch (erro) {
    console.error("[geocoding] Falha ao geocodificar, usando fallback:", erro.message);
    return { ...FALLBACK_COORDS, fonte: "simulado", enderecoFormatado: endereco };
  }
}

module.exports = { geocodificarEndereco };
