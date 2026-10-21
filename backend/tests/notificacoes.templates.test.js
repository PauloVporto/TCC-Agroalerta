const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  emailBoasVindas,
  emailAlerta,
  emailTeste,
  whatsappBoasVindas,
  whatsappAlertaGeada,
  whatsappTeste,
} = require("../services/notificacoes/templates");

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

test("mensagens de teste manual se identificam como teste", () => {
  const email = emailTeste();
  assert.equal(email.assunto, "Agro Alerta: teste de envio de e-mail");
  assert.ok(email.html.includes("Mensagem de teste enviada manualmente"));
  assert.ok(!email.html.includes("autorizou notificações"));
  assert.match(whatsappTeste(), /^Agro Alerta: mensagem de teste\./);
});

test("boas-vindas do WhatsApp têm exatamente o texto definido", () => {
  assert.equal(
    whatsappBoasVindas(),
    "🌱 Bem-vindo ao Agro Alerta!\n\n" +
      "Seu cadastro foi realizado com sucesso.\n\n" +
      "Você receberá notificações sobre possíveis riscos de geada na região da sua propriedade.\n\n" +
      "Acompanhe também as informações disponíveis no Agro Alerta.\n\n" +
      "Você pode cancelar as notificações nas preferências da sua conta."
  );
});

const GEADA = {
  propriedade: "Talhão da encosta",
  localizacao: "Lavras - MG",
  temperatura: 1.4,
  nivel: "alto",
  data: "2026-10-23",
  hora: "05:00",
  periodo: null,
};

test("alerta de geada do WhatsApp segue o modelo, com a hora prevista da mínima", () => {
  assert.equal(
    whatsappAlertaGeada(GEADA),
    "❄️ ALERTA DE GEADA — AGRO ALERTA\n\n" +
      "Propriedade: Talhão da encosta\n" +
      "Localização: Lavras - MG\n" +
      "Temperatura prevista: 1,4 °C\n" +
      "Nível de risco: Alto\n" +
      "Previsão: 23/10/2026, por volta das 05:00\n\n" +
      "Atenção: existe possibilidade de geada na região.\n\n" +
      "Consulte as informações detalhadas no Agro Alerta."
  );
});

test("sem hora prevista, o alerta diz que é a mínima do dia; risco de vários dias mostra o período", () => {
  const texto = whatsappAlertaGeada({ ...GEADA, nivel: "medio", temperatura: 4, hora: null, periodo: "23/10 a 24/10" });
  assert.ok(texto.includes("Temperatura prevista: 4,0 °C"));
  assert.ok(texto.includes("Nível de risco: Médio"));
  assert.ok(texto.includes("Previsão: 23/10/2026 (mínima prevista para o dia) — risco de 23/10 a 24/10"));
});
