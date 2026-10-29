/**
 * 30 cenários climáticos controlados (15 café, 15 soja) para avaliar a IA do monitoramento.
 *
 * O gabarito ("esperado") é calculado pelo motor de regras real (services/rules.js);
 * "intencao" é o que o autor do cenário pretendia testar, declarada à mão. Um teste garante
 * que as duas coincidem, para detectar se os limiares das regras mudarem.
 * Casos ambíguos do ponto de vista agronômico ficam de fora de propósito.
 */
const { avaliarAlertas } = require("../services/rules");
const { tipoDoAlerta, nivelGeralDosAlertas } = require("../services/climaIA");

const BASE = {
  fonte: "cenario-controlado",
  temperaturaMinima: 14,
  chuvaAcumulada7dias: 25,
  diasSemChuva: 2,
  probabilidadeChuva7dias: 40,
  ventoMaximoKmh: 15,
  evapotranspiracao7dias: 28,
};

// [id, cultura, fase, categoria, descrição, ajustes no clima, intenção {nivelGeral, tipos}, pontosChave, naoDeve]
const DEFINICOES = [
  ["C01", "cafe", "vegetativo", "normal", "Café vegetativo com clima ameno", {}, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre geada", "alertar sobre estiagem"]],
  ["C02", "cafe", "floracao", "risco_unico", "Geada forte na floração", { temperaturaMinima: 0.5 }, { nivelGeral: "alto", tipos: ["geada"] },
    ["risco alto de geada", "citar a mínima de 0.5 °C"], ["dizer que não há risco"]],
  ["C03", "cafe", "vegetativo", "limite", "Mínima exatamente no limiar de geada alta (2 °C)", { temperaturaMinima: 2 }, { nivelGeral: "alto", tipos: ["geada"] },
    ["risco alto de geada"], ["dizer que não há risco"]],
  ["C04", "cafe", "granacao", "risco_unico", "Geada moderada na granação", { temperaturaMinima: 4 }, { nivelGeral: "medio", tipos: ["geada"] },
    ["risco moderado de geada", "monitorar a previsão"], ["classificar como risco alto"]],
  ["C05", "cafe", "vegetativo", "limite", "Mínima de 5,5 °C, logo acima do limiar de geada", { temperaturaMinima: 5.5 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre geada"]],
  ["C06", "cafe", "floracao", "risco_unico", "Estiagem crítica na floração (18 dias secos)", { diasSemChuva: 18, chuvaAcumulada7dias: 3, probabilidadeChuva7dias: 20 }, { nivelGeral: "alto", tipos: ["estiagem"] },
    ["risco alto de estiagem na floração", "recomendar irrigação"], ["dizer que não há risco"]],
  ["C07", "cafe", "vegetativo", "risco_unico", "Estiagem moderada fora da fase crítica (12 dias)", { diasSemChuva: 12, chuvaAcumulada7dias: 8 }, { nivelGeral: "medio", tipos: ["estiagem"] },
    ["risco moderado de estiagem"], ["classificar como risco alto"]],
  ["C08", "cafe", "floracao", "limite", "9 dias secos, abaixo do limiar de estiagem", { diasSemChuva: 9, chuvaAcumulada7dias: 10 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre estiagem"]],
  ["C09", "cafe", "vegetativo", "risco_unico", "Excesso de chuva (180 mm em 7 dias)", { chuvaAcumulada7dias: 180, probabilidadeChuva7dias: 90, diasSemChuva: 0 }, { nivelGeral: "medio", tipos: ["excesso_chuva"] },
    ["risco de doenças fúngicas", "citar 180 mm"], ["alertar sobre estiagem"]],
  ["C10", "cafe", "vegetativo", "limite", "149 mm de chuva, logo abaixo do limiar de excesso", { chuvaAcumulada7dias: 149, probabilidadeChuva7dias: 85, diasSemChuva: 0 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre excesso de chuva"]],
  ["C11", "cafe", "vegetativo", "combinado", "Geada moderada e estiagem moderada", { temperaturaMinima: 3, diasSemChuva: 11, chuvaAcumulada7dias: 5 }, { nivelGeral: "medio", tipos: ["geada", "estiagem"] },
    ["mencionar geada e estiagem"], ["classificar como risco alto"]],
  ["C12", "cafe", "granacao", "combinado", "Geada forte e estiagem crítica na granação", { temperaturaMinima: 1, diasSemChuva: 16, chuvaAcumulada7dias: 2, probabilidadeChuva7dias: 10 }, { nivelGeral: "alto", tipos: ["geada", "estiagem"] },
    ["mencionar geada e estiagem", "nível geral alto"], ["dizer que não há risco"]],
  ["C13", "cafe", "vegetativo", "combinado", "Frio moderado com chuva excessiva", { temperaturaMinima: 4.5, chuvaAcumulada7dias: 160, probabilidadeChuva7dias: 90, diasSemChuva: 0 }, { nivelGeral: "medio", tipos: ["geada", "excesso_chuva"] },
    ["mencionar geada e excesso de chuva"], ["alertar sobre estiagem"]],
  ["C14", "cafe", "vegetativo", "normal", "Vento de 45 km/h, sem regra de vento para o café", { ventoMaximoKmh: 45 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["classificar o vento como risco alto"]],
  ["C15", "cafe", "colheita", "normal", "Colheita do café com tempo firme", { temperaturaMinima: 12, probabilidadeChuva7dias: 20, chuvaAcumulada7dias: 6 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre geada", "alertar sobre estiagem"]],

  ["S01", "soja", "vegetativo", "normal", "Soja vegetativa com clima ameno", {}, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre estiagem", "alertar sobre vento"]],
  ["S02", "soja", "enchimento_graos", "risco_unico", "Estiagem crítica no enchimento de grãos (12 dias)", { diasSemChuva: 12, chuvaAcumulada7dias: 4, probabilidadeChuva7dias: 15 }, { nivelGeral: "alto", tipos: ["estiagem"] },
    ["risco alto de estiagem no enchimento de grãos", "recomendar irrigação suplementar"], ["dizer que não há risco"]],
  ["S03", "soja", "vegetativo", "risco_unico", "Estiagem moderada na fase vegetativa (8 dias)", { diasSemChuva: 8, chuvaAcumulada7dias: 10 }, { nivelGeral: "medio", tipos: ["estiagem"] },
    ["risco moderado de estiagem"], ["classificar como risco alto"]],
  ["S04", "soja", "vegetativo", "limite", "6 dias secos, abaixo do limiar", { diasSemChuva: 6, chuvaAcumulada7dias: 12 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre estiagem"]],
  ["S05", "soja", "floracao", "limite", "Exatamente 10 dias secos na floração", { diasSemChuva: 10, chuvaAcumulada7dias: 6 }, { nivelGeral: "alto", tipos: ["estiagem"] },
    ["risco alto de estiagem na floração"], ["dizer que não há risco"]],
  ["S06", "soja", "colheita", "risco_unico", "Colheita com 75% de chance de chuva", { probabilidadeChuva7dias: 75, chuvaAcumulada7dias: 55 }, { nivelGeral: "medio", tipos: ["chuva_colheita"] },
    ["risco de chuva na janela de colheita", "avaliar antecipar a colheita"], ["classificar como risco alto"]],
  ["S07", "soja", "colheita", "normal", "Colheita com 40% de chance de chuva", { probabilidadeChuva7dias: 40, chuvaAcumulada7dias: 15 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre chuva na colheita"]],
  ["S08", "soja", "vegetativo", "risco_unico", "Ventos de 65 km/h", { ventoMaximoKmh: 65 }, { nivelGeral: "alto", tipos: ["vento"] },
    ["risco alto de ventos fortes", "citar 65 km/h"], ["dizer que não há risco"]],
  ["S09", "soja", "vegetativo", "limite", "Vento de 59 km/h, logo abaixo do limiar", { ventoMaximoKmh: 59 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre vento forte"]],
  ["S10", "soja", "colheita", "combinado", "Colheita com chuva provável e vento forte", { probabilidadeChuva7dias: 80, ventoMaximoKmh: 62, chuvaAcumulada7dias: 60 }, { nivelGeral: "alto", tipos: ["chuva_colheita", "vento"] },
    ["mencionar chuva na colheita e vento"], ["dizer que não há risco"]],
  ["S11", "soja", "floracao", "combinado", "Estiagem crítica e vento forte na floração", { diasSemChuva: 11, ventoMaximoKmh: 61, chuvaAcumulada7dias: 3 }, { nivelGeral: "alto", tipos: ["estiagem", "vento"] },
    ["mencionar estiagem e vento"], ["dizer que não há risco"]],
  ["S12", "soja", "vegetativo", "normal", "Soja com tempo quente e úmido, sem risco", { temperaturaMinima: 18, chuvaAcumulada7dias: 40, diasSemChuva: 1, ventoMaximoKmh: 20 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre estiagem", "alertar sobre vento"]],
  ["S13", "soja", "enchimento_graos", "normal", "Enchimento de grãos com solo úmido (3 dias secos)", { diasSemChuva: 3, chuvaAcumulada7dias: 35 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre estiagem"]],
  ["S14", "soja", "colheita", "limite", "Colheita com exatamente 60% de chance de chuva", { probabilidadeChuva7dias: 60, chuvaAcumulada7dias: 30 }, { nivelGeral: "medio", tipos: ["chuva_colheita"] },
    ["risco de chuva na janela de colheita"], ["classificar como risco alto"]],
  ["S15", "soja", "colheita", "limite", "Colheita com 59% de chance de chuva", { probabilidadeChuva7dias: 59, chuvaAcumulada7dias: 28 }, { nivelGeral: "baixo", tipos: [] },
    ["informar que não há risco relevante"], ["alertar sobre chuva na colheita"]],
];

function montar([id, cultura, fase, categoria, descricao, ajustes, intencao, pontosChave, naoDeve]) {
  const clima = { ...BASE, ...ajustes };
  const talhao = { id: 1000 + Number(id.slice(1)) + (cultura === "soja" ? 100 : 0), nome: "Talhão " + id, cultura, fase };
  const alertas = avaliarAlertas(cultura, fase, clima);
  return {
    id, modulo: "clima", categoria, descricao, cultura,
    entrada: { talhao, clima, alertas, alertasOficiais: [] },
    intencao,
    esperado: {
      nivelGeral: nivelGeralDosAlertas(alertas),
      tipos: [...new Set(alertas.map((a) => tipoDoAlerta(a.id)).filter(Boolean))].sort(),
    },
    pontosChave,
    naoDeve,
  };
}

const CENARIOS_CLIMA = DEFINICOES.map(montar);

module.exports = { CENARIOS_CLIMA };
