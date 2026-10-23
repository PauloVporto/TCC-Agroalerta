const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  emailValido,
  normalizarTelefone,
  ehCelular,
  formatarTelefone,
  mascararTelefone,
  mascararEmail,
  numeroParaWhatsapp,
  digitosDoWhatsapp,
  telefoneDoWhatsapp,
  remetenteCorresponde,
} = require("../services/contato");

test("normalizarTelefone aceita os formatos que o produtor costuma digitar", () => {
  for (const digitado of ["(35) 99999-0000", "35999990000", "+55 35 99999-0000", "5535999990000", "0055 35 99999 0000", "035 99999-0000"]) {
    assert.equal(normalizarTelefone(digitado), "+5535999990000", digitado);
  }
});

test("normalizarTelefone aceita fixo com 8 dígitos e o DDD 55 sem confundir com o código do país", () => {
  assert.equal(normalizarTelefone("(35) 3471-0000"), "+553534710000");
  assert.equal(normalizarTelefone("(55) 99999-0000"), "+5555999990000");
  assert.equal(normalizarTelefone("+55 55 99999-0000"), "+5555999990000");
});

test("normalizarTelefone recusa número incompleto, DDD inexistente e assinante inválido", () => {
  for (const invalido of ["", null, undefined, "9999-0000", "(20) 99999-0000", "(35) 89999-0000", "(35) 1471-0000", "35999990000123", "abc"]) {
    assert.equal(normalizarTelefone(invalido), null, String(invalido));
  }
});

test("ehCelular distingue celular de fixo", () => {
  assert.equal(ehCelular("(35) 99999-0000"), true);
  assert.equal(ehCelular("+5535999990000"), true);
  assert.equal(ehCelular("(35) 3471-0000"), false);
  assert.equal(ehCelular(null), false);
});

test("formatarTelefone mostra o número no padrão brasileiro e mantém o que não reconhece", () => {
  assert.equal(formatarTelefone("+5535999990000"), "(35) 99999-0000");
  assert.equal(formatarTelefone("+553534710000"), "(35) 3471-0000");
  assert.equal(formatarTelefone("123"), "123");
  assert.equal(formatarTelefone(null), "");
});

test("mascararTelefone e mascararEmail escondem o contato nos logs", () => {
  assert.equal(mascararTelefone("+5535999990000"), "(35) 9****-0000");
  assert.equal(mascararTelefone("(35) 3471-0000"), "(35) 3****-0000");
  assert.equal(mascararTelefone("número qualquer"), "***");
  assert.equal(mascararEmail("produtor@fazenda.com.br"), "pr***@fazenda.com.br");
  assert.equal(mascararEmail("sem-arroba"), "***");
});

test("emailValido segue a mesma regra do formulário de cadastro", () => {
  assert.equal(emailValido("produtor@fazenda.com.br"), true);
  assert.equal(emailValido("  produtor@fazenda.com.br "), true);
  for (const invalido of ["", "produtor", "produtor@", "produtor@fazenda", "pro dutor@fazenda.com", null]) {
    assert.equal(emailValido(invalido), false, String(invalido));
  }
});

test("numeroParaWhatsapp devolve os dígitos com DDI que a Evolution API espera", () => {
  assert.equal(numeroParaWhatsapp("(35) 99999-3362"), "5535999993362");
  assert.equal(numeroParaWhatsapp("+5535999993362"), "5535999993362");
  assert.equal(numeroParaWhatsapp("123"), null);
});

test("digitosDoWhatsapp e telefoneDoWhatsapp leem o JID, com ou sem o nono dígito", () => {
  assert.equal(digitosDoWhatsapp("553599999503:12@s.whatsapp.net"), "553599999503");
  assert.equal(digitosDoWhatsapp(null), "");
  // O WhatsApp costuma identificar celulares brasileiros sem o nono dígito.
  assert.equal(telefoneDoWhatsapp("553599999503@s.whatsapp.net"), "+5535999999503");
  assert.equal(telefoneDoWhatsapp("5535999999503@s.whatsapp.net"), "+5535999999503");
  assert.equal(telefoneDoWhatsapp("553534719503@s.whatsapp.net"), "+553534719503", "fixo fica como está");
  assert.equal(telefoneDoWhatsapp("123@lid"), null);
});

test("remetenteCorresponde compara pelo final ou pelo número completo, com ou sem o nono dígito", () => {
  const conectado = "553599999503@s.whatsapp.net";
  assert.equal(remetenteCorresponde(conectado, "9503"), true);
  assert.equal(remetenteCorresponde(conectado, "3362"), false);
  assert.equal(remetenteCorresponde(conectado, "5535999999503"), true);
  assert.equal(remetenteCorresponde("5535999999503@s.whatsapp.net", "(35) 99999-9503"), true);
  assert.equal(remetenteCorresponde(conectado, "5531999999503"), false, "mesmo final, outro DDD");
  assert.equal(remetenteCorresponde(conectado, ""), false, "sem remetente esperado, nada confere");
  assert.equal(remetenteCorresponde(null, "9503"), false);
});
