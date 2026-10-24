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
const { contatoDoProdutor, obterConsentimentos, autorizacaoVigente } = require("../services/notificacoes/consentimentos");
const { registrarEscolhasDoCadastro } = require("../services/notificacoes");

const ERRO_TELEFONE = "Telefone inválido. Informe DDD e número, ex.: (35) 99999-0000.";

/**
 * @swagger
 * /auth/registrar:
 *   post:
 *     summary: Cria uma conta e já cria o primeiro talhão na localização do CEP informado
 *     description: >
 *       O CEP é validado via ViaCEP e geocodificado via Nominatim (OpenStreetMap) - sem
 *       necessidade de chave de API. Com as coordenadas já disponíveis, cria automaticamente
 *       o primeiro talhão naquela localização, para que o produtor veja alertas e previsão
 *       do tempo reais assim que entrar no painel.
 *     tags: [Autenticação]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, email, senha, cep]
 *             properties:
 *               nome: { type: string, example: "Marina Rezende Alves" }
 *               email: { type: string, example: "marina@fazenda.com.br" }
 *               senha: { type: string, format: password, minLength: 6 }
 *               cep: { type: string, example: "37540-000" }
 *               cultura: { type: string, enum: [cafe, soja, milho, cana, feijao], example: cafe }
 *     responses:
 *       201:
 *         description: Conta criada e autenticada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 usuario: { $ref: '#/components/schemas/Usuario' }
 *                 token: { type: string }
 *       400:
 *         description: Campos obrigatórios ausentes, senha curta ou CEP não encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Erro' }
 *       409:
 *         description: Já existe uma conta com esse e-mail
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Erro' }
 */
