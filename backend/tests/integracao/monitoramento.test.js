const banco = require("./helpers/banco");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { executarCiclo } = require("../../services/monitoramento");
const { contarSegmentos } = require("../../services/notificacoes/textoSms");

before(() => banco.prepararBanco());
beforeEach(() => banco.limparBanco());
after(() => banco.pool.end());

const LAVRAS = { regiao: "Lavras - MG", latitude: -21.245, longitude: -44.999 };
const VARGINHA = { regiao: "Varginha - MG", latitude: -21.551, longitude: -45.43 };

function dia(data, campos = {}) {
  return { data, tempMin: 12, tempMax: 27, chuvaMm: 0, chuvaProbabilidade: 10, ventoMaxKmh: 14, ...campos };
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
const GEADA_FORTE = clima({ temperaturaMinima: 1.2, previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21", { tempMin: 1.2 }), dia("2026-10-22", { tempMin: 6 })] });
const GEADA_MODERADA = clima({ temperaturaMinima: 4.1, previsaoDiaria: [dia("2026-10-20"), dia("2026-10-21", { tempMin: 4.1 }), dia("2026-10-22")] });

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
  const ana = await banco.criarProdutor({ nome: "Ana", email: "ana@fazenda.com.br", telefone: "+5535999990001", consentimentos: { email: true, sms: true } });
  const bruno = await banco.criarProdutor({ nome: "Bruno", email: "bruno@sitio.com.br", telefone: "+5535988880002", consentimentos: { email: true, sms: true } });
  await banco.criarTalhaoDeTeste(ana.id, { nome: "Talhão da encosta", ...LAVRAS });
  await banco.criarTalhaoDeTeste(bruno.id, { nome: "Talhão do rio", ...VARGINHA });
  return { ana, bruno };
}

test("risco crítico: o produtor da região afetada recebe e-mail e SMS; o de fora não recebe nada", async () => {
  const { ana } = await cenarioDeDoisProdutores();
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar);
  assert.deepEqual(resumo, { talhoes: 2, semDados: 0, alertasNovos: 1, enfileirados: 2 });

  const envios = await banco.listarEnvios();
  assert.deepEqual(envios.map((e) => [e.usuario_id, e.canal, e.tipo, e.nivel, e.regiao]), [
    [ana.id, "email", "alerta_climatico", "alto", "Lavras - MG"],
    [ana.id, "sms", "alerta_climatico", "alto", "Lavras - MG"],
  ]);

  const { rows: alertas } = await banco.pool.query("SELECT regra_id, nivel, janela, regiao, leitura_id FROM alertas_gerados");
  assert.equal(alertas.length, 1);
  assert.deepEqual([alertas[0].regra_id, alertas[0].nivel, alertas[0].janela, alertas[0].regiao], ["cafe_geada", "alto", "21/10", "Lavras - MG"]);
  assert.ok(alertas[0].leitura_id);
  const { rows: leituras } = await banco.pool.query("SELECT fonte, temperatura_minima FROM leituras_clima ORDER BY id");
  assert.deepEqual(leituras, [{ fonte: "open-meteo", temperatura_minima: 1.2 }, { fonte: "open-meteo", temperatura_minima: 12 }]);

  const email = banco.provedorFalso({ nome: "resend" });
  const sms = banco.provedorFalso({ nome: "smsgo" });
  await banco.processar({ email, sms });
  assert.deepEqual(email.enviados.map((m) => m.destino), ["ana@fazenda.com.br"]);
  assert.equal(envios[0].assunto, "Alerta alto: Risco de geada em Lavras - MG");
  for (const trecho of ["Olá, Ana", "Talhão da encosta", "21/10", "1,2 °C", "Considere métodos de proteção contra geada"]) {
    assert.ok(email.enviados[0].html.includes(trecho), trecho);
  }
  assert.deepEqual(sms.enviados.map((m) => m.destino), ["+5535999990001"]);
  assert.equal(
    sms.enviados[0].texto,
    "Agro Alerta: Alerta de geada (risco alto) em Lavras - MG. Periodo: 21/10. Acompanhe as condicoes climaticas."
  );
  assert.equal(contarSegmentos(sms.enviados[0].texto), 1);
});

test("risco não crítico (médio): só e-mail, pela preferência padrão", async () => {
  await cenarioDeDoisProdutores();
  await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_MODERADA }).buscar);
  assert.deepEqual((await banco.listarEnvios()).map((e) => [e.canal, e.nivel]), [["email", "medio"]]);
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
  assert.deepEqual((await banco.listarEnvios()).map((e) => `${e.canal}:${e.nivel}`), ["email:medio", "email:alto", "sms:alto"]);
});

test("risco que volta depois de 24 h sem ser detectado gera novo aviso", async () => {
  await cenarioDeDoisProdutores();
  const forte = openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar;
  await ciclo(forte);
  await banco.pool.query("UPDATE alertas_gerados SET ultima_deteccao_em = NOW() - INTERVAL '25 hours'");
  assert.equal((await ciclo(forte)).enfileirados, 2);
  assert.equal((await banco.listarEnvios()).length, 4);
});

test("preferência 'somente alto' no e-mail ignora risco médio; o episódio fica registrado", async () => {
  const p = await banco.criarProdutor({ email: "c@fazenda.com.br", consentimentos: { email: true }, preferencias: { email: "alto", sms: "alto" } });
  await banco.criarTalhaoDeTeste(p.id, LAVRAS);
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_MODERADA }).buscar);
  assert.deepEqual([resumo.alertasNovos, resumo.enfileirados], [1, 0]);
});

test("produtor sem canal autorizado não é monitorado (nem consulta o Open-Meteo)", async () => {
  const sem = await banco.criarProdutor({ email: "d@fazenda.com.br", consentimentos: { email: false } });
  await banco.criarTalhaoDeTeste(sem.id, LAVRAS);
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

test("o mesmo risco em dois talhões do produtor na mesma região vira uma mensagem por canal", async () => {
  const p = await banco.criarProdutor({ nome: "Ana", email: "ana@fazenda.com.br", telefone: "+5535999990001", consentimentos: { email: true, sms: true } });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Encosta", ...LAVRAS });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Baixada", fase: "plantio", ...LAVRAS });
  const resumo = await ciclo(openMeteo({ [LAVRAS.latitude]: GEADA_FORTE }).buscar);
  assert.deepEqual([resumo.alertasNovos, resumo.enfileirados], [2, 2]);
  const [email] = await banco.listarEnvios();
  assert.ok(email.conteudo.includes("Talhões: Encosta, Baixada"));
  assert.equal(email.resumo, "Risco de geada (risco alto) · Encosta, Baixada");
});

test("talhões com níveis diferentes no mesmo grupo mostram o nível de cada um", async () => {
  const p = await banco.criarProdutor({ email: "e@fazenda.com.br", consentimentos: { email: true } });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Florada", fase: "floracao", ...LAVRAS });
  await banco.criarTalhaoDeTeste(p.id, { nome: "Plantio", fase: "plantio", ...LAVRAS });
  // 16 dias sem chuva: estiagem alta na floração e média nas demais fases.
  await ciclo(openMeteo({ [LAVRAS.latitude]: clima({ diasSemChuva: 16 }) }).buscar);
  const [email] = await banco.listarEnvios();
  assert.equal(email.nivel, "alto");
  assert.ok(email.conteudo.includes("Florada (alto), Plantio (médio)"));
});
