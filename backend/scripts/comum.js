/**
 * Utilidades dos scripts de teste manual: argumentos, confirmação explícita e
 * acompanhamento da entrega.
 */

const readline = require("readline");

function argumento(nome) {
  const posicao = process.argv.indexOf("--" + nome);
  return posicao === -1 ? undefined : process.argv[posicao + 1];
}

function temOpcao(nome) {
  return process.argv.includes("--" + nome);
}

// Só confirma quem digitar ENVIAR; qualquer outra resposta (ou fim da entrada) cancela.
function confirmar(pergunta, { entrada = process.stdin, saida = process.stdout } = {}) {
  const leitor = readline.createInterface({ input: entrada, output: saida });
  return new Promise((resolve) => {
    leitor.on("close", () => resolve(false));
    leitor.question(pergunta, (resposta) => {
      resolve(resposta.trim() === "ENVIAR");
      leitor.close();
    });
  });
}

// Consulta o provedor a cada 5 s, por até 1 minuto, até haver confirmação.
async function acompanharEntrega(consultar, { tentativas = 12, intervaloMs = 5000 } = {}) {
  let ultimo = { status: null, detalhe: "sem resposta do provedor" };
  for (let i = 0; i < tentativas && !ultimo.status; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
    try {
      ultimo = await consultar();
    } catch (erro) {
      ultimo = { status: null, detalhe: erro.message };
    }
  }
  return ultimo;
}

module.exports = { argumento, temOpcao, confirmar, acompanharEntrega };
