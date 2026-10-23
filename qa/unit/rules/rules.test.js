const { avaliarAlertas, culturasSuportadas, NIVEIS } = require("../../../backend/services/rules");

const climaBase = {
  temperaturaMinima: 15,
  diasSemChuva: 0,
  chuvaAcumulada7dias: 20,
  probabilidadeChuva7dias: 10,
  ventoMaximoKmh: 10,
};
const clima = (extra) => ({ ...climaBase, ...extra });
const ids = (alertas) => alertas.map((a) => a.id);

describe("rules.culturasSuportadas / NIVEIS", () => {
  test("suporta somente café e soja", () => {
    const culturas = culturasSuportadas();
    expect(culturas).toEqual(["cafe", "soja"]);
    expect(culturas).toHaveLength(2);
  });

  test("expõe os três níveis de severidade", () => {
    expect(NIVEIS).toEqual({ BAIXO: "baixo", MEDIO: "medio", ALTO: "alto" });
    expect(Object.keys(NIVEIS)).toHaveLength(3);
  });
});

describe("rules.avaliarAlertas - café: geada", () => {
  test.each([
    [2, "alto"],
    [0, "alto"],
    [-3, "alto"],
    [2.1, "medio"],
    [5, "medio"],
  ])("temperatura mínima %p gera geada nível %s", (temp, nivel) => {
    const alertas = avaliarAlertas("cafe", "vegetativo", clima({ temperaturaMinima: temp }));
    const geada = alertas.find((a) => a.id === "cafe_geada");
    expect(geada).toBeDefined();
    expect(geada.nivel).toBe(nivel);
  });

  test("temperatura 5.1°C não gera alerta de geada", () => {
    const alertas = avaliarAlertas("cafe", "vegetativo", clima({ temperaturaMinima: 5.1 }));
    expect(ids(alertas)).not.toContain("cafe_geada");
    expect(alertas).toHaveLength(0);
  });

  test("mensagem de geada alta cita a temperatura e recomenda proteção", () => {
    const [alerta] = avaliarAlertas("cafe", "vegetativo", clima({ temperaturaMinima: 1 }));
    expect(alerta.mensagem).toContain("1°C");
    expect(alerta.recomendacao).toMatch(/proteção contra geada/);
    expect(alerta.janela).toBe("próximas 48h");
  });
});

describe("rules.avaliarAlertas - café: estiagem", () => {
  test("15 dias sem chuva em floração é nível alto", () => {
    const [a] = avaliarAlertas("cafe", "floracao", clima({ diasSemChuva: 15 }));
    expect(a.id).toBe("cafe_estiagem");
    expect(a.nivel).toBe("alto");
    expect(a.mensagem).toContain("floracao");
  });

  test("granação também é fase crítica", () => {
    const [a] = avaliarAlertas("cafe", "granacao", clima({ diasSemChuva: 20 }));
    expect(a.nivel).toBe("alto");
    expect(a.janela).toBe("últimos 20 dias");
  });

  test("15 dias sem chuva em fase não crítica cai para nível médio", () => {
    const [a] = avaliarAlertas("cafe", "vegetativo", clima({ diasSemChuva: 15 }));
    expect(a.nivel).toBe("medio");
    expect(a.id).toBe("cafe_estiagem");
  });

  test("10 dias sem chuva é nível médio", () => {
    const [a] = avaliarAlertas("cafe", "vegetativo", clima({ diasSemChuva: 10 }));
    expect(a.nivel).toBe("medio");
    expect(a.mensagem).toBe("10 dias sem chuva registrados.");
  });

  test("14 dias em floração ainda é médio (limite da fase crítica é 15)", () => {
    const [a] = avaliarAlertas("cafe", "floracao", clima({ diasSemChuva: 14 }));
    expect(a.nivel).toBe("medio");
    expect(a.id).toBe("cafe_estiagem");
  });

  test("9 dias sem chuva não gera alerta", () => {
    const alertas = avaliarAlertas("cafe", "floracao", clima({ diasSemChuva: 9 }));
    expect(alertas).toEqual([]);
    expect(alertas).toHaveLength(0);
  });
});

describe("rules.avaliarAlertas - café: excesso de chuva", () => {
  test("150 mm acumulados gera alerta médio sobre ferrugem", () => {
    const [a] = avaliarAlertas("cafe", "vegetativo", clima({ chuvaAcumulada7dias: 150 }));
    expect(a.id).toBe("cafe_excesso_chuva");
    expect(a.nivel).toBe("medio");
    expect(a.mensagem).toMatch(/ferrugem/);
  });

  test("149.9 mm não gera alerta", () => {
    const alertas = avaliarAlertas("cafe", "vegetativo", clima({ chuvaAcumulada7dias: 149.9 }));
    expect(alertas).toHaveLength(0);
    expect(ids(alertas)).not.toContain("cafe_excesso_chuva");
  });
});

