/**
 * Motor de regras de alertas climáticos.
 *
 * Cada regra recebe os dados climáticos atuais/previstos de um talhão
 * e retorna um alerta (ou nada, se não houver risco).
 *
 * As faixas usadas aqui são baseadas em referências agronômicas gerais
 * (Embrapa/Epamig) para café e soja. Para o TCC, vale a pena revisar
 * e citar as fontes específicas usadas no referencial teórico.
 */

const NIVEIS = {
  BAIXO: "baixo",
  MEDIO: "medio",
  ALTO: "alto",
};

const SEM_DATA_DEFINIDA = "próximos dias";

// Dias da previsão ("AAAA-MM-DD") que atendem à condição.
function diasDaPrevisao(clima, condicao) {
  return (clima.previsaoDiaria || []).filter(condicao).map((d) => d.data);
}

// Janela real do risco: do primeiro ao último dia da previsão que atende à
// condição ("21/10" ou "21/10 a 23/10"). Sem previsão diária, devolve null.
function periodoDaPrevisao(clima, condicao) {
  const dias = diasDaPrevisao(clima, condicao);
  if (dias.length === 0) return null;
  const formatar = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const inicio = formatar(dias[0]);
  return dias.length === 1 ? inicio : inicio + " a " + formatar(dias[dias.length - 1]);
}

// Regras por cultura. Cada regra é uma função pura: (clima, faseAtual) => alerta|null
const REGRAS_POR_CULTURA = {
  cafe: [
    {
      id: "cafe_geada",
      titulo: "Risco de geada",
      avaliar: (clima) => {
        if (clima.temperaturaMinima <= 2) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              "Temperatura mínima prevista de " +
              clima.temperaturaMinima +
              "°C. Risco alto de geada, que pode causar perda severa em lavouras de café.",
            recomendacao:
              "Considere métodos de proteção contra geada (irrigação por aspersão, cobertura) nas próximas noites.",
            janela: periodoDaPrevisao(clima, (d) => d.tempMin <= 2) || SEM_DATA_DEFINIDA,
            // Dias previstos com a mínima na faixa: o alerta por WhatsApp só sai com eles.
            dias: diasDaPrevisao(clima, (d) => d.tempMin <= 2),
          };
        }
        if (clima.temperaturaMinima <= 5) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              "Temperatura mínima prevista de " +
              clima.temperaturaMinima +
              "°C. Risco moderado de geada.",
            recomendacao: "Monitore a previsão nas próximas 48h.",
            janela: periodoDaPrevisao(clima, (d) => d.tempMin <= 5) || SEM_DATA_DEFINIDA,
            dias: diasDaPrevisao(clima, (d) => d.tempMin <= 5),
          };
        }
        return null;
      },
    },
    {
      id: "cafe_estiagem",
      titulo: "Risco de estiagem",
      avaliar: (clima, fase) => {
        const faseCritica = fase === "floracao" || fase === "granacao";
        if (clima.diasSemChuva >= 15 && faseCritica) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              clima.diasSemChuva +
              " dias sem chuva durante a fase de " +
              fase +
              ". Risco alto de queda de produtividade.",
            recomendacao: "Priorize irrigação, se disponível, nos próximos dias.",
            janela: "últimos " + clima.diasSemChuva + " dias",
          };
        }
        if (clima.diasSemChuva >= 10) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Acompanhe a previsão de chuva para os próximos dias.",
            janela: "últimos " + clima.diasSemChuva + " dias",
          };
        }
        return null;
      },
    },
    {
      id: "cafe_excesso_chuva",
      titulo: "Excesso de chuva",
      avaliar: (clima) => {
        // chuvaAcumulada7dias é a soma da PREVISÃO dos próximos dias (Open-Meteo/OpenWeather).
        if (clima.chuvaAcumulada7dias >= 150) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              clima.chuvaAcumulada7dias +
              " mm de chuva previstos para os próximos dias. Risco de doenças fúngicas (ferrugem).",
            recomendacao: "Avalie a necessidade de aplicação preventiva de fungicida.",
            janela: periodoDaPrevisao(clima, () => true) || SEM_DATA_DEFINIDA,
          };
        }
        return null;
      },
    },
  ],

  soja: [
    {
      id: "soja_estiagem",
      titulo: "Risco de estiagem",
      avaliar: (clima, fase) => {
        const faseCritica = fase === "floracao" || fase === "enchimento_graos";
        if (clima.diasSemChuva >= 10 && faseCritica) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              clima.diasSemChuva +
              " dias sem chuva durante " +
              fase +
              ". Fase crítica para definição de produtividade da soja.",
            recomendacao: "Se possível, priorize irrigação suplementar.",
            janela: "últimos " + clima.diasSemChuva + " dias",
          };
        }
        if (clima.diasSemChuva >= 7) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Monitore a previsão para os próximos dias.",
            janela: "últimos " + clima.diasSemChuva + " dias",
          };
        }
        return null;
      },
    },
    {
      id: "soja_chuva_colheita",
      titulo: "Chuva na janela de colheita",
      avaliar: (clima, fase) => {
        if (fase === "colheita" && clima.probabilidadeChuva7dias >= 60)
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              "Probabilidade de " +
              clima.probabilidadeChuva7dias +
              "% de chuva nos próximos 7 dias durante a janela de colheita.",
            recomendacao: "Avalie antecipar a colheita, se a umidade dos grãos permitir.",
            janela: periodoDaPrevisao(clima, (d) => d.chuvaProbabilidade >= 60) || SEM_DATA_DEFINIDA,
          };
        return null;
      },
    },
    {
      id: "soja_vento_forte",
      titulo: "Ventos fortes",
      avaliar: (clima) => {
        if (clima.ventoMaximoKmh >= 60) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem: "Ventos de até " + clima.ventoMaximoKmh + " km/h previstos.",
            recomendacao: "Risco de acamamento da lavoura. Evite aplicações aéreas nesse período.",
            janela: periodoDaPrevisao(clima, (d) => d.ventoMaxKmh >= 60) || SEM_DATA_DEFINIDA,
          };
        }
        return null;
      },
    },
  ],

};

/**
 * Avalia todas as regras de uma cultura contra os dados climáticos fornecidos.
 * @param {string} cultura - "cafe" | "soja" (culturas suportadas)
 * @param {string} fase - fase atual da cultura (ex: "floracao")
 * @param {object} clima - dados climáticos (ver services/weather.js)
 * @returns {Array} lista de alertas gerados
 */
function avaliarAlertas(cultura, fase, clima) {
  const regras = REGRAS_POR_CULTURA[cultura] || [];
  const alertas = [];

  for (const regra of regras) {
    const resultado = regra.avaliar(clima, fase);
    if (resultado) {
      alertas.push({
        id: regra.id,
        titulo: regra.titulo,
        cultura,
        fase,
        geradoEm: new Date().toISOString(),
        ...resultado,
      });
    }
  }

  // Alertas de maior severidade primeiro
  const ordem = { alto: 0, medio: 1, baixo: 2 };
  alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);

  return alertas;
}

function culturasSuportadas() {
  return Object.keys(REGRAS_POR_CULTURA);
}

// Fases que o produtor escolhe para o talhão. As regras acima reagem a
// "floracao" e "colheita"; em "plantio" valem só as regras sem fase (geada, chuva, vento).
const FASES = ["plantio", "floracao", "colheita"];

function fasesSuportadas() {
  return [...FASES];
}

module.exports = { avaliarAlertas, culturasSuportadas, fasesSuportadas, NIVEIS };
