/**
 * Envia UM e-mail de teste pelo Resend para o endereço informado em --para.
 *
 * Mostra destinatário, remetente, assunto, conteúdo e custo, exige confirmação
 * (digitar ENVIAR) e registra o resultado no histórico (tipo "teste"). Não usa
 * a fila nem consulta produtores: ninguém além do destinatário recebe nada.
 *
 * Uso: docker compose exec backend npm run notificacoes:testar-email -- --para voce@exemplo.com
 */

require("dotenv").config();
const { lerConfiguracao } = require("../services/notificacoes/config");
const resend = require("../services/notificacoes/provedores/resend");
const { statusPorEventoResend } = require("../services/notificacoes/provedores");
const { registrarTesteManual, concluirTesteManual } = require("../services/notificacoes/fila");
const { aplicarResultadoDeEntrega } = require("../services/notificacoes/statusEntrega");
const { emailTeste } = require("../services/notificacoes/templates");
const { emailValido } = require("../services/contato");
const { pool } = require("../services/db");
const { argumento, confirmar, acompanharEntrega } = require("./comum");

async function main() {
  const para = String(argumento("para") || "").trim();
  if (!emailValido(para)) {
    console.error("Informe o destinatário: --para voce@exemplo.com");
    process.exitCode = 1;
    return;
  }
  const { email } = lerConfiguracao();
  if (!email.resendApiKey || !email.remetente) {
    console.error("Defina RESEND_API_KEY e EMAIL_FROM no backend/.env.");
    process.exitCode = 1;
    return;
  }

  const mensagem = emailTeste();
  console.log("Teste de e-mail · Resend");
  console.log("  destinatário: " + para);
  console.log("  remetente:    " + email.remetente);
  console.log("  assunto:      " + mensagem.assunto);
  console.log("  conteúdo:\n" + mensagem.texto.split("\n").map((linha) => "    " + linha).join("\n"));
  console.log("  custo: consome 1 e-mail da cota do plano da sua conta Resend.");
  if (/@resend\.dev>?$/i.test(email.remetente)) {
    console.log("  atenção: com o remetente de teste (resend.dev), o Resend só entrega para o e-mail dono da conta.");
  }
  if (!(await confirmar("\nDigite ENVIAR para mandar 1 e-mail (qualquer outra resposta cancela): "))) {
    console.log("Cancelado. Nada foi enviado.");
    return;
  }

  const envioId = await registrarTesteManual({
    canal: "email",
    destino: para,
    assunto: mensagem.assunto,
    conteudo: mensagem.texto,
    conteudoHtml: mensagem.html,
    provedor: "resend",
    modo: "real",
  });
  try {
    const { provedorId } = await resend.enviarEmail({
      apiKey: email.resendApiKey,
      remetente: email.remetente,
      para,
      assunto: mensagem.assunto,
      html: mensagem.html,
      texto: mensagem.texto,
      chaveIdempotencia: `agroalerta-teste-${envioId}`,
      tags: [{ name: "tipo", value: "teste" }],
    });
    await concluirTesteManual(envioId, { provedorId });
    console.log(`Aceito pelo Resend (id ${provedorId}); registrado no histórico como envio ${envioId}.`);
    console.log("Aceito ainda não é entregue: acompanhando a entrega por até 1 minuto...");
    const resultado = await acompanharEntrega(async () =>
      statusPorEventoResend((await resend.consultarEmail({ apiKey: email.resendApiKey, id: provedorId })).ultimoEvento)
    );
    if (resultado.status) await aplicarResultadoDeEntrega(envioId, resultado, "consulta");
    console.log(`Situação: ${resultado.status || "ainda sem confirmação"} (${resultado.detalhe}).`);
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
