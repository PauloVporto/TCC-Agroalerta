const fs = require("fs");
const { resposta, mockFetch, carregar } = require("../helpers/http");
const { SERIES_ICBR } = require("../../../backend/services/bcb");

afterEach(() => {
  delete process.env.ALPHA_VANTAGE_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("bcb.buscarPtax", () => {
  const ptax = { value: [{ cotacaoCompra: 5.1, cotacaoVenda: 5.2, dataHoraCotacao: "2026-01-02 13:00" }] };

  test("devolve a última cotação do dólar", async () => {
    const fetchMock = mockFetch(resposta({ json: ptax }));
    const r = await carregar("services/bcb.js").buscarPtax();
    expect(r).toEqual({ cotacaoCompra: 5.1, cotacaoVenda: 5.2, dataHora: "2026-01-02 13:00", fonte: "Banco Central do Brasil (PTAX)" });
    expect(fetchMock.mock.calls[0][0]).toContain("olinda.bcb.gov.br");
  });

  test("usa cache na segunda chamada", async () => {
    const fetchMock = mockFetch(resposta({ json: ptax }));
    const { buscarPtax } = carregar("services/bcb.js");
    const a = await buscarPtax();
    const b = await buscarPtax();
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["HTTP não-ok", () => resposta({ ok: false, status: 500, json: {} })],
    ["lista vazia", () => resposta({ json: { value: [] } })],
    ["sem 'value'", () => resposta({ json: {} })],
    ["erro de rede", () => new Error("rede")],
  ])("%s retorna null", async (_, fabricar) => {
    mockFetch(fabricar());
    expect(await carregar("services/bcb.js").buscarPtax()).toBeNull();
  });
});

describe("bcb.buscarIndiceCommoditiesAgro", () => {
  test("calcula valor atual, variação 12m e limita a série a 12 pontos", async () => {
    const serie = Array.from({ length: 13 }, (_, i) => ({ data: "01/" + (i + 1), valor: String(100 + i * 10).replace(".", ",") }));
    mockFetch(resposta({ json: serie }));
    const r = await carregar("services/bcb.js").buscarIndiceCommoditiesAgro();
    expect(r.valorAtual).toBe(220);
    expect(r.variacao12m).toBe("120.0");
    expect(r.serie).toHaveLength(12);
  });

  test("aceita vírgula decimal e ignora valores não numéricos", async () => {
    mockFetch(resposta({ json: [{ data: "a", valor: "100,5" }, { data: "b", valor: "x" }, { data: "c", valor: "110,5" }] }));
    const r = await carregar("services/bcb.js").buscarIndiceCommoditiesAgro();
    expect(r.serie).toHaveLength(2);
    expect(r.valorAtual).toBe(110.5);
  });

  test("primeiro valor 0 deixa a variação nula", async () => {
    mockFetch(resposta({ json: [{ data: "a", valor: "0" }, { data: "b", valor: "10" }] }));
    expect((await carregar("services/bcb.js").buscarIndiceCommoditiesAgro()).variacao12m).toBeNull();
  });

  // Quando todas as séries falham, o serviço tenta devolver o último valor
  // gravado em disco. Sem esse arquivo, a resposta é null.
  describe("sem valor anterior em disco", () => {
    beforeEach(() => {
      jest.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("sem cache salvo");
      });
      jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    });

    test.each([
      ["HTTP não-ok", () => resposta({ ok: false, status: 500, text: "<html>erro</html>" })],
      ["array vazio", () => resposta({ json: [] })],
      ["não é array", () => resposta({ json: { a: 1 } })],
      ["uma única leitura", () => resposta({ json: [{ data: "a", valor: "1" }] })],
      ["erro de rede", () => new Error("x")],
    ])("%s em todas as séries retorna null", async (_, fabricar) => {
      // Uma resposta para cada série consultada em paralelo.
      mockFetch(...SERIES_ICBR.map(fabricar));
      expect(await carregar("services/bcb.js").buscarIndiceCommoditiesAgro()).toBeNull();
    });

    test("valores não numéricos em todas as séries retornam null", async () => {
      mockFetch(...SERIES_ICBR.map(() => resposta({ json: [{ data: "a", valor: "x" }, { data: "b", valor: "y" }] })));
      expect(await carregar("services/bcb.js").buscarIndiceCommoditiesAgro()).toBeNull();
    });
  });

  test("cai para a segunda série quando a primeira falha", async () => {
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    mockFetch(
      new Error("série fora do ar"),
      resposta({ json: [{ data: "a", valor: "100" }, { data: "b", valor: "110" }] })
    );
    const r = await carregar("services/bcb.js").buscarIndiceCommoditiesAgro();
    expect(r.valorAtual).toBe(110);
    expect(r.fonte).toContain(String(SERIES_ICBR[1]));
  });

  test("quando o BCB cai, devolve o último valor salvo marcado como desatualizado", async () => {
    const salvo = { salvoEm: "2026-01-01T00:00:00.000Z", dados: { valorAtual: 99, fonte: "BCB", serie: [] } };
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(salvo));
    mockFetch(...SERIES_ICBR.map(() => new Error("fora do ar")));
    const r = await carregar("services/bcb.js").buscarIndiceCommoditiesAgro();
    expect(r).toMatchObject({ valorAtual: 99, desatualizado: true, obtidoEm: salvo.salvoEm });
  });

  test("usa cache na segunda chamada", async () => {
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    const fetchMock = mockFetch(
      ...SERIES_ICBR.map(() => resposta({ json: [{ data: "a", valor: "1" }, { data: "b", valor: "2" }] }))
    );
    const { buscarIndiceCommoditiesAgro } = carregar("services/bcb.js");
    await buscarIndiceCommoditiesAgro();
    await buscarIndiceCommoditiesAgro();
    // Uma rodada consulta todas as séries em paralelo; a segunda não consulta nada.
    expect(fetchMock).toHaveBeenCalledTimes(SERIES_ICBR.length);
  });
});

