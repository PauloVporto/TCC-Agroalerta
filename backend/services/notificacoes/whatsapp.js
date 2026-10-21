/**
 * Canal WhatsApp: a instância única da Evolution API, conectada ao número do
 * Agro Alerta (remetente esperado em WHATSAPP_EXPECTED_SENDER, ex.: final 9503).
 * O produtor nunca conecta nada: só informa o celular e autoriza o recebimento.
 *
 * - liberacaoDoDespacho(): o que a fila pode enviar agora. Exige a trava da
 *   implantação aberta, envios liberados pelo administrador, a instância conectada
 *   e o número conectado igual ao remetente esperado. Qualquer trava fechada retém
 *   a fila inteira do WhatsApp.
 * - estadoParaPainel(): o que o administrador vê — nunca tokens nem segredos.
 * - conectar / reconectar / desconectar: ações do administrador, auditadas. A
 *   reconexão automática de quedas passageiras é feita pela própria Evolution API.
 */

const evolution = require("./provedores/evolution");
const { modoDoCanal, evolutionConfigurada } = require("./config");
const { lerControle, registrarEventoAdmin } = require("./controle");
const { remetenteCorresponde, telefoneDoWhatsapp, formatarTelefone } = require("../contato");
const { pool } = require("../db");

const MOTIVO_MODO = {
  desativado: "Envio real desativado na implantação (WHATSAPP_SENDING_ENABLED=false).",
  nao_configurado: "Evolution API não configurada (EVOLUTION_API_URL e EVOLUTION_API_KEY).",
};

function retido(motivo) {
  return { tipos: [], motivo, remetente: null };
}

// "5535999999503" → "9503": o painel e o produtor só precisam do final do número.
function finalDoNumero(digitos) {
  return digitos ? digitos.slice(-4) : null;
}

async function conexaoAtual(cfg) {
  const [{ existe, estado }, dados] = await Promise.all([evolution.estadoDaConexao(cfg), evolution.dadosDaInstancia(cfg)]);
  return { existe, estado, dados };
}

/**
 * @returns {{ tipos: string[], motivo: string|null, remetente: string|null }}
 *   tipos: tipos de mensagem liberados agora; remetente: telefone conectado (E.164).
 */
async function liberacaoDoDespacho(config) {
  const modo = modoDoCanal(config, "whatsapp");
  if (MOTIVO_MODO[modo]) return retido(MOTIVO_MODO[modo]);
  const { remetenteEsperado, evolution: cfg } = config.whatsapp;
  if (!remetenteEsperado) return retido("Remetente esperado não configurado (WHATSAPP_EXPECTED_SENDER).");

  const controle = await lerControle();
  if (controle.enviosBloqueados) return retido("Envios do WhatsApp bloqueados pelo administrador.");
  const tipos = [];
  if (controle.boasVindasAtivas) tipos.push("boas_vindas");
  if (controle.alertasAtivos) tipos.push("alerta_climatico");
  if(config.boletim?.ativo||config.novosAlertas?.ativo){
    const novo=await require("./climaControle").consultar();
    if(config.boletim?.ativo&&!novo.boletins_pausados)tipos.push("boletim_diario");
    if(config.novosAlertas?.ativo&&!novo.novos_alertas_pausados&&controle.alertasAtivos)tipos.push("alerta_meteorologico");
  }
  if (tipos.length === 0) return retido("Boas-vindas e alertas automáticos bloqueados pelo administrador.");

  let conexao;
  try {
    conexao = await conexaoAtual(cfg);
  } catch (erro) {
    return retido("Evolution API indisponível: " + erro.message);
  }
  if (!conexao.existe) return retido(`A instância "${cfg.instancia}" ainda não foi criada: conecte o WhatsApp no painel do administrador.`);
  if (conexao.estado !== "open") return retido(`WhatsApp desconectado (estado: ${conexao.estado || "desconhecido"}).`);
  const numero = conexao.dados && conexao.dados.numero;
  if (!remetenteCorresponde(numero, remetenteEsperado)) {
    return retido(`O número conectado não é o remetente esperado (final ${finalDoNumero(remetenteEsperado)}): envios bloqueados.`);
  }
  return { tipos, motivo: null, remetente: telefoneDoWhatsapp(numero) };
}

