const express = require("express");
const router = express.Router();
const { buscarClimaAtual } = require("../services/weather");
const { avaliarAlertas } = require("../services/rules");
const { buscarTalhaoPorId } = require("./talhoes");
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");
const { insumosParaAlerta } = require("../services/insumosCatalog");
const { temChaveLlm, chamarClaudeComBusca, promptAlertaProdutor } = require("../services/llm");
const { gerarESalvarParaTalhao } = require("../services/mensagens");

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
    const alertasBase = avaliarAlertas(talhao.cultura, talhao.fase, clima);
    const alertas = await Promise.all(
      alertasBase.map(async (alerta) => {
        const insumos = (await insumosParaAlerta(alerta.id)) || [];
        return {
          ...alerta,
          insumos: insumos.slice(0, 3).map((i) => ({
            id: i.id,
            nome: i.nome,
            categoria: i.categoria,
            unidade: i.unidade,
            melhorPreco: i.melhorPreco,
          })),
        };
      })
    );
    const briefing = await gerarBriefingProdutor({ talhao, clima, alertas: alertasBase });

    persistirAlertas(talhao.id, alertasBase).catch((erro) =>
      console.error("[alertas] persistir:", erro.message)
    );

    gerarESalvarParaTalhao(req.usuario.id, talhao, clima, alertasBase).catch((erro) =>
      console.error("[alertas] mensagens:", erro.message)
    );

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
        poligono: talhao.poligono || null,
        areaHa: talhao.areaHa || null,
      },
      clima,
      previsao: clima.previsao || [],
      alertas,
      briefing,
    });
  } catch (erro) {
    console.error("[alertas] Erro ao gerar alertas:", erro);
    res.status(500).json({ erro: "Erro ao gerar alertas para o talhão" });
  }
});

async function persistirAlertas(talhaoId, alertas) {
  await pool.query("DELETE FROM alertas_gerados WHERE talhao_id = $1", [talhaoId]);
  for (const alerta of alertas) {
    await pool.query(
      `INSERT INTO alertas_gerados (talhao_id, regra_id, nivel, titulo, mensagem, recomendacao)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [talhaoId, alerta.id, alerta.nivel, alerta.titulo, alerta.mensagem, alerta.recomendacao]
    );
  }
}

async function gerarBriefingProdutor({ talhao, clima, alertas }) {
  const previsao = clima.previsao || [];
  if (!temChaveLlm()) {
    const chuva = previsao.filter((d) => d.condicao === "chuva").length;
    const seco = previsao.filter((d) => d.condicao === "seco").length;
    const top = alertas[0];
    return {
      texto:
        "Na área mapeada de " +
        talhao.nome +
        ", a previsão indica " +
        chuva +
        " dia(s) chuvoso(s) e " +
        seco +
        " dia(s) seco(s) na semana. " +
        (top
          ? "Atenção principal: " + top.titulo + " — " + top.recomendacao
          : "Nenhum risco agronômico alto no motor de regras; siga acompanhando chuva e temperatura no mapa.") +
        " (IA em modo simulado.)",
      gerarPor: "simulado",
    };
  }
  try {
    const { texto } = await chamarClaudeComBusca(
      promptAlertaProdutor({ talhao, clima, previsao, alertas }),
      500
    );
    return { texto, gerarPor: "ia_clima" };
  } catch (erro) {
    console.error("[alertas] Briefing IA falhou:", erro.message);
    return { texto: "Não foi possível gerar o recado da IA agora. Use os alertas do motor de regras abaixo.", gerarPor: "erro" };
  }
}

module.exports = router;
