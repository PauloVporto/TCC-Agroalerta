const INTERNACIONAL = {
  cafe: {
    ticker: "KC=F",
    nome: "Café Arábica (ICE Nova York)",
    unidade: "US¢/lb",
    bolsa: "ICE",
  },
  soja: {
    ticker: "ZS=F",
    nome: "Soja (CBOT Chicago)",
    unidade: "US¢/bu",
    bolsa: "CBOT",
  },
  milho: {
    ticker: "ZC=F",
    nome: "Milho (CBOT Chicago)",
    unidade: "US¢/bu",
    bolsa: "CBOT",
  },
  cana: {
    ticker: "SB=F",
    nome: "Açúcar #11 (ICE Nova York)",
    unidade: "US¢/lb",
    bolsa: "ICE",
  },
  feijao: null,
};

/** Compatível com o código antigo que lia SIMBOLOS.cafe.ticker */
const SIMBOLOS = INTERNACIONAL;

module.exports = { INTERNACIONAL, SIMBOLOS };
