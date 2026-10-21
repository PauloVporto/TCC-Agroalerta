const express = require("express");
const router = express.Router();
const { exigirAutenticacao } = require("../services/auth");
const {
  sincronizarMensagensDoUsuario,
  listarMensagens,
  contarNaoLidas,
  marcarLidas,
  notificacoesHabilitadas,
} = require("../services/mensagens");
const { statusCanais, buscarUsuarioNotificacao } = require("../services/notificar");

router.use(exigirAutenticacao);

/** GET /api/mensagens — lista caixa de entrada (opcional: ?sync=1 gera mensagens atuais) */
router.get("/", async (req, res) => {
  try {
    if (req.usuario.papel === "fornecedor") {
      return res.json({ mensagens: [], naoLidas: 0, notificacoes: false, canais: statusCanais() });
    }

    if (String(req.query.sync || "") === "1" || String(req.query.sync || "") === "true") {
      await sincronizarMensagensDoUsuario(req.usuario.id);
    }

    const mensagens = await listarMensagens(req.usuario.id);
    const naoLidas = await contarNaoLidas(req.usuario.id);
    const notificacoes = await notificacoesHabilitadas(req.usuario.id);
    const contato = await buscarUsuarioNotificacao(req.usuario.id);
    res.json({
      mensagens,
      naoLidas,
      notificacoes,
      canais: statusCanais(),
      contato: contato
        ? { email: contato.email, telefone: contato.telefone || null }
        : null,
    });
  } catch (erro) {
    console.error("[mensagens] listar:", erro);
    res.status(500).json({ erro: "Não foi possível carregar as mensagens de alerta." });
  }
});

/** POST /api/mensagens/sincronizar — atualiza clima e gera mensagens para todos os talhões */
router.post("/sincronizar", async (req, res) => {
  try {
    if (req.usuario.papel === "fornecedor") {
      return res.json({ mensagens: [], naoLidas: 0 });
    }
    await sincronizarMensagensDoUsuario(req.usuario.id);
    const mensagens = await listarMensagens(req.usuario.id);
    const naoLidas = await contarNaoLidas(req.usuario.id);
    res.json({ mensagens, naoLidas });
  } catch (erro) {
    console.error("[mensagens] sync:", erro);
    res.status(500).json({ erro: "Falha ao atualizar mensagens." });
  }
});

/** POST /api/mensagens/lidas — marca como lidas (body: { ids?: number[] }) */
router.post("/lidas", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
    const naoLidas = await marcarLidas(req.usuario.id, ids);
    res.json({ ok: true, naoLidas });
  } catch (erro) {
    console.error("[mensagens] lidas:", erro);
    res.status(500).json({ erro: "Não foi possível marcar as mensagens." });
  }
});

module.exports = router;
