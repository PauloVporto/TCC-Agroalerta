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
const { emailValido, normalizarTelefone, ehCelular } = require("../services/contato");
const { contatoDoProdutor, obterConsentimentos } = require("../services/notificacoes/consentimentos");
const { registrarEscolhasDoCadastro } = require("../services/notificacoes");

const ERRO_TELEFONE = "Telefone inválido. Informe DDD e número, ex.: (35) 99999-0000.";

// POST /api/auth/registrar
// body: { nome, email, senha, cep, telefone?, cultura?, notificacoes?: { email, sms } }
//
// O CEP é validado via ViaCEP e geocodificado pelo Nominatim (OpenStreetMap),
// sem chave de API. Com as coordenadas, cria o primeiro talhão na mesma
// localização para que o produtor veja alertas e previsão reais ao entrar.
// Os canais de notificação só ficam autorizados se o produtor marcar cada um;
// para cada canal autorizado, a mensagem de boas-vindas entra na fila.
router.post("/registrar", async (req, res) => {
  const { nome, email, senha, cep, cultura, telefone, notificacoes } = req.body;

  if (!nome || !email || !senha || !cep) {
    return res.status(400).json({ erro: "Campos obrigatórios: nome, email, senha, cep" });
  }
  if (!emailValido(email)) {
    return res.status(400).json({ erro: "E-mail em formato inválido." });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
  }
  const telefoneNormalizado = telefone ? normalizarTelefone(telefone) : null;
  if (telefone && !telefoneNormalizado) {
    return res.status(400).json({ erro: ERRO_TELEFONE });
  }
  const escolhas = {
    email: Boolean(notificacoes && notificacoes.email === true),
    sms: Boolean(notificacoes && notificacoes.sms === true),
  };
  if (escolhas.sms && !ehCelular(telefoneNormalizado)) {
    return res.status(400).json({ erro: "Para receber SMS, informe um celular válido com DDD." });
  }

  const local = await resolverLocalizacaoPorCep(cep);
  if (!local.valido) {
    return res.status(400).json({ erro: local.erro });
  }

  const culturaEscolhida = culturasSuportadas().includes(cultura) ? cultura : "cafe";

  try {
    const usuario = await criarUsuario({
      nome, email, senha,
      telefone: telefoneNormalizado,
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
      regiao: local.cidade + " - " + local.uf,
      coordenadas: local,
    });

    // A conta já existe: um problema ao gravar as notificações não desfaz o cadastro
    // (o produtor vê os canais desautorizados no painel e pode ativá-los lá).
    try {
      await registrarEscolhasDoCadastro(usuario, escolhas);
    } catch (erro) {
      console.error("[auth] não foi possível registrar as notificações do cadastro:", erro.message);
    }

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

// PATCH /api/auth/perfil
// body: { nome, email, telefone? } - sem o campo telefone, o número atual é mantido.
router.patch("/perfil", exigirAutenticacao, async (req, res) => {
  const { nome, email, telefone } = req.body;
  if (!nome || !email) return res.status(400).json({ erro: "Nome e e-mail são obrigatórios." });
  if (!emailValido(email)) return res.status(400).json({ erro: "E-mail em formato inválido." });

  const contato = await contatoDoProdutor(req.usuario.id);
  let telefoneFinal = contato.telefone;
  if (telefone !== undefined) {
    telefoneFinal = telefone ? normalizarTelefone(telefone) : null;
    if (telefone && !telefoneFinal) return res.status(400).json({ erro: ERRO_TELEFONE });
    const { sms } = await obterConsentimentos(req.usuario.id);
    if (sms.concedido && !ehCelular(telefoneFinal)) {
      return res.status(400).json({
        erro: "As notificações por SMS estão autorizadas: informe um celular válido ou desative o SMS antes.",
      });
    }
  }

  try {
    res.json(await atualizarPerfil(req.usuario.id, { nome, email, telefone: telefoneFinal }));
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
  const { culturaFavorita, unidadeTemperatura } = req.body;
  const culturas = ["cafe", "soja", "milho", "cana", "feijao"];
  if (!culturas.includes(culturaFavorita) || !["celsius", "fahrenheit"].includes(unidadeTemperatura)) {
    return res.status(400).json({ erro: "Preferências inválidas." });
  }
  res.json(await atualizarPreferencias(req.usuario.id, { culturaFavorita, unidadeTemperatura }));
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
