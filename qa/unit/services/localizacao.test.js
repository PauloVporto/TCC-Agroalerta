const { resposta, mockFetch, carregar } = require("../helpers/http");

describe("viacep.consultarCep", () => {
  const viacep = () => carregar("services/viacep.js");

  test("CEP com menos de 8 dígitos é rejeitado sem chamar a API", async () => {
    const fetchMock = mockFetch();
    const r = await viacep().consultarCep("123");
    expect(r.valido).toBe(false);
    expect(r.erro).toMatch(/8 dígitos/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("CEP nulo/vazio também é inválido", async () => {
    mockFetch();
    expect((await viacep().consultarCep(null)).valido).toBe(false);
    expect((await viacep().consultarCep("")).erro).toMatch(/CEP inválido/);
  });

  test("CEP válido devolve cidade/UF e remove a máscara na URL", async () => {
    const fetchMock = mockFetch(resposta({ json: { cep: "37540-000", logradouro: "Rua A", bairro: "Centro", localidade: "Santa Rita", uf: "MG" } }));
    const r = await viacep().consultarCep("37540-000");
    expect(r).toEqual({ valido: true, cep: "37540-000", logradouro: "Rua A", bairro: "Centro", cidade: "Santa Rita", uf: "MG" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://viacep.com.br/ws/37540000/json/");
  });

  test("campos opcionais ausentes viram string vazia", async () => {
    mockFetch(resposta({ json: { cep: "1", localidade: "X", uf: "MG" } }));
    const r = await viacep().consultarCep("37540000");
    expect(r.logradouro).toBe("");
    expect(r.bairro).toBe("");
  });

  test("CEP inexistente (erro:true) devolve 'não encontrado'", async () => {
    mockFetch(resposta({ json: { erro: true } }));
    const r = await viacep().consultarCep("00000000");
    expect(r.valido).toBe(false);
    expect(r.erro).toMatch(/não encontrado/);
  });

  test("HTTP não-ok devolve mensagem de indisponibilidade", async () => {
    mockFetch(resposta({ ok: false, status: 500, json: {} }));
    const r = await viacep().consultarCep("37540000");
    expect(r.valido).toBe(false);
    expect(r.erro).toMatch(/Tente novamente/);
  });

  test("falha de rede devolve mensagem de indisponibilidade", async () => {
    mockFetch(new Error("ECONNRESET"));
    const r = await viacep().consultarCep("37540000");
    expect(r.valido).toBe(false);
    expect(r.erro).toMatch(/Não foi possível verificar/);
  });
});

describe("nominatim.geocodificarComNominatim", () => {
  const nominatim = () => carregar("services/nominatim.js");

  test("converte o primeiro resultado em números", async () => {
    const fetchMock = mockFetch(resposta({ json: [{ lat: "-22.25", lon: "-45.7", display_name: "Lavras, MG" }] }));
    const r = await nominatim().geocodificarComNominatim("Lavras, MG, Brasil");
    expect(r).toEqual({ latitude: -22.25, longitude: -45.7, enderecoFormatado: "Lavras, MG", fonte: "nominatim" });
    expect(fetchMock.mock.calls[0][0]).toContain("q=" + encodeURIComponent("Lavras, MG, Brasil"));
  });

  test("lista vazia ou resposta não-array retorna null", async () => {
    mockFetch(resposta({ json: [] }), resposta({ json: { x: 1 } }));
    expect(await nominatim().geocodificarComNominatim("a")).toBeNull();
    expect(await nominatim().geocodificarComNominatim("b")).toBeNull();
  });

  test("HTTP não-ok retorna null", async () => {
    mockFetch(resposta({ ok: false, status: 429, json: {} }));
    expect(await nominatim().geocodificarComNominatim("a")).toBeNull();
  });

  test("erro de rede retorna null", async () => {
    mockFetch(new Error("timeout"));
    expect(await nominatim().geocodificarComNominatim("a")).toBeNull();
  });
});

describe("geocoding.geocodificarEndereco", () => {
  test("usa o Nominatim quando disponível", async () => {
    mockFetch(resposta({ json: [{ lat: "1", lon: "2", display_name: "X" }] }));
    const r = await carregar("services/geocoding.js").geocodificarEndereco("X");
    expect(r.valido).toBe(true);
    expect(r.fonte).toBe("nominatim");
    expect(r.latitude).toBe(1);
  });

  test("cai para a coordenada fixa quando o Nominatim falha", async () => {
    mockFetch(new Error("fora"));
    const r = await carregar("services/geocoding.js").geocodificarEndereco("Endereço Y");
    expect(r).toMatchObject({ valido: true, fonte: "simulado", enderecoFormatado: "Endereço Y" });
    expect(r.latitude).toBe(-18.5122);
  });
});

describe("localizacao.resolverLocalizacaoPorCep", () => {
  const cepOk = resposta({ json: { cep: "37540-000", logradouro: "Rua A", bairro: "Centro", localidade: "Santa Rita", uf: "MG" } });

  test("CEP inválido propaga o erro e não geocodifica", async () => {
    const fetchMock = mockFetch();
    const r = await carregar("services/localizacao.js").resolverLocalizacaoPorCep("12");
    expect(r.valido).toBe(false);
    expect(r.erro).toMatch(/CEP inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("combina ViaCEP + Nominatim", async () => {
    mockFetch(cepOk, resposta({ json: [{ lat: "-22.2", lon: "-45.7", display_name: "Santa Rita do Sapucaí, MG" }] }));
    const r = await carregar("services/localizacao.js").resolverLocalizacaoPorCep("37540-000");
    expect(r).toMatchObject({
      valido: true, cidade: "Santa Rita", uf: "MG", latitude: -22.2, longitude: -45.7,
      enderecoFormatado: "Santa Rita do Sapucaí, MG", fonteCoordenadas: "nominatim",
    });
  });

  test("sem coordenadas do Nominatim usa o fallback e monta o endereço pelo ViaCEP", async () => {
    mockFetch(cepOk, resposta({ json: [] }));
    const r = await carregar("services/localizacao.js").resolverLocalizacaoPorCep("37540000");
    expect(r.fonteCoordenadas).toBe("fallback");
    expect(r.latitude).toBe(-18.5122);
    expect(r.enderecoFormatado).toBe("Rua A, Centro, Santa Rita - MG");
  });
});
