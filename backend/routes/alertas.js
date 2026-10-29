const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { buscarClimaOpenMeteo } = require("../services/openmeteo");
const { buscarAlertasINMET, extrairUF } = require("../services/inmet");
const { avaliarAlertas } = require("../services/rules");
const { buscarTalhaoPorId } = require("./talhoes");
const { exigirAutenticacao } = require("../services/auth");
const { gerarAnaliseClimatica } = require("../services/climaIA");

router.use(exigirAutenticacao);

// Valida o talhão e o dono; responde 404/403 e devolve null quando não pode prosseguir.
async function talhaoDoUsuario(req, res) {
  const talhao = await buscarTalhaoPorId(req.params.talhaoId);
  if (!talhao) {
    res.status(404).json({ erro: "Talhão não encontrado" });
    return null;
  }
  if (talhao.usuarioId !== req.usuario.id) {
    res.status(403).json({ erro: "Você não tem permissão para ver este talhão." });
    return null;
  }
  return talhao;
}

// Open-Meteo é a fonte primária do motor de alertas; OWM é fallback. Devolve null sem clima.
async function coletarDadosTalhao(talhao) {
  const uf = extrairUF(talhao.enderecoFormatado || talhao.endereco || "");
  const [climaOpenMeteoResult, climaOWMResult, alertasInmetResult] = await Promise.allSettled([
    buscarClimaOpenMeteo(talhao.latitude, talhao.longitude),
    buscarClimaAtual(talhao.latitude, talhao.longitude),
    buscarAlertasINMET(uf),
  ]);
  const clima = climaOpenMeteoResult.status === "fulfilled"
    ? climaOpenMeteoResult.value
    : climaOWMResult.status === "fulfilled"
      ? climaOWMResult.value
      : null;
  if (!clima) return null;
  return {
    clima,
    alertas: avaliarAlertas(talhao.cultura, talhao.fase, clima),
    alertasOficiais: alertasInmetResult.status === "fulfilled" ? alertasInmetResult.value : [],
  };
}

function resumoTalhao(talhao) {
  return {
    id: talhao.id,
    nome: talhao.nome,
    cultura: talhao.cultura,
    fase: talhao.fase,
    latitude: talhao.latitude,
    longitude: talhao.longitude,
    enderecoFormatado: talhao.enderecoFormatado || talhao.endereco,
  };
}

/**
 * @swagger
 * /alertas/{talhaoId}:
 *   get:
 *     summary: Gera os alertas climáticos atuais para um talhão
 *     description: >
 *       Usa Open-Meteo (variáveis agronômicas + histórico real de dias secos) como fonte
 *       primária para o motor de regras, com fallback para OpenWeatherMap, e consulta o
 *       INMET para avisos oficiais da UF do talhão.
 *     tags: [Alertas]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: talhaoId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Clima e alertas gerados para o talhão
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 talhao: { $ref: '#/components/schemas/Talhao' }
 *                 clima: { $ref: '#/components/schemas/Clima' }
 *                 alertas:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Alerta' }
 *                 alertasOficiais:
 *                   type: array
 *                   description: Avisos oficiais do INMET para a UF do talhão
 *                   items: { type: object }
 *       403: { description: Talhão pertence a outro usuário, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       404: { description: Talhão não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       503: { description: Dados meteorológicos indisponíveis no momento, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/:talhaoId", async (req, res) => {
  const talhao = await talhaoDoUsuario(req, res);
  if (!talhao) return;

  try {
    const dados = await coletarDadosTalhao(talhao);
    if (!dados) {
      return res.status(503).json({ erro: "Dados meteorológicos indisponíveis no momento." });
    }
    res.json({ talhao: resumoTalhao(talhao), clima: dados.clima, alertas: dados.alertas, alertasOficiais: dados.alertasOficiais });
  } catch (erro) {
    console.error("[alertas] Erro ao gerar alertas:", erro);
    res.status(500).json({ erro: "Erro ao gerar alertas para o talhão" });
  }
});

/**
 * @swagger
 * /alertas/{talhaoId}/analise-ia:
 *   get:
 *     summary: Análise climática do talhão interpretada por IA (Claude)
 *     description: >
 *       O modelo interpreta a leitura meteorológica e os alertas do motor de regras. A resposta
 *       sempre informa a origem: "anthropic" (gerada pela API, com modelo e requestId) ou
 *       "simulado" (resumo determinístico, com o motivo da indisponibilidade em "ia").
 *       Respostas da IA ficam em cache por 30 minutos enquanto os dados não mudam; use ?forcar=1 para renovar.
 *     tags: [Alertas]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: talhaoId
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: forcar
 *         schema: { type: string, enum: ["1"] }
 *     responses:
 *       200:
 *         description: Análise climática
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 origem: { type: string, enum: [anthropic, simulado] }
 *                 analise:
 *                   type: object
 *                   properties:
 *                     nivelGeral: { type: string, enum: [baixo, medio, alto] }
 *                     resumo: { type: string }
 *                     riscos: { type: array, items: { type: object } }
 *                     recomendacoes: { type: array, items: { type: string } }
 *                 modelo: { type: string }
 *                 requestId: { type: string }
 *                 respostaId: { type: string }
 *                 promptVersao: { type: string }
 *                 ia: { type: object, description: Estado de indisponibilidade quando origem = simulado }
 *       403: { description: Talhão pertence a outro usuário, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       404: { description: Talhão não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       503: { description: Dados meteorológicos indisponíveis no momento, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/:talhaoId/analise-ia", async (req, res) => {
  const talhao = await talhaoDoUsuario(req, res);
  if (!talhao) return;

  try {
    const dados = await coletarDadosTalhao(talhao);
    if (!dados) {
      return res.status(503).json({ erro: "Dados meteorológicos indisponíveis no momento." });
    }
    const analise = await gerarAnaliseClimatica({ talhao, ...dados }, { forcar: req.query.forcar === "1" });
    res.json({ talhaoId: talhao.id, ...analise });
  } catch (erro) {
    console.error("[alertas] Erro na análise por IA:", erro);
    res.status(500).json({ erro: "Erro ao gerar a análise do talhão" });
  }
});

module.exports = router;
