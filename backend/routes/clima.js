const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { obterConfiguracoes, exigirAutenticacao } = require("../services/auth");

router.use(exigirAutenticacao);

// GET /api/clima - clima da cidade cadastrada pelo usuário (não de um talhão
// específico). Usado no painel geral, para mostrar o clima de onde o
// produtor reside independente de qual talhão está selecionado.
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
