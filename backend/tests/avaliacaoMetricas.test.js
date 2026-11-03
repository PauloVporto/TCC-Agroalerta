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

test("compararNotas: diferença, viés, concordância e Spearman", () => {
  const r = M.compararNotas([5, 4, 3, 5], [5, 5, 3, 4]);
  assert.equal(r.n, 4);
  assert.equal(r.diffMediaAbs, 0.5);
  assert.equal(r.vies, 0); // +0 -1 +0 +1
  assert.equal(r.concordanciaExata, 50);
  assert.equal(r.dentroDe1, 100);
  assert.equal(M.compararNotas([1, 2, 3, 4], [10, 20, 30, 40]).spearman, 1);
  assert.equal(M.compararNotas([1, 2, 3, 4], [4, 3, 2, 1]).spearman, -1);
  // série constante: correlação indefinida, não NaN
  assert.equal(M.compararNotas([5, 5, 5], [5, 4, 5]).spearman, null);
  assert.equal(M.compararNotas([], []).n, 0);
});

test("comparar-humano: lê CSV com tabulação e em Windows-1252, e valida as notas", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const H = require("../avaliacao-ia/comparar-humano");
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "humano-")), "p.csv");
  const texto = "cenario\tresposta_do_claude\tcoerencia_1a5\n C01\tNível geral: baixo\t5,0\n";
  fs.writeFileSync(arquivo, Buffer.from(texto, "latin1")); // acentos em Windows-1252, não UTF-8
  assert.match(H.lerTexto(arquivo), /Nível geral/);
  const { separador, linhas } = H.lerCsv(H.lerTexto(arquivo));
  assert.equal(separador, "\t");
  assert.equal(linhas.length, 1);
  assert.equal(H.nota("5,0"), 5);
  assert.equal(H.nota(" 4 "), 4);
  assert.equal(H.nota("6"), null);
  assert.equal(H.nota(""), null);
  assert.equal(H.nota("abc"), null);
});

// Cenário mínimo no formato de respostas.json, com notas do juiz diferentes em cada execução.
const cenarioFalso = (id, modulo, juiz1, juiz2, consistencia) => {
  const notas = (v) => ({ coerencia: v, clareza: v, relevancia: v, ausenciaInvencao: v });
  return {
    id, modulo, categoria: "x", descricao: "Cenário " + id, gabarito: "Nenhum risco esperado; nível geral baixo.",
    dadosEntrada: "Dados do " + id + "\n- linha 2", excluido: false, notas: { consistencia },
    execucoes: [
      { execucao: 1, excluida: false, textoAvaliado: "Resposta um do " + id + "\nRiscos: nenhum", juiz: { notas: notas(juiz1) } },
      { execucao: 2, excluida: false, textoAvaliado: "Resposta dois do " + id + " & <b>", juiz: { notas: notas(juiz2) } },
    ],
  };
};

