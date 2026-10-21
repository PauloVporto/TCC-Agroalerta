/**
 * Envia UMA mensagem de teste pelo WhatsApp (Evolution API, instância do Agro
 * Alerta) para o celular informado em --para.
 *
 * Antes de enviar, confere que a instância está conectada e que o número conectado
 * é o remetente esperado (WHATSAPP_EXPECTED_SENDER) — senão, nada sai. Mostra
 * remetente, destinatário e conteúdo, exige confirmação (digitar ENVIAR) e registra
 * o resultado no histórico (tipo "teste"). Não usa a fila nem consulta produtores.
 *
 * Os recibos (servidor, entrega, leitura) chegam pelo webhook, que é processado
 * pelo backend em execução: por isso o script acompanha o histórico no banco por
 * até 1 minuto. Rode dentro do container, com o backend no ar:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec backend \
 *     npm run notificacoes:testar-whatsapp -- --para "(35) 99999-0000"
 */

require("dotenv").config();
const { lerConfiguracao, evolutionConfigurada } = require("../services/notificacoes/config");
const evolution = require("../services/notificacoes/provedores/evolution");
const { registrarTesteManual, concluirTesteManual } = require("../services/notificacoes/fila");
const { whatsappTeste } = require("../services/notificacoes/templates");
const { normalizarTelefone, ehCelular, formatarTelefone, numeroParaWhatsapp, remetenteCorresponde, telefoneDoWhatsapp } = require("../services/contato");
const { pool } = require("../services/db");
const { argumento, confirmar, acompanharEntrega } = require("./comum");

const ROTULO = {
  enviado: "aceito pela Evolution API (sem recibo do WhatsApp ainda)",
  confirmado_servidor: "confirmado pelo servidor do WhatsApp",
  entregue: "entregue no celular do destinatário",
  lido: "lido pelo destinatário",
  falhou: "falhou",
};

async function situacaoNoBanco(envioId) {
  const { rows } = await pool.query("SELECT status FROM notificacao_envios WHERE id = $1", [envioId]);
  return rows[0].status;
}

async function main() {
  const destino = normalizarTelefone(argumento("para"));
  if (!ehCelular(destino)) {
    console.error('Informe um celular brasileiro com DDD: --para "(35) 99999-0000"');
    process.exitCode = 1;
    return;
  }
  const config = lerConfiguracao();
  const cfg = config.whatsapp.evolution;
  if (!evolutionConfigurada(config)) {
    console.error("Defina EVOLUTION_API_URL e EVOLUTION_API_KEY (ou EVOLUTION_API_KEY_FILE).");
    process.exitCode = 1;
    return;
  }
  if (!config.whatsapp.remetenteEsperado) {
    console.error("Defina WHATSAPP_EXPECTED_SENDER com o número (ou o final) do WhatsApp do Agro Alerta.");
    process.exitCode = 1;
    return;
  }

  const [{ existe, estado }, dados] = await Promise.all([evolution.estadoDaConexao(cfg), evolution.dadosDaInstancia(cfg)]);
  const remetente = dados && telefoneDoWhatsapp(dados.numero);
  if (!existe || estado !== "open" || !remetente) {
    console.error(`A instância "${cfg.instancia}" não está conectada (estado: ${estado || "inexistente"}). Conecte o WhatsApp no painel do administrador.`);
    process.exitCode = 1;
    return;
  }
  if (!remetenteCorresponde(dados.numero, config.whatsapp.remetenteEsperado)) {
    console.error(`O número conectado (${formatarTelefone(remetente)}) não é o remetente esperado (final ${config.whatsapp.remetenteEsperado.slice(-4)}). Nada foi enviado.`);
    process.exitCode = 1;
    return;
  }

  const texto = whatsappTeste();
  console.log("Teste de WhatsApp · Evolution API");
  console.log("  instância:    " + cfg.instancia);
  console.log("  remetente:    " + formatarTelefone(remetente));
  console.log("  destinatário: " + formatarTelefone(destino));
  console.log("  conteúdo:     " + texto);
  console.log("  custo: nenhum na Evolution; a mensagem sai do WhatsApp conectado como uma mensagem comum.");
  if (!(await confirmar("\nDigite ENVIAR para mandar 1 mensagem (qualquer outra resposta cancela): "))) {
    console.log("Cancelado. Nada foi enviado.");
    return;
  }

  const envioId = await registrarTesteManual({
    canal: "whatsapp", destino, conteudo: texto, provedor: "evolution", modo: "real", remetente,
  });
  try {
    const { provedorId } = await evolution.enviarTexto(cfg, { numero: numeroParaWhatsapp(destino), texto });
    await concluirTesteManual(envioId, { provedorId });
    console.log(`Aceito pela Evolution API (id ${provedorId}); registrado no histórico como envio ${envioId}.`);
    console.log("Aceito ainda não é entregue: acompanhando os recibos do WhatsApp por até 1 minuto...");
    const status = await acompanharEntrega(async () => {
      const atual = await situacaoNoBanco(envioId);
      return { status: ["entregue", "lido", "falhou"].includes(atual) ? atual : null, detalhe: ROTULO[atual] || atual };
    });
    console.log(`Situação: ${status.detalhe || "ainda sem recibo do WhatsApp"}.`);
  } catch (erro) {
    await concluirTesteManual(envioId, { erro });
    console.error(
      erro.incerto
        ? `Resultado incerto (${erro.codigo}): ${erro.message}\nConfira no celular do remetente antes de tentar de novo.`
        : `Falhou (${erro.codigo || "erro"}): ${erro.message}`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((erro) => {
    console.error("Falha no teste:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
