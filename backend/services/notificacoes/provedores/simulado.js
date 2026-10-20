/**
 * Provedor do modo simulado (desenvolvimento): registra no log, com o destino
 * mascarado, e devolve um identificador local — nenhuma chamada externa, sem custo.
 */

const crypto = require("crypto");
const { mascararEmail, mascararTelefone } = require("../../contato");

function criarProvedorSimulado(canal, log = console.log) {
  const mascarar = canal === "email" ? mascararEmail : mascararTelefone;
  return {
    nome: "simulado",
    modo: "simulado",
    async enviar(mensagem) {
      log(`[notificacoes:simulado] ${canal} para ${mascarar(mensagem.destino)} | ${mensagem.resumo}`);
      return { provedorId: "simulado-" + crypto.randomUUID() };
    },
  };
}

module.exports = { criarProvedorSimulado };