// POST /api/auth/registrar
// body: { nome, email, senha, cep, telefone, cultura?, notificacoes?: { email, whatsapp } }
//
// O CEP é validado via ViaCEP e geocodificado pelo Nominatim (OpenStreetMap),
// sem chave de API. Com as coordenadas, cria o primeiro talhão na mesma
// localização para que o produtor veja alertas e previsão reais ao entrar.
// Os canais de notificação só ficam autorizados se o produtor marcar cada um;
// para cada canal autorizado, a mensagem de boas-vindas entra na fila. O cadastro
// não depende de nenhum provedor: a fila envia depois, quando puder.
router.post("/registrar", async (req, res) => {
  const { nome, email, senha, cep, cultura, telefone, notificacoes, papel } = req.body;

  if (!nome || !email || !senha || !cep) {
    return res.status(400).json({ erro: "Campos obrigatórios: nome, email, senha, cep" });
  }
  if (!emailValido(email)) {
    return res.status(400).json({ erro: "E-mail em formato inválido." });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
  }
  if (!telefone) {
    return res.status(400).json({ erro: "Informe o celular com DDD, ex.: (35) 99999-0000." });
  }
  const telefoneNormalizado = normalizarTelefone(telefone);
  if (!telefoneNormalizado) {
    return res.status(400).json({ erro: ERRO_TELEFONE });
  }
  const escolhas = {
    email: Boolean(notificacoes && notificacoes.email === true),
    whatsapp: Boolean(notificacoes && notificacoes.whatsapp === true),
  };
  if (escolhas.whatsapp && !ehCelular(telefoneNormalizado)) {
    return res.status(400).json({ erro: "Para receber pelo WhatsApp, informe um celular válido com DDD." });
  }

  const local = await resolverLocalizacaoPorCep(cep);
  if (!local.valido) {
    return res.status(400).json({ erro: local.erro });
  }

  const culturaEscolhida = culturasSuportadas().includes(cultura) ? cultura : "cafe";

  try {
    const usuario = await criarUsuario({
      nome, email, senha, papel,
      telefone: telefoneNormalizado,
      cidade: local.cidade + " - " + local.uf,
      cidadeFormatada: local.enderecoFormatado,
      latitude: local.latitude,
      longitude: local.longitude,
    });

    // Fornecedor não tem lavoura: o talhão inicial é só para quem produz.
    if (usuario.papel !== "fornecedor") {
      await criarTalhao(usuario.id, {
        nome: "Talhão principal - " + local.cidade,
        cultura: culturaEscolhida,
        fase: "plantio",
        endereco: local.enderecoFormatado,
        regiao: local.cidade + " - " + local.uf,
        coordenadas: local,
      });
    }

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

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Autentica um usuário e retorna um token de sessão
 *     tags: [Autenticação]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, senha]
 *             properties:
 *               email: { type: string }
 *               senha: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login bem-sucedido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 usuario: { $ref: '#/components/schemas/Usuario' }
 *                 token: { type: string }
 *       400:
 *         description: E-mail ou senha ausentes
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Erro' }
 *       401:
 *         description: Credenciais inválidas
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Erro' }
 */
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

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Encerra a sessão atual (invalida o token)
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Sessão encerrada }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.post("/logout", exigirAutenticacao, async (req, res) => {
  const token = req.headers.authorization.slice(7);
  await encerrarSessao(token);
  res.status(204).send();
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Retorna o usuário autenticado (usado pelo frontend para checar a sessão)
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Usuário autenticado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Usuario' }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/me", exigirAutenticacao, (req, res) => {
  res.json(req.usuario);
});

/**
 * @swagger
 * /auth/configuracoes:
 *   get:
 *     summary: Retorna perfil, localização e preferências do usuário autenticado
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Configurações do usuário
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Usuario'
 *                 - type: object
 *                   properties:
 *                     culturaFavorita: { type: string, example: cafe }
 *                     unidadeTemperatura: { type: string, enum: [celsius, fahrenheit] }
 *                     notificacoes: { type: boolean }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.get("/configuracoes", exigirAutenticacao, async (req, res) => {
  res.json(await obterConfiguracoes(req.usuario.id));
});

/**
 * @swagger
 * /auth/perfil:
 *   patch:
 *     summary: Atualiza nome e e-mail do usuário autenticado
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nome, email]
 *             properties:
 *               nome: { type: string }
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Perfil atualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Usuario' }
 *       400: { description: Campos obrigatórios ausentes, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       409: { description: E-mail já em uso, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
// PATCH /api/auth/perfil
// body: { nome, email, telefone?, cidade? } - sem o campo telefone, o número atual é mantido.
router.patch("/perfil", exigirAutenticacao, async (req, res) => {
  const { nome, email, telefone, cidade } = req.body;
  if (!nome || !email) return res.status(400).json({ erro: "Nome e e-mail são obrigatórios." });
  if (!emailValido(email)) return res.status(400).json({ erro: "E-mail em formato inválido." });

  const contato = await contatoDoProdutor(req.usuario.id);
  let telefoneFinal = contato.telefone;
  if (telefone !== undefined) {
    telefoneFinal = telefone ? normalizarTelefone(telefone) : null;
    if (telefone && !telefoneFinal) return res.status(400).json({ erro: ERRO_TELEFONE });
    // Trocar por outro celular é permitido: a autorização do WhatsApp passa a valer
    // só depois de ser renovada para o número novo (o painel renova ao salvar).
    const { whatsapp } = await obterConsentimentos(req.usuario.id);
    if (autorizacaoVigente("whatsapp", whatsapp, contato.telefone) && !ehCelular(telefoneFinal)) {
      return res.status(400).json({
        erro: "As notificações por WhatsApp estão autorizadas: informe um celular válido ou desative o WhatsApp antes.",
      });
    }
  }

  try {
    const payload = { nome, email, telefone: telefoneFinal };
    if (Object.prototype.hasOwnProperty.call(req.body, "cidade")) payload.cidade = cidade;
    res.json(await atualizarPerfil(req.usuario.id, payload));
  } catch (erro) {
    res.status(409).json({ erro: erro.message });
  }
});

/**
 * @swagger
 * /auth/localizacao:
 *   patch:
 *     summary: Atualiza a cidade/coordenadas do usuário a partir de um CEP
 *     description: Valida o CEP via ViaCEP, geocodifica via Nominatim e salva a nova localização.
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cep]
 *             properties:
 *               cep: { type: string, example: "37540-000" }
 *     responses:
 *       200:
 *         description: Localização atualizada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cidade: { type: string }
 *                 cidadeFormatada: { type: string }
 *                 latitude: { type: number }
 *                 longitude: { type: number }
 *                 cep: { type: string }
 *                 uf: { type: string }
 *       400: { description: CEP ausente ou não encontrado, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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

/**
 * @swagger
 * /auth/preferencias:
 *   patch:
 *     summary: Atualiza as preferências do usuário (cultura favorita, unidade, notificações)
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [culturaFavorita, unidadeTemperatura, notificacoes]
 *             properties:
 *               culturaFavorita: { type: string, enum: [cafe, soja, milho, cana, feijao] }
 *               unidadeTemperatura: { type: string, enum: [celsius, fahrenheit] }
 *               notificacoes: { type: boolean }
 *     responses:
 *       200:
 *         description: Preferências atualizadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 culturaFavorita: { type: string }
 *                 unidadeTemperatura: { type: string }
 *                 notificacoes: { type: boolean }
 *       400: { description: Preferências inválidas, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.patch("/preferencias", exigirAutenticacao, async (req, res) => {
  const { culturaFavorita, unidadeTemperatura } = req.body;
  const culturas = ["cafe", "soja", "milho", "cana", "feijao"];
  if (!culturas.includes(culturaFavorita) || !["celsius", "fahrenheit"].includes(unidadeTemperatura)) {
    return res.status(400).json({ erro: "Preferências inválidas." });
  }
  res.json(await atualizarPreferencias(req.usuario.id, { culturaFavorita, unidadeTemperatura }));
});

/**
 * @swagger
 * /auth/senha:
 *   patch:
 *     summary: Altera a senha do usuário autenticado
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [senhaAtual, novaSenha]
 *             properties:
 *               senhaAtual: { type: string, format: password }
 *               novaSenha: { type: string, format: password, minLength: 6 }
 *     responses:
 *       200:
 *         description: Senha alterada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mensagem: { type: string }
 *       400: { description: Senha atual incorreta ou dados inválidos, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
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

/**
 * @swagger
 * /auth/conta:
 *   delete:
 *     summary: Exclui a conta do usuário autenticado (e seus talhões, em cascata)
 *     tags: [Autenticação]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Conta excluída }
 *       401: { description: Token ausente ou inválido, content: { application/json: { schema: { $ref: '#/components/schemas/Erro' } } } }
 */
router.delete("/conta", exigirAutenticacao, async (req, res) => {
  await excluirConta(req.usuario.id);
  res.status(204).send();
});

module.exports = router;