/** Situação completa para o painel do administrador (sem tokens nem segredos). */
async function estadoParaPainel(config) {
  const { whatsapp } = config;
  const cfg = whatsapp.evolution;
  const [controle, liberacao] = await Promise.all([lerControle(), liberacaoDoDespacho(config)]);
  const estado = {
    instancia: cfg.instancia,
    modo: modoDoCanal(config, "whatsapp"),
    remetenteEsperadoFinal: finalDoNumero(whatsapp.remetenteEsperado),
    controle,
    envioLiberado: liberacao.tipos.length > 0,
    motivoRetencao: liberacao.motivo,
    evolution: { configurada: evolutionConfigurada(config), disponivel: false, erro: null },
    webhook: { configuradoNoServidor: Boolean(cfg.webhookUrl && cfg.webhookSecret), emDia: false },
    conexao: {
      existe: false, estado: null, numero: null, perfil: null, remetenteValido: false,
      qrCode: null, motivoDesconexao: null, desconectadaEm: null,
    },
  };
  if (!estado.evolution.configurada) return estado;

  try {
    const { existe, estado: situacao, dados } = await conexaoAtual(cfg);
    estado.evolution.disponivel = true;
    estado.conexao.existe = existe;
    estado.conexao.estado = situacao;
    if (dados) {
      const telefone = telefoneDoWhatsapp(dados.numero);
      estado.conexao.numero = telefone ? formatarTelefone(telefone) : null;
      estado.conexao.perfil = dados.perfil;
      estado.conexao.remetenteValido = remetenteCorresponde(dados.numero, whatsapp.remetenteEsperado);
      estado.conexao.motivoDesconexao = dados.motivoDesconexao;
      estado.conexao.desconectadaEm = dados.desconectadaEm;
    }
    // Em pareamento, /instance/connect só devolve o QR atual (não reinicia nada).
    if (situacao === "connecting") estado.conexao.qrCode = (await evolution.conectar(cfg)).qrCode;
    if (existe && estado.webhook.configuradoNoServidor) estado.webhook.emDia = await evolution.webhookEmDia(cfg);
  } catch (erro) {
    estado.evolution.erro = erro.message;
  }
  return estado;
}

/**
 * Prepara e inicia o pareamento por QR Code: cria a instância se ainda não existir,
 * (re)configura o webhook e pede a conexão.
 */
async function conectar(config, usuarioId) {
  const cfg = config.whatsapp.evolution;
  if (await evolution.criarInstancia(cfg)) {
    await registrarEventoAdmin(pool, { categoria: "conexao", tipo: "instancia_criada", detalhe: `Instância "${cfg.instancia}" criada na Evolution API.`, usuarioId });
  }
  if (cfg.webhookUrl && cfg.webhookSecret) await evolution.configurarWebhook(cfg);
  const { estado } = await evolution.conectar(cfg);
  await registrarEventoAdmin(pool, {
    categoria: "conexao",
    tipo: estado === "open" ? "ja_conectado" : "pareamento_solicitado",
    detalhe: estado === "open" ? "A instância já estava conectada." : "Pareamento por QR Code iniciado.",
    usuarioId,
  });
  return estadoParaPainel(config);
}

/** Recupera a conexão: com a sessão salva, reconecta sem QR; sem ela, gera um QR novo. */
async function reconectar(config, usuarioId) {
  const cfg = config.whatsapp.evolution;
  const { estado } = await evolution.estadoDaConexao(cfg);
  if (estado === "open" || estado === "connecting") await evolution.reiniciar(cfg);
  else await evolution.conectar(cfg);
  await registrarEventoAdmin(pool, { categoria: "conexao", tipo: "reconexao_solicitada", detalhe: `Reconexão pedida (estado anterior: ${estado || "desconhecido"}).`, usuarioId });
  return estadoParaPainel(config);
}

/** Desconecta o número da instância (para parear outro). A instância e o webhook continuam. */
async function desconectar(config, usuarioId) {
  await evolution.desconectar(config.whatsapp.evolution);
  await registrarEventoAdmin(pool, { categoria: "conexao", tipo: "desconectado_pelo_administrador", detalhe: "Número desconectado da instância pelo administrador.", usuarioId });
  return estadoParaPainel(config);
}

module.exports = { liberacaoDoDespacho, estadoParaPainel, conectar, reconectar, desconectar, finalDoNumero };
