const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { buscarClimaOpenMeteo } = require("../services/openmeteo");
const { buscarAlertasINMET, extrairUF } = require("../services/inmet");
const { avaliarAlertas } = require("../services/rules");
const { buscarTalhaoPorId } = require("./talhoes");
const { exigirAutenticacao } = require("../services/auth");

router.use(exigirAutenticacao);

// GET /api/alertas/:talhaoId
// Usa Open-Meteo (variáveis agronômicas + histórico real de dias secos) para o motor
// de regras, e INMET para avisos oficiais. Degrada graciosamente para OWM se necessário.
router.get("/:talhaoId", async (req, res) => {
  const talhao = await buscarTalhaoPorId(req.params.talhaoId);

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para ver este talhão." });
  }

  try {
    const uf = extrairUF(talhao.enderecoFormatado || talhao.endereco || '');

    const [climaOpenMeteoResult, climaOWMResult, alertasInmetResult] = await Promise.allSettled([
      buscarClimaOpenMeteo(talhao.latitude, talhao.longitude),
      buscarClimaAtual(talhao.latitude, talhao.longitude),
      buscarAlertasINMET(uf),
    ]);

    // Open-Meteo é a fonte primária para o motor de alertas; OWM é fallback
    const clima = climaOpenMeteoResult.status === 'fulfilled'
      ? climaOpenMeteoResult.value
      : climaOWMResult.status === 'fulfilled'
        ? climaOWMResult.value
        : null;

    if (!clima) {
      return res.status(503).json({ erro: "Dados meteorológicos indisponíveis no momento." });
    }

    const alertas = avaliarAlertas(talhao.cultura, talhao.fase, clima);
    const alertasOficiais = alertasInmetResult.status === 'fulfilled' ? alertasInmetResult.value : [];

    res.json({
      talhao: {
        id: talhao.id,
        nome: talhao.nome,
        cultura: talhao.cultura,
        fase: talhao.fase,
        latitude: talhao.latitude,
        longitude: talhao.longitude,
        enderecoFormatado: talhao.enderecoFormatado || talhao.endereco,
      },
      clima,
      alertas,
      alertasOficiais,
    });
  } catch (erro) {
    console.error("[alertas] Erro ao gerar alertas:", erro);
    res.status(500).json({ erro: "Erro ao gerar alertas para o talhão" });
  }
});

module.exports = router;
