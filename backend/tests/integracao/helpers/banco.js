/**
 * Banco das suítes de integração (PostgreSQL real).
 *
 * Exige TEST_DATABASE_URL apontando para um banco cujo nome termine em "_teste":
 * as suítes apagam os dados entre um teste e outro, então nunca podem rodar no
 * banco de verdade. Carregue este arquivo antes de qualquer serviço — o pool de
 * conexões lê DATABASE_URL no momento em que db.js é carregado.
 */

const crypto = require("crypto");

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("Defina TEST_DATABASE_URL, ex.: postgres://agroalerta:agroalerta@127.0.0.1:55432/agroalerta_teste");
}
const nomeDoBanco = new URL(url).pathname.slice(1);
if (!nomeDoBanco.endsWith("_teste")) {
  throw new Error(`TEST_DATABASE_URL deve apontar para um banco de teste (nome terminado em "_teste"), não "${nomeDoBanco}".`);
}
process.env.DATABASE_URL = url;

const { pool, inicializarBanco } = require("../../../services/db");
const { aplicarMigracoes } = require("../../../services/migracoes");
const { lerConfiguracao } = require("../../../services/notificacoes/config");
const { processarFila } = require("../../../services/notificacoes/fila");

let preparo = null;

function prepararBanco() {
  preparo =
    preparo ||
    (async () => {
      await inicializarBanco();
      await aplicarMigracoes({ log: () => {} });
    })();
  return preparo;
}

async function limparBanco() {
  await pool.query(
    `TRUNCATE notificacao_webhooks, notificacao_eventos, notificacao_envios, notificacao_consentimentos,
              notificacao_preferencias, alertas_gerados, leituras_clima, sessoes, talhoes,
              preferencias_usuario, usuarios
     RESTART IDENTITY CASCADE`
  );
}

/**
 * @param consentimentos { email?: boolean, sms?: boolean } — decisão gravada como se viesse do painel
 * @param preferencias { email: "medio"|"alto", sms: "medio"|"alto" } — gravidade mínima por canal
 */
async function criarProdutor({ nome = "Produtor Teste", email, telefone = null, consentimentos = {}, preferencias = null }) {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, salt, telefone)
     VALUES ($1, $2, 'hash', 'salt', $3) RETURNING id, nome, email, telefone`,
    [nome, email, telefone]
  );
  const usuario = rows[0];
  for (const [canal, concedido] of Object.entries(consentimentos)) {
    await pool.query(
      `INSERT INTO notificacao_consentimentos (usuario_id, canal, concedido, destino, origem)
       VALUES ($1, $2, $3, $4, 'painel')`,
      [usuario.id, canal, concedido, canal === "email" ? email : telefone]
    );
  }
  if (preferencias) {
    await pool.query(
      "INSERT INTO notificacao_preferencias (usuario_id, email_nivel_minimo, sms_nivel_minimo) VALUES ($1, $2, $3)",
      [usuario.id, preferencias.email, preferencias.sms]
    );
  }
  return usuario;
}

async function criarTalhaoDeTeste(usuarioId, campos = {}) {
  const t = {
    nome: "Talhão 1",
    cultura: "cafe",
    fase: "floracao",
    regiao: "Lavras - MG",
    latitude: -21.245,
    longitude: -44.999,
    ...campos,
  };
  const { rows } = await pool.query(
    `INSERT INTO talhoes (usuario_id, nome, cultura, fase, endereco, latitude, longitude, endereco_formatado, regiao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [usuarioId, t.nome, t.cultura, t.fase, t.regiao, t.latitude, t.longitude, t.regiao, t.regiao]
  );
  return rows[0].id;
}

async function criarSessao(usuarioId) {
  const token = crypto.randomBytes(16).toString("hex");
  await pool.query("INSERT INTO sessoes (token, usuario_id) VALUES ($1, $2)", [token, usuarioId]);
  return token;
}

async function listarEnvios() {
  const { rows } = await pool.query("SELECT * FROM notificacao_envios ORDER BY id");
  return rows.map((envio) => ({ ...envio, id: Number(envio.id) }));
}

async function eventosDoEnvio(envioId) {
  const { rows } = await pool.query(
    "SELECT tipo, status, detalhe FROM notificacao_eventos WHERE envio_id = $1 ORDER BY id",
    [envioId]
  );
  return rows;
}

// Torna "agora" a próxima tentativa (simula a passagem do tempo de espera).
async function liberarRetentativas() {
  await pool.query("UPDATE notificacao_envios SET proxima_tentativa_em = NOW() WHERE status = 'pendente'");
}

/**
 * Provedor falso: guarda o que enviaria e responde conforme o roteiro
 * (cada item é { provedorId } ou um erro a lançar; sem roteiro, aceita tudo).
 */
function provedorFalso({ nome = "falso", modo = "real", roteiro = [], consultarStatus } = {}) {
  const enviados = [];
  return {
    nome,
    modo,
    enviados,
    consultarStatus,
    async enviar(mensagem) {
      enviados.push(mensagem);
      const proxima = roteiro.length ? roteiro.shift() : { provedorId: `${nome}-${enviados.length}` };
      if (proxima instanceof Error) throw proxima;
      return proxima;
    },
  };
}

// Configuração de produção bem preenchida: com custo e orçamento, o SMS real pode sair.
const ENV_PADRAO = { SMS_COST_PER_SEGMENT: "0.075", SMS_MONTHLY_BUDGET: "100" };

function configuracao(env = {}) {
  return lerConfiguracao({ ...ENV_PADRAO, ...env });
}

function processar({ config = configuracao(), email = provedorFalso({ nome: "resend" }), sms = provedorFalso({ nome: "smsgo" }) } = {}) {
  return processarFila({ config, provedores: { email, sms }, log: () => {} });
}

module.exports = {
  pool,
  prepararBanco,
  limparBanco,
  criarProdutor,
  criarTalhaoDeTeste,
  criarSessao,
  listarEnvios,
  eventosDoEnvio,
  liberarRetentativas,
  provedorFalso,
  configuracao,
  processar,
};
