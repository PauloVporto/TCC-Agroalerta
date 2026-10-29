const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../avaliacao-ia/metricas");
const { CENARIOS_CLIMA } = require("../avaliacao-ia/cenarios-clima");
const { CENARIOS_MERCADO } = require("../avaliacao-ia/cenarios-mercado");
const { validarNotas } = require("../avaliacao-ia/juiz");
const { lerArgs } = require("../avaliacao-ia/executar");
const { csv } = require("../avaliacao-ia/relatorio");

test("há 30 cenários por módulo, com ids únicos e 15 por cultura", () => {
  for (const lista of [CENARIOS_CLIMA, CENARIOS_MERCADO]) {
    assert.equal(lista.length, 30);
    assert.equal(new Set(lista.map((c) => c.id)).size, 30);
    assert.equal(lista.filter((c) => c.cultura === "cafe").length, 15);
    assert.equal(lista.filter((c) => c.cultura === "soja").length, 15);
  }
});

test("o gabarito calculado coincide com a intenção do autor (detecta mudança nos limiares)", () => {
  for (const c of CENARIOS_CLIMA) {
    assert.equal(c.esperado.nivelGeral, c.intencao.nivelGeral, c.id);
    assert.deepEqual(c.esperado.tipos, [...c.intencao.tipos].sort(), c.id);
  }
  for (const c of CENARIOS_MERCADO) {
    assert.equal(c.esperado.tendencia, c.intencao.tendencia, c.id);
  }
});

test("as séries de mercado têm 14 pontos e ficam a >= 1 p.p. do limiar de 2%", () => {
  for (const c of CENARIOS_MERCADO) {
    assert.equal(c.entrada.serie.length, 14, c.id);
    const v = Math.abs(c.esperado.variacaoPercentual);
    assert.ok(v <= 1.0 || Math.abs(v - 2) >= 1, c.id + " variação " + v);
  }
});

test("as séries são reproduzíveis (semente fixa)", () => {
  delete require.cache[require.resolve("../avaliacao-ia/cenarios-mercado")];
  const outra = require("../avaliacao-ia/cenarios-mercado").CENARIOS_MERCADO;
  assert.deepEqual(outra[3].entrada.serie, CENARIOS_MERCADO[3].entrada.serie);
});

test("extrairNumeros entende formatos brasileiros e ambíguos", () => {
  const [a, b, c] = M.extrairNumeros("R$ 1.730,50 e 5,2% e 1.730");
  assert.deepEqual(a.candidatos, [1730.5]);
  assert.deepEqual(b.candidatos, [5.2]);
  assert.deepEqual(c.candidatos, [1730, 1.73]);
});

test("numerosSuspeitos aceita arredondamento e vírgula decimal, e aponta o que não está nos dados", () => {
  const permitidos = M.conjuntoPermitido("Mínima prevista: 1.5 °C. Preço final: 1729.83. Chuva: 12 mm");
  assert.deepEqual(M.numerosSuspeitos("Mínima de 1,5 °C, preço perto de 1.730 e 12 mm de chuva", permitidos), []);
  assert.deepEqual(M.numerosSuspeitos("Chuva de 90 mm e rajadas de 70 km/h", permitidos), ["90", "70"]);
});

test("derivadosMercado inclui variação, amplitude e limiar", () => {
  const d = M.derivadosMercado([{ data: "a", preco: 100 }, { data: "b", preco: 120 }, { data: "c", preco: 110 }]);
  assert.ok(d.includes(10)); // variação líquida
  assert.ok(d.includes(20)); // máx - mín
  assert.ok(d.includes(2)); // limiar
});

test("wilson: extremos e valor de referência", () => {
  assert.equal(M.wilson(0, 0).p, null);
  assert.equal(M.wilson(0, 30).inf, 0);
  const w = M.wilson(27, 30);
  assert.ok(Math.abs(w.inf - 0.744) < 0.01);
  assert.ok(Math.abs(w.sup - 0.965) < 0.01);
});

test("satisfatório exige média >= 4 e nenhum critério abaixo de 3", () => {
  const nota = (...v) => Object.fromEntries(M.CRITERIOS.map((c, i) => [c, v[i]]));
  assert.equal(M.satisfatorio(nota(5, 5, 5, 5, 5)), true);
  assert.equal(M.satisfatorio(nota(4, 4, 4, 4, 4)), true);
  assert.equal(M.satisfatorio(nota(5, 5, 5, 5, 2)), false);
  assert.equal(M.satisfatorio(nota(3, 4, 4, 4, 4)), false);
  assert.equal(M.satisfatorio({ coerencia: 5 }), false);
});

test("origemComprovada só aceita identificadores devolvidos pela API", () => {
  assert.equal(M.origemComprovada({ requestId: "req_01A", respostaId: "msg_01B", modelo: "claude-x" }), true);
  assert.equal(M.origemComprovada({ requestId: null, respostaId: "msg_01B", modelo: "claude-x" }), false);
  assert.equal(M.origemComprovada({ requestId: "req_01A", respostaId: "simulado", modelo: "claude-x" }), false);
  assert.equal(M.origemComprovada({ requestId: "req_01A", respostaId: "msg_01B" }), false);
  assert.equal(M.origemComprovada(), false);
});

test("consistência: respostas idênticas valem 5; totalmente diferentes valem 1", () => {
  const a = { nivelGeral: "alto", riscos: [{ tipo: "geada", nivel: "alto" }] };
  const b = { nivelGeral: "baixo", riscos: [{ tipo: "vento", nivel: "alto" }] };
  assert.equal(M.notaConsistencia(M.concordanciaClima(a, a)), 5);
  assert.equal(M.notaConsistencia(M.concordanciaClima(a, b)), 1);
  assert.equal(M.concordanciaClima(a, null), 0);
  assert.equal(M.concordanciaMercado("alta", "alta"), 1);
  assert.equal(M.concordanciaMercado("alta", "queda"), 0);
  assert.equal(M.concordanciaMercado(null, null), 0);
});

