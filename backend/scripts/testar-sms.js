/**
 * Envia UM SMS de teste pela SMSGo para o celular informado em --para.
 *
 * Mostra destinatário, conteúdo, segmentos, custo estimado (preço lido da conta)
 * e saldo, exige confirmação (digitar ENVIAR) e registra o resultado no
 * histórico (tipo "teste"). Não usa a fila nem consulta produtores.
 *
 * Com --sandbox usa SMSGO_TEST_API_KEY: a API responde como em produção, mas não
 * debita saldo nem entrega a mensagem. Sem a opção, usa SMSGO_API_KEY (real).
 *
 * Uso: docker compose exec backend npm run notificacoes:testar-sms -- --para "(35) 99999-0000" [--sandbox]
 */

require("dotenv").config();
const { lerConfiguracao } = require("../services/notificacoes/config");
const smsgo = require("../services/notificacoes/provedores/smsgo");
const { statusPorResumoSmsgo } = require("../services/notificacoes/provedores");
const { registrarTesteManual, concluirTesteManual } = require("../services/notificacoes/fila");
const { aplicarResultadoDeEntrega } = require("../services/notificacoes/statusEntrega");
const { smsTeste } = require("../services/notificacoes/templates");
const { contarSegmentos } = require("../services/notificacoes/textoSms");
const { normalizarTelefone, ehCelular, formatarTelefone } = require("../services/contato");
const { pool } = require("../services/db");
const { argumento, temOpcao, confirmar, acompanharEntrega } = require("./comum");

function reais(valor, casas = 4) {
  return "R$ " + valor.toFixed(casas).replace(".", ",");
}

async function main() {
  const destino = normalizarTelefone(argumento("para"));
  if (!ehCelular(destino)) {
    console.error('Informe um celular brasileiro com DDD: --para "(35) 99999-0000"');
    process.exitCode = 1;
    return;
  }
  const { sms } = lerConfiguracao();
  const sandbox = temOpcao("sandbox");
  const apiKey = sandbox ? sms.smsgo.chaveTeste : sms.smsgo.chaveProducao;
  if (!apiKey) {
    console.error(`Defina ${sandbox ? "SMSGO_TEST_API_KEY" : "SMSGO_API_KEY"} no backend/.env.`);
    process.exitCode = 1;
    return;
  }

  const texto = smsTeste();
  const segmentos = contarSegmentos(texto);
  const [modoDaChave, { saldo, moeda }, tipos] = await Promise.all([
    smsgo.obterModo({ apiKey }),
    smsgo.consultarSaldo({ apiKey }),
    smsgo.listarTiposSms({ apiKey }),
  ]);
  const tipo = tipos.find((t) => t.id === sms.smsgo.tipoSmsId) || null;
  const preco = tipo ? Number(tipo.sale ?? tipo.price) : null;
  const custo = sandbox ? 0 : preco === null ? null : preco * segmentos;

  console.log("Teste de SMS · SMSGo");
  console.log("  destinatário: " + formatarTelefone(destino) + " (" + destino + ")");
  console.log("  conteúdo:     " + texto);
  console.log(`  tamanho:      ${texto.length} caracteres, ${segmentos} segmento(s)`);
  console.log("  chave:        " + (modoDaChave === "test" ? "sandbox — não cobra nem entrega" : "produção — envio real"));
  console.log("  tipo de SMS:  " + (tipo ? `${tipo.id} (${tipo.label || tipo.name})` : "padrão da conta (SMSGO_SMS_TYPE_ID não definido)"));
  if (custo !== null) {
    console.log("  custo:        " + reais(custo) + (sandbox ? " (sandbox)" : ` (${segmentos} × ${reais(preco)})`));
  } else {
    console.log("  custo:        depende do tipo padrão; preços da conta:");
    for (const t of tipos) console.log(`                tipo ${t.id} (${t.label || t.name}): ${reais(Number(t.sale ?? t.price))} por SMS`);
  }
  console.log("  saldo:        " + (moeda === "BRL" ? reais(saldo, 2) : `${moeda} ${saldo}`));
  if (!(await confirmar("\nDigite ENVIAR para mandar 1 SMS (qualquer outra resposta cancela): "))) {
    console.log("Cancelado. Nada foi enviado.");
    return;
  }

  const envioId = await registrarTesteManual({
    canal: "sms",
    destino,
    conteudo: texto,
    provedor: "smsgo",
    modo: sandbox ? "sandbox" : "real",
    segmentos,
    custo,
  });
  try {
    const resultado = await smsgo.enviarSms({
      apiKey,
      para: destino,
      mensagem: texto,
      referencia: `teste-${envioId}`,
      tipoSmsId: sms.smsgo.tipoSmsId,
    });
    await concluirTesteManual(envioId, { provedorId: resultado.provedorId });
    console.log(
      `Aceito pela SMSGo (id ${resultado.provedorId}, status ${resultado.status}${resultado.teste ? ", sandbox" : ""}); ` +
        `registrado no histórico como envio ${envioId}.`
    );
    console.log("Aceito ainda não é entregue: acompanhando a entrega por até 1 minuto...");
    const entrega = await acompanharEntrega(async () =>
      statusPorResumoSmsgo(await smsgo.consultarEnvio({ apiKey, id: resultado.provedorId }))
    );
    if (entrega.status) await aplicarResultadoDeEntrega(envioId, entrega, "consulta");
    console.log(`Situação: ${entrega.status || "ainda sem confirmação"} (${entrega.detalhe}).`);
  } catch (erro) {
    await concluirTesteManual(envioId, { erro });
    console.error(`Falhou (${erro.codigo || "erro"}): ${erro.message}`);
    process.exitCode = 1;
  }
}

main()
  .catch((erro) => {
    console.error("Falha no teste:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
