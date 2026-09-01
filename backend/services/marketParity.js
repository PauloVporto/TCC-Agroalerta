/**
 * Converte contratos internacionais para R$/saca, a unidade que o
 * produtor brasileiro usa no dia a dia (paridade de exportação).
 *
 * Fatores físicos padrão:
 * - Café: saca 60 kg = 132,276 lb (ICE arábica em US¢/lb)
 * - Soja: bushel = 27,216 kg (CBOT em US¢/bu)
 * - Milho: bushel = 25,401 kg (CBOT em US¢/bu)
 * - Açúcar: saca 50 kg = 110,231 lb (ICE #11 em US¢/lb)
 */

const CONVERSAO = {
  cafe: { tipo: "cents_lb", lbPorSaca: 132.276, unidadeBrasil: "R$/saca 60kg" },
  soja: { tipo: "cents_bu", kgPorBushel: 27.2155422, unidadeBrasil: "R$/saca 60kg" },
  milho: { tipo: "cents_bu", kgPorBushel: 25.40117272, unidadeBrasil: "R$/saca 60kg" },
  cana: { tipo: "cents_lb", lbPorSaca: 110.231, unidadeBrasil: "R$/saca 50kg" },
  feijao: null,
};

function internacionalParaReais(cultura, precoContrato, dolar) {
  const regra = CONVERSAO[cultura];
  if (!regra || precoContrato == null || !dolar) return null;

  let reais = null;
  if (regra.tipo === "cents_lb") {
    reais = (precoContrato / 100) * regra.lbPorSaca * dolar;
  } else if (regra.tipo === "cents_bu") {
    reais = (precoContrato / 100) * (60 / regra.kgPorBushel) * dolar;
  }

  return reais == null ? null : Number(reais.toFixed(2));
}

function converterHistorico(cultura, pontos, dolarPorData, dolarAtual) {
  if (!CONVERSAO[cultura] || !Array.isArray(pontos)) return [];
  return pontos
    .map((p) => {
      const dolar = (dolarPorData && dolarPorData[p.data]) || dolarAtual;
      const preco = internacionalParaReais(cultura, p.preco, dolar);
      return preco == null ? null : { data: p.data, preco };
    })
    .filter(Boolean);
}

function unidadeBrasil(cultura) {
  return CONVERSAO[cultura] ? CONVERSAO[cultura].unidadeBrasil : "R$/saca";
}

module.exports = {
  CONVERSAO,
  internacionalParaReais,
  converterHistorico,
  unidadeBrasil,
};