describe("rules.avaliarAlertas - soja: estiagem", () => {
  test("10 dias sem chuva em floração é alto", () => {
    const [a] = avaliarAlertas("soja", "floracao", clima({ diasSemChuva: 10 }));
    expect(a.id).toBe("soja_estiagem");
    expect(a.nivel).toBe("alto");
  });

  test("enchimento_graos é fase crítica", () => {
    const [a] = avaliarAlertas("soja", "enchimento_graos", clima({ diasSemChuva: 12 }));
    expect(a.nivel).toBe("alto");
    expect(a.mensagem).toContain("enchimento_graos");
  });

  test("10 dias sem chuva fora de fase crítica é médio", () => {
    const [a] = avaliarAlertas("soja", "vegetativo", clima({ diasSemChuva: 10 }));
    expect(a.nivel).toBe("medio");
    expect(a.id).toBe("soja_estiagem");
  });

  test("7 dias é médio e 6 dias não gera alerta", () => {
    const sete = avaliarAlertas("soja", "vegetativo", clima({ diasSemChuva: 7 }));
    const seis = avaliarAlertas("soja", "vegetativo", clima({ diasSemChuva: 6 }));
    expect(sete[0].nivel).toBe("medio");
    expect(seis).toHaveLength(0);
  });
});

describe("rules.avaliarAlertas - soja: chuva na colheita e vento", () => {
  test("colheita com 60% de chance de chuva gera alerta médio", () => {
    const [a] = avaliarAlertas("soja", "colheita", clima({ probabilidadeChuva7dias: 60 }));
    expect(a.id).toBe("soja_chuva_colheita");
    expect(a.nivel).toBe("medio");
    expect(a.mensagem).toContain("60%");
  });

  test("59% em colheita não gera alerta", () => {
    expect(avaliarAlertas("soja", "colheita", clima({ probabilidadeChuva7dias: 59 }))).toHaveLength(0);
  });

  test("probabilidade alta fora da colheita não gera alerta", () => {
    const alertas = avaliarAlertas("soja", "floracao", clima({ probabilidadeChuva7dias: 90 }));
    expect(ids(alertas)).not.toContain("soja_chuva_colheita");
    expect(alertas).toHaveLength(0);
  });

  test("vento de 60 km/h gera alerta alto de acamamento", () => {
    const [a] = avaliarAlertas("soja", "vegetativo", clima({ ventoMaximoKmh: 60 }));
    expect(a.id).toBe("soja_vento_forte");
    expect(a.nivel).toBe("alto");
    expect(a.recomendacao).toMatch(/acamamento/);
  });

  test("vento de 59 km/h não gera alerta", () => {
    expect(avaliarAlertas("soja", "vegetativo", clima({ ventoMaximoKmh: 59 }))).toHaveLength(0);
  });
});

describe("rules.avaliarAlertas - comportamento geral", () => {
  test("ordena alertas do mais severo para o menos severo", () => {
    const alertas = avaliarAlertas(
      "cafe",
      "vegetativo",
      clima({ chuvaAcumulada7dias: 200, temperaturaMinima: 1, diasSemChuva: 10 })
    );
    expect(alertas.map((a) => a.nivel)).toEqual(["alto", "medio", "medio"]);
    expect(alertas[0].id).toBe("cafe_geada");
  });

  test("cada alerta carrega cultura, fase, id, título e geradoEm ISO", () => {
    const [a] = avaliarAlertas("soja", "vegetativo", clima({ ventoMaximoKmh: 80 }));
    expect(a).toMatchObject({ cultura: "soja", fase: "vegetativo", titulo: "Ventos fortes" });
    expect(new Date(a.geradoEm).toISOString()).toBe(a.geradoEm);
  });

  test("cultura desconhecida retorna lista vazia", () => {
    const alertas = avaliarAlertas("milho", "floracao", clima({ temperaturaMinima: -5 }));
    expect(alertas).toEqual([]);
    expect(Array.isArray(alertas)).toBe(true);
  });

  test("regras de café não disparam para soja e vice-versa", () => {
    const geadaSoja = avaliarAlertas("soja", "vegetativo", clima({ temperaturaMinima: -2 }));
    const ventoCafe = avaliarAlertas("cafe", "vegetativo", clima({ ventoMaximoKmh: 100 }));
    expect(geadaSoja).toHaveLength(0);
    expect(ventoCafe).toHaveLength(0);
  });

  test("clima tranquilo não gera alertas para nenhuma cultura", () => {
    expect(avaliarAlertas("cafe", "floracao", climaBase)).toHaveLength(0);
    expect(avaliarAlertas("soja", "colheita", climaBase)).toHaveLength(0);
  });
});
