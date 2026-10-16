/**
 * Verificação de CEP via API oficial do ViaCEP (viacep.com.br).
 *
 * Cobertura total dos CEPs brasileiros, sem necessidade de chave de API.
 * Retorna cidade, UF, bairro e logradouro. Coordenadas são resolvidas
 * separadamente pelo serviço de geocodificação (nominatim.js).
 */

const BASE_URL = "https://viacep.com.br/ws";

async function consultarCep(cep) {
  const cepLimpo = String(cep || "").replace(/\D/g, "");

  if (cepLimpo.length !== 8) {
    return { valido: false, erro: "CEP inválido. Informe os 8 dígitos (ex: 37540-000)." };
  }

  try {
    const url = `${BASE_URL}/${cepLimpo}/json/`;

    const resposta = await fetch(url, {
      headers: { "User-Agent": "AgroAlerta-TCC/1.0 (projeto academico)" },
    });

    if (!resposta.ok) {
      console.error("[viacep] Resposta não-ok:", resposta.status);
      return { valido: false, erro: "Não foi possível verificar o CEP agora. Tente novamente em instantes." };
    }

    const dados = await resposta.json();

    if (dados.erro) {
      return { valido: false, erro: "CEP não encontrado. Verifique o número digitado." };
    }

    return {
      valido: true,
      cep: dados.cep,
      logradouro: dados.logradouro || "",
      bairro: dados.bairro || "",
      cidade: dados.localidade,
      uf: dados.uf,
    };
  } catch (erro) {
    console.error("[viacep] Falha ao consultar CEP:", erro.message);
    return { valido: false, erro: "Não foi possível verificar o CEP agora. Tente novamente em instantes." };
  }
}

module.exports = { consultarCep };
