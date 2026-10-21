const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { executarCiclo } = require("../../services/monitoramento");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

const LAVRAS = { regiao: "Lavras - MG", latitude: -21.245, longitude: -44.999 };
const VARGINHA = { regiao: "Varginha - MG", latitude: -21.551, longitude: -45.43 };

function dia(data, campos = {}) {
  return { data, tempMin: 12, tempMax: 27, horaMinima: "05:00", chuvaMm: 0, chuvaProbabilidade: 10, ventoMaxKmh: 14, ...campos };
}

function clima(campos = {}) {
  return {
    temperaturaMinima: 12,
    chuvaAcumulada7dias: 8,
    diasSemChuva: 3,
    probabilidadeChuva7dias: 10,
    ventoMaximoKmh: 14,
    evapotranspiracao7dias: 21,
    previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21"), dia("2026-10-22")],
    fonte: "open-meteo",
    ...campos,
  };
}

const NORMAL = clima();
const GEADA_FORTE = clima({
  temperaturaMinima: 1.2,
  previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21", { tempMin: 1.2, horaMinima: "05:00" }), dia("2026-10-22", { tempMin: 6 })],
});
const GEADA_MODERADA = clima({ temperaturaMinima: 4.1, previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21", { tempMin: 4.1 }), dia("2026-10-22")] });

const ALERTA_ANA =
  "❄️ ALERTA DE GEADA — AGRO ALERTA\n\n" +
  "Propriedade: Talhão da encosta\n" +
  "Localização: Lavras - MG\n" +
  "Temperatura prevista: 1,2 °C\n" +
  "Nível de risco: Alto\n" +
  "Previsão: 21/10/2026, por volta das 05:00\n\n" +
  "Atenção: existe possibilidade de geada na região.\n\n" +
  "Consulte as informações detalhadas no Agro Alerta.";

// Open-Meteo falso: responde conforme a latitude e anota quais locais foram consultados.
function openMeteo(porLatitude) {
  const consultas = [];
  const buscar = async (latitude) => {
    consultas.push(latitude);
    const resposta = porLatitude[latitude];
    if (resposta instanceof Error) throw resposta;
    return resposta || NORMAL;
  };
  return { buscar, consultas };
}

function ciclo(buscarClima, config = banco.configuracao()) {
  return executarCiclo({ config, buscarClima, log: () => {} });
}

async function cenarioDeDoisProdutores() {
  const ana = await banco.criarProdutor({ nome: "Ana", email: "ana@fazenda.com.br", telefone: "+5535999993362", consentimentos: { email: true, whatsapp: true } });
  const bruno = await banco.criarProdutor({ nome: "Bruno", email: "bruno@sitio.com.br", telefone: "+5535988880002", consentimentos: { email: true, whatsapp: true } });
  await banco.criarTalhaoDeTeste(ana.id, { nome: "Talhão da encosta", ...LAVRAS });
  await banco.criarTalhaoDeTeste(bruno.id, { nome: "Talhão do rio", ...VARGINHA });
  return { ana, bruno };
}

test("geada: o agricultor da região afetada recebe e-mail e WhatsApp; o de fora não recebe nada", async () => {
  const { ana } = await cenarioDeDoisProdutores();
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar);
  assert.deepEqual(resumo, { talhoes: 2, semDados: 0, alertasNovos: 1, enfileirados: 2 });

  const envios = await banco.listarEnvios();
  assert.deepEqual(envios.map((e) => [e.usuario_id, e.canal, e.tipo, e.nivel, e.regiao]), [
    [ana.id, "email", "alerta_climatico", "alto", "Lavras - MG"],
    [ana.id, "whatsapp", "alerta_climatico", "alto", "Lavras - MG"],
  ]);
  const { rows: alertas } = await banco.pool.query("SELECT id, regra_id, nivel, janela, regiao, leitura_id FROM alertas_gerados");
  assert.equal(alertas.length, 1);
  assert.deepEqual([alertas[0].regra_id, alertas[0].nivel, alertas[0].janela, alertas[0].regiao], ["cafe_geada", "alto", "21/10", "Lavras - MG"]);
  assert.ok(alertas[0].leitura_id);

  const [, whatsapp] = envios;
  assert.equal(whatsapp.conteudo, ALERTA_ANA);
  assert.deepEqual(
    [whatsapp.destino, whatsapp.chave_idempotencia, whatsapp.alerta_id, whatsapp.resumo],
    ["+5535999993362", `alerta:${alertas[0].id}:whatsapp`, alertas[0].id, "Risco de geada (risco alto) · Talhão da encosta"]
  );
  assert.equal(new Date(whatsapp.expira_em).toISOString(), new Date("2026-10-21T23:59:59-03:00").toISOString(), "vale até o fim do dia de risco");

  const email = banco.provedorFalso({ nome: "resend" });
  const zap = banco.provedorFalso({ nome: "evolution", reenvioSeguro: false });
  // A validade de 2026-10-21 já passou para quem roda o teste depois: o envio fica no futuro para testar o despacho.
  await banco.pool.query("UPDATE notificacao_envios SET expira_em = NOW() + INTERVAL '1 day' WHERE canal = 'whatsapp'");
  await banco.processar({ email, whatsapp: zap });
  assert.deepEqual(email.enviados.map((m) => m.destino), ["ana@fazenda.com.br"]);
  for (const trecho of ["Olá, Ana", "Talhão da encosta", "21/10", "1,2 °C", "Considere métodos de proteção contra geada"]) {
    assert.ok(email.enviados[0].html.includes(trecho), trecho);
  }
  assert.deepEqual(zap.enviados.map((m) => [m.destino, m.texto]), [["+5535999993362", ALERTA_ANA]]);
});

test("geada moderada também vai ao WhatsApp (gravidade padrão: médio e alto); 'somente alto' a ignora", async () => {
  await cenarioDeDoisProdutores();
  await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_MODERADA }).buscar);
  const envios = await banco.listarEnvios();
  assert.deepEqual(envios.map((e) => [e.canal, e.nivel]), [["email", "medio"], ["whatsapp", "medio"]]);
  assert.ok(envios[1].conteudo.includes("Nível de risco: Médio"));
  assert.ok(envios[1].conteudo.includes("Temperatura prevista: 4,1 °C"));

  await banco.limparBanco();
  const exigente = await banco.criarProdutor({
    email: "c@fazenda.com.br", telefone: "+5535977776666", consentimentos: { email: true, whatsapp: true },
    preferencias: { email: "alto", whatsapp: "alto" },
  });
  await banco.criarTalhaoDeTeste(exigente.id, LAVRAS);
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_MODERADA }).buscar);
  assert.deepEqual([resumo.alertasNovos, resumo.enfileirados], [1, 0], "o episódio fica registrado, sem mensagem");
});

