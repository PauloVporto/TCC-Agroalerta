const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("stream");
const { argumento, temOpcao, confirmar, acompanharEntrega } = require("../scripts/comum");
const { esperaAntesDaProxima } = require("../services/notificacoes/fila");

const argvOriginal = process.argv;
afterEach(() => {
  process.argv = argvOriginal;
});

test("argumento e temOpcao leem a linha de comando dos scripts", () => {
  process.argv = ["node", "testar-sms.js", "--para", "(35) 99999-0000", "--sandbox"];
  assert.equal(argumento("para"), "(35) 99999-0000");
  assert.equal(argumento("ausente"), undefined);
  assert.equal(temOpcao("sandbox"), true);
  assert.equal(temOpcao("confirmar"), false);
});

function responder(texto) {
  const entrada = new PassThrough();
  const saida = new PassThrough();
  const resultado = confirmar("Digite ENVIAR: ", { entrada, saida });
  if (texto === null) entrada.end();
  else entrada.write(texto);
  return resultado;
}

test("confirmar só aceita ENVIAR; outra resposta ou fim da entrada cancela", async () => {
  assert.equal(await responder("ENVIAR\n"), true);
  assert.equal(await responder("  ENVIAR  \n"), true);
  assert.equal(await responder("sim\n"), false);
  assert.equal(await responder("enviar\n"), false);
  assert.equal(await responder(null), false);
});

test("acompanharEntrega consulta até haver confirmação ou esgotar as tentativas", async () => {
  const respostas = [{ status: null, detalhe: "em andamento" }, new Error("instável"), { status: "entregue", detalhe: "ok" }];
  let chamadas = 0;
  const resultado = await acompanharEntrega(
    async () => {
      const proxima = respostas[chamadas++];
      if (proxima instanceof Error) throw proxima;
      return proxima;
    },
    { tentativas: 5, intervaloMs: 1 }
  );
  assert.deepEqual(resultado, { status: "entregue", detalhe: "ok" });
  assert.equal(chamadas, 3);

  const semConfirmacao = await acompanharEntrega(async () => ({ status: null, detalhe: "em andamento" }), { tentativas: 2, intervaloMs: 1 });
  assert.deepEqual(semConfirmacao, { status: null, detalhe: "em andamento" });
});

test("a fila espera 1, 5, 15 e 60 minutos entre tentativas e respeita o Retry-After do provedor", () => {
  const minutos = (ms) => ms / 60000;
  assert.deepEqual([1, 2, 3, 4, 9].map((t) => minutos(esperaAntesDaProxima(t))), [1, 5, 15, 60, 60]);
  assert.equal(minutos(esperaAntesDaProxima(1, 600)), 10);
  assert.equal(minutos(esperaAntesDaProxima(2, 30)), 5);
});
