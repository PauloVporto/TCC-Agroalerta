const express = require("express");
const router = express.Router();
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");
const { buscarClimaAtual } = require("../services/weather");
const { avaliarAlertas } = require("../services/rules");
const { buscarContextoMercado } = require("../services/marketQuotes");
const { resumoMercadoInterno } = require("../services/market");

router.use(exigirAutenticacao);

router.get("/", async (req, res) => {
  const papel = req.usuario.papel || "produtor";
  const culturas = ["cafe", "soja", "milho", "cana", "feijao"];
  const contextos = await Promise.all(culturas.map((cultura) => buscarContextoMercado(cultura)));
  const cotacoes = {};
  let dolar = null;
  culturas.forEach((cultura, i) => {
    const ctx = contextos[i];
    if (ctx.dolar) dolar = ctx.dolar;
    const interno = resumoMercadoInterno(cultura);
    cotacoes[cultura] = {
      brasil: interno
        ? {
            nome: "Interno Brasil",
            preco: interno.precoAtual,
            unidade: interno.unidade,
            variacaoPercentual: interno.variacaoPercentual,
            fonte: "cepea-ref",
          }
        : null,
      internacional: ctx.internacional
        ? {
            preco: ctx.internacional.preco,
            unidade: ctx.internacional.unidade,
            data: ctx.internacional.data,
            ticker: ctx.internacional.ticker,
            bolsa: ctx.internacional.bolsa,
          }
        : null,
      paridade: ctx.paridade
        ? { preco: ctx.paridade.preco, unidade: ctx.paridade.unidade, data: ctx.paridade.data }
        : null,
    };
  });

  if (papel === "fornecedor") {
    const ofertas = await pool.query(
      "SELECT COUNT(*)::int AS total FROM ofertas_insumos WHERE usuario_id = $1",
      [req.usuario.id]
    );
    return res.json({
      papel,
      totalOfertas: ofertas.rows[0].total,
      totalTalhoes: 0,
      totalAlertas: 0,
      alertas: [],
      dolar,
      icBrAgro: contextos[0] ? contextos[0].icBrAgro : null,
      cotacoes,
    });
  }

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

  res.json({
    papel,
    totalTalhoes: talhoes.rows.length,
    alertas: resumoAlertas,
    totalAlertas: resumoAlertas.reduce((acc, a) => acc + a.total, 0),
    dolar,
    icBrAgro: contextos[0] ? contextos[0].icBrAgro : null,
    cotacoes,
  });
});

module.exports = router;
