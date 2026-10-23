const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { reterPendenciasAnteriores } = require("../../services/notificacoes/ativacao");
const { enfileirar, cancelarPendentesDoProdutor } = require("../../services/notificacoes/fila");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

async function cenario() {
  const admin = await banco.criarProdutor({ email: "admin@example.test", papel: "admin" });
  const produtor = await banco.criarProdutor({ email: "produtor@example.test", telefone: "+5535999993362", consentimentos: { whatsapp: true } });
  const adicionar = (chave) => enfileirar(banco.pool, { usuarioId: produtor.id, canal: "whatsapp", tipo: "boas_vindas",
    chaveIdempotencia: chave, destino: produtor.telefone, conteudo: chave, resumo: chave, maxTentativas: 5 });
  return { admin, produtor, adicionar };
}

test("ativação retém mensagens antigas e libera somente novas, sem confirmação manual", async () => {
  const { admin, adicionar } = await cenario();
  const antiga = await adicionar("antiga");
  assert.deepEqual(await reterPendenciasAnteriores(admin.id), [antiga]);
  // A retenção também impede expiração silenciosa de pendências históricas.
  await banco.pool.query("UPDATE notificacao_envios SET expira_em=NOW()-INTERVAL '1 day' WHERE id=$1", [antiga]);
  await adicionar("nova");
  const provedor = banco.provedorFalso({ nome: "evolution", reenvioSeguro: false });
  await banco.processar({ whatsapp: provedor });
  const [retida, nova] = await banco.listarEnvios();
  assert.equal(retida.status, "pendente");
  assert.equal(retida.tentativas, 0);
  assert.ok(retida.retido_em);
  assert.equal(nova.status, "enviado");
  assert.equal(provedor.enviados.length, 1);
  await banco.processar({ whatsapp: provedor });
  assert.equal(provedor.enviados.length, 1, "não duplica nem envia a pendência antiga");
});

test("retenção exige administrador e bloqueio; falha não altera a fila", async () => {
  const { admin, produtor, adicionar } = await cenario();
  await adicionar("antiga");
  await assert.rejects(reterPendenciasAnteriores(produtor.id), /administrador/);
  await banco.definirControle();
  await assert.rejects(reterPendenciasAnteriores(admin.id), /Bloqueie/);
  assert.equal((await banco.listarEnvios())[0].retido_em, null);
});

test("retenção preserva cancelamento por revogação de consentimento", async () => {
  const { admin, produtor, adicionar } = await cenario();
  await adicionar("antiga");
  await reterPendenciasAnteriores(admin.id);
  await cancelarPendentesDoProdutor(banco.pool, produtor.id, "whatsapp", "Consentimento revogado");
  assert.equal((await banco.listarEnvios())[0].status, "cancelado");
});
