const { resposta, mockFetch, carregar } = require("../helpers/http");

afterEach(() => {
  delete process.env.OPENWEATHER_API_KEY;
});

describe("weather.buscarClimaAtual - modo simulado (sem chave)", () => {
  test("gera clima simulado determinístico por coordenada, sem chamar a rede", async () => {
    const fetchMock = mockFetch();
    const { buscarClimaAtual } = carregar("services/weather.js");
    const a = await buscarClimaAtual(-22.25, -45.7);
    const b = await buscarClimaAtual(-22.25, -45.7);

    expect(a.fonte).toBe("simulado");
    expect(a.previsaoDiaria).toHaveLength(7);
    expect(a.temperaturaMinima).toBe(b.temperaturaMinima);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("todos os indicadores do motor de regras estão presentes e numéricos", async () => {
    const { buscarClimaAtual } = carregar("services/weather.js");
    const c = await buscarClimaAtual(-18, -44);
    ["temperaturaMinima", "chuvaAcumulada7dias", "diasSemChuva", "probabilidadeChuva7dias", "ventoMaximoKmh"]
      .forEach((k) => expect(typeof c[k]).toBe("number"));
    expect(c.previsaoDiaria[0]).toHaveProperty("data");
  });
});

describe("weather.buscarClimaAtual - modo real (com chave)", () => {
  // dt em UTC; fuso -3h => 21h-23h59 local caem no dia seguinte UTC
  const lista = [
    { dt: 1700000000, main: { temp: 20, temp_min: 18 }, pop: 0.2, wind: { speed: 5 } },
    { dt: 1700010800, main: { temp: 22, temp_min: 10 }, pop: 0.8, rain: { "3h": 4 }, wind: { speed: 10 } },
    { dt: 1700097200, main: { temp: 25, temp_min: 15 }, pop: 0, wind: { speed: 2 } },
  ];

  test("processa a previsão da OpenWeatherMap em indicadores agronômicos", async () => {
    process.env.OPENWEATHER_API_KEY = " chave ";
    const fetchMock = mockFetch(resposta({ json: { list: lista, city: { timezone: -10800 } } }));
    const c = await carregar("services/weather.js").buscarClimaAtual(-22, -45);

    expect(fetchMock.mock.calls[0][0]).toContain("appid=chave&");
    expect(c.fonte).toBe("openweathermap");
    expect(c.temperaturaMinima).toBe(10);
    expect(c.chuvaAcumulada7dias).toBe(4);
    expect(c.ventoMaximoKmh).toBe(36); // 10 m/s * 3.6
    expect(c.probabilidadeChuva7dias).toBe(33);
    expect(c.previsaoDiaria.length).toBeGreaterThan(0);
  });

  test("itens sem rain/wind/pop e city ausente não quebram", async () => {
    process.env.OPENWEATHER_API_KEY = "k";
    mockFetch(resposta({ json: { list: [{ dt: 1700000000, main: { temp: 20, temp_min: 20 } }] } }));
    const c = await carregar("services/weather.js").buscarClimaAtual(1, 1);
    expect(c.chuvaAcumulada7dias).toBe(0);
    expect(c.ventoMaximoKmh).toBe(0);
  });

  test("com 3+ dias completos descarta os parciais na previsão diária", async () => {
    process.env.OPENWEATHER_API_KEY = "k";
    const base = Date.UTC(2026, 0, 1) / 1000;
    const itens = [];
    for (let dia = 0; dia < 4; dia++) {
      const blocos = dia === 0 ? 2 : 8; // primeiro dia incompleto
      for (let b = 0; b < blocos; b++) {
        itens.push({ dt: base + dia * 86400 + b * 10800, main: { temp: 20 + b, temp_min: 15 }, pop: 0.5 });
      }
    }
    mockFetch(resposta({ json: { list: itens, city: { timezone: 0 } } }));
    const c = await carregar("services/weather.js").buscarClimaAtual(1, 1);
    expect(c.previsaoDiaria).toHaveLength(3);
    expect(c.previsaoDiaria[0].data).toBe("2026-01-02");
    expect(c.previsaoDiaria[0].tempMax).toBe(27);
  });

  test("HTTP 401 cai para o simulado", async () => {
    process.env.OPENWEATHER_API_KEY = "k";
    mockFetch(resposta({ ok: false, status: 401, json: {}, text: "invalid" }));
    const c = await carregar("services/weather.js").buscarClimaAtual(1, 1);
    expect(c.fonte).toBe("simulado");
    expect(c.previsaoDiaria).toHaveLength(7);
  });

  test("erro de rede cai para o simulado", async () => {
    process.env.OPENWEATHER_API_KEY = "k";
    mockFetch(new Error("rede"));
    const c = await carregar("services/weather.js").buscarClimaAtual(1, 1);
    expect(c.fonte).toBe("simulado");
  });
});

describe("openmeteo.buscarClimaOpenMeteo", () => {
  const previsao = {
    daily: {
      time: ["2026-01-01", "2026-01-02", "2026-01-03"],
      temperature_2m_min: [10, 4.26, null],
      temperature_2m_max: [28, 30, null],
      precipitation_sum: [0, 12, null],
      precipitation_probability_max: [10, 70, null],
      wind_speed_10m_max: [20, 45.6, null],
      et0_fao_evapotranspiration: [3, 4, null],
    },
  };
  const historico = { daily: { precipitation_sum: [0, 0.5, 5, null, 0.99] } };

  test("combina previsão e histórico e calcula os indicadores", async () => {
    mockFetch(resposta({ json: previsao }), resposta({ json: historico }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(-22.25, -45.7);

    expect(c.fonte).toBe("open-meteo");
    expect(c.temperaturaMinima).toBe(4.3);
    expect(c.chuvaAcumulada7dias).toBe(12);
    expect(c.probabilidadeChuva7dias).toBe(70);
    expect(c.ventoMaximoKmh).toBe(46);
    expect(c.evapotranspiracao7dias).toBe(7);
    // Sequência seca contada de trás para frente: 0.99 e null ficam abaixo de
    // 1 mm, e os 5 mm anteriores interrompem a contagem.
    expect(c.diasSemChuva).toBe(2);
  });

  test("a estiagem conta só os dias secos consecutivos até ontem", async () => {
    const seca = { daily: { precipitation_sum: [20, 0, 0, 0, 0] } };
    mockFetch(resposta({ json: previsao }), resposta({ json: seca }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(-22.25, -45.7);
    expect(c.diasSemChuva).toBe(4);
  });

  test("chuva recente zera a contagem de estiagem", async () => {
    const choveuOntem = { daily: { precipitation_sum: [0, 0, 0, 0, 12] } };
    mockFetch(resposta({ json: previsao }), resposta({ json: choveuOntem }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(-22.25, -45.7);
    expect(c.diasSemChuva).toBe(0);
  });

  test("descreve cada dia com descrição e ícone coerentes com a chuva", async () => {
    mockFetch(resposta({ json: previsao }), resposta({ json: historico }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(1, 1);
    expect(c.previsaoDiaria.map((d) => d.descricao)).toEqual(["Ensolarado", "Chuva", "Ensolarado"]);
    expect(c.previsaoDiaria[1].icone).toBe("🌧");
    expect(c.previsaoDiaria[2].tempMax).toBe(25); // null => padrão
  });

  test("faixas intermediárias: nublado e chuvoso", async () => {
    const dados = { daily: { time: ["a", "b"], precipitation_sum: [0, 3], precipitation_probability_max: [40, 10] } };
    mockFetch(resposta({ json: dados }), resposta({ json: historico }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(2, 2);
    expect(c.previsaoDiaria.map((d) => d.descricao)).toEqual(["Nublado", "Chuvoso"]);
    expect(c.previsaoDiaria.map((d) => d.icone)).toEqual(["⛅", "🌦"]);
  });

  test("sem histórico, diasSemChuva fica 0 e a previsão ainda é usada", async () => {
    mockFetch(resposta({ json: previsao }), resposta({ ok: false, status: 500, json: {} }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(3, 3);
    expect(c.diasSemChuva).toBe(0);
    expect(c.temperaturaMinima).toBe(4.3);
  });

  test("previsão vazia usa valores padrão", async () => {
    mockFetch(resposta({ json: { daily: {} } }), resposta({ json: {} }));
    const c = await carregar("services/openmeteo.js").buscarClimaOpenMeteo(4, 4);
    expect(c.temperaturaMinima).toBe(15);
    expect(c.previsaoDiaria).toEqual([]);
  });

  test("falha na previsão rejeita a promessa", async () => {
    mockFetch(resposta({ ok: false, status: 500, json: {} }), resposta({ json: historico }));
    await expect(carregar("services/openmeteo.js").buscarClimaOpenMeteo(5, 5)).rejects.toThrow("Open-Meteo HTTP 500");
  });

  test("erro lógico da API (error:true) rejeita com o motivo", async () => {
    mockFetch(resposta({ json: { error: true, reason: "limite" } }), resposta({ json: historico }));
    await expect(carregar("services/openmeteo.js").buscarClimaOpenMeteo(6, 6)).rejects.toThrow("Open-Meteo: limite");
  });

  test("segunda chamada com as mesmas coordenadas usa o cache", async () => {
    const fetchMock = mockFetch(resposta({ json: previsao }), resposta({ json: historico }));
    const { buscarClimaOpenMeteo } = carregar("services/openmeteo.js");
    await buscarClimaOpenMeteo(7, 7);
    await buscarClimaOpenMeteo(7, 7);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 previsão + 1 histórico, nenhuma repetida
  });
});

describe("inmet.extrairUF", () => {
  const { extrairUF } = carregar("services/inmet.js");

  test.each([
    ["Lavras - MG", "MG"],
    ["Rua A, Centro, Santa Rita - SP", "SP"],
    ["Sem UF aqui", ""],
    ["", ""],
    [null, ""],
  ])("extrairUF(%p) => %p", (entrada, esperado) => {
    expect(extrairUF(entrada)).toBe(esperado);
    expect(typeof extrairUF(entrada)).toBe("string");
  });
});

describe("inmet.buscarAlertasINMET", () => {
  const aviso = (extra) => ({
    nivel_severidade: "Laranja",
    descricao_do_aviso: "Chuvas intensas",
    instrucoes: "Evite áreas alagadas",
    data_inicio: "2026-01-01 10:00:00",
    data_fim: "2026-01-02 10:00:00",
    estados: ["MG", "SP"],
    ...extra,
  });

  test("converte avisos oficiais e filtra pela UF", async () => {
    mockFetch(resposta({ text: JSON.stringify([aviso(), aviso({ estados: ["RS"], descricao_do_aviso: "Frio" })]) }));
    const r = await carregar("services/inmet.js").buscarAlertasINMET("MG");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ nivel: "medio", descricao: "Chuvas intensas", instrucao: "Evite áreas alagadas" });
    expect(r[0].janela).toContain("–");
  });

  test.each([
    ["amarelo", "baixo"],
    ["Vermelho", "alto"],
    ["severe", "alto"],
    ["desconhecido", "baixo"],
  ])("severidade %p vira nível %p", async (sev, nivel) => {
    mockFetch(resposta({ text: JSON.stringify([aviso({ nivel_severidade: sev })]) }));
    const [r] = await carregar("services/inmet.js").buscarAlertasINMET("");
    expect(r.nivel).toBe(nivel);
  });

  test("aceita formatos { avisos } e GeoJSON { features }", async () => {
    mockFetch(
      resposta({ text: JSON.stringify({ avisos: [aviso()] }) }),
      resposta({ text: JSON.stringify({ features: [{ properties: { nivel: "extreme", descricao: "Ciclone", estados: ["MG"] } }] }) })
    );
    const { buscarAlertasINMET } = carregar("services/inmet.js");
    expect(await buscarAlertasINMET("MG")).toHaveLength(1);
    const geo = await buscarAlertasINMET("SP"); // chave de cache diferente
    expect(geo).toEqual([]); // MG != SP
  });

  test("descarta avisos sem descrição e aceita aviso sem estados", async () => {
    mockFetch(resposta({ text: JSON.stringify([aviso({ descricao_do_aviso: "" }), aviso({ estados: [], descricao_do_aviso: "Geral" })]) }));
    const r = await carregar("services/inmet.js").buscarAlertasINMET("MG");
    expect(r).toHaveLength(1);
    expect(r[0].descricao).toBe("Geral");
  });

  test("sem datas a janela é um traço", async () => {
    mockFetch(resposta({ text: JSON.stringify([aviso({ data_inicio: "", data_fim: "" })]) }));
    const [r] = await carregar("services/inmet.js").buscarAlertasINMET("");
    expect(r.janela).toBe("—");
  });

  test("HTTP não-ok, corpo vazio, JSON inválido e erro de rede retornam []", async () => {
    mockFetch(
      resposta({ ok: false, status: 500, json: {} }),
      resposta({ text: " " }),
      resposta({ text: "<html>" }),
      new Error("rede")
    );
    const { buscarAlertasINMET } = carregar("services/inmet.js");
    expect(await buscarAlertasINMET("a")).toEqual([]);
    expect(await buscarAlertasINMET("b")).toEqual([]);
    expect(await buscarAlertasINMET("c")).toEqual([]);
    expect(await buscarAlertasINMET("d")).toEqual([]);
  });

  test("segunda consulta da mesma UF vem do cache", async () => {
    const fetchMock = mockFetch(resposta({ text: JSON.stringify([aviso()]) }));
    const { buscarAlertasINMET } = carregar("services/inmet.js");
    const a = await buscarAlertasINMET("MG");
    const b = await buscarAlertasINMET("MG");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });
});
