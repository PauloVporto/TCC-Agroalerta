const express = require("express");
const router = express.Router();
const { resolverLocalizacaoPorCep } = require("../services/localizacao");
const { culturasSuportadas, fasesSuportadas } = require("../services/rules");
const { exigirAutenticacao } = require("../services/auth");
const { pool } = require("../services/db");

// Colunas devolvidas em toda resposta de talhão (listagem, cadastro, edição e busca).
const COLUNAS_TALHAO = `id, usuario_id AS "usuarioId", nome, cultura, variedade, fase, endereco,
  latitude, longitude, endereco_formatado AS "enderecoFormatado",
  poligono, area_ha AS "areaHa", area_unidade AS "areaUnidade", criado_em AS "criadoEm"`;

const TAMANHO_MAX_VARIEDADE = 60;
// A área é gravada sempre em hectares; a unidade guarda como o produtor prefere vê-la.
const UNIDADES_AREA = ["ha", "m2"];

// Todas as rotas de talhão exigem usuário autenticado, e cada usuário
// só enxerga/mexe nos próprios talhões.
router.use(exigirAutenticacao);

// GET /api/talhoes - lista os talhões do usuário logado
router.get("/", async (req, res) => {
  const resultado = await pool.query(
    `SELECT ${COLUNAS_TALHAO} FROM talhoes WHERE usuario_id = $1 ORDER BY id`,
    [req.usuario.id]
  );
  res.json(resultado.rows);
});

// GET /api/talhoes/geocodificar?endereco=... - localiza endereço para o mapa de cadastro
router.get("/geocodificar", async (req, res) => {
  const endereco = String(req.query.endereco || "").trim();
  if (!endereco) {
    return res.status(400).json({ erro: "Informe o endereço para localizar no mapa." });
  }

  try {
    const coords = await geocodificarEndereco(endereco);
    res.json(coords);
  } catch (erro) {
    console.error("[talhoes] Geocodificação falhou:", erro.message);
    res.status(400).json({ erro: "Não foi possível localizar esse endereço. Tente cidade, bairro ou referência mais específica." });
  }
});

router.get("/geocodificar-reverso", async (req, res) => {
  try {
    const coords = await geocodificarReverso(req.query.lat, req.query.lng);
    res.json(coords);
  } catch (erro) {
    res.status(400).json({ erro: erro.message || "Não foi possível identificar o endereço desse ponto." });
  }
});

// POST /api/talhoes - cadastra um novo talhão para o usuário logado
// body: { nome, cultura, fase, cep, variedade?, areaHa? }
router.post("/", async (req, res) => {
  const { nome, cultura, fase, cep } = req.body;

  if (!nome || !cultura || !fase || !cep) {
    return res.status(400).json({
      erro: "Campos obrigatórios: nome, cultura, fase, cep",
    });
  }

  const erroCulturaOuFase = validarCulturaEFase({ cultura, fase });
  if (erroCulturaOuFase) {
    return res.status(400).json({ erro: erroCulturaOuFase });
  }

  const lidos = lerVariedadeEArea(req.body);
  const detalhes = { ...lidos, areaUnidade: lidos.areaUnidade || "ha" };
  const erroVariedadeOuArea = validarVariedadeEArea(detalhes);
  if (erroVariedadeOuArea) {
    return res.status(400).json({ erro: erroVariedadeOuArea });
  }

  const local = await resolverLocalizacaoPorCep(cep);
  if (!local.valido) {
    return res.status(400).json({ erro: local.erro });
  }

  const talhao = await criarTalhao(req.usuario.id, {
    nome, cultura, fase, ...detalhes, endereco: local.enderecoFormatado, coordenadas: local,
  });
  res.status(201).json(talhao);
});

// Campos ausentes (undefined) não são validados — o PATCH só confere o que foi enviado.
function validarCulturaEFase({ cultura, fase }) {
  if (cultura !== undefined && !culturasSuportadas().includes(cultura)) {
    return "Cultura não suportada. Use uma de: " + culturasSuportadas().join(", ");
  }
  if (fase !== undefined && !fasesSuportadas().includes(fase)) {
    return "Fase inválida. Use uma de: " + fasesSuportadas().join(", ");
  }
  return null;
}

// Variedade e área são opcionais: texto vazio vira null. A área chega em hectares
// e a unidade (ha ou m2) só diz como exibi-la; unidade ausente fica a cargo de quem chama.
function lerVariedadeEArea(corpo) {
  const variedade = corpo.variedade == null ? null : String(corpo.variedade).trim() || null;
  const areaHa = corpo.areaHa == null || corpo.areaHa === "" ? null : Number(corpo.areaHa);
  const areaUnidade = corpo.areaUnidade == null ? null : String(corpo.areaUnidade).trim() || null;
  return { variedade, areaHa, areaUnidade };
}

