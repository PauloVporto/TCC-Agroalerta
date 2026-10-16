/**
 * Geocodificação via Nominatim (OpenStreetMap) - gratuita, sem necessidade
 * de chave/billing. Usada como fallback automático de services/geocoding.js
 * quando o Google Maps não está configurado ou falha (ex: billing não
 * habilitado no projeto), para que cada cidade continue recebendo
 * coordenadas reais e distintas em vez de caírem todas na mesma
 * coordenada fixa aproximada.
 *
 * Respeita a política de uso do Nominatim: identifica a aplicação via
 * User-Agent (exigido) e limita a 1 req/s não é necessário aqui pois o
 * volume é baixo (cadastro de usuário/talhão), mas evite chamadas em loop.
 */

const BASE_URL = "https://nominatim.openstreetmap.org/search";

async function geocodificarComNominatim(endereco) {
  try {
    const url = BASE_URL + "?format=json&limit=1&countrycodes=br&q=" + encodeURIComponent(endereco);
    const resposta = await fetch(url, {
      headers: { "User-Agent": "AgroAlerta-TCC/1.0 (projeto academico)" },
    });

    if (!resposta.ok) {
      console.error("[nominatim] Resposta não-ok:", resposta.status);
      return null;
    }

    const dados = await resposta.json();
    if (!Array.isArray(dados) || dados.length === 0) {
      return null;
    }

    const resultado = dados[0];
    return {
      latitude: Number(resultado.lat),
      longitude: Number(resultado.lon),
      enderecoFormatado: resultado.display_name,
      fonte: "nominatim",
    };
  } catch (erro) {
    console.error("[nominatim] Falha ao geocodificar:", erro.message);
    return null;
  }
}

module.exports = { geocodificarComNominatim };
