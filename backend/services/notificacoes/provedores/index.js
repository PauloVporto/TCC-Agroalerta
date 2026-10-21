/**
 * Monta o provedor de cada canal a partir da configuração.
 *
 * Todo provedor expõe { nome, modo, liberacao(), enviar(mensagem) }:
 *   liberacao() → { tipos, motivo, remetente }: o que pode sair agora;
 *   enviar()    → { provedorId } ou lança ErroProvedor.
 * Opcionais: consultarStatus(provedorId) (consulta de entrega), reservarVez(envio)
 * (ritmo e travas conferidos antes de cada mensagem), reenvioSeguro (false: o
 * provedor não descarta repetições, então resultado incerto não é reenviado),
 * despachoExclusivo (um despachante por vez) e tamanhoLote.
 */

const resend = require("./resend");
const evolution = require("./evolution");
const { criarProvedorSimulado } = require("./simulado");
const { erroDeConfiguracao } = require("./comum");
const { liberacaoDoDespacho } = require("../whatsapp");
const { lerControle } = require("../controle");
const { verificarRitmo } = require("../limitesWhatsapp");
const { numeroParaWhatsapp } = require("../../contato");

const TIPOS_AUTOMATICOS = ["boas_vindas", "alerta_climatico"];

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tudoLiberado() {
  return { tipos: TIPOS_AUTOMATICOS, motivo: null, remetente: null };
}

function provedorNaoSuportado(variavel, valor) {
  return {
    nome: valor,
    modo: "real",
    liberacao: tudoLiberado,
    async enviar() {
      throw erroDeConfiguracao(valor, `${variavel}="${valor}" não é um provedor suportado.`);
    },
  };
}

function provedorDeEmail(config) {
  const { email } = config;
  if (!email.envioAtivo) return { ...criarProvedorSimulado("email"), liberacao: tudoLiberado };
  if (email.provedor !== "resend") return provedorNaoSuportado("EMAIL_PROVIDER", email.provedor);
  return {
    nome: "resend",
    modo: "real",
    liberacao: tudoLiberado,
    enviar: (m) =>
      resend.enviarEmail({
        apiKey: email.resendApiKey,
        remetente: email.remetente,
        para: m.destino,
        assunto: m.assunto,
        html: m.html,
        texto: m.texto,
        chaveIdempotencia: m.chaveIdempotencia,
        tags: m.tags,
      }),
    consultarStatus: async (id) =>
      resend.statusPorEventoResend((await resend.consultarEmail({ apiKey: email.resendApiKey, id })).ultimoEvento),
  };
}

function provedorDeWhatsapp(config) {
  const { whatsapp } = config;
  return {
    nome: "evolution",
    modo: "real",
    reenvioSeguro: false,
    despachoExclusivo: true,
    tamanhoLote: 1,
    liberacao: () => liberacaoDoDespacho(config),
    // Conferido a cada mensagem: o administrador pode ter bloqueado durante a rodada.
    async reservarVez(envio) {
      const controle = await lerControle();
      const tipoLiberado = envio.tipo === "boas_vindas" ? controle.boasVindasAtivas : envio.tipo==="boletim_diario" ? true : controle.alertasAtivos;
      if (controle.enviosBloqueados || !tipoLiberado) {
        return { ok: false, global: true, codigo: "envios_bloqueados", mensagem: "Envio retido: bloqueado pelo administrador." };
      }
      const ritmo = await verificarRitmo(envio, whatsapp);
      if (!ritmo.ok) return ritmo;
      if (ritmo.esperaMs > 0) await esperar(ritmo.esperaMs);
      // A conexão ou o remetente podem mudar entre mensagens da mesma rodada.
      // Conferir novamente após a espera evita continuar com uma liberação antiga.
      const atual = await liberacaoDoDespacho(config);
      if (!atual.tipos.includes(envio.tipo)) {
        return { ok: false, global: true, codigo: "whatsapp_indisponivel",
          mensagem: atual.motivo || "Tipo de mensagem não autorizado no momento do despacho." };
      }
      return { ok: true };
    },
    enviar: (m) => evolution.enviarTexto(whatsapp.evolution, { numero: numeroParaWhatsapp(m.destino), texto: m.texto }),
  };
}

function provedoresDaConfiguracao(config) {
  return { email: provedorDeEmail(config), whatsapp: provedorDeWhatsapp(config) };
}

module.exports = { provedoresDaConfiguracao, TIPOS_AUTOMATICOS };
