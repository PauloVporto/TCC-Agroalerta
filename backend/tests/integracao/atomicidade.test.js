const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { atualizarNotificacoes } = require("../../services/notificacoes/consentimentos");
const { registrarEscolhasDoCadastro } = require("../../services/notificacoes");
const { reservarSms } = require("../../services/notificacoes/limitesSms");
const { enfileirar, processarFila } = require("../../services/notificacoes/fila");
const { criarUsuario, atualizarPerfil } = require("../../services/auth");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

async function contar(tabela) {
  const { rows } = await banco.pool.query(`SELECT COUNT(*)::int AS total FROM ${tabela}`);
  return rows[0].total;
}

test("escolhas do painel são atômicas: erro no meio não deixa consentimento pela metade", async () => {
  const p = await banco.criarProdutor({ email: "a@fazenda.com.br", telefone: "+5535999990001" });
  await assert.rejects(
    atualizarNotificacoes(p.id, {
      email: { consentido: true, nivelMinimo: "medio" },
      sms: { consentido: true, nivelMinimo: "baixo" }, // viola o CHECK da tabela de preferências
    }),
    /violates check constraint/
  );
  assert.equal(await contar("notificacao_consentimentos"), 0);
});

test("escolhas do cadastro são atômicas: sem produtor válido, nem consentimento nem boas-vindas", async () => {
  await assert.rejects(
    registrarEscolhasDoCadastro({ id: 999999, nome: "Fantasma", email: "x@fazenda.com.br", telefone: null }, { email: true, sms: false }),
    /violates foreign key constraint/
  );
  assert.deepEqual([await contar("notificacao_consentimentos"), await contar("notificacao_envios")], [0, 0]);
});

test("reserva de SMS desfaz a transação quando o banco recusa a consulta", async () => {
  const limites = banco.configuracao().sms;
  await assert.rejects(reservarSms({ id: "não-numérico", usuario_id: null, conteudo: "a" }, "simulado", limites), /invalid input syntax/);
  // A trava do orçamento foi liberada: uma nova reserva funciona normalmente.
  const p = await banco.criarProdutor({ email: "b@fazenda.com.br", telefone: "+5535999990002", consentimentos: { sms: true } });
  const id = await enfileirar(banco.pool, {
    usuarioId: p.id, canal: "sms", tipo: "alerta_climatico", chaveIdempotencia: "s1",
    destino: p.telefone, conteudo: "a", resumo: "r", maxTentativas: 5,
  });
  const [envio] = (await banco.listarEnvios()).filter((e) => e.id === id);
  assert.equal((await reservarSms(envio, "simulado", limites)).ok, true);
});

test("erro inesperado num envio não interrompe o lote; a trava devolve o envio à fila depois", async (t) => {
  const ana = await banco.criarProdutor({ email: "ana@fazenda.com.br", consentimentos: { email: true } });
  const bia = await banco.criarProdutor({ email: "bia@fazenda.com.br", consentimentos: { email: true } });
  for (const [p, chave] of [[ana, "e1"], [bia, "e2"]]) {
    await enfileirar(banco.pool, { usuarioId: p.id, canal: "email", tipo: "boas_vindas", chaveIdempotencia: chave, destino: p.email, conteudo: "x", resumo: "r", maxTentativas: 5 });
  }
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/FROM usuarios u WHERE u.id/.test(sql) && params[0] === ana.id) throw new Error("conexão perdida");
    return consultaOriginal(sql, params);
  });
  const logs = [];
  const email = banco.provedorFalso({ nome: "resend" });
  await processarFila({ config: banco.configuracao(), provedores: { email, sms: banco.provedorFalso() }, log: (l) => logs.push(l) });

  assert.deepEqual(email.enviados.map((m) => m.destino), ["bia@fazenda.com.br"]);
  assert.match(logs[0], /erro inesperado no envio 1: conexão perdida/);
  const [preso] = await banco.listarEnvios();
  assert.equal(preso.status, "processando");
  assert.ok(new Date(preso.processando_ate) > new Date());
});

test("erros do banco que não são de e-mail duplicado chegam intactos a quem chamou", async () => {
  await assert.rejects(criarUsuario({ nome: null, email: "c@fazenda.com.br", senha: "segredo1" }), /null value in column "nome"/);
  const p = await banco.criarProdutor({ email: "d@fazenda.com.br" });
  await assert.rejects(atualizarPerfil(p.id, { nome: null, email: "d@fazenda.com.br", telefone: null }), /null value in column "nome"/);
});
