/**
 * Diagnóstico das notificações — somente leitura: nenhuma mensagem é enviada e
 * nenhuma chave é exibida.
 *
 * Confere a configuração local e as condições reais dos serviços:
 *   Resend:    chave, domínios cadastrados e se o domínio de EMAIL_FROM está verificado;
 *   Evolution: versão do servidor, instância, conexão, número conectado × remetente
 *              esperado, webhook e controles do administrador;
 *   fila:      envios por canal e status e motivos de falha/bloqueio da última semana.
 *
 * Uso: docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend npm run notificacoes:diagnostico
 */

require("dotenv").config();
const { lerConfiguracao, modoDoCanal, avisosDeConfiguracao, evolutionConfigurada } = require("../services/notificacoes/config");
const resend = require("../services/notificacoes/provedores/resend");
const evolution = require("../services/notificacoes/provedores/evolution");
const { liberacaoDoDespacho } = require("../services/notificacoes/whatsapp");
const { lerControle } = require("../services/notificacoes/controle");
const { formatarTelefone, telefoneDoWhatsapp, remetenteCorresponde } = require("../services/contato");
const { pool } = require("../services/db");

function titulo(texto) {
  console.log("\n" + texto + "\n" + "-".repeat(texto.length));
}

function dominioDoRemetente(remetente) {
  const encontrado = /@([^>\s]+)>?\s*$/.exec(remetente || "");
  return encontrado ? encontrado[1].toLowerCase() : null;
}

async function diagnosticarResend(config) {
  titulo("E-mail · Resend");
  console.log(`modo: ${modoDoCanal(config, "email")} (EMAIL_SENDING_ENABLED=${config.email.envioAtivo})`);
  console.log("remetente (EMAIL_FROM): " + (config.email.remetente || "não definido"));
  if (!config.email.resendApiKey) {
    console.log("RESEND_API_KEY: não definida");
    return;
  }
  try {
    const dominios = await resend.listarDominios({ apiKey: config.email.resendApiKey });
    console.log("RESEND_API_KEY: válida (acesso total)");
    if (dominios.length === 0) console.log("domínios: nenhum cadastrado");
    for (const d of dominios) console.log(`domínio ${d.name}: ${d.status}`);

    const dominio = dominioDoRemetente(config.email.remetente);
    if (dominio === "resend.dev") {
      console.log("ATENÇÃO: remetente de teste — o Resend só entrega para o e-mail dono da conta.");
    } else if (dominio) {
      const cadastrado = dominios.find((d) => d.name === dominio);
      console.log(
        cadastrado && cadastrado.status === "verified"
          ? `domínio do remetente (${dominio}): verificado`
          : `ATENÇÃO: domínio do remetente (${dominio}) não está verificado — o Resend recusará os envios.`
      );
    }
  } catch (erro) {
    console.log("não foi possível consultar a conta: " + erro.message);
  }
}

async function diagnosticarEvolution(config) {
  const { whatsapp } = config;
  const cfg = whatsapp.evolution;
  titulo("WhatsApp · Evolution API");
  console.log(`modo: ${modoDoCanal(config, "whatsapp")} (WHATSAPP_SENDING_ENABLED=${whatsapp.envioAtivo})`);
  console.log("EVOLUTION_API_URL: " + (cfg.url || "não definida"));
  console.log("EVOLUTION_API_KEY: " + (cfg.apiKey ? "definida" : "não definida"));
  console.log("instância: " + cfg.instancia);
  console.log("remetente esperado: " + (whatsapp.remetenteEsperado ? "final " + whatsapp.remetenteEsperado.slice(-4) : "não definido"));
  console.log(
    `ritmo: intervalo de ${whatsapp.intervaloMinimoMs} ms · ${whatsapp.limitePorHora}/hora · ` +
      `${whatsapp.limiteDiario}/dia · ${whatsapp.limitePorProdutorDia} por produtor/dia`
  );
  if (!evolutionConfigurada(config)) return;

  try {
    console.log("servidor: Evolution API " + ((await evolution.versaoDoServidor(cfg)) || "versão desconhecida"));
    const [{ existe, estado }, dados] = await Promise.all([evolution.estadoDaConexao(cfg), evolution.dadosDaInstancia(cfg)]);
    if (!existe) {
      console.log(`instância "${cfg.instancia}": não criada (conecte pelo painel do administrador)`);
    } else {
      console.log("conexão: " + (estado || "desconhecida"));
      const telefone = dados && telefoneDoWhatsapp(dados.numero);
      if (telefone) {
        const valido = remetenteCorresponde(dados.numero, whatsapp.remetenteEsperado);
        console.log(`número conectado: ${formatarTelefone(telefone)} — ${valido ? "é o remetente esperado" : "ATENÇÃO: não é o remetente esperado"}`);
      }
      if (cfg.webhookUrl && cfg.webhookSecret) {
        console.log("webhook: " + ((await evolution.webhookEmDia(cfg)) ? "configurado e em dia" : "ATENÇÃO: ausente ou diferente (conecte de novo pelo painel)"));
      } else {
        console.log("webhook: EVOLUTION_WEBHOOK_URL ou EVOLUTION_WEBHOOK_SECRET não definido (sem recibos)");
      }
    }
  } catch (erro) {
    console.log("Evolution API indisponível: " + erro.message);
  }
}

async function diagnosticarFila(config) {
  titulo("Controle e fila (PostgreSQL)");
  const controle = await lerControle();
  console.log(
    `controle: envios ${controle.enviosBloqueados ? "BLOQUEADOS" : "liberados"} · boas-vindas ` +
      `${controle.boasVindasAtivas ? "ativas" : "bloqueadas"} · alertas ${controle.alertasAtivos ? "ativos" : "bloqueados"}`
  );
  const liberacao = await liberacaoDoDespacho(config);
  console.log("despacho do WhatsApp agora: " + (liberacao.tipos.length ? "liberado para " + liberacao.tipos.join(", ") : "retido — " + liberacao.motivo));

  const porStatus = await pool.query(
    `SELECT canal, status, COUNT(*)::int AS total FROM notificacao_envios
     GROUP BY canal, status ORDER BY canal, status`
  );
  if (porStatus.rows.length === 0) console.log("nenhum envio registrado");
  for (const linha of porStatus.rows) console.log(`${linha.canal} · ${linha.status}: ${linha.total}`);

  const motivos = await pool.query(
    `SELECT canal, status, erro_codigo, COUNT(*)::int AS total FROM notificacao_envios
     WHERE status IN ('falhou', 'bloqueado', 'pendente', 'incerto') AND erro_codigo IS NOT NULL
       AND atualizado_em > NOW() - INTERVAL '7 days'
     GROUP BY canal, status, erro_codigo ORDER BY total DESC LIMIT 10`
  );
  for (const linha of motivos.rows) {
    console.log(`motivo (7 dias) ${linha.canal} · ${linha.status} · ${linha.erro_codigo}: ${linha.total}`);
  }
}

async function main() {
  const config = lerConfiguracao();
  const avisos = avisosDeConfiguracao(config);
  if (avisos.length) titulo("Avisos de configuração");
  for (const aviso of avisos) console.log("- " + aviso);

  await diagnosticarResend(config);
  await diagnosticarEvolution(config);
  try {
    await diagnosticarFila(config);
  } catch (erro) {
    console.log("banco indisponível: " + erro.message);
    console.log("rode dentro do container: docker compose exec backend npm run notificacoes:diagnostico");
  }
  await pool.end();
}

main().catch((erro) => {
  console.error("Falha no diagnóstico:", erro.message);
  process.exit(1);
});
