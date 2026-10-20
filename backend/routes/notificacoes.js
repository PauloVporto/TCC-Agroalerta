const express = require("express");
const router = express.Router();
const { exigirAutenticacao } = require("../services/auth");
const { lerConfiguracao } = require("../services/notificacoes/config");
const {
  NIVEIS_MINIMOS,
  resumoDasPreferencias,
  atualizarNotificacoes,
  contatoDoProdutor,
} = require("../services/notificacoes/consentimentos");
const { listarHistorico } = require("../services/notificacoes/historico");
const { ehCelular } = require("../services/contato");

router.use(exigirAutenticacao);

function escolhaValida(canal) {
  return Boolean(canal) && typeof canal.consentido === "boolean" && NIVEIS_MINIMOS.includes(canal.nivelMinimo);
}

// GET /api/notificacoes/preferencias - autorização, gravidade mínima, destino e modo de cada canal
router.get("/preferencias", async (req, res) => {
  try {
    res.json(await resumoDasPreferencias(req.usuario.id, lerConfiguracao()));
  } catch (erro) {
    console.error("[notificacoes] preferências:", erro.message);
    res.status(500).json({ erro: "Não foi possível carregar as preferências de notificação." });
  }
});

// PUT /api/notificacoes/preferencias
// body: { email: { consentido, nivelMinimo }, sms: { consentido, nivelMinimo } }
router.put("/preferencias", async (req, res) => {
  const { email, sms } = req.body || {};
  if (!escolhaValida(email) || !escolhaValida(sms)) {
    return res.status(400).json({
      erro: "Informe, para e-mail e SMS, consentido (true ou false) e nivelMinimo (medio ou alto).",
    });
  }
  try {
    if (sms.consentido) {
      const contato = await contatoDoProdutor(req.usuario.id);
      if (!ehCelular(contato.telefone)) {
        return res.status(400).json({ erro: "Cadastre um celular válido com DDD em Dados da conta antes de autorizar SMS." });
      }
    }
    await atualizarNotificacoes(req.usuario.id, { email, sms });
    res.json(await resumoDasPreferencias(req.usuario.id, lerConfiguracao()));
  } catch (erro) {
    console.error("[notificacoes] salvar preferências:", erro.message);
    res.status(500).json({ erro: "Não foi possível salvar as preferências de notificação." });
  }
});

// GET /api/notificacoes/historico?limite=50 - envios do produtor logado, mais recentes primeiro
router.get("/historico", async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 50, 1), 200);
  try {
    res.json({ envios: await listarHistorico(req.usuario.id, limite) });
  } catch (erro) {
    console.error("[notificacoes] histórico:", erro.message);
    res.status(500).json({ erro: "Não foi possível carregar o histórico de notificações." });
  }
});

module.exports = router;
