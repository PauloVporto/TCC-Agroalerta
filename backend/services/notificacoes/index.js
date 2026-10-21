/**
 * Ponto de entrada das notificações: liga os processos automáticos junto com o
 * backend e registra as escolhas feitas no cadastro.
 */

const { pool } = require("../db");
const { lerConfiguracao, modoDoCanal, avisosDeConfiguracao } = require("./config");
const { provedoresDaConfiguracao } = require("./provedores");
const { enfileirar, acordarFila, iniciarFila, pararFila } = require("./fila");
const { registrarConsentimento } = require("./consentimentos");
const { iniciarConsultaDeEntrega, pararConsultaDeEntrega } = require("./statusEntrega");
const { iniciarMonitoramento, pararMonitoramento } = require("../monitoramento");
const { emailBoasVindas, smsBoasVindas } = require("./templates");

/**
 * Grava os consentimentos do cadastro e enfileira as boas-vindas de cada canal
 * autorizado, numa transação. A chave de idempotência por produtor e canal
 * garante uma única mensagem de boas-vindas por canal.
 * @param escolhas { email: boolean, sms: boolean }
 */
async function registrarEscolhasDoCadastro(usuario, escolhas, config = lerConfiguracao()) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    if (escolhas.email) {
      await registrarConsentimento(cliente, {
        usuarioId: usuario.id, canal: "email", concedido: true, destino: usuario.email, origem: "cadastro",
      });
      const email = emailBoasVindas({ nome: usuario.nome });
      await enfileirar(cliente, {
        usuarioId: usuario.id,
        canal: "email",
        tipo: "boas_vindas",
        chaveIdempotencia: `boas_vindas:email:usuario:${usuario.id}`,
        destino: usuario.email,
        assunto: email.assunto,
        conteudo: email.texto,
        conteudoHtml: email.html,
        resumo: "Boas-vindas ao Agro Alerta",
        maxTentativas: config.fila.maxTentativas,
      });
    }
    if (escolhas.sms) {
      await registrarConsentimento(cliente, {
        usuarioId: usuario.id, canal: "sms", concedido: true, destino: usuario.telefone, origem: "cadastro",
      });
      await enfileirar(cliente, {
        usuarioId: usuario.id,
        canal: "sms",
        tipo: "boas_vindas",
        chaveIdempotencia: `boas_vindas:sms:usuario:${usuario.id}`,
        destino: usuario.telefone,
        conteudo: smsBoasVindas(),
        resumo: "Boas-vindas ao Agro Alerta",
        maxTentativas: config.fila.maxTentativas,
      });
    }
    await cliente.query("COMMIT");
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
  if (escolhas.email || escolhas.sms) acordarFila();
}

/** Inicia fila, consulta de entregas e monitoramento climático. */
function iniciarNotificacoes({ config = lerConfiguracao(), log = console.log } = {}) {
  const provedores = provedoresDaConfiguracao(config);
  for (const aviso of avisosDeConfiguracao(config)) log("[notificacoes] atenção: " + aviso);
  iniciarFila({ config, provedores, log });
  iniciarConsultaDeEntrega({ provedores, log });
  if (config.monitoramento.ativo) iniciarMonitoramento({ config, log });
  return { email: modoDoCanal(config, "email"), sms: modoDoCanal(config, "sms") };
}

async function pararNotificacoes() {
  pararConsultaDeEntrega();
  await Promise.all([pararFila(), pararMonitoramento()]);
}

module.exports = { registrarEscolhasDoCadastro, iniciarNotificacoes, pararNotificacoes };
