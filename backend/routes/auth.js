const express = require("express");
const router = express.Router();
const {
  criarUsuario,
  autenticar,
  encerrarSessao,
  obterConfiguracoes,
  atualizarPerfil,
  atualizarPreferencias,
  atualizarLocalizacao,
  alterarSenha,
  excluirConta,
  exigirAutenticacao,
} = require("../services/auth");
const { resolverLocalizacaoPorCep } = require("../services/localizacao");
const { criarTalhao } = require("./talhoes");
const { culturasSuportadas } = require("../services/rules");

// POST /api/auth/registrar
// body: { nome, email, senha, cep, cultura? }
//
// O CEP é validado via Nominatim (OpenStreetMap): se encontrado, retorna
// cidade, UF e coordenadas em uma única chamada — sem chave de API. Com
// as coordenadas já disponíveis, cria o primeiro talhão na mesma localização
// para que o produtor veja alertas e previsão do tempo reais ao entrar.
router.post("/registrar", async (req, res) => {
  const { nome, email, senha, cep, cultura, telefone, papel } = req.body;

  if (!nome || !email || !senha || !cep) {
    return res.status(400).json({ erro: "Campos obrigatórios: nome, email, senha, cep" });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
  }
  const digitosTel = String(telefone || "").replace(/\D/g, "");
  if (digitosTel.length < 10) {
    return res.status(400).json({
      erro: "Informe o celular com DDD. Os alertas climáticos serão enviados por SMS e e-mail.",
    });
  }

  const local = await resolverLocalizacaoPorCep(cep);
  if (!local.valido) {
    return res.status(400).json({ erro: local.erro });
  }

  const culturaEscolhida = culturasSuportadas().includes(cultura) ? cultura : "cafe";

  try {
    const usuario = await criarUsuario({
      nome, email, senha, telefone, papel,
      cidade: local.cidade + " - " + local.uf,
      cidadeFormatada: local.enderecoFormatado,
      latitude: local.latitude,
      longitude: local.longitude,
    });

    await criarTalhao(usuario.id, {
      nome: "Talhão principal - " + local.cidade,
      cultura: culturaEscolhida,
      fase: "vegetativo",
      endereco: local.enderecoFormatado,
      coordenadas: local,
    });

    // Já loga o usuário automaticamente após o cadastro
    const { token } = await autenticar({ email, senha });
    res.status(201).json({ usuario, token });
  } catch (erro) {
    res.status(409).json({ erro: erro.message });
  }
});

// POST /api/auth/login
// body: { email, senha }
router.post("/login", async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: "Informe e-mail e senha." });
  }

  try {
    const { token, usuario } = await autenticar({ email, senha });
    res.json({ usuario, token });
  } catch (erro) {
    res.status(401).json({ erro: erro.message });
  }
});

// POST /api/auth/logout
router.post("/logout", exigirAutenticacao, async (req, res) => {
  const token = req.headers.authorization.slice(7);
  await encerrarSessao(token);
  res.status(204).send();
});

// GET /api/auth/me - retorna o usuário logado (útil para o frontend checar a sessão)
router.get("/me", exigirAutenticacao, (req, res) => {
  res.json(req.usuario);
});

router.get("/configuracoes", exigirAutenticacao, async (req, res) => {
  res.json(await obterConfiguracoes(req.usuario.id));
});

router.patch("/perfil", exigirAutenticacao, async (req, res) => {
  const { nome, email, telefone, cidade } = req.body;
  if (!nome || !email) return res.status(400).json({ erro: "Nome e e-mail são obrigatórios." });
  try {
    const payload = { nome, email };
    if (Object.prototype.hasOwnProperty.call(req.body, "telefone")) payload.telefone = telefone;
    if (Object.prototype.hasOwnProperty.call(req.body, "cidade")) payload.cidade = cidade;
    res.json(await atualizarPerfil(req.usuario.id, payload));
  } catch (erro) {
    res.status(409).json({ erro: erro.message });
  }
});

// PATCH /api/auth/localizacao
// body: { cep }
// Valida o CEP via Nominatim e atualiza a localização do usuário.
router.patch("/localizacao", exigirAutenticacao, async (req, res) => {
  const { cep } = req.body;
  if (!cep) return res.status(400).json({ erro: "Informe o CEP." });

  const local = await resolverLocalizacaoPorCep(cep);
  if (!local.valido) return res.status(400).json({ erro: local.erro });

  const dados = await atualizarLocalizacao(req.usuario.id, {
    cidade: local.cidade + " - " + local.uf,
    cidadeFormatada: local.enderecoFormatado,
    latitude: local.latitude,
    longitude: local.longitude,
  });

  res.json({
    cidade: dados.cidade,
    cidadeFormatada: dados.cidadeFormatada,
    latitude: dados.latitude,
    longitude: dados.longitude,
    cep: local.cep,
    uf: local.uf,
  });
});

router.patch("/preferencias", exigirAutenticacao, async (req, res) => {
  const { culturaFavorita, unidadeTemperatura, notificacoes } = req.body;
  const culturas = ["cafe", "soja", "milho", "cana", "feijao"];
  if (!culturas.includes(culturaFavorita) || !["celsius", "fahrenheit"].includes(unidadeTemperatura) || typeof notificacoes !== "boolean") {
    return res.status(400).json({ erro: "Preferências inválidas." });
  }
  res.json(await atualizarPreferencias(req.usuario.id, { culturaFavorita, unidadeTemperatura, notificacoes }));
});

router.patch("/senha", exigirAutenticacao, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  if (!senhaAtual || !novaSenha || novaSenha.length < 6) {
    return res.status(400).json({ erro: "Informe a senha atual e uma nova senha com pelo menos 6 caracteres." });
  }
  try {
    await alterarSenha(req.usuario.id, senhaAtual, novaSenha);
    res.json({ mensagem: "Senha alterada com sucesso." });
  } catch (erro) {
    res.status(400).json({ erro: erro.message });
  }
});

router.delete("/conta", exigirAutenticacao, async (req, res) => {
  await excluirConta(req.usuario.id);
  res.status(204).send();
});

module.exports = router;
