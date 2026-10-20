const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { iniciarNotificacoes, pararNotificacoes, registrarEscolhasDoCadastro } = require("../../services/notificacoes");
const { enfileirar, acordarFila } = require("../../services/notificacoes/fila");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

// Espera de verdade (sem depender de setTimeout, que um dos testes simula).
async function aguardar(condicao, limiteMs = 5000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (await condicao()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

const SEM_MONITORAMENTO = { WEATHER_MONITOR_ENABLED: "false" };

test("a fila sobe com o backend e processa o cadastro sozinha, sem comando manual", async () => {
  const logs = [];
  const modos = iniciarNotificacoes({ config: banco.configuracao(SEM_MONITORAMENTO), log: (linha) => logs.push(linha) });
  assert.deepEqual(modos, { email: "simulado", sms: "simulado" });
  try {
    const produtor = await banco.criarProdutor({ nome: "Ana", email: "ana@fazenda.com.br", telefone: "+5535999990001" });
    await registrarEscolhasDoCadastro(produtor, { email: true, sms: true });
    // O log sai depois de gravar o status: esperar por ele garante que os dois envios terminaram.
    const smsLogado = await aguardar(async () => logs.some((linha) => /envio \d+ \(sms, boas_vindas\) → \(35\) 9\*\*\*\*-0001: simulado/.test(linha)));
    assert.equal(smsLogado, true);
    assert.deepEqual((await banco.listarEnvios()).map((e) => [e.canal, e.status]), [["email", "simulado"], ["sms", "simulado"]]);
  } finally {
    await pararNotificacoes();
  }
});

test("depois de reiniciar, o que ficou pendente é enviado na primeira rodada", async () => {
  const produtor = await banco.criarProdutor({ email: "b@fazenda.com.br", consentimentos: { email: true } });
  await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "email", tipo: "boas_vindas", chaveIdempotencia: "pendente-antes-do-reinicio",
    destino: produtor.email, conteudo: "x", resumo: "Boas-vindas", maxTentativas: 5,
  });
  iniciarNotificacoes({ config: banco.configuracao(SEM_MONITORAMENTO), log: () => {} });
  iniciarNotificacoes({ config: banco.configuracao(SEM_MONITORAMENTO), log: () => {} }); // segunda chamada não duplica nada
  try {
    assert.equal(await aguardar(async () => (await banco.listarEnvios())[0].status === "simulado"), true);
  } finally {
    await pararNotificacoes();
  }
});

test("pedidos para processar durante uma rodada geram mais uma rodada; erro na fila é registrado", async (t) => {
  iniciarNotificacoes({ config: banco.configuracao(SEM_MONITORAMENTO), log: () => {} });
  acordarFila();
  acordarFila();
  await pararNotificacoes();

  const erros = [];
  t.mock.method(console, "error", (...partes) => erros.push(partes.join(" ")));
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/SET status = 'processando'/.test(sql)) throw new Error("banco fora do ar");
    return consultaOriginal(sql, params);
  });
  iniciarNotificacoes({ config: banco.configuracao(SEM_MONITORAMENTO), log: () => {} });
  await pararNotificacoes();
  assert.ok(erros.some((linha) => /falha ao processar a fila: banco fora do ar/.test(linha)));
});

test("monitoramento e consulta de entregas rodam sozinhos nos intervalos configurados", async (t) => {
  // Um envio aceito, para observar a consulta periódica de entrega.
  const produtor = await banco.criarProdutor({ email: "c@fazenda.com.br", consentimentos: { email: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "email", tipo: "boas_vindas", chaveIdempotencia: "aceito",
    destino: produtor.email, conteudo: "x", resumo: "Boas-vindas", maxTentativas: 5,
  });
  await banco.pool.query(
    "UPDATE notificacao_envios SET status = 'enviado', provedor = 'resend', provedor_id = 'email-1', modo = 'real', enviado_em = NOW() WHERE id = $1",
    [id]
  );

  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const logs = [];
  iniciarNotificacoes({ config: banco.configuracao({ WEATHER_MONITOR_INTERVAL_MINUTES: "60" }), log: (linha) => logs.push(linha) });
  t.mock.timers.tick(60 * 1000); // primeiro ciclo do monitoramento
  t.mock.timers.tick(4 * 60 * 1000); // 5 min: consulta de entregas
  try {
    assert.equal(await aguardar(async () => logs.some((linha) => linha.startsWith("[monitoramento] ciclo concluído"))), true);
    assert.equal(
      await aguardar(async () => {
        const { rows } = await banco.pool.query("SELECT status_consultado_em FROM notificacao_envios WHERE id = $1", [id]);
        return rows[0].status_consultado_em !== null;
      }),
      true
    );
  } finally {
    await pararNotificacoes();
  }

  // Falhas nos processos periódicos são registradas e não derrubam o backend.
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/FROM talhoes t|SET status_consultado_em/.test(sql)) throw new Error("banco fora do ar");
    return consultaOriginal(sql, params);
  });
  const falhas = [];
  iniciarNotificacoes({ config: banco.configuracao(), log: (linha) => falhas.push(linha) });
  t.mock.timers.tick(5 * 60 * 1000);
  t.mock.timers.tick(60 * 60 * 1000); // intervalo seguinte do monitoramento, com o ciclo anterior ainda em andamento ou já falho
  try {
    assert.equal(await aguardar(async () => falhas.some((linha) => linha === "[monitoramento] falha no ciclo: banco fora do ar")), true);
    assert.equal(await aguardar(async () => falhas.some((linha) => linha === "[notificacoes] falha na consulta de entregas: banco fora do ar")), true);
  } finally {
    await pararNotificacoes();
  }
});

test("avisos de configuração aparecem no log ao iniciar", async () => {
  const logs = [];
  const modos = iniciarNotificacoes({
    config: banco.configuracao({ ...SEM_MONITORAMENTO, EMAIL_SENDING_ENABLED: "true", SMS_SENDING_ENABLED: "true" }),
    log: (linha) => logs.push(linha),
  });
  await pararNotificacoes();
  assert.deepEqual(modos, { email: "real", sms: "sandbox" });
  assert.ok(logs.some((linha) => linha === "[notificacoes] atenção: EMAIL_SENDING_ENABLED=true, mas RESEND_API_KEY está vazia."));
});
