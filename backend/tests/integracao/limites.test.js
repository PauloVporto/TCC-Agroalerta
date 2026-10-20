const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { enfileirar } = require("../../services/notificacoes/fila");
const { reservarSms } = require("../../services/notificacoes/limitesSms");
const { ErroProvedor } = require("../../services/notificacoes/provedores/comum");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

let sequencia = 0;

async function produtor(telefone = "+5535999990000") {
  sequencia += 1;
  return banco.criarProdutor({ email: `p${sequencia}@fazenda.com.br`, telefone, consentimentos: { sms: true } });
}

async function enfileirarSms(usuarioId, conteudo = "Agro Alerta: Alerta de geada (risco alto) em Lavras - MG.") {
  sequencia += 1;
  return enfileirar(banco.pool, {
    usuarioId, canal: "sms", tipo: "alerta_climatico", chaveIdempotencia: "sms-" + sequencia,
    destino: "+5535999990000", conteudo, resumo: "Risco de geada", maxTentativas: 5,
  });
}

async function situacao() {
  return (await banco.listarEnvios()).map((e) => [e.status, e.erro_codigo]);
}

test("limite de SMS por produtor por dia", async () => {
  const p = await produtor();
  for (let i = 0; i < 3; i++) await enfileirarSms(p.id);
  await banco.processar({ config: banco.configuracao({ SMS_PER_USER_DAILY_LIMIT: "2" }) });
  assert.deepEqual(await situacao(), [["enviado", null], ["enviado", null], ["bloqueado", "limite_produtor_diario"]]);
  const [, , bloqueado] = await banco.listarEnvios();
  assert.match(bloqueado.erro_mensagem, /SMS_PER_USER_DAILY_LIMIT/);
});

test("limite diário global vale para todos os produtores juntos", async () => {
  for (let i = 0; i < 3; i++) await enfileirarSms((await produtor()).id);
  await banco.processar({ config: banco.configuracao({ SMS_DAILY_LIMIT: "2" }) });
  assert.deepEqual((await situacao()).map(([status]) => status), ["enviado", "enviado", "bloqueado"]);
  assert.equal((await situacao())[2][1], "limite_diario");
});

test("limite mensal global", async () => {
  for (let i = 0; i < 2; i++) await enfileirarSms((await produtor()).id);
  await banco.processar({ config: banco.configuracao({ SMS_MONTHLY_LIMIT: "1" }) });
  assert.deepEqual((await situacao())[1], ["bloqueado", "limite_mensal"]);
});

test("orçamento mensal: bloqueia quando o próximo SMS ultrapassaria o valor definido", async () => {
  for (let i = 0; i < 2; i++) await enfileirarSms((await produtor()).id);
  await banco.processar({ config: banco.configuracao({ SMS_COST_PER_SEGMENT: "0.075", SMS_MONTHLY_BUDGET: "0.10" }) });
  assert.deepEqual(await situacao(), [["enviado", null], ["bloqueado", "orcamento_esgotado"]]);
  const [enviado, bloqueado] = await banco.listarEnvios();
  assert.equal(Number(enviado.custo_estimado), 0.075);
  assert.equal(enviado.segmentos, 1);
  assert.match(bloqueado.erro_mensagem, /R\$\s0,075 já usados de R\$\s0,10/);
});

test("SMS real sem custo ou orçamento configurado é bloqueado (não há preço embutido)", async () => {
  const p = await produtor();
  await enfileirarSms(p.id);
  await enfileirarSms(p.id);
  await banco.processar({ config: banco.configuracao({ SMS_COST_PER_SEGMENT: "", SMS_MONTHLY_BUDGET: "" }) });
  assert.deepEqual((await situacao()).map(([, codigo]) => codigo), ["custo_nao_configurado", "custo_nao_configurado"]);

  await banco.limparBanco();
  await enfileirarSms((await produtor()).id);
  await banco.processar({ config: banco.configuracao({ SMS_MONTHLY_BUDGET: "" }) });
  assert.deepEqual(await situacao(), [["bloqueado", "orcamento_nao_configurado"]]);
});

test("sandbox e simulado não exigem orçamento e não consomem o orçamento real", async () => {
  const p = await produtor();
  await enfileirarSms(p.id);
  await banco.processar({
    config: banco.configuracao({ SMS_COST_PER_SEGMENT: "", SMS_MONTHLY_BUDGET: "" }),
    sms: banco.provedorFalso({ nome: "smsgo", modo: "sandbox" }),
  });
  assert.deepEqual(await situacao(), [["enviado", null]]);

  // O SMS do sandbox não conta para o limite do modo real.
  await enfileirarSms(p.id);
  await banco.processar({ config: banco.configuracao({ SMS_PER_USER_DAILY_LIMIT: "1" }) });
  assert.deepEqual((await situacao())[1], ["enviado", null]);
});

test("mensagem acima do máximo de segmentos é bloqueada", async () => {
  await enfileirarSms((await produtor()).id, "a".repeat(200));
  await banco.processar();
  assert.deepEqual(await situacao(), [["bloqueado", "mensagem_longa"]]);
});

test("SMS recusado pelo provedor não consome limite", async () => {
  const p = await produtor();
  await enfileirarSms(p.id);
  await enfileirarSms(p.id);
  const recusa = new ErroProvedor({ provedor: "smsgo", codigo: "requisicao_invalida", mensagem: "SMSGo: 422", temporario: false });
  await banco.processar({
    config: banco.configuracao({ SMS_PER_USER_DAILY_LIMIT: "1" }),
    sms: banco.provedorFalso({ nome: "smsgo", roteiro: [recusa] }),
  });
  assert.deepEqual(await situacao(), [["falhou", "requisicao_invalida"], ["enviado", null]]);
});

test("reservas simultâneas não ultrapassam o limite juntas (advisory lock)", async () => {
  const ids = [await enfileirarSms((await produtor()).id), await enfileirarSms((await produtor()).id)];
  await banco.pool.query("UPDATE notificacao_envios SET status = 'processando'");
  const linhas = (await banco.listarEnvios()).filter((e) => ids.includes(e.id));
  const limites = banco.configuracao({ SMS_DAILY_LIMIT: "1" }).sms;
  const resultados = await Promise.all(linhas.map((envio) => reservarSms(envio, "real", limites)));
  assert.deepEqual(resultados.map((r) => r.ok).sort(), [false, true]);
  assert.equal(resultados.find((r) => !r.ok).codigo, "limite_diario");
});
