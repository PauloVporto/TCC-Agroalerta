const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { registrarEscolhasDoCadastro, salvarEscolhasDoPainel } = require("../../services/notificacoes");
const { atualizarControle, lerControle } = require("../../services/notificacoes/controle");
const { enfileirar, processarFila } = require("../../services/notificacoes/fila");
const { criarUsuario, atualizarPerfil } = require("../../services/auth");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

async function contar(tabela) {
  const { rows } = await banco.pool.query(`SELECT COUNT(*)::int AS total FROM ${tabela}`);
  return rows[0].total;
}

test("escolhas do painel são atômicas: erro no meio não deixa consentimento nem boas-vindas pela metade", async () => {
  const p = await banco.criarProdutor({ email: "a@fazenda.com.br", telefone: "+5535999993362" });
  await assert.rejects(
    salvarEscolhasDoPainel(p.id, {
      email: { consentido: true, nivelMinimo: "medio" },
      whatsapp: { consentido: true, nivelMinimo: "baixo" }, // viola o CHECK da tabela de preferências
    }),
    /violates check constraint/
  );
  assert.deepEqual([await contar("notificacao_consentimentos"), await contar("notificacao_envios")], [0, 0]);
});

test("escolhas do cadastro são atômicas: sem produtor válido, nem consentimento nem boas-vindas", async () => {
  await assert.rejects(
    registrarEscolhasDoCadastro({ id: 999999, nome: "Fantasma", email: "x@fazenda.com.br", telefone: "+5535999993362" }, { email: true, whatsapp: true }),
    /violates foreign key constraint/
  );
  assert.deepEqual([await contar("notificacao_consentimentos"), await contar("notificacao_envios")], [0, 0]);
});

test("controles do administrador são atômicos: falha no meio não muda nada nem deixa auditoria", async () => {
  // Falha de verdade no banco, na segunda alteração da transação (depois da primeira já gravada).
  await banco.pool.query(`
    CREATE FUNCTION falhar_boas_vindas() RETURNS trigger AS $$
    BEGIN
      IF NEW.boas_vindas_ativas IS DISTINCT FROM OLD.boas_vindas_ativas THEN RAISE EXCEPTION 'conexão perdida'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER falhar_boas_vindas BEFORE UPDATE ON whatsapp_controle FOR EACH ROW EXECUTE FUNCTION falhar_boas_vindas();
  `);
  try {
    await assert.rejects(atualizarControle({ enviosBloqueados: false, boasVindasAtivas: true }, null), /conexão perdida/);
  } finally {
    await banco.pool.query("DROP TRIGGER falhar_boas_vindas ON whatsapp_controle; DROP FUNCTION falhar_boas_vindas();");
  }
  assert.equal((await lerControle()).enviosBloqueados, true, "a primeira alteração também foi desfeita");
  assert.equal(await contar("administracao_eventos"), 0);
});

test("erro inesperado num envio não interrompe o lote; a trava devolve o envio à fila depois", async (t) => {
  const ana = await banco.criarProdutor({ email: "ana@fazenda.com.br", consentimentos: { email: true } });
  const bia = await banco.criarProdutor({ email: "bia@fazenda.com.br", consentimentos: { email: true } });
  for (const [p, chave] of [[ana, "e1"], [bia, "e2"]]) {
    await enfileirar(banco.pool, { usuarioId: p.id, canal: "email", tipo: "boas_vindas", chaveIdempotencia: chave, destino: p.email, conteudo: "x", resumo: "r", maxTentativas: 5 });
  }
  const consultaOriginal = banco.pool.query.bind(banco.pool);
  t.mock.method(banco.pool, "query", async (sql, params) => {
    if (/LEFT JOIN LATERAL/.test(sql) && params[0] === ana.id) throw new Error("conexão perdida");
    return consultaOriginal(sql, params);
  });
  const logs = [];
  const email = banco.provedorFalso({ nome: "resend" });
  await processarFila({ config: banco.configuracao(), provedores: { email }, log: (l) => logs.push(l) });

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
