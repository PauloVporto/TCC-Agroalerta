const { resposta, mockFetch, carregar } = require("../helpers/http");

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

  test.each([
    ["HTTP não-ok", () => resposta({ ok: false, status: 500, json: [] })],
    ["array vazio", () => resposta({ json: [] })],
    ["não é array", () => resposta({ json: { a: 1 } })],
    ["todos inválidos", () => resposta({ json: [{ valor: "x" }] })],
    ["erro de rede", () => new Error("x")],
  ])("%s retorna null", async (_, fabricar) => {
    mockFetch(fabricar());
    expect(await carregar("services/bcb.js").buscarIndiceCommoditiesAgro()).toBeNull();
  });

  test("usa cache na segunda chamada", async () => {
    const fetchMock = mockFetch(resposta({ json: [{ data: "a", valor: "1" }] }));
    const { buscarIndiceCommoditiesAgro } = carregar("services/bcb.js");
    await buscarIndiceCommoditiesAgro();
    await buscarIndiceCommoditiesAgro();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("googlenews.buscarNoticiasCultura", () => {
  const item = (titulo, fonte, data) =>
    `<item><title><![CDATA[${titulo} - ${fonte}]]></title><pubDate>${data}</pubDate><source url="x">${fonte}</source></item>`;
  const rss = `<rss>${item("Preço do café sobe forte na bolsa", "Canal Rural", "Mon, 05 Jan 2026 10:00:00 GMT")}${item("Curto", "X", "Mon, 05 Jan 2026 10:00:00 GMT")}${item("Safra de soja deve bater recorde", "Globo Rural", "invalida")}</rss>`;

  test("cultura sem query retorna []", async () => {
    const fetchMock = mockFetch();
    expect(await carregar("services/googlenews.js").buscarNoticiasCultura("arroz")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("extrai título sem o sufixo da fonte e filtra títulos curtos", async () => {
    mockFetch(resposta({ text: rss }));
    const r = await carregar("services/googlenews.js").buscarNoticiasCultura("cafe");
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ titulo: "Preço do café sobe forte na bolsa", fonte: "Canal Rural" });
    expect(r[0].dataTexto).toMatch(/2026/);
    expect(r[1].dataTexto).toBe(""); // data inválida
  });

  test("entende texto simples com entidades HTML e fonte ausente", async () => {
    const xml = "<rss><item><title>Milho &amp; soja em alta - Jornal &lt;b&gt;X&lt;/b&gt;</title></item></rss>";
    mockFetch(resposta({ text: xml }));
    const [n] = await carregar("services/googlenews.js").buscarNoticiasCultura("milho");
    expect(n.fonte).toBe("Google News");
    expect(n.titulo).toBe("Milho & soja em alta");
  });

  test("limita a 5 notícias", async () => {
    const xml = "<rss>" + Array.from({ length: 8 }, (_, i) => item("Notícia número " + i + " longa", "F", "Mon, 05 Jan 2026 10:00:00 GMT")).join("") + "</rss>";
    mockFetch(resposta({ text: xml }));
    expect(await carregar("services/googlenews.js").buscarNoticiasCultura("soja")).toHaveLength(5);
  });

  test.each([
    ["HTTP não-ok", () => resposta({ ok: false, status: 500, text: "" })],
    ["sem <item>", () => resposta({ text: "<rss></rss>" })],
    ["erro de rede", () => new Error("x")],
  ])("%s retorna []", async (_, fabricar) => {
    mockFetch(fabricar());
    expect(await carregar("services/googlenews.js").buscarNoticiasCultura("cafe")).toEqual([]);
  });

  test("usa cache", async () => {
    const fetchMock = mockFetch(resposta({ text: rss }));
    const { buscarNoticiasCultura } = carregar("services/googlenews.js");
    await buscarNoticiasCultura("cafe");
    await buscarNoticiasCultura("cafe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    jest.doMock("../../../backend/services/googlenews", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue(noticia) }));
    const { gerarAnaliseTendencia, obterHistorico } = require("../../../backend/services/market");
    const hist = obterHistorico("cafe").historico.slice(-14);
    const esperada = (((hist[13].preco - hist[0].preco) / hist[0].preco) * 100).toFixed(1);

    const r = await gerarAnaliseTendencia("cafe");
    expect(r.gerarPor).toBe("simulado");
    expect(r.variacaoPercentual).toBe(Number(esperada));
    expect(r.precoAtual).toBe(hist[13].preco);
    expect(r.fatoresConsiderados).toEqual(noticia);
    expect(r.resumo).toContain(Number(esperada) >= 0 ? "alta" : "queda");
    jest.dontMock("../../../backend/services/googlenews");
  });

  test("sem notícias reais usa o fallback de curadoria interna", async () => {
    jest.resetModules();
    jest.doMock("../../../backend/services/googlenews", () => ({ buscarNoticiasCultura: jest.fn().mockRejectedValue(new Error("x")) }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("soja");
    expect(r.fatoresConsiderados).toHaveLength(3);
    expect(r.fatoresConsiderados[0].fonte).toBe("Curadoria interna");
    jest.dontMock("../../../backend/services/googlenews");
  });

  test("cultura desconhecida lança erro", async () => {
    const { gerarAnaliseTendencia } = carregar("services/market.js");
    await expect(gerarAnaliseTendencia("arroz")).rejects.toThrow("Cultura não suportada");
  });

  test("com chave, usa o texto da IA", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.resetModules();
    jest.doMock("../../../backend/services/googlenews", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue(noticia) }));
    const fetchMock = mockFetch(resposta({ json: { content: [{ type: "text", text: "Análise A" }, { type: "tool", text: "x" }, { type: "text", text: "B" }] } }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("cafe");
    expect(r.gerarPor).toBe("ia");
    expect(r.resumo).toBe("Análise A\nB");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain("café arábica");
    jest.dontMock("../../../backend/services/googlenews");
  });

  test("com chave mas IA falhando, cai para o simulado", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.resetModules();
    jest.doMock("../../../backend/services/googlenews", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue(noticia) }));
    mockFetch(resposta({ ok: false, status: 500, json: {}, text: "erro" }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("soja");
    expect(r.gerarPor).toBe("simulado");
    expect(r.cultura).toBe("soja");
    jest.dontMock("../../../backend/services/googlenews");
  });

  test("IA devolvendo texto vazio usa mensagem padrão", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    jest.resetModules();
    jest.doMock("../../../backend/services/googlenews", () => ({ buscarNoticiasCultura: jest.fn().mockResolvedValue([]) }));
    mockFetch(resposta({ json: { content: [] } }));
    const { gerarAnaliseTendencia } = require("../../../backend/services/market");
    const r = await gerarAnaliseTendencia("cafe");
    expect(r.resumo).toMatch(/Não foi possível gerar/);
    expect(r.gerarPor).toBe("ia");
    jest.dontMock("../../../backend/services/googlenews");
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