function validarVariedadeEArea({ variedade, areaHa, areaUnidade }) {
  if (variedade !== null && variedade.length > TAMANHO_MAX_VARIEDADE) {
    return "A variedade deve ter no máximo " + TAMANHO_MAX_VARIEDADE + " caracteres.";
  }
  if (areaHa !== null && !(Number.isFinite(areaHa) && areaHa > 0)) {
    return "A área deve ser um número de hectares maior que zero.";
  }
  if (!UNIDADES_AREA.includes(areaUnidade)) {
    return "Unidade de área inválida. Use uma de: " + UNIDADES_AREA.join(", ");
  }
  return null;
}

// variedade, poligono e área são opcionais: o cadastro feito na tela de login
// cria o primeiro talhão só com cultura e fase.
async function criarTalhao(usuarioId, { nome, cultura, variedade, fase, endereco, coordenadas, poligono, areaHa, areaUnidade }) {
  const resultado = await pool.query(
    `INSERT INTO talhoes
       (usuario_id, nome, cultura, variedade, fase, endereco, latitude, longitude, endereco_formatado,
        poligono, area_ha, area_unidade)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${COLUNAS_TALHAO}`,
    [usuarioId, nome, cultura, variedade || null, fase, endereco, coordenadas.latitude,
      coordenadas.longitude, coordenadas.enderecoFormatado,
      poligono ? JSON.stringify(poligono) : null, areaHa != null ? areaHa : null, areaUnidade || "ha"]
  );
  return resultado.rows[0];
}

// DELETE /api/talhoes/:id - remove um talhão (só o dono pode remover)
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId" FROM talhoes WHERE id = $1`, [id]
  );
  const talhao = resultado.rows[0];

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para remover este talhão." });
  }

  await pool.query("DELETE FROM talhoes WHERE id = $1", [id]);
  res.status(204).send();
});

// PATCH /api/talhoes/:id - atualiza nome, cultura, variedade, fase e área (só o dono)
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const resultado = await pool.query(
    `SELECT id, usuario_id AS "usuarioId", nome, cultura, variedade, fase,
            area_ha AS "areaHa", area_unidade AS "areaUnidade"
     FROM talhoes WHERE id = $1`,
    [id]
  );
  const talhao = resultado.rows[0];

  if (!talhao) {
    return res.status(404).json({ erro: "Talhão não encontrado" });
  }
  if (talhao.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: "Você não tem permissão para editar este talhão." });
  }

  const nome = req.body.nome != null ? String(req.body.nome).trim() : talhao.nome;
  const cultura = req.body.cultura != null ? String(req.body.cultura).trim() : talhao.cultura;
  const fase = req.body.fase != null ? String(req.body.fase).trim() : talhao.fase;

  if (!nome) {
    return res.status(400).json({ erro: "Informe o nome do talhão." });
  }
  // Valida só o que veio no corpo: um talhão antigo com fase fora da lista
  // (ex.: "vegetativo") ainda pode ter apenas o nome alterado.
  const erroCulturaOuFase = validarCulturaEFase({
    cultura: req.body.cultura != null ? cultura : undefined,
    fase: req.body.fase != null ? fase : undefined,
  });
  if (erroCulturaOuFase) {
    return res.status(400).json({ erro: erroCulturaOuFase });
  }

  // Campo enviado (mesmo vazio) substitui o valor salvo; vazio apaga. Campo ausente mantém.
  const enviados = lerVariedadeEArea(req.body);
  const variedade = Object.hasOwn(req.body, "variedade") ? enviados.variedade : talhao.variedade;
  const areaHa = Object.hasOwn(req.body, "areaHa") ? enviados.areaHa : talhao.areaHa;
  const areaUnidade = Object.hasOwn(req.body, "areaUnidade") ? enviados.areaUnidade || "ha" : talhao.areaUnidade;
  const erroVariedadeOuArea = validarVariedadeEArea({ variedade, areaHa, areaUnidade });
  if (erroVariedadeOuArea) {
    return res.status(400).json({ erro: erroVariedadeOuArea });
  }

  const atualizado = await pool.query(
    `UPDATE talhoes SET nome = $1, cultura = $2, variedade = $3, fase = $4, area_ha = $5, area_unidade = $6
     WHERE id = $7
     RETURNING ${COLUNAS_TALHAO}`,
    [nome, cultura, variedade, fase, areaHa, areaUnidade, id]
  );

  res.json(atualizado.rows[0]);
});

async function buscarTalhaoPorId(id) {
  const resultado = await pool.query(
    `SELECT ${COLUNAS_TALHAO} FROM talhoes WHERE id = $1`,
    [Number(id)]
  );
  return resultado.rows[0] || null;
}

module.exports = { router, buscarTalhaoPorId, criarTalhao };
