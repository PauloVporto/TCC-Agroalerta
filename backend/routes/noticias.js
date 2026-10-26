const express = require("express");
const router = express.Router();
const { buscarNoticiasCultura, TERMOS } = require("../services/noticias");

const CULTURAS = Object.keys(TERMOS);

/**
 * @swagger
 * /noticias:
 *   get:
 *     summary: Notícias recentes da cultura, com resumo e link da matéria
 *     description: >
 *       Lê os RSS do Canal Rural (busca pela cultura) e do g1 Agronegócios (feed geral,
 *       filtrado aqui por palavra-chave), junta os dois sem repetir manchete e devolve as
 *       mais recentes primeiro. Cada item traz um resumo de até 320 caracteres para o
 *       preview e o link direto do veículo. O resultado fica em cache por 3 horas; se um
 *       dos feeds falhar, o outro ainda alimenta a resposta.
 *     tags: [Notícias]
 *     parameters:
 *       - in: query
 *         name: cultura
 *         required: false
 *         schema: { type: string, default: cafe, enum: [cafe, soja] }
 *     responses:
 *       200:
 *         description: Lista de notícias da cultura
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cultura: { type: string, example: cafe }
 *                 total: { type: integer, example: 10 }
 *                 noticias:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       titulo: { type: string }
 *                       resumo: { type: string, description: Trecho da notícia para o preview }
 *                       link: { type: string, format: uri, description: Endereço da matéria no veículo }
 *                       fonte: { type: string, example: Canal Rural }
 *                       dataTexto: { type: string, example: 23 de out. de 2026 }
 *                       publicadoEm: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: Cultura não suportada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Erro' }
 */
router.get("/", async (req, res) => {
  const cultura = req.query.cultura || "cafe";

  if (!CULTURAS.includes(cultura)) {
    return res
      .status(400)
      .json({ erro: "Cultura não suportada. Use uma destas: " + CULTURAS.join(", ") });
  }

  try {
    const noticias = await buscarNoticiasCultura(cultura);
    res.json({ cultura, total: noticias.length, noticias });
  } catch (erro) {
    // Notícia é conteúdo acessório: se os feeds caírem, a página mostra o aviso
    // de lista vazia em vez de quebrar.
    console.error("[noticias] falha ao buscar notícias de " + cultura + ":", erro.message);
    res.status(200).json({ cultura, total: 0, noticias: [] });
  }
});

module.exports = router;
