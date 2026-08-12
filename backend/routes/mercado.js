const express = require("express");
const router = express.Router();
const { obterHistorico, gerarAnaliseTendencia } = require("../services/market");

// GET /api/mercado/:cultura/historico - histórico de preços
router.get("/:cultura/historico", (req, res) => {
  const historico = obterHistorico(req.params.cultura);
  if (!historico) {
    return res.status(404).json({ erro: "Cultura não encontrada" });
  }
  res.json(historico);
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
