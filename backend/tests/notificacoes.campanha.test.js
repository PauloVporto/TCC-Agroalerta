const { test } = require("node:test");
const assert = require("node:assert/strict");
const { elegiveis, agruparNumeros, MENSAGEM, validarRemetente } = require("../scripts/campanha-whatsapp");

test("campanha exige o remetente completo configurado, terminado em 9503", () => {
  assert.doesNotThrow(() => validarRemetente("5535999999503", "+5535999999503"));
  assert.throws(() => validarRemetente("9503", "+5535999999503"), /número completo/);
  assert.throws(() => validarRemetente("5535999991111", "+5535999991111"), /9503/);
  assert.throws(() => validarRemetente("5535999999503", "+5511999999503"), /diferente/);
});

test("campanha seleciona consentimento vigente e deduplica pelo telefone normalizado", () => {
  const telefone = "+5535999993362";
  const rows = [
    { id: 1, telefone, destino: telefone, concedido: true },
    { id: 2, telefone: "(35) 99999-3362", destino: telefone, concedido: true },
    { id: 3, telefone, destino: telefone, concedido: false },
    { id: 4, telefone, destino: "+5535999990000", concedido: true },
    { id: 5, telefone, destino: null, concedido: null },
  ];
  assert.equal(elegiveis(rows).length, 2);
  assert.deepEqual([...agruparNumeros(rows)], [[telefone, [1, 2]]]);
});
test("campanha usa o texto autorizado sem afirmar risco climático real", () => {
  assert.equal(MENSAGEM, "🌱 Agro Alerta — Teste de Notificações\n\nOlá! Estamos realizando um teste do sistema Agro Alerta.\n\nSeu WhatsApp está cadastrado para receber notificações autorizadas sobre as condições climáticas e riscos de geada na sua propriedade.\n\nEsta é apenas uma mensagem de teste. Não representa um alerta climático real.");
});
