const express = require("express");
const router = express.Router();
const { obterHistorico, gerarAnaliseTendencia } = require("../services/market");
const { buscarCotacaoAV } = require("../services/alphavantage");
const { buscarCotacaoStooq, buscarHistoricoMensalStooq } = require("../services/stooq");
const { buscarPtax, buscarIndiceCommoditiesAgro } = require("../services/bcb");

// GET /api/mercado/cotacoes?cultura=cafe
// Dados externos: PTAX (BCB), cotação internacional (Alpha Vantage → Stooq) e IC-Br Agropecuário (BCB).
// Rota definida ANTES de /:cultura para não ser capturada como parâmetro.
router.get("/cotacoes", async (req, res) => {
  const cultura = req.query.cultura || "cafe";

  const [ptaxResult, icbrResult, avResult, stooqResult] = await Promise.allSettled([
    buscarPtax(),
    buscarIndiceCommoditiesAgro(),
    buscarCotacaoAV(cultura),
    buscarCotacaoStooq(cultura),
  ]);

  // Cadeia de fallback: Alpha Vantage → Stooq
  const cotacaoIntl =
    (avResult.status === "fulfilled" && avResult.value) ||
    (stooqResult.status === "fulfilled" && stooqResult.value) ||
    null;

  res.json({
    ptax: ptaxResult.status === "fulfilled" ? ptaxResult.value : null,
    icbr: icbrResult.status === "fulfilled" ? icbrResult.value : null,
    cotacaoInternacional: cotacaoIntl,
  });
});

// GET /api/mercado/:cultura/historico
// Tenta Stooq primeiro (dados reais mensais). Fallback: JSON local sintético.
router.get("/:cultura/historico", async (req, res) => {
  const cultura = req.params.cultura;

  try {
    const hist = await buscarHistoricoMensalStooq(cultura);
    if (hist && Array.isArray(hist.historico) && hist.historico.length > 0) {
      return res.json(hist);
    }
  } catch (e) {
    console.error("[mercado] Stooq histórico falhou, usando fallback:", e.message);
  }

  const historico = obterHistorico(cultura);
  if (!historico) {
    return res.status(404).json({ erro: "Cultura não encontrada" });
  }
  res.json(historico);
});

// GET /api/mercado/:cultura/analise
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
