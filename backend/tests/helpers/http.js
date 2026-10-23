// Respostas HTTP falsas para testar as integrações sem chamar os provedores.
function resposta(status, corpo, cabecalhos = {}) {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return new Response(texto, { status, headers: cabecalhos });
}

module.exports = { resposta };
