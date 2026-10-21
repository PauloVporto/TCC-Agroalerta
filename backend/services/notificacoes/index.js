/**
 * Ponto de entrada das notificações: liga os processos automáticos junto com o
 * backend e registra as escolhas do produtor (cadastro e painel).
 *
 * Boas-vindas: uma por canal e por conta (chave boas_vindas:<canal>:usuario:<id>).
 * No WhatsApp, saem na primeira autorização da conta — no cadastro ou depois, no
 * painel — e valem por 7 dias: se o envio ficar retido além disso, expiram.
 * Atualizar o cadastro, entrar de novo ou reautorizar nunca gera outra.
 */

const { emTransacao } = require("../db");
const { lerConfiguracao, modoDoCanal, avisosDeConfiguracao } = require("./config");
const { provedoresDaConfiguracao } = require("./provedores");
const { enfileirar, cancelarPendentesDoProdutor, acordarFila, iniciarFila, pararFila } = require("./fila");
const {
  registrarConsentimento,
  obterConsentimentos,
  contatoDoProdutor,
  salvarPreferencias,
  autorizacaoVigente,
} = require("./consentimentos");
const { iniciarConsultaDeEntrega, pararConsultaDeEntrega } = require("./statusEntrega");
const { iniciarMonitoramento, pararMonitoramento } = require("../monitoramento");
const { emailBoasVindas, whatsappBoasVindas } = require("./templates");

const VALIDADE_BOAS_VINDAS_MS = 7 * 24 * 60 * 60 * 1000;

function enfileirarBoasVindasPorEmail(db, usuario, config) {
  const email = emailBoasVindas({ nome: usuario.nome });
  return enfileirar(db, {
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

function enfileirarBoasVindasPorWhatsapp(db, usuario, config) {
  return enfileirar(db, {
    usuarioId: usuario.id,
    canal: "whatsapp",
    tipo: "boas_vindas",
    chaveIdempotencia: `boas_vindas:whatsapp:usuario:${usuario.id}`,
    destino: usuario.telefone,
    conteudo: whatsappBoasVindas(),
    resumo: "Boas-vindas ao Agro Alerta",
    maxTentativas: config.fila.maxTentativas,
    expiraEm: new Date(Date.now() + VALIDADE_BOAS_VINDAS_MS),
  });
}

/**
 * Grava os consentimentos do cadastro e enfileira as boas-vindas de cada canal
 * autorizado, numa transação.
 * @param escolhas { email: boolean, whatsapp: boolean }
 */
async function registrarEscolhasDoCadastro(usuario, escolhas, config = lerConfiguracao()) {
  const enfileirados = await emTransacao(async (cliente) => {
    let total = 0;
    if (escolhas.email) {
      await registrarConsentimento(cliente, {
        usuarioId: usuario.id, canal: "email", concedido: true, destino: usuario.email, origem: "cadastro",
      });
      if (await enfileirarBoasVindasPorEmail(cliente, usuario, config)) total++;
    }
    if (escolhas.whatsapp) {
      await registrarConsentimento(cliente, {
        usuarioId: usuario.id, canal: "whatsapp", concedido: true, destino: usuario.telefone, origem: "cadastro",
      });
      if (await enfileirarBoasVindasPorWhatsapp(cliente, usuario, config)) total++;
    }
    return total;
  });
  if (enfileirados) acordarFila();
}

/**
 * Grava as escolhas do painel numa transação. Um consentimento só ganha linha nova
 * quando a decisão muda — no WhatsApp, também quando o celular mudou desde a
 * autorização —, para a trilha registrar decisões, não cliques. Revogar um canal
 * cancela o que dele ainda estava na fila.
 * @param escolhas { email: { consentido, nivelMinimo }, whatsapp: { consentido, nivelMinimo } }
 */
async function salvarEscolhasDoPainel(usuarioId, escolhas, config = lerConfiguracao()) {
  const enfileirados = await emTransacao(async (cliente) => {
    const [decisoes, contato] = await Promise.all([
      obterConsentimentos(usuarioId, cliente),
      contatoDoProdutor(usuarioId, cliente),
    ]);
    let total = 0;

    if (escolhas.email.consentido !== decisoes.email.concedido) {
      await registrarConsentimento(cliente, {
        usuarioId, canal: "email", concedido: escolhas.email.consentido, destino: contato.email, origem: "painel",
      });
      if (!escolhas.email.consentido) {
        await cancelarPendentesDoProdutor(cliente, usuarioId, "email", "O produtor revogou a autorização do e-mail.");
      }
    }

    const whatsappVigente = autorizacaoVigente("whatsapp", decisoes.whatsapp, contato.telefone);
    const decisaoNova = escolhas.whatsapp.consentido ? !whatsappVigente : decisoes.whatsapp.concedido;
    if (decisaoNova) {
      await registrarConsentimento(cliente, {
        usuarioId, canal: "whatsapp", concedido: escolhas.whatsapp.consentido, destino: contato.telefone, origem: "painel",
      });
      if (escolhas.whatsapp.consentido) {
        if (await enfileirarBoasVindasPorWhatsapp(cliente, { id: usuarioId, telefone: contato.telefone }, config)) total++;
      } else {
        await cancelarPendentesDoProdutor(cliente, usuarioId, "whatsapp", "O produtor revogou a autorização do WhatsApp.");
      }
    }

    await salvarPreferencias(cliente, usuarioId, {
      emailNivelMinimo: escolhas.email.nivelMinimo,
      whatsappNivelMinimo: escolhas.whatsapp.nivelMinimo,
    });
    return total;
  });
  if (enfileirados) acordarFila();
}

/** Inicia fila, consulta de entregas (e-mail) e, se autorizado, o monitoramento climático. */
function iniciarNotificacoes({ config = lerConfiguracao(), log = console.log } = {}) {
  const provedores = provedoresDaConfiguracao(config);
  for (const aviso of avisosDeConfiguracao(config)) log("[notificacoes] atenção: " + aviso);
  iniciarFila({ config, provedores, log });
  iniciarConsultaDeEntrega({ provedores, log });
  if (config.monitoramento.ativo) iniciarMonitoramento({ config, log });
  return {
    email: modoDoCanal(config, "email"),
    whatsapp: modoDoCanal(config, "whatsapp"),
    monitoramento: config.monitoramento.ativo ? "ativo" : "desligado",
  };
}

async function pararNotificacoes() {
  pararConsultaDeEntrega();
  await Promise.all([pararFila(), pararMonitoramento()]);
}

module.exports = { registrarEscolhasDoCadastro, salvarEscolhasDoPainel, iniciarNotificacoes, pararNotificacoes };