test("objetivoClima conta acertos, falsos alarmes e omissões", () => {
  const alertas = [{ id: "cafe_geada", nivel: "alto" }, { id: "cafe_estiagem", nivel: "medio" }];
  const analise = { nivelGeral: "alto", riscos: [{ tipo: "geada", nivel: "alto" }, { tipo: "vento", nivel: "medio" }] };
  const o = M.objetivoClima({ alertas, analise });
  assert.equal(o.tp, 1);
  assert.equal(o.fp, 1);
  assert.equal(o.fn, 1);
  assert.equal(o.nivelCorreto, true);
  assert.equal(o.niveisCorretos, 1);
  assert.equal(o.riscosExatos, false);
  assert.equal(M.objetivoClima({ alertas, analise: null }).formatoValido, false);
});

test("resumirModulo calcula médias, % de nota >= 4 e proporção satisfatória com IC", () => {
  const mk = (v, satisfatorio) => ({ satisfatorio, notas: Object.fromEntries(M.CRITERIOS.map((c) => [c, v])) });
  const r = M.resumirModulo([mk(5, true), mk(4, true), mk(2, false), mk(5, true)]);
  assert.equal(r.n, 4);
  assert.equal(r.criterios.coerencia.media, 4);
  assert.equal(r.criterios.coerencia.pctNota4ouMais, 75);
  assert.equal(r.satisfatorios.k, 3);
  assert.equal(r.satisfatorios.pct, 75);
  assert.ok(r.satisfatorios.ic95[0] < 75 && r.satisfatorios.ic95[1] > 75);
});

test("validarNotas do juiz recusa nota fora de 1..5 ou não inteira", () => {
  const ok = (n) => ({ coerencia: { nota: n }, clareza: { nota: 4 }, relevancia: { nota: 4 }, ausenciaInvencao: { nota: 4 } });
  assert.ok(validarNotas(ok(5)));
  assert.equal(validarNotas(ok(6)), null);
  assert.equal(validarNotas(ok(0)), null);
  assert.equal(validarNotas(ok(3.5)), null);
  assert.equal(validarNotas(null), null);
});

test("lerArgs valida módulo, execuções e concorrência", () => {
  assert.deepEqual(lerArgs([]).modulo, "todos");
  assert.equal(lerArgs(["--piloto"]).piloto, true);
  assert.throws(() => lerArgs(["--modulo=outro"]));
  assert.throws(() => lerArgs(["--execucoes=1"]));
  assert.throws(() => lerArgs(["--concorrencia=0"]));
});

test("csv escapa aspas, ponto e vírgula e quebras de linha", () => {
  const texto = csv(["a", "b"], [{ a: 'diz "oi"', b: "x;y\nz" }]);
  assert.match(texto, /"diz ""oi"""/);
  assert.match(texto, /"x;y\nz"/);
});

test("calcularAssertividade: índice = média ÷ 5, acerto objetivo e satisfatórias com IC, geral ponderado", () => {
  const notas = (v) => ({ coerencia: v, clareza: v, relevancia: v, ausenciaInvencao: v, consistencia: v, media: v });
  const exec = (objetivo) => ({ excluida: false, objetivo });
  const clima = [
    { excluido: false, satisfatorio: true, notas: notas(5), execucoes: [exec({ nivelCorreto: true, riscosExatos: true }), exec({ nivelCorreto: true, riscosExatos: true })] },
    // nível certo mas conjunto de riscos errado: não conta como acerto objetivo
    { excluido: false, satisfatorio: true, notas: notas(4), execucoes: [exec({ nivelCorreto: true, riscosExatos: false }), exec({ nivelCorreto: true, riscosExatos: true })] },
    { excluido: true, execucoes: [{ excluida: true }] },
  ];
  const mercado = [
    { excluido: false, satisfatorio: false, notas: notas(2), execucoes: [exec({ tendenciaCorreta: false }), exec({ tendenciaCorreta: true })] },
  ];
  const r = M.calcularAssertividade({ clima, mercado });
  assert.equal(r.modulos.clima.cenarios, 2);
  assert.equal(r.modulos.clima.excluidos, 1);
  assert.equal(r.modulos.clima.indice, 90); // média 4,5 ÷ 5
  assert.equal(r.modulos.clima.acertoObjetivo.k, 3);
  assert.equal(r.modulos.clima.acertoObjetivo.n, 4);
  assert.equal(r.modulos.mercado.indice, 40);
  assert.equal(r.modulos.mercado.acertoObjetivo.pct, 50);
  assert.equal(r.geral.cenarios, 3);
  assert.equal(r.geral.indice, 73.3); // (90×2 + 40×1) ÷ 3
  assert.equal(r.geral.acertoObjetivo.k, 4);
  assert.equal(r.geral.acertoObjetivo.n, 6);
  assert.equal(r.geral.satisfatorios.k, 2);
  assert.ok(r.geral.acertoObjetivo.ic95[0] < r.geral.acertoObjetivo.pct && r.geral.acertoObjetivo.ic95[1] > r.geral.acertoObjetivo.pct);
});

test("calcularAssertividade ignora cenários excluídos e não quebra sem nenhum cenário válido", () => {
  const r = M.calcularAssertividade({ clima: [{ excluido: true, execucoes: [] }] });
  assert.deepEqual(r.modulos, {});
  assert.equal(r.geral.indice, null);
  assert.equal(r.geral.acertoObjetivo.n, 0);
});
