/**
 * Serviço de verificação de CEP via ViaCEP (https://viacep.com.br).
 *
 * É a fonte da verdade para "essa cidade/região existe de verdade":
 * é uma API brasileira, gratuita e sem necessidade de chave, mantida a
 * partir da base de CEPs dos Correios. Usada no cadastro de usuário e de
 * talhão para validar o CEP antes de geocodificar e buscar o clima.
 */

const BASE_URL = "https://viacep.com.br/ws";

async function consultarCep(cep) {
  const cepLimpo = String(cep || "").replace(/\D/g, "");

  if (cepLimpo.length !== 8) {
    return { valido: false, erro: "CEP inválido. Informe os 8 dígitos (ex: 37540-000)." };
  }

  try {
    const resposta = await fetch(BASE_URL + "/" + cepLimpo + "/json/");
    const dados = await resposta.json();

    if (!resposta.ok || dados.erro) {
      return { valido: false, erro: "CEP não encontrado. Verifique o número digitado." };
    }

    const enderecoCompleto = [dados.logradouro, dados.bairro, dados.localidade + " - " + dados.uf]
      .filter(Boolean)
      .join(", ");

    return {
      valido: true,
      cep: dados.cep,
      logradouro: dados.logradouro || "",
      bairro: dados.bairro || "",
      cidade: dados.localidade,
      uf: dados.uf,
      enderecoCompleto,
    };
  } catch (erro) {
    console.error("[viacep] Falha ao consultar CEP:", erro.message);
    return { valido: false, erro: "Não foi possível verificar o CEP agora. Tente novamente em instantes." };
  }
}

module.exports = { consultarCep };