describe("stooq", () => {
  const csv = "Date,Open,High,Low,Close,Volume\n2026-01-01,1,2,0,150.5,10\n2026-01-02,1,2,0,152.25,10\n";

  test("buscarCotacaoStooq lê o fechamento do CSV", async () => {
    const fetchMock = mockFetch(resposta({ text: csv }));
    const r = await carregar("services/stooq.js").buscarCotacaoStooq("cafe");
    expect(r).toMatchObject({ fonte: "Stooq", simbolo: "KC.F", unidade: "cents/lb", valorAtual: 152.25, data: "2026-01-02" });
    expect(r.serie).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toContain("s=KC.F");
  });

  test("soja usa ZS.F", async () => {
    mockFetch(resposta({ text: csv }));
    const r = await carregar("services/stooq.js").buscarCotacaoStooq("soja");
    expect(r.simbolo).toBe("ZS.F");
    expect(r.unidade).toBe("cents/bushel");
  });

  test("cultura sem símbolo retorna null sem chamar a rede", async () => {
    const fetchMock = mockFetch();
    const { buscarCotacaoStooq, buscarHistoricoMensalStooq } = carregar("services/stooq.js");
    expect(await buscarCotacaoStooq("milho")).toBeNull();
    expect(await buscarHistoricoMensalStooq("milho")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ["HTTP não-ok", () => resposta({ ok: false, status: 500, text: "" })],
    ["HTML", () => resposta({ text: "<!DOCTYPE html>" })],
    ["No data", () => resposta({ text: "No data" })],
    ["vazio", () => resposta({ text: "" })],
    ["só cabeçalho", () => resposta({ text: "Date,Open,High,Low,Close,Volume\n" })],
    ["erro de rede", () => new Error("x")],
  ])("buscarCotacaoStooq: %s retorna null", async (_, fabricar) => {
    mockFetch(fabricar());
    expect(await carregar("services/stooq.js").buscarCotacaoStooq("cafe")).toBeNull();
  });

  test("buscarCotacaoStooq usa cache", async () => {
    const fetchMock = mockFetch(resposta({ text: csv }));
    const { buscarCotacaoStooq } = carregar("services/stooq.js");
    await buscarCotacaoStooq("cafe");
    await buscarCotacaoStooq("cafe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("buscarHistoricoMensalStooq devolve histórico mensal com preço de fechamento", async () => {
    mockFetch(resposta({ text: csv }));
    const r = await carregar("services/stooq.js").buscarHistoricoMensalStooq("cafe");
    expect(r.historico).toEqual([{ data: "2026-01-01", preco: 150.5 }, { data: "2026-01-02", preco: 152.25 }]);
    expect(r).toMatchObject({ fonte: "Stooq", unidade: "cents/lb" });
  });

  test("histórico usa a abertura quando o fechamento não é numérico", async () => {
    mockFetch(resposta({ text: "Date,Open,High,Low,Close\n2026-01-01,99,1,1,abc\n" }));
    const r = await carregar("services/stooq.js").buscarHistoricoMensalStooq("soja");
    expect(r.historico[0].preco).toBe(99);
  });

  test.each([
    ["HTTP não-ok", () => resposta({ ok: false, status: 500, text: "" })],
    ["HTML", () => resposta({ text: "<!DOCTYPE" })],
    ["só cabeçalho", () => resposta({ text: "Date,Open\n" })],
    ["erro de rede", () => new Error("x")],
  ])("buscarHistoricoMensalStooq: %s retorna null", async (_, fabricar) => {
    mockFetch(fabricar());
    expect(await carregar("services/stooq.js").buscarHistoricoMensalStooq("cafe")).toBeNull();
  });

  test("buscarHistoricoMensalStooq usa cache", async () => {
    const fetchMock = mockFetch(resposta({ text: csv }));
    const { buscarHistoricoMensalStooq } = carregar("services/stooq.js");
    await buscarHistoricoMensalStooq("cafe");
    await buscarHistoricoMensalStooq("cafe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("alphavantage.buscarCotacaoAV", () => {
  const json = { unit: "cents per pound", data: [{ date: "2026-01-01", value: "250.5" }, { date: "2025-12-01", value: "." }, { date: "2025-11-01", value: "240" }] };

  test("sem chave retorna null sem chamar a rede", async () => {
    const fetchMock = mockFetch();
    expect(await carregar("services/alphavantage.js").buscarCotacaoAV("cafe")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("cultura sem função (soja) retorna null", async () => {
    process.env.ALPHA_VANTAGE_KEY = "k";
    const fetchMock = mockFetch();
    expect(await carregar("services/alphavantage.js").buscarCotacaoAV("soja")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("com chave devolve a série válida e o valor mais recente", async () => {
    process.env.ALPHA_VANTAGE_KEY = " k ";
    const fetchMock = mockFetch(resposta({ json }));
    const r = await carregar("services/alphavantage.js").buscarCotacaoAV("cafe");
    expect(r).toMatchObject({ fonte: "Alpha Vantage", funcao: "COFFEE", unidade: "cents per pound", valorAtual: 250.5 });
    expect(r.serie).toHaveLength(2); // "." é descartado
    expect(fetchMock.mock.calls[0][0]).toContain("apikey=k");
  });

  test.each([
    ["limite excedido (Note)", () => resposta({ json: { Note: "limit" } })],
    ["Information", () => resposta({ json: { Information: "x" } })],
    ["sem data", () => resposta({ json: {} })],
    ["série inválida", () => resposta({ json: { data: [{ date: "a", value: "." }] } })],
    ["HTTP não-ok", () => resposta({ ok: false, status: 500, json: {} })],
    ["erro de rede", () => new Error("x")],
  ])("%s retorna null", async (_, fabricar) => {
    process.env.ALPHA_VANTAGE_KEY = "k";
    mockFetch(fabricar());
    expect(await carregar("services/alphavantage.js").buscarCotacaoAV("cafe")).toBeNull();
  });

  test("usa cache por função", async () => {
    process.env.ALPHA_VANTAGE_KEY = "k";
    const fetchMock = mockFetch(resposta({ json }));
    const { buscarCotacaoAV } = carregar("services/alphavantage.js");
    await buscarCotacaoAV("cafe");
    await buscarCotacaoAV("cafe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("noticias.buscarNoticiasCultura", () => {
  // A ordem das respostas importa: o serviço busca o Canal Rural e, em seguida, o g1.
  const itemCanal = (titulo, data, descricao) =>
    `<item><title><![CDATA[${titulo}]]></title>` +
    `<link>https://www.canalrural.com.br/${encodeURIComponent(titulo)}/</link>` +
    `<pubDate>${data}</pubDate><description><![CDATA[${descricao}]]></description></item>`;

  const itemG1 = (titulo, data, resumo) =>
    `<item><title>${titulo}</title><atom:subtitle>${resumo}</atom:subtitle>` +
    `<link>https://g1.globo.com/economia/agronegocios/noticia/${encodeURIComponent(titulo)}.ghtml</link>` +
    `<pubDate>${data}</pubDate><description><![CDATA[<img src="foto.jpg"/>]]></description></item>`;

  const DIA_23 = "Fri, 23 Oct 2026 10:00:00 GMT";
  const DIA_24 = "Sat, 24 Oct 2026 10:00:00 GMT";

  // Como o Canal Rural entrega de verdade: legenda com crédito da foto antes do
  // texto e, no fim, a assinatura automática do WordPress.
  const descricaoCanal =
    '<div><figure><img src="x.jpg"/><figcaption>Foto: Canal Rural/Divulgação</figcaption></figure></div>' +
    "<p>Queda das cotações em Nova York pressiona os preços do café no mercado brasileiro.</p>" +
    '<p>O post <a href="x">Preço do café recua</a> apareceu primeiro em <a href="y">Canal Rural</a>.</p>';

  const rssCanal = `<rss>${itemCanal("Preço do café recua e fecha a semana em queda", DIA_23, descricaoCanal)}</rss>`;
  const rssG1 =
    `<rss>${itemG1("Exportação de café bate recorde no trimestre", DIA_24, "Volume embarcado superou o do ano passado, segundo a Cecafé.")}` +
    `${itemG1("Frango pode ficar mais barato no Sul", DIA_24, "Suspensão de compras pela China deve aumentar a oferta interna.")}</rss>`;

  test("cultura sem termos cadastrados retorna [] sem bater nos feeds", async () => {
    const fetchMock = mockFetch();
    expect(await carregar("services/noticias.js").buscarNoticiasCultura("arroz")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("tira o crédito da foto e a assinatura do WordPress do resumo", async () => {
    mockFetch(resposta({ text: rssCanal }), resposta({ text: "<rss></rss>" }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    const canal = r.find((n) => n.fonte === "Canal Rural");
    expect(canal.resumo).toBe(
      "Queda das cotações em Nova York pressiona os preços do café no mercado brasileiro."
    );
    expect(canal.resumo).not.toContain("Foto:");
    expect(canal.resumo).not.toContain("apareceu primeiro em");
    expect(canal.link).toContain("canalrural.com.br");
  });

  test("no g1 usa o <atom:subtitle>, porque o <description> é só a imagem", async () => {
    mockFetch(resposta({ text: "<rss></rss>" }), resposta({ text: rssG1 }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    const g1 = r.find((n) => n.fonte === "g1 Agronegócios");
    expect(g1.resumo).toBe("Volume embarcado superou o do ano passado, segundo a Cecafé.");
    expect(g1.resumo).not.toContain("img");
    expect(g1.dataTexto).toMatch(/2026/);
  });

  test("filtra o feed geral do g1 pela cultura pedida", async () => {
    mockFetch(resposta({ text: rssCanal }), resposta({ text: rssG1 }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    const titulos = r.map((n) => n.titulo);
    expect(titulos).toContain("Exportação de café bate recorde no trimestre");
    expect(titulos).not.toContain("Frango pode ficar mais barato no Sul");
  });

  test("ordena da mais recente para a mais antiga", async () => {
    mockFetch(resposta({ text: rssCanal }), resposta({ text: rssG1 }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    expect(r[0].titulo).toBe("Exportação de café bate recorde no trimestre"); // dia 24
    expect(r[1].titulo).toBe("Preço do café recua e fecha a semana em queda"); // dia 23
  });

  test("não repete a mesma manchete vinda das duas fontes", async () => {
    const mesmo = "Preço do café sobe com a quebra de safra";
    mockFetch(
      resposta({
        text: `<rss>${itemCanal(mesmo, DIA_23, "<p>Cotação do café em alta na bolsa de Nova York.</p>")}</rss>`,
      }),
      resposta({
        text: `<rss>${itemG1(mesmo, DIA_24, "Cotação do café em alta na bolsa de Nova York, diz consultoria.")}</rss>`,
      })
    );
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    expect(r).toHaveLength(1);
    expect(r[0].titulo).toBe(mesmo);
  });

  test("um feed fora do ar não impede o outro de alimentar a página", async () => {
    mockFetch(new Error("canal rural fora"), resposta({ text: rssG1 }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    expect(r).toHaveLength(1);
    expect(r[0].fonte).toBe("g1 Agronegócios");
  });

  test.each([
    ["erro de rede nos dois", () => [new Error("x"), new Error("y")]],
    [
      "HTTP não-ok nos dois",
      () => [resposta({ ok: false, status: 500, text: "" }), resposta({ ok: false, status: 503, text: "" })],
    ],
    ["resposta sem <item>", () => [resposta({ text: "<rss></rss>" }), resposta({ text: "<rss></rss>" })]],
  ])("%s retorna []", async (_, fabricar) => {
    const fetchMock = mockFetch(...fabricar());
    expect(await carregar("services/noticias.js").buscarNoticiasCultura("cafe")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("completa com o resto da busca do Canal Rural quando o filtro deixa a lista magra", async () => {
    // A busca do Canal Rural casa o termo no corpo da matéria, que não vem no RSS:
    // esses dois itens são pertinentes mesmo sem repetir "café" no título ou resumo.
    const xml =
      `<rss>${itemCanal("Preço do café recua e fecha a semana em queda", DIA_23, descricaoCanal)}` +
      `${itemCanal("IPCA-15 desacelera em outubro, aponta o IBGE", DIA_24, "<p>Índice veio abaixo do esperado pelo mercado financeiro.</p>")}` +
      `${itemCanal("Porto de Paranaguá amplia a capacidade de embarque", DIA_24, "<p>Obra deve reduzir a fila de navios na safra nova.</p>")}</rss>`;
    mockFetch(resposta({ text: xml }), resposta({ text: "<rss></rss>" }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    expect(r).toHaveLength(3);
    expect(r.map((n) => n.titulo)).toContain("IPCA-15 desacelera em outubro, aponta o IBGE");
  });

  test("corta o resumo longo no fim de uma frase", async () => {
    const frase = "O mercado de café segue atento ao clima nas regiões produtoras de Minas Gerais. ";
    const xml = `<rss>${itemCanal("Café: clima dita o humor do mercado", DIA_23, "<p>" + frase.repeat(6) + "</p>")}</rss>`;
    mockFetch(resposta({ text: xml }), resposta({ text: "<rss></rss>" }));
    const [n] = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    expect(n.resumo.length).toBeLessThanOrEqual(320);
    expect(n.resumo.endsWith(".")).toBe(true);
  });

  test("devolve no máximo 12 notícias", async () => {
    const muitos = Array.from({ length: 15 }, (_, i) =>
      itemCanal(
        "Café em alta pela " + i + "ª semana seguida",
        DIA_23,
        "<p>Cotação do café avança no mercado físico brasileiro.</p>"
      )
    ).join("");
    mockFetch(resposta({ text: `<rss>${muitos}</rss>` }), resposta({ text: "<rss></rss>" }));
    const r = await carregar("services/noticias.js").buscarNoticiasCultura("cafe");
    expect(r).toHaveLength(12);
    expect(r.every((n) => n.resumo.length > 40)).toBe(true);
  });

  test("usa cache na segunda chamada da mesma cultura", async () => {
    const fetchMock = mockFetch(resposta({ text: rssCanal }), resposta({ text: rssG1 }));
    const { buscarNoticiasCultura } = carregar("services/noticias.js");
    const a = await buscarNoticiasCultura("cafe");
    const b = await buscarNoticiasCultura("cafe");
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(2); // uma por feed, só na primeira vez
  });
});

describe("market (histórico e análise de tendência)", () => {
  const noticia = [{ titulo: "Notícia de teste longa", fonte: "T" }];

  test("obterHistorico devolve a série da cultura ou null", () => {
    const { obterHistorico } = carregar("services/market.js");
    const cafe = obterHistorico("cafe");
    expect(Array.isArray(cafe.historico)).toBe(true);
    expect(cafe.unidade).toMatch(/saca/);
    expect(obterHistorico("arroz")).toBeNull();
  });

  test("análise simulada (sem chave) calcula a variação e usa as notícias", async () => {
    jest.resetModules();
    jest.doMock("../../../backend/services/noticias", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue(noticia) }));
    const { gerarAnaliseTendencia, obterHistorico } = require("../../../backend/services/market");
    const hist = obterHistorico("cafe").historico.slice(-14);
    const esperada = (((hist[13].preco - hist[0].preco) / hist[0].preco) * 100).toFixed(1);

    const r = await gerarAnaliseTendencia("cafe");
    expect(r.gerarPor).toBe("simulado");
    expect(r.variacaoPercentual).toBe(Number(esperada));
    expect(r.precoAtual).toBe(hist[13].preco);
    expect(r.fatoresConsiderados).toEqual(noticia);
    expect(r.resumo).toContain(Number(esperada) >= 0 ? "alta" : "queda");
    jest.dontMock("../../../backend/services/noticias");
  });

  test("sem notícias reais usa o fallback de curadoria interna", async () => {
    jest.resetModules();
    jest.doMock("../../../backend/services/noticias", () => ({ buscarNoticiasCultura: jest.fn().mockRejectedValue(new Error("x")) }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("soja");
    expect(r.fatoresConsiderados).toHaveLength(3);
    expect(r.fatoresConsiderados[0].fonte).toBe("Curadoria interna");
    jest.dontMock("../../../backend/services/noticias");
  });

  test("cultura desconhecida lança erro", async () => {
    const { gerarAnaliseTendencia } = carregar("services/market.js");
    await expect(gerarAnaliseTendencia("arroz")).rejects.toThrow("Cultura não suportada");
  });

  test("com chave, usa o texto da IA", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.resetModules();
    jest.doMock("../../../backend/services/noticias", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue(noticia) }));
    const fetchMock = mockFetch(resposta({ json: { content: [{ type: "text", text: "Análise A" }, { type: "tool", text: "x" }, { type: "text", text: "B" }] } }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("cafe");
    expect(r.gerarPor).toBe("ia");
    expect(r.resumo).toBe("Análise A\nB");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain("café arábica");
    jest.dontMock("../../../backend/services/noticias");
  });

  test("com chave mas IA falhando, cai para o simulado", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.resetModules();
    jest.doMock("../../../backend/services/noticias", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue(noticia) }));
    mockFetch(resposta({ ok: false, status: 500, json: {}, text: "erro" }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("soja");
    expect(r.gerarPor).toBe("simulado");
    expect(r.cultura).toBe("soja");
    jest.dontMock("../../../backend/services/noticias");
  });

  test("IA devolvendo texto vazio usa mensagem padrão", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.resetModules();
    jest.doMock("../../../backend/services/noticias", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue([]) }));
    mockFetch(resposta({ json: { content: [] } }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("cafe");
    expect(r.resumo).toMatch(/Não foi possível gerar/);
    expect(r.gerarPor).toBe("ia");
    jest.dontMock("../../../backend/services/noticias");
  });
});

describe("insumosIA.gerarInsightCompra", () => {
  test("categoria inexistente lança erro", async () => {
    await expect(carregar("services/insumosIA.js").gerarInsightCompra("xyz")).rejects.toThrow("Categoria de insumo não encontrada: xyz");
  });

  test("modo simulado cita o menor preço da categoria", async () => {
    const r = await carregar("services/insumosIA.js").gerarInsightCompra("fungicida");
    expect(r).toMatchObject({ categoria: "fungicida", nomeCategoria: "fungicidas", gerarPor: "simulado" });
    expect(r.recomendacao).toContain("R$ 64.50");
  });

  test("com chave usa a resposta da IA", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    mockFetch(resposta({ json: { content: [{ type: "text", text: "Compre agora" }] } }));
    const r = await carregar("services/insumosIA.js").gerarInsightCompra("irrigacao");
    expect(r.gerarPor).toBe("ia");
    expect(r.recomendacao).toBe("Compre agora");
  });

  test("com chave e falha da IA, usa o simulado", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    mockFetch(new Error("rede"));
    const r = await carregar("services/insumosIA.js").gerarInsightCompra("hidrogel");
    expect(r.gerarPor).toBe("simulado");
    expect(r.recomendacao).toContain("R$ 89.00");
  });

  test("IA com resposta vazia usa texto padrão", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    mockFetch(resposta({ json: { content: [] } }));
    const r = await carregar("services/insumosIA.js").gerarInsightCompra("fungicida");
    expect(r.recomendacao).toMatch(/Não foi possível gerar/);
    expect(r.gerarPor).toBe("ia");
  });
});
