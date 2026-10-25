const express = require("express");
const router = express.Router();
const { obterHistorico, gerarAnaliseTendencia } = require("../services/market");
const { buscarCotacaoAV } = require("../services/alphavantage");
const { buscarCotacaoStooq, buscarHistoricoMensalStooq } = require("../services/stooq");
const { buscarPtax, buscarIndiceCommoditiesAgro, SERIES_ICBR } = require("../services/bcb");
const { montarSerieComProjecao } = require("../services/marketProjection");

/**
 * @swagger
 * /mercado/cotacoes:
 *   get:
 *     summary: Cotações externas de câmbio e commodities agro
 *     description: >
 *       Combina PTAX (Banco Central), índice IC-Br Agropecuário (Banco Central) e a cotação
 *       internacional da cultura (Alpha Vantage, com fallback para Stooq). Cada fonte que
 *       falhar retorna null nesse campo em vez de derrubar a resposta inteira.
 *     tags: [Mercado]
 *     parameters:
 *       - in: query
 *         name: cultura
 *         required: false
 *         schema: { type: string, default: cafe, enum: [cafe, soja] }
 *     responses:
 *       200:
 *         description: Cotações agregadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ptax: { type: object, nullable: true }
 *                 icbr: { type: object, nullable: true }
 *                 cotacaoInternacional: { type: object, nullable: true }
 */
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
    icbrSeries: SERIES_ICBR.map(Number),
    cotacaoInternacional: cotacaoIntl,
  });
});

/**
 * @swagger
 * /mercado/{cultura}/historico:
 *   get:
 *     summary: Histórico de preço mensal da cultura
 *     description: Tenta a Stooq primeiro (dados reais mensais); se falhar, usa um JSON local sintético como fallback.
 *     tags: [Mercado]
 *     parameters:
 *       - in: path
 *         name: cultura
 *         required: true
 *         schema: { type: string, example: cafe }
 *     responses:
 *       200:
 *         description: Série histórica de preços
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unidade: { type: string, example: "R$/saca 60kg" }
 *                 historico:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       data: { type: string, format: date }
 *                       preco: { type: number }
 *       404: { description: Cultura não encontrada, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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

/**
 * @swagger
 * /mercado/{cultura}/serie:
 *   get:
 *     summary: Série de preço em R$/saca com projeção, para o gráfico do painel
 *     description: >
 *       Usa sempre a base local em R$/saca. O /historico pode vir da Stooq em centavos de
 *       dólar, que não combinaria com a projeção nem com o simulador de venda em reais.
 *     tags: [Mercado]
 *     parameters:
 *       - in: path
 *         name: cultura
 *         required: true
 *         schema: { type: string, example: cafe }
 *     responses:
 *       200:
 *         description: Histórico mais projeção mensal na mesma unidade
 *       404:
 *         description: Cultura não encontrada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Erro' }
 */
// GET /api/mercado/:cultura/serie
// Histórico em R$/saca + projeção mensal na mesma unidade, para o gráfico do painel.
// Usa sempre a base local: o /historico pode vir do Stooq em centavos de dólar,
// o que não combinaria com a projeção nem com o simulador de venda em R$.
router.get("/:cultura/serie", (req, res) => {
  const base = obterHistorico(req.params.cultura);
  if (!base || !Array.isArray(base.historico)) {
    return res.status(404).json({ erro: "Cultura não encontrada" });
  }
  res.json(montarSerieComProjecao(base, req.params.cultura));
});

/**
 * @swagger
 * /mercado/{cultura}/analise:
 *   get:
 *     summary: Gera uma análise qualitativa de tendência de mercado para a cultura
 *     description: >
 *       Busca notícias reais nos RSS do Canal Rural e do g1 Agronegócios e, se ANTHROPIC_API_KEY
 *       estiver configurada,
 *       usa IA (Claude) para elaborar a análise; caso contrário, retorna um resumo simulado
 *       baseado só na variação percentual do histórico de preços.
 *     tags: [Mercado]
 *     parameters:
 *       - in: path
 *         name: cultura
 *         required: true
 *         schema: { type: string, example: cafe }
 *     responses:
 *       200:
 *         description: Análise de tendência
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cultura: { type: string }
 *                 variacaoPercentual: { type: number }
 *                 precoAtual: { type: number }
 *                 unidade: { type: string }
 *                 resumo: { type: string }
 *                 fatoresConsiderados:
 *                   type: array
 *                   items: { type: object }
 *                 gerarPor: { type: string, enum: [ia, simulado] }
 *                 geradoEm: { type: string, format: date-time }
 *       400: { description: Cultura não suportada, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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
