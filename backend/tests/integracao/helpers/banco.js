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
    `TRUNCATE clima_controle, boletim_execucoes, notificacao_webhooks, notificacao_eventos, notificacao_envios, notificacao_consentimentos,
              notificacao_preferencias, administracao_eventos, whatsapp_controle, alertas_gerados,
              leituras_clima, sessoes, talhoes, preferencias_usuario, usuarios
     RESTART IDENTITY CASCADE`
  );
  // A linha de controle volta ao padrão da migration: envios bloqueados.
  await pool.query("INSERT INTO whatsapp_controle (id) VALUES (1)");
  await pool.query("INSERT INTO clima_controle (id) VALUES (1)");
}

/**
 * @param consentimentos { email?: boolean, whatsapp?: boolean, sms?: boolean } — decisão gravada como se viesse do painel
 * @param preferencias { email: "medio"|"alto", whatsapp: "medio"|"alto" } — gravidade mínima por canal
 */
async function criarProdutor({ nome = "Produtor Teste", email, telefone = null, papel = "produtor", consentimentos = {}, preferencias = null }) {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, salt, telefone, papel)
     VALUES ($1, $2, 'hash', 'salt', $3, $4) RETURNING id, nome, email, telefone, papel`,
    [nome, email, telefone, papel]
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
      "INSERT INTO notificacao_preferencias (usuario_id, email_nivel_minimo, whatsapp_nivel_minimo) VALUES ($1, $2, $3)",
      [usuario.id, preferencias.email, preferencias.whatsapp]
    );
  }
  return usuario;
}

/** Abre (ou fecha) as travas do administrador no banco. */
async function definirControle({ enviosBloqueados = false, boasVindasAtivas = true, alertasAtivos = true } = {}) {
  await pool.query(
    "UPDATE whatsapp_controle SET envios_bloqueados = $1, boas_vindas_ativas = $2, alertas_ativos = $3 WHERE id = 1",
    [enviosBloqueados, boasVindasAtivas, alertasAtivos]
  );
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

const TIPOS_AUTOMATICOS = ["boas_vindas", "alerta_climatico"];

/**
 * Provedor falso: guarda o que enviaria e responde conforme o roteiro
 * (cada item é { provedorId } ou um erro a lançar; sem roteiro, aceita tudo).
 * Por padrão libera tudo; `liberacao` simula travas fechadas.
 */
function provedorFalso({
  nome = "falso", modo = "real", roteiro = [], consultarStatus, reenvioSeguro, reservarVez,
  liberacao = { tipos: TIPOS_AUTOMATICOS, motivo: null, remetente: null }, aoEnviar,
} = {}) {
  const enviados = [];
  return {
    nome,
    modo,
    enviados,
    consultarStatus,
    reenvioSeguro,
    reservarVez,
    liberacao: async () => liberacao,
    async enviar(mensagem) {
      enviados.push(mensagem);
      if (aoEnviar) await aoEnviar(mensagem);
      const proxima = roteiro.length ? roteiro.shift() : { provedorId: `${nome}-${enviados.length}` };
      if (proxima instanceof Error) throw proxima;
      return proxima;
    },
  };
}

// WhatsApp de teste: sem espera entre mensagens; demais valores como em produção.
const ENV_PADRAO = { WHATSAPP_MIN_INTERVAL_MS: "0", WHATSAPP_EXPECTED_SENDER: "9503" };

function configuracao(env = {}) {
  return lerConfiguracao({ ...ENV_PADRAO, ...env });
}

function processar({
  config = configuracao(),
  email = provedorFalso({ nome: "resend" }),
  whatsapp = provedorFalso({ nome: "evolution", reenvioSeguro: false }),
} = {}) {
  return processarFila({ config, provedores: { email, whatsapp }, log: () => {} });
}

module.exports = {
  pool,
  prepararBanco,
  limparBanco,
  definirControle,
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