test("risco que não é geada vai só por e-mail: o WhatsApp avisa só de geada", async () => {
  const p = await banco.criarProdutor({ email: "e@fazenda.com.br", telefone: "+5535999993362", consentimentos: { email: true, whatsapp: true } });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Florada", fase: "floracao", ...LAVRAS });
  await ciclo(openMeteo({ [LAVRAS.latitude]: clima({ diasSemChuva: 16 }) }).buscar);
  assert.deepEqual((await banco.listarEnvios()).map((e) => [e.canal, e.resumo]), [["email", "Risco de estiagem (risco alto) · Florada"]]);
});

test("o mesmo risco não é repetido a cada ciclo; o agravamento avisa de novo", async () => {
  await cenarioDeDoisProdutores();
  const moderada = openMeteo({ [LAVRAS.latitude]: GEADA_MODERADA }).buscar;
  await ciclo(moderada);
  const segundo = await ciclo(moderada);
  assert.deepEqual([segundo.alertasNovos, segundo.enfileirados], [0, 0]);
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS total, MAX(ultima_deteccao_em) > MIN(criado_em) AS atualizado FROM alertas_gerados");
  assert.deepEqual(rows[0], { total: 1, atualizado: true });

  const agravado = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar);
  assert.deepEqual([agravado.alertasNovos, agravado.enfileirados], [1, 2]);
  // Voltar ao nível médio, com o alto ainda ativo, não gera aviso.
  assert.equal((await ciclo(moderada)).enfileirados, 0);
  assert.deepEqual((await banco.listarEnvios()).map((e) => `${e.canal}:${e.nivel}`), ["email:medio", "whatsapp:medio", "email:alto", "whatsapp:alto"]);
});

test("risco que volta depois de 24 h sem ser detectado gera novo aviso", async () => {
  await cenarioDeDoisProdutores();
  const forte = openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar;
  await ciclo(forte);
  await banco.pool.query("UPDATE alertas_gerados SET ultima_deteccao_em = NOW() - INTERVAL '25 hours'");
  assert.equal((await ciclo(forte)).enfileirados, 2);
  assert.equal((await banco.listarEnvios()).length, 4);
});

