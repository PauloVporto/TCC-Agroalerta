const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dadosDaGeada, ehRiscoDeGeada } = require("../services/notificacoes/alertas");

function dia(data, tempMin, horaMinima = "05:00") {
  return { data, tempMin, horaMinima };
}

const EPISODIO = {
  alerta: { id: "cafe_geada", nivel: "alto", janela: "21/10 a 22/10", dias: ["2026-10-21", "2026-10-22"] },
  talhao: { nome: "Encosta", regiao: "Lavras - MG", enderecoFormatado: "Lavras, Minas Gerais, Brasil", endereco: "Lavras" },
  clima: { previsaoDiaria: [dia("2026-10-20", 8), dia("2026-10-21", 1.6, "04:00"), dia("2026-10-22", 1.2, "05:00")] },
};

test("só regras de geada vão ao WhatsApp", () => {
  assert.equal(ehRiscoDeGeada("cafe_geada"), true);
  assert.equal(ehRiscoDeGeada("soja_geada"), true);
  assert.equal(ehRiscoDeGeada("cafe_estiagem"), false);
  assert.equal(ehRiscoDeGeada(undefined), false);
});

test("o alerta usa o dia mais frio dentro do risco, a hora prevista e vale até o fim do último dia", () => {
  assert.deepEqual(dadosDaGeada(EPISODIO), {
    recomendacao: null,
    propriedade: "Encosta",
    localizacao: "Lavras - MG",
    temperatura: 1.2,
    nivel: "alto",
    data: "2026-10-22",
    hora: "05:00",
    periodo: "21/10 a 22/10",
    expiraEm: new Date("2026-10-22T23:59:59-03:00"),
  });
});

test("sem região, a localização cai para o endereço do talhão; um dia só não mostra período", () => {
  const umDia = { ...EPISODIO.alerta, dias: ["2026-10-21"] };
  const semRegiao = dadosDaGeada({ ...EPISODIO, alerta: umDia, talhao: { ...EPISODIO.talhao, regiao: null } });
  assert.deepEqual([semRegiao.localizacao, semRegiao.periodo, semRegiao.data], ["Lavras, Minas Gerais, Brasil", null, "2026-10-21"]);
  const soEndereco = dadosDaGeada({ ...EPISODIO, talhao: { nome: "Encosta", endereco: "Rua A, Lavras" } });
  assert.equal(soEndereco.localizacao, "Rua A, Lavras");
});

test("faltando dia de risco, temperatura ou local, nenhum alerta afirma geada", () => {
  assert.equal(dadosDaGeada({ ...EPISODIO, alerta: { ...EPISODIO.alerta, dias: undefined } }), null, "regra sem dias");
  assert.equal(dadosDaGeada({ ...EPISODIO, alerta: { ...EPISODIO.alerta, dias: ["2026-10-30"] } }), null, "dia fora da previsão");
  assert.equal(dadosDaGeada({ ...EPISODIO, clima: {} }), null, "sem previsão diária");
  assert.equal(dadosDaGeada({ ...EPISODIO, clima: { previsaoDiaria: [dia("2026-10-21", null), dia("2026-10-22", NaN)] } }), null);
  assert.equal(dadosDaGeada({ ...EPISODIO, talhao: { nome: "Encosta" } }), null, "sem local");
  const semHora = dadosDaGeada({ ...EPISODIO, clima: { previsaoDiaria: [dia("2026-10-22", 1.2, null)] } });
  assert.equal(semHora.hora, null);
});
