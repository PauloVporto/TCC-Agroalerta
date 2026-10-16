/**
 * Combina a verificação de CEP (ViaCEP) com a geocodificação (Nominatim).
 *
 * O ViaCEP cobre todos os CEPs brasileiros e retorna cidade/UF com fidelidade.
 * O Nominatim geocodifica a cidade para obter lat/lon. Separar as duas
 * responsabilidades torna cada passo mais confiável do que buscar por CEP
 * diretamente no OpenStreetMap, cuja cobertura de códigos postais é limitada.
 */

const { consultarCep } = require("./viacep");
const { geocodificarComNominatim } = require("./nominatim");

const FALLBACK_COORDS = { latitude: -18.5122, longitude: -44.555, fonte: "fallback" };

async function resolverLocalizacaoPorCep(cep) {
  const resultado = await consultarCep(cep);
  if (!resultado.valido) {
    return { valido: false, erro: resultado.erro };
  }

  const enderecoParaGeocode = `${resultado.cidade}, ${resultado.uf}, Brasil`;
  const coords = (await geocodificarComNominatim(enderecoParaGeocode)) || FALLBACK_COORDS;

  const enderecoCompleto = [resultado.logradouro, resultado.bairro, `${resultado.cidade} - ${resultado.uf}`]
    .filter(Boolean)
    .join(", ");

  return {
    valido: true,
    cep: resultado.cep,
    cidade: resultado.cidade,
    uf: resultado.uf,
    bairro: resultado.bairro,
    latitude: coords.latitude,
    longitude: coords.longitude,
    enderecoFormatado: coords.enderecoFormatado || enderecoCompleto,
    fonteCoordenadas: coords.fonte || "nominatim",
  };
}

module.exports = { resolverLocalizacaoPorCep };