test("documento Word: gera os cenários com as duas respostas e lê de volta as notas digitadas", async () => {
  const V = require("../avaliacao-ia/validacao-docx");
  const amostra = [cenarioFalso("C01", "clima", 5, 4, 5), cenarioFalso("MC01", "mercado", 4, 4, 3)];
  const preenchida = { r1: { coerencia: 5, clareza: 4, relevancia: 5, ausenciaInvencao: 3 }, r2: { coerencia: 4, clareza: 4, relevancia: 4, ausenciaInvencao: 4 } };
  const buffer = await V.gerarBuffer(amostra, { rodada: "teste", avaliador: "Fulana", data: "02/11/2026", preenchidas: { C01: { ...preenchida, consistencia: 5, observacoes: "ok & <ok>" } } });

  // O texto das duas respostas e dos dados está no documento (é isso que o avaliador lê).
  const JSZip = require("jszip");
  const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml").async("string");
  assert.match(xml, /Resposta um do C01/);
  assert.match(xml, /Resposta dois do C01 &amp; &lt;b&gt;/);
  assert.match(xml, /Dados do MC01/);
  // Avaliação cega: nenhuma nota nem justificativa do juiz entra no documento.
  const comJustificativa = cenarioFalso("Z99", "clima", 1, 2, 1);
  comJustificativa.execucoes[0].juiz.justificativas = { coerencia: "SEGREDO-DO-JUIZ" };
  const bufferJuiz = await V.gerarBuffer([comJustificativa]);
  const xmlJuiz = await (await JSZip.loadAsync(bufferJuiz)).file("word/document.xml").async("string");
  assert.doesNotMatch(xmlJuiz, /SEGREDO-DO-JUIZ/);

  const lido = await V.lerRespostas(buffer);
  assert.deepEqual(lido.avaliador, { nome: "Fulana", data: "02/11/2026" });
  assert.deepEqual(lido.itens.map((i) => i.cenario), ["C01", "MC01"]);
  const c01 = lido.itens[0];
  assert.equal(c01.respostas[0].notas.ausenciaInvencao, "3");
  assert.equal(c01.respostas[1].notas.coerencia, "4");
  assert.equal(c01.consistencia, "5");
  assert.equal(c01.observacoes, "ok & <ok>");
  assert.equal(lido.itens[1].respostas[0].notas.coerencia, ""); // não preenchido

  // Caractere digitado por engano no rótulo (como "6Consistência...") não pode esconder a nota.
  const zip = await JSZip.loadAsync(buffer);
  const xmlOriginal = await zip.file("word/document.xml").async("string");
  const xmlComErro = xmlOriginal.replace(/>Consistência entre as duas respostas \(1 a 5\)</, ">6Consistência entre as duas respostas (1 a 5)<");
  assert.notEqual(xmlComErro, xmlOriginal);
  zip.file("word/document.xml", xmlComErro);
  const lidoComErro = await V.lerRespostas(await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(lidoComErro.itens[0].consistencia, "5");
});

test("comparar-humano com Word: Resposta 1 × execução 1, Resposta 2 × execução 2, e consistência", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const V = require("../avaliacao-ia/validacao-docx");
  const H = require("../avaliacao-ia/comparar-humano");
  const cenarios = [cenarioFalso("C01", "clima", 5, 3, 5), cenarioFalso("MC01", "mercado", 4, 4, 3)];
  const r1 = { coerencia: 5, clareza: 5, relevancia: 5, ausenciaInvencao: 5 };
  const r2 = { coerencia: 4, clareza: 4, relevancia: 4, ausenciaInvencao: 4 };
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "docx-")), "v.docx");
  fs.writeFileSync(arquivo, await V.gerarBuffer(cenarios, { preenchidas: { C01: { r1, r2, consistencia: 5 } } }));

  const av = await H.lerAvaliador(arquivo);
  assert.equal(av.formato, "docx");
  assert.equal(H.temNotas(av), true);
  const r = H.comparar(cenarios, av);

  // Só o C01 foi preenchido: MC01 vira aviso, e há 4 notas × 2 respostas + 1 de consistência.
  assert.equal(r.cenarios, 1);
  assert.equal(r.notas, 9);
  assert.match(r.avisos[0], /1 cenário\(s\) sem nenhuma nota preenchida, ignorados: MC01/);
  // Resposta 1: humano 5 × juiz 5 (exec 1) = diferença 0. Resposta 2: humano 4 × juiz 3 (exec 2) = +1.
  assert.equal(r.porExecucao[1].diffMediaAbs, 0);
  assert.equal(r.porExecucao[2].vies, 1);
  // Consistência: humano 5 × consistência calculada do cenário (5).
  assert.equal(r.porCriterio.consistencia.n, 1);
  assert.equal(r.porCriterio.consistencia.diffMediaAbs, 0);
  assert.equal(r.porCriterio.coerencia.n, 2);
});

test("comparar-humano com Word em branco: nada a comparar e temNotas é falso", async () => {
  const V = require("../avaliacao-ia/validacao-docx");
  const H = require("../avaliacao-ia/comparar-humano");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "docx-")), "v.docx");
  fs.writeFileSync(arquivo, await V.gerarBuffer([cenarioFalso("C01", "clima", 5, 5, 5)]));
  const av = await H.lerAvaliador(arquivo);
  assert.equal(H.temNotas(av), false);
  assert.equal(H.comparar([cenarioFalso("C01", "clima", 5, 5, 5)], av).notas, 0);
});

test("calcularAssertividade ignora cenários excluídos e não quebra sem nenhum cenário válido", () => {
  const r = M.calcularAssertividade({ clima: [{ excluido: true, execucoes: [] }] });
  assert.deepEqual(r.modulos, {});
  assert.equal(r.geral.indice, null);
  assert.equal(r.geral.acertoObjetivo.n, 0);
});
