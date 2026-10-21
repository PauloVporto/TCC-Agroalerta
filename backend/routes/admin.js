const express = require("express");
const router = express.Router();
const { exigirAutenticacao, exigirPapel, PAPEL_ADMIN } = require("../services/auth");
const { lerConfiguracao } = require("../services/notificacoes/config");
const whatsapp = require("../services/notificacoes/whatsapp");
const { CAMPOS, lerControle, atualizarControle, listarEventosAdmin } = require("../services/notificacoes/controle");
const { eventosDoEnvio } = require("../services/notificacoes/eventos");
const { acordarFila } = require("../services/notificacoes/fila");
const administracao = require("../services/notificacoes/administracao");

// Tudo aqui é só do administrador: o produtor recebe 403, sem token, 401.
router.use(exigirAutenticacao, exigirPapel(PAPEL_ADMIN));

class RequisicaoInvalida extends Error {}

function limiteDaConsulta(valor, padrao, maximo) {
  return Math.min(Math.max(parseInt(valor, 10) || padrao, 1), maximo);
}

function idDoEnvio(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new RequisicaoInvalida("Envio inválido.");
  return id;
}

// Pedido inválido → 400; ação fora de hora → 409; Evolution API → 502 com a mensagem; o resto, 500 genérico.
function responderErro(res, erro, contexto) {
  if (erro instanceof RequisicaoInvalida) return res.status(400).json({ erro: erro.message });
  if (erro instanceof administracao.AcaoRecusada) return res.status(409).json({ erro: erro.message });
  if (erro.provedor === "evolution") return res.status(502).json({ erro: erro.message });
  console.error(`[admin] ${contexto}:`, erro.message);
  return res.status(500).json({ erro: "Não foi possível concluir a ação. Veja o log do backend." });
}

function acao(contexto, executar) {
  return async (req, res) => {
    try {
      res.json(await executar(req));
    } catch (erro) {
      responderErro(res, erro, contexto);
    }
  };
}

// ---- WhatsApp (instância "agroalerta") -------------------------------------------

// GET /api/admin/whatsapp - conexão, número, QR Code (durante o pareamento), controles e travas
router.get("/whatsapp", acao("estado do WhatsApp", () => whatsapp.estadoParaPainel(lerConfiguracao())));

// POST /api/admin/whatsapp/conectar - cria a instância se preciso, configura o webhook e gera o QR Code
router.post("/whatsapp/conectar", acao("conectar", (req) => whatsapp.conectar(lerConfiguracao(), req.usuario.id)));

// POST /api/admin/whatsapp/reconectar - recupera a conexão (sem QR, se a sessão salva ainda valer)
router.post("/whatsapp/reconectar", acao("reconectar", (req) => whatsapp.reconectar(lerConfiguracao(), req.usuario.id)));

// POST /api/admin/whatsapp/desconectar - tira o número da instância (para parear outro)
router.post("/whatsapp/desconectar", acao("desconectar", (req) => whatsapp.desconectar(lerConfiguracao(), req.usuario.id)));

// PUT /api/admin/whatsapp/controles - body: { enviosBloqueados?, boasVindasAtivas?, alertasAtivos? } (booleanos)
router.put("/whatsapp/controles", acao("controles", async (req) => {
  const informados = Object.keys(CAMPOS).filter((campo) => req.body[campo] !== undefined);
  if (informados.length === 0 || informados.some((campo) => typeof req.body[campo] !== "boolean")) {
    throw new RequisicaoInvalida("Informe ao menos um controle (enviosBloqueados, boasVindasAtivas, alertasAtivos) com true ou false.");
  }
  await atualizarControle(req.body, req.usuario.id);
  acordarFila();
  return lerControle();
}));

// ---- Notificações ---------------------------------------------------------------

// GET /api/admin/notificacoes/resumo - agricultores autorizados e envios do WhatsApp por situação
router.get("/notificacoes/resumo", acao("resumo", () => administracao.resumoDoWhatsapp()));

// GET /api/admin/notificacoes?status=&tipo=&canal=&limite=100 - histórico de todos os produtores
router.get("/notificacoes", acao("histórico", async (req) => {
  const { status, tipo, canal } = req.query;
  if (
    (status && !administracao.STATUS.includes(status)) ||
    (tipo && !administracao.TIPOS.includes(tipo)) ||
    (canal && !administracao.CANAIS.includes(canal))
  ) {
    throw new RequisicaoInvalida("Filtro inválido.");
  }
  return { envios: await administracao.listarEnvios({ status, tipo, canal, limite: limiteDaConsulta(req.query.limite, 100, 500) }) };
}));

// GET /api/admin/notificacoes/:id/eventos - linha do tempo de um envio
router.get("/notificacoes/:id/eventos", acao("eventos", async (req) => ({ eventos: await eventosDoEnvio(idDoEnvio(req)) })));

// POST /api/admin/notificacoes/:id/cancelar - tira da fila um envio pendente
router.post("/notificacoes/:id/cancelar", acao("cancelar envio", async (req) => {
  await administracao.cancelarEnvio(idDoEnvio(req), req.usuario);
  return { ok: true };
}));

// POST /api/admin/notificacoes/:id/reenfileirar - reenvio, decidido pelo administrador, de um envio incerto
router.post("/notificacoes/:id/reenfileirar", acao("reenfileirar envio", async (req) => {
  await administracao.reenfileirarIncerto(idDoEnvio(req), req.usuario);
  acordarFila();
  return { ok: true };
}));

// POST /api/admin/notificacoes/cancelar-pendentes - body: { canal: "whatsapp" | "email" }
router.post("/notificacoes/cancelar-pendentes", acao("cancelar pendentes", async (req) => {
  if (!["whatsapp", "email"].includes(req.body.canal)) throw new RequisicaoInvalida("Informe o canal: whatsapp ou email.");
  return { cancelados: await administracao.cancelarPendentes(req.body.canal, req.usuario) };
}));

// ---- Agricultores e auditoria -----------------------------------------------------

// GET /api/admin/agricultores?limite=200
router.get("/agricultores", acao("agricultores", async (req) => ({
  agricultores: await administracao.listarAgricultores(limiteDaConsulta(req.query.limite, 200, 1000)),
})));

// GET /api/admin/logs?limite=100 - conexão do WhatsApp, mudanças de controle e ações na fila
router.get("/logs", acao("logs", async (req) => ({ eventos: await listarEventosAdmin(limiteDaConsulta(req.query.limite, 100, 500)) })));

module.exports = router;
