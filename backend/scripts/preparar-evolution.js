/** Cria a instância e registra o webhook. Não solicita QR, pareamento ou envio. */
const assert = require("node:assert/strict");
const { lerConfiguracao } = require("../services/notificacoes/config");
const evolution = require("../services/notificacoes/provedores/evolution");
const { estadoParaPainel } = require("../services/notificacoes/whatsapp");
const { registrarEventoAdmin } = require("../services/notificacoes/controle");
const { pool } = require("../services/db");

async function main() {
  const config = lerConfiguracao();
  assert.equal(config.whatsapp.envioAtivo, false, "A preparação exige os envios desativados.");
  assert.equal(config.monitoramento.ativo, false, "A preparação exige o monitoramento automático desativado.");
  assert.equal(config.whatsapp.evolution.instancia, "agroalerta");
  assert.ok(config.whatsapp.remetenteEsperado.endsWith("9503"), "Configure o remetente padrão 9503.");
  const criada = await evolution.criarInstancia(config.whatsapp.evolution);
  await evolution.configurarWebhook(config.whatsapp.evolution);
  if (criada) await registrarEventoAdmin(pool, { categoria: "conexao", tipo: "instancia_criada", detalhe: "Instância agroalerta preparada pelo servidor, sem iniciar pareamento." });
  const state = await estadoParaPainel(config);
  assert.equal(state.evolution.disponivel, true);
  assert.equal(state.webhook.emDia, true);
  assert.equal(state.envioLiberado, false);
  console.log(JSON.stringify({ instancia: state.instancia, evolutionDisponivel: true,
    webhookConfigurado: true, estado: state.conexao.estado, envioLiberado: false,
    pareamentoSolicitado: false, mensagensEnviadas: 0 }));
}

main().catch((error) => { console.error("Não foi possível preparar a Evolution:", error.message); process.exitCode = 1; })
  .finally(() => pool.end());
