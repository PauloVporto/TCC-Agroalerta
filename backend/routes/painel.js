const express = require("express");
const router = express.Router();
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");
const { buscarClimaAtual } = require("../services/weather");
const { avaliarAlertas } = require("../services/rules");
const { buscarContextoMercado } = require("../services/marketQuotes");

router.use(exigirAutenticacao);

router.get("/", async (req, res) => {
  const talhoes = await pool.query(
    `SELECT id, nome, cultura, fase, latitude, longitude
     FROM talhoes WHERE usuario_id = $1 ORDER BY id`,
    [req.usuario.id]
  );

  const resumoAlertas = await Promise.all(
    talhoes.rows.slice(0, 8).map(async (talhao) => {
      try {
        const clima = await buscarClimaAtual(talhao.latitude, talhao.longitude);
        const alertas = avaliarAlertas(talhao.cultura, talhao.fase, clima);
        return {
          talhaoId: talhao.id,
          nome: talhao.nome,
          cultura: talhao.cultura,
          total: alertas.length,
          maiorNivel: alertas[0] ? alertas[0].nivel : null,
        };
      } catch (erro) {
        return { talhaoId: talhao.id, nome: talhao.nome, cultura: talhao.cultura, total: 0, maiorNivel: null };
      }
    })
  );

  const culturas = ["cafe", "soja", "milho", "cana", "feijao"];
  const contextos = await Promise.all(culturas.map((cultura) => buscarContextoMercado(cultura)));
  const cotacoes = {};
  let dolar = null;
  culturas.forEach((cultura, i) => {
    const ctx = contextos[i];
    if (ctx.dolar) dolar = ctx.dolar;
    cotacoes[cultura] = ctx.cotacaoAoVivo
      ? {
          preco: ctx.cotacaoAoVivo.preco,
          unidade: ctx.cotacaoAoVivo.unidade,
          data: ctx.cotacaoAoVivo.data,
          ticker: ctx.cotacaoAoVivo.ticker,
        }
      : null;
  });

  res.json({
    totalTalhoes: talhoes.rows.length,
    alertas: resumoAlertas,
    totalAlertas: resumoAlertas.reduce((acc, a) => acc + a.total, 0),
    dolar,
    cotacoes,
  });
});

module.exports = router;
