// Categorias de insumo recomendadas para cada regra de alerta.
const MAPA_ALERTA_CATEGORIA = {
  cafe_geada: ["protecao_termica"],
  cafe_estiagem: ["irrigacao", "hidrogel"],
  cafe_excesso_chuva: ["fungicida"],
  soja_estiagem: ["irrigacao", "hidrogel"],
  soja_chuva_colheita: [],
  soja_vento_forte: [],
  milho_estiagem: ["irrigacao", "hidrogel"],
  milho_vento_forte: [],
  milho_excesso_chuva: ["fungicida"],
  cana_estiagem_prolongada: ["irrigacao"],
  cana_geada: ["protecao_termica"],
  cana_chuva_colheita: [],
  feijao_estiagem: ["irrigacao", "hidrogel"],
  feijao_excesso_chuva: ["fungicida"],
  feijao_chuva_colheita: [],
};

module.exports = { MAPA_ALERTA_CATEGORIA };
