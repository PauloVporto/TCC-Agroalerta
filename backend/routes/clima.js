const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { obterConfiguracoes, exigirAutenticacao } = require("../services/auth");

router.use(exigirAutenticacao);

/**
 * @swagger
 * /clima:
 *   get:
 *     summary: Clima da cidade cadastrada pelo usuário (não de um talhão específico)
 *     description: >
 *       Usado no painel geral, para mostrar o clima de onde o produtor reside,
 *       independente de qual talhão está selecionado na tela de alertas.
 *     tags: [Clima]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Clima da cidade do usuário
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cidade: { type: string }
 *                 cidadeFormatada: { type: string }
 *                 clima: { $ref: '#/components/schemas/Clima' }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       404: { description: Usuário ainda não tem cidade cadastrada, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/", async (req, res) => {
  const config = await obterConfiguracoes(req.usuario.id);

  if (!config || config.latitude == null || config.longitude == null) {
    return res.status(404).json({ erro: "Cidade não cadastrada para este usuário." });
  }

  const clima = await buscarClimaAtual(config.latitude, config.longitude);
  res.json({
    cidade: config.cidade,
    cidadeFormatada: config.cidadeFormatada,
    clima,
  });
});

module.exports = router;
