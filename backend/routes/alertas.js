const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { avaliarAlertas } = require("../services/rules");
const { buscarTalhaoPorId } = require("./talhoes");
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");

router.use(exigirAutenticacao);

// GET /api/alertas/:talhaoId - retorna os alertas atuais para um talhão do usuário logado
router.get("/:talhaoId", async (req, res) => {
  const talhao = await buscarTalhaoPorId(req.params.talhaoId);

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para ver este talhão." });
  }

  try {
    const clima = await buscarClimaAtual(talhao.latitude, talhao.longitude);
    const alertas = avaliarAlertas(talhao.cultura, talhao.fase, clima);

    pool.query(
      `INSERT INTO leituras_clima
         (talhao_id, fonte, temperatura_minima, chuva_acumulada_7d, dias_sem_chuva,
          probabilidade_chuva, vento_maximo_kmh, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        talhao.id,
        clima.fonte,
        clima.temperaturaMinima,
        clima.chuvaAcumulada7dias,
        clima.diasSemChuva,
        clima.probabilidadeChuva7dias,
        clima.ventoMaximoKmh,
        JSON.stringify(clima),
      ]
    ).catch((erro) => console.error("[alertas] Falha ao persistir leitura de clima:", erro.message));

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
