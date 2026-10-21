const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { iniciarNotificacoes, pararNotificacoes, registrarEscolhasDoCadastro } = require("../../services/notificacoes");
const { enfileirar, acordarFila } = require("../../services/notificacoes/fila");
const resend = require("../../services/notificacoes/provedores/resend");

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

const EMAIL_REAL = { EMAIL_SENDING_ENABLED: "true", RESEND_API_KEY: "re_teste", EMAIL_FROM: "Agro Alerta <alertas@agroalerta.com.br>" };

test("a fila sobe com o backend e processa o cadastro sozinha; o WhatsApp fica retido até a liberação", async () => {
  const logs = [];
  const modos = iniciarNotificacoes({ config: banco.configuracao(), log: (linha) => logs.push(linha) });
  assert.deepEqual(modos, { email: "simulado", whatsapp: "desativado", monitoramento: "desligado" });
  try {
    const produtor = await banco.criarProdutor({ nome: "Ana", email: "ana@fazenda.com.br", telefone: "+5535999993362" });
    await registrarEscolhasDoCadastro(produtor, { email: true, whatsapp: true });
    // O log sai depois de gravar o status: esperar por ele garante que a rodada passou pelos dois canais.
    assert.equal(await aguardar(async () => logs.some((linha) => /envio \d+ \(email, boas_vindas\) → an\*\*\*@fazenda\.com\.br: simulado/.test(linha))), true);
    assert.equal(await aguardar(async () => logs.includes("[notificacoes] whatsapp retido: Envio real desativado na implantação (WHATSAPP_SENDING_ENABLED=false).")), true);
    assert.deepEqual((await banco.listarEnvios()).map((e) => [e.canal, e.status, e.tentativas]), [["email", "simulado", 1], ["whatsapp", "pendente", 0]]);
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
  iniciarNotificacoes({ config: banco.configuracao(), log: () => {} });
  iniciarNotificacoes({ config: banco.configuracao(), log: () => {} }); // segunda chamada não duplica nada
  try {
    assert.equal(await aguardar(async () => (await banco.listarEnvios())[0].status === "simulado"), true);
  } finally {
    await pararNotificacoes();
  }
});

test("pedidos para processar durante uma rodada geram mais uma rodada; erro na fila é registrado", async (t) => {
  iniciarNotificacoes({ config: banco.configuracao(), log: () => {} });
  acordarFila();
  acordarFila();
  await pararNotificacoes();

  const erros = [];
  t.mock.method(console, "error", (...partes) => erros.push(partes.join(" ")));
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/SET status = 'incerto'/.test(sql)) throw new Error("banco fora do ar");
    return consultaOriginal(sql, params);
  });
  iniciarNotificacoes({ config: banco.configuracao(), log: () => {} });
  await pararNotificacoes();
  assert.ok(erros.some((linha) => /falha ao processar a fila: banco fora do ar/.test(linha)));
});

test("monitoramento (quando autorizado) e consulta de entregas rodam sozinhos nos intervalos configurados", async (t) => {
  // Um e-mail aceito, para observar a consulta periódica de entrega.
  const produtor = await banco.criarProdutor({ email: "c@fazenda.com.br", consentimentos: { email: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: produtor.id, canal: "email", tipo: "boas_vindas", chaveIdempotencia: "aceito",
    destino: produtor.email, conteudo: "x", resumo: "Boas-vindas", maxTentativas: 5,
  });
  await banco.pool.query(
    "UPDATE notificacao_envios SET status = 'enviado', provedor = 'resend', provedor_id = 'email-1', modo = 'real', enviado_em = NOW() WHERE id = $1",
    [id]
  );
  t.mock.method(resend, "consultarEmail", async () => ({ ultimoEvento: "delivered" }));

  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const logs = [];
  const config = banco.configuracao({ ...EMAIL_REAL, WEATHER_MONITOR_ENABLED: "true", WEATHER_MONITOR_INTERVAL_MINUTES: "60" });
  assert.equal(iniciarNotificacoes({ config, log: (linha) => logs.push(linha) }).monitoramento, "ativo");
  t.mock.timers.tick(60 * 1000); // primeiro ciclo do monitoramento
  t.mock.timers.tick(4 * 60 * 1000); // 5 min: consulta de entregas
  try {
    assert.equal(await aguardar(async () => logs.some((linha) => linha.startsWith("[monitoramento] ciclo concluído"))), true);
    assert.equal(await aguardar(async () => (await banco.listarEnvios())[0].status === "entregue"), true);
  } finally {
    await pararNotificacoes();
  }

  // Falhas nos processos periódicos são registradas e não derrubam o backend.
  await banco.pool.query("UPDATE notificacao_envios SET status = 'enviado', status_consultado_em = NULL WHERE id = $1", [id]);
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/FROM talhoes t|SET status_consultado_em/.test(sql)) throw new Error("banco fora do ar");
    return consultaOriginal(sql, params);
  });
  const falhas = [];
  iniciarNotificacoes({ config, log: (linha) => falhas.push(linha) });
  t.mock.timers.tick(5 * 60 * 1000);
  t.mock.timers.tick(60 * 60 * 1000); // intervalo seguinte do monitoramento, com o ciclo anterior ainda em andamento ou já falho
  try {
    assert.equal(await aguardar(async () => falhas.some((linha) => linha === "[monitoramento] falha no ciclo: banco fora do ar")), true);
    assert.equal(await aguardar(async () => falhas.some((linha) => linha === "[notificacoes] falha na consulta de entregas: banco fora do ar")), true);
  } finally {
    await pararNotificacoes();
  }
});

test("sem autorização explícita, o monitoramento climático não roda", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const logs = [];
  iniciarNotificacoes({ config: banco.configuracao(), log: (linha) => logs.push(linha) });
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  await pararNotificacoes();
  assert.equal(logs.some((linha) => linha.startsWith("[monitoramento]")), false);
});

test("avisos de configuração aparecem no log ao iniciar", async () => {
  const logs = [];
  const modos = iniciarNotificacoes({
    config: banco.configuracao({ EMAIL_SENDING_ENABLED: "true", WHATSAPP_SENDING_ENABLED: "true" }),
    log: (linha) => logs.push(linha),
  });
  await pararNotificacoes();
  assert.deepEqual(modos, { email: "real", whatsapp: "nao_configurado", monitoramento: "desligado" });
  assert.ok(logs.includes("[notificacoes] atenção: EMAIL_SENDING_ENABLED=true, mas RESEND_API_KEY está vazia."));
  assert.ok(logs.includes("[notificacoes] atenção: WHATSAPP_SENDING_ENABLED=true, mas EVOLUTION_API_URL está vazia."));
});
