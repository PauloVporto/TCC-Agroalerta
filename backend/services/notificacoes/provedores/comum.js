/**
 * Partes comuns às integrações de e-mail e WhatsApp.
 *
 * Todo erro de provedor vira um ErroProvedor com um `codigo` estável e a
 * indicação `temporario`: queda de rede, limite de taxa e instabilidade do
 * provedor merecem nova tentativa; credencial inválida ou dados recusados são
 * falhas definitivas. `incerto` marca o erro em que a mensagem pode ter saído
 * (ex.: a requisição foi enviada e a resposta não voltou): a fila nunca a reenvia.
 */

const TEMPO_LIMITE_MS = 15000;

class ErroProvedor extends Error {
  constructor({ provedor, codigo, mensagem, temporario, status = null, aguardarSegundos = null, incerto = false }) {
    super(mensagem);
    this.name = "ErroProvedor";
    this.provedor = provedor;
    this.codigo = codigo;
    this.temporario = temporario;
    this.status = status;
    this.aguardarSegundos = aguardarSegundos;
    this.incerto = incerto;
  }
}

function erroDeConfiguracao(provedor, mensagem) {
  return new ErroProvedor({ provedor, codigo: "configuracao_ausente", mensagem, temporario: false });
}

async function requisitar(provedor, url, opcoes = {}) {
  try {
    return await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  } catch (erro) {
    throw new ErroProvedor({
      provedor,
      codigo: "falha_conexao",
      mensagem: `Falha de conexão com ${provedor}: ${erro.message}`,
      temporario: true,
    });
  }
}

// Corpo da resposta como JSON quando possível; senão, o texto cru.
async function lerCorpo(resposta) {
  const texto = await resposta.text();
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

function segundosDeEspera(resposta) {
  const valor = Number(resposta.headers.get("retry-after"));
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

module.exports = { ErroProvedor, erroDeConfiguracao, requisitar, lerCorpo, segundosDeEspera };
