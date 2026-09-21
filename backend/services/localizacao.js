/**
 * Combina a verificação de CEP (ViaCEP, autoritativo para "essa cidade/
 * região existe") com a geocodificação (Google Maps, para obter
 * latitude/longitude e alimentar o serviço de clima).
 *
 * O ViaCEP é quem decide se o CEP é válido; o Google Maps é usado apenas
 * como um passo best-effort para refinar as coordenadas - se ele falhar
 * ou não estiver configurado, cai no fallback simulado do próprio
 * geocoding.js, sem bloquear o cadastro (o CEP já foi confirmado real).
 */

const { consultarCep } = require("./viacep");
const { geocodificarEndereco } = require("./geocoding");

async function resolverLocalizacaoPorCep(cep) {
  const viacep = await consultarCep(cep);
  if (!viacep.valido) {
    return { valido: false, erro: viacep.erro };
  }

  const coordenadas = await geocodificarEndereco(viacep.enderecoCompleto);

  return {
    valido: true,
    cep: viacep.cep,
    cidade: viacep.cidade,
    uf: viacep.uf,
    bairro: viacep.bairro,
    latitude: coordenadas.latitude,
    longitude: coordenadas.longitude,
    enderecoFormatado: coordenadas.enderecoFormatado || viacep.enderecoCompleto,
    fonteCoordenadas: coordenadas.fonte,
  };
}

module.exports = { resolverLocalizacaoPorCep };
