/**
 * Geocodificação (endereço -> latitude/longitude).
 *
 * A existência da cidade já é validada antes via ViaCEP (ver
 * services/localizacao.js) - esse serviço só busca as coordenadas mais
 * precisas possíveis, tentando nesta ordem:
 *   1. Google Maps Geocoding API, se GOOGLE_MAPS_API_KEY estiver configurada
 *      e a conta tiver billing habilitado.
 *   2. Nominatim (OpenStreetMap) - gratuito, sem chave, usado automaticamente
 *      quando o Google não está configurado ou falha (ex: sem billing).
 *   3. Coordenada fixa aproximada do centro de MG, como último recurso, só
 *      para não travar o cadastro caso as duas opções acima falhem.
 *
 * Sem o passo 2, todo endereço cairia sempre na mesma coordenada fixa do
 * passo 3 quando o Google falhasse - fazendo cidades diferentes mostrarem
 * exatamente a mesma previsão do tempo.
 */

const { geocodificarComNominatim } = require("./nominatim");

const API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim() || undefined;
const BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// Centro aproximado de MG - usado só se Google e Nominatim falharem os dois
const FALLBACK_COORDS = { latitude: -18.5122, longitude: -44.555 };

async function geocodificarEndereco(endereco) {
  const viaGoogle = API_KEY ? await tentarGoogle(endereco) : null;
  if (viaGoogle) return viaGoogle;

  const viaNominatim = await geocodificarComNominatim(endereco);
  if (viaNominatim) return { ...viaNominatim, valido: true };

  console.warn(
    '[geocoding] Não foi possível geocodificar "' + endereco + '" via Google nem Nominatim - ' +
    "usando coordenada aproximada fixa (centro de MG)."
  );
  return { ...FALLBACK_COORDS, fonte: "simulado", enderecoFormatado: endereco, valido: true };
}

async function tentarGoogle(endereco) {
  try {
    const url = BASE_URL + "?address=" + encodeURIComponent(endereco) + "&key=" + API_KEY;
    const resposta = await fetch(url);
    const dados = await resposta.json();

    if (dados.status !== "OK" || !dados.results || dados.results.length === 0) {
      console.warn(
        "[geocoding] Google Geocoding retornou " + dados.status +
        (dados.error_message ? " - " + dados.error_message : "") +
        " - tentando Nominatim como fallback."
      );
      return null;
    }

    const resultado = dados.results[0];
    return {
      latitude: resultado.geometry.location.lat,
      longitude: resultado.geometry.location.lng,
      enderecoFormatado: resultado.formatted_address,
      fonte: "google_maps",
      valido: true,
    };
  } catch (erro) {
    console.error("[geocoding] Falha ao chamar Google Geocoding, tentando Nominatim:", erro.message);
    return null;
  }
}

module.exports = { geocodificarEndereco };