test("dois talhões do agricultor com geada: um e-mail citando os dois e um WhatsApp por propriedade", async () => {
  const p = await banco.criarProdutor({ nome: "Ana", email: "ana@fazenda.com.br", telefone: "+5535999993362", consentimentos: { email: true, whatsapp: true } });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Encosta", ...LAVRAS });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Baixada", fase: "plantio", ...LAVRAS });
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar);
  assert.deepEqual([resumo.alertasNovos, resumo.enfileirados], [2, 3]);
  const [email, ...whatsapps] = await banco.listarEnvios();
  assert.ok(email.conteudo.includes("Talhões: Encosta, Baixada"));
  assert.deepEqual(whatsapps.map((e) => e.conteudo.split("\n")[2]), ["Propriedade: Encosta", "Propriedade: Baixada"]);
});

test("sem dia previsto para a geada, nenhuma mensagem de WhatsApp afirma o risco", async () => {
  const p = await banco.criarProdutor({ email: "a@fazenda.com.br", telefone: "+5535999993362", consentimentos: { email: true, whatsapp: true } });
  await banco.criarTalhaoDeTeste(p.id, LAVRAS);
  // A previsão diária veio vazia: o motor de regras ainda detecta, mas sem datar o risco.
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: clima({ temperaturaMinima: 1, previsaoDiaria: [] }) }).buscar);
  assert.deepEqual([resumo.alertasNovos, resumo.enfileirados], [1, 1]);
  assert.deepEqual((await banco.listarEnvios()).map((e) => e.canal), ["email"]);
});

test("geada com vários dias de risco mostra o período; sem hora prevista, a mínima do dia", async () => {
  const p = await banco.criarProdutor({ email: "a@fazenda.com.br", telefone: "+5535999993362", consentimentos: { whatsapp: true } });
  await banco.criarTalhaoDeTeste(p.id, LAVRAS);
  const longa = clima({
    temperaturaMinima: 0.6,
    previsaoDiaria: [dia("2026-10-20", { tempMin: 1.5 }), dia("2026-10-21", { tempMin: 0.6, horaMinima: null }), dia("2026-10-22", { tempMin: 1.9 })],
  });
  await ciclo(openMeteo({ [LAVRAS.latitude]: longa }).buscar);
  const [whatsapp] = await banco.listarEnvios();
  assert.ok(whatsapp.conteudo.includes("Temperatura prevista: 0,6 °C"));
  assert.ok(whatsapp.conteudo.includes("Previsão: 21/10/2026 (mínima prevista para o dia) — risco de 20/10 a 22/10"));
  assert.equal(new Date(whatsapp.expira_em).toISOString(), new Date("2026-10-22T23:59:59-03:00").toISOString());
});

test("quem não tem canal autorizado agora não é monitorado (nem consulta o Open-Meteo)", async () => {
  const sem = await banco.criarProdutor({ email: "d@fazenda.com.br", telefone: "+5535999990004", consentimentos: { email: false } });
  const soSms = await banco.criarProdutor({ email: "s@fazenda.com.br", telefone: "+5535999990005", consentimentos: { sms: true } });
  const trocouNumero = await banco.criarProdutor({ email: "t@fazenda.com.br", telefone: "+5535999990006", consentimentos: { whatsapp: true } });
  await banco.pool.query("UPDATE usuarios SET telefone = '+5535988880006' WHERE id = $1", [trocouNumero.id]);
  for (const produtor of [sem, soSms, trocouNumero]) await banco.criarTalhaoDeTeste(produtor.id, LAVRAS);

  const { buscar, consultas } = openMeteo({ [LAVRAS.latitude]: GEADA_FORTE });
  const resumo = await ciclo(buscar);
  assert.deepEqual([resumo.talhoes, consultas.length], [0, 0]);
  assert.deepEqual(await banco.listarEnvios(), []);
});

test("Open-Meteo fora do ar: o talhão fica sem leitura e sem alerta — nada é inventado", async () => {
  await cenarioDeDoisProdutores();
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: new Error("Open-Meteo HTTP 503") }).buscar);
  assert.deepEqual(resumo, { talhoes: 2, semDados: 1, alertasNovos: 0, enfileirados: 0 });
  const { rows } = await banco.pool.query("SELECT COUNT(*)::int AS total FROM leituras_clima");
  assert.equal(rows[0].total, 1);
});

test("talhões com níveis diferentes no mesmo grupo mostram o nível de cada um no e-mail", async () => {
  const p = await banco.criarProdutor({ email: "e@fazenda.com.br", consentimentos: { email: true } });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Florada", fase: "floracao", ...LAVRAS });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Plantio", fase: "plantio", ...LAVRAS });
  // 16 dias sem chuva: estiagem alta na floração e média nas demais fases.
  await ciclo(openMeteo({ [LAVRAS.latitude]: clima({ diasSemChuva: 16 }) }).buscar);
  const [email] = await banco.listarEnvios();
  assert.equal(email.nivel, "alto");
  assert.ok(email.conteudo.includes("Florada (alto), Plantio (médio)"));
});
