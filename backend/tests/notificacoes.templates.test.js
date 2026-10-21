const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  emailBoasVindas,
  smsBoasVindas,
  emailAlerta,
  smsAlerta,
  emailTeste,
  smsTeste,
} = require("../services/notificacoes/templates");
const { contarSegmentos, contarUnidades } = require("../services/notificacoes/textoSms");

const ALERTA = {
  nome: "Marina Rezende",
  titulo: "Risco de geada",
  nivel: "alto",
  mensagem: "Temperatura mínima prevista de 1.5°C. Risco alto de geada, que pode causar perda severa em lavouras de café.",
  recomendacao: "Considere métodos de proteção contra geada (irrigação por aspersão, cobertura) nas próximas noites.",
  regiao: "Lavras - MG",
  janela: "21/10 a 22/10",
  talhoes: ["Talhão da encosta"],
  clima: {
    temperaturaMinima: 1.5,
    chuvaAcumulada7dias: 12.4,
    diasSemChuva: 4,
    probabilidadeChuva7dias: 35,
    ventoMaximoKmh: 22,
  },
  consultadoEm: new Date("2026-10-20T12:30:00Z"),
};

test("e-mail de boas-vindas traz o assunto e o texto definidos para o cadastro", () => {
  const email = emailBoasVindas({ nome: "Marina Rezende" });
  assert.equal(email.assunto, "Bem-vindo ao Agro Alerta!");
  for (const trecho of [
    "Olá, Marina Rezende!",
    "Seu cadastro no Agro Alerta foi realizado com sucesso.",
    "Agora você poderá receber notificações sobre riscos climáticos na região da sua propriedade.",
    "O Agro Alerta monitora as condições meteorológicas para ajudar você a acompanhar possíveis riscos para sua produção.",
    "Agro Alerta — Monitoramento climático inteligente.",
  ]) {
    assert.ok(email.texto.includes(trecho), trecho);
    assert.ok(email.html.includes(trecho), trecho);
  }
  assert.match(email.html, /<meta name="viewport"/);
});

test("o nome do produtor é escapado no HTML", () => {
  const email = emailBoasVindas({ nome: '<script>alert("x")</script>' });
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
});

test("SMS de boas-vindas é o texto combinado e cabe em um segmento", () => {
  assert.equal(
    smsBoasVindas(),
    "Agro Alerta: Cadastro realizado com sucesso! Voce recebera alertas climaticos conforme suas preferencias."
  );
  assert.equal(contarSegmentos(smsBoasVindas()), 1);
});

test("e-mail de alerta traz risco, região, período, dados, gravidade, recomendações e identificação", () => {
  const email = emailAlerta(ALERTA);
  assert.equal(email.assunto, "Alerta alto: Risco de geada em Lavras - MG");
  for (const trecho of [
    "Olá, Marina Rezende",
    "Risco de geada",
    "Lavras - MG",
    "Talhão da encosta",
    "21/10 a 22/10",
    "1,5 °C",
    "12,4 mm",
    "35%",
    "22 km/h",
    "Considere métodos de proteção contra geada",
    "Open-Meteo",
    "20/10/2026",
    "Agro Alerta — Monitoramento climático inteligente.",
  ]) {
    assert.ok(email.texto.includes(trecho), "texto: " + trecho);
    assert.ok(email.html.includes(trecho), "html: " + trecho);
  }
  assert.ok(email.html.includes("nível Alto"));
});

test("e-mail de alerta com vários talhões usa o plural; nível desconhecido vira médio", () => {
  const email = emailAlerta({ ...ALERTA, nivel: "outro", talhoes: ["T1", "T2"] });
  assert.ok(email.texto.includes("os seus talhões"));
  assert.ok(email.texto.includes("Talhões: T1, T2"));
  assert.equal(email.assunto, "Alerta médio: Risco de geada em Lavras - MG");
});

test("SMS de alerta segue o modelo, sem acentos, em um segmento", () => {
  const sms = smsAlerta(ALERTA);
  assert.equal(
    sms,
    "Agro Alerta: Alerta de geada (risco alto) em Lavras - MG. Periodo: 21/10 a 22/10. Acompanhe as condicoes climaticas."
  );
  assert.equal(contarSegmentos(sms), 1);
  assert.match(smsAlerta({ ...ALERTA, titulo: "Excesso de chuva", nivel: "medio" }), /Alerta de excesso de chuva \(risco medio\)/);
});

test("SMS de alerta com região longa perde o fecho e encurta a região para caber", () => {
  const regiaoMedia = "Santa Rita do Sapucaí - MG, São Sebastião da Bela Vista - MG";
  const semFecho = smsAlerta({ ...ALERTA, regiao: regiaoMedia });
  assert.ok(!semFecho.includes("Acompanhe"));
  assert.ok(semFecho.includes("Sao Sebastiao da Bela Vista - MG"));
  assert.ok(contarUnidades(semFecho) <= 160);

  const regiaoLonga = "Cidade com um nome realmente comprido - MG, ".repeat(5);
  const cortado = smsAlerta({ ...ALERTA, regiao: regiaoLonga });
  assert.ok(contarUnidades(cortado) <= 160);
  assert.ok(cortado.includes("Periodo: 21/10 a 22/10."));

  const emDoisSegmentos = smsAlerta({ ...ALERTA, regiao: regiaoMedia }, 2);
  assert.ok(emDoisSegmentos.includes("Acompanhe"));
  assert.equal(contarSegmentos(emDoisSegmentos), 2);
});

test("mensagens de teste manual se identificam como teste", () => {
  const email = emailTeste();
  assert.equal(email.assunto, "Agro Alerta: teste de envio de e-mail");
  assert.ok(email.html.includes("Mensagem de teste enviada manualmente"));
  assert.ok(!email.html.includes("autorizou notificações"));
  assert.equal(contarSegmentos(smsTeste()), 1);
});
