const express = require("express");
const router = express.Router();
const { obterHistorico, gerarAnaliseTendencia, obterContextoIntegracao } = require("../services/market");

// GET /api/mercado/:cultura/historico - histórico de preços + cotação ao vivo
router.get("/:cultura/historico", async (req, res) => {
  const historico = await obterHistorico(req.params.cultura);
  if (!historico) {
    return res.status(404).json({ erro: "Cultura não encontrada" });
  }
  res.json(historico);
});

router.get("/:cultura/contexto-llm", async (req, res) => {
  try {
    res.json(await obterContextoIntegracao(req.params.cultura));
  } catch (erro) {
    res.status(400).json({ erro: erro.message });
  }
});

// GET /api/mercado/:cultura/analise - resumo qualitativo de tendência (IA)
router.get("/:cultura/analise", async (req, res) => {
  try {
    const analise = await gerarAnaliseTendencia(req.params.cultura);
    res.json(analise);
  } catch (erro) {
    console.error("[mercado] Erro ao gerar análise:", erro);
    res.status(400).json({ erro: erro.message });
  }
});

module.exports = router;
