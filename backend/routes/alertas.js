const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { avaliarAlertas } = require("../services/rules");
const { buscarTalhaoPorId } = require("./talhoes");
const { exigirAutenticacao } = require("../services/auth");

router.use(exigirAutenticacao);

// GET /api/alertas/:talhaoId - retorna os alertas atuais para um talhão do usuário logado
router.get("/:talhaoId", async (req, res) => {
  const talhao = buscarTalhaoPorId(req.params.talhaoId);

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para ver este talhão." });
  }

  try {
    const clima = await buscarClimaAtual(talhao.latitude, talhao.longitude);
    const alertas = avaliarAlertas(talhao.cultura, talhao.fase, clima);

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
    });
  } catch (erro) {
    console.error("[alertas] Erro ao gerar alertas:", erro);
    res.status(500).json({ erro: "Erro ao gerar alertas para o talhão" });
  }
});

module.exports = router;
