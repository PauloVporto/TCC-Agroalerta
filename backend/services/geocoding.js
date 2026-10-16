/**
 * Geocodificação (endereço -> latitude/longitude) via Nominatim (OpenStreetMap).
 *
 * Gratuito, sem chave/billing, usado como geocodificador principal. Se o
 * Nominatim falhar (timeout, indisponibilidade), cai no fallback fixo do
 * centro de MG para não bloquear o cadastro.
 *
 * Nota: o CEP já é validado e geocodificado em services/viacep.js — este
 * serviço é utilizado quando a geocodificação é acionada por endereço de
 * texto em vez de CEP.
 */

const { geocodificarComNominatim } = require("./nominatim");

const FALLBACK_COORDS = { latitude: -18.5122, longitude: -44.555 };

async function geocodificarEndereco(endereco) {
  const viaNominatim = await geocodificarComNominatim(endereco);
  if (viaNominatim) return { ...viaNominatim, valido: true };

  console.warn(
    '[geocoding] Não foi possível geocodificar "' + endereco + '" via Nominatim - ' +
    "usando coordenada aproximada fixa (centro de MG)."
  );
  return { ...FALLBACK_COORDS, fonte: "simulado", enderecoFormatado: endereco, valido: true };
}

module.exports = { geocodificarEndereco };
