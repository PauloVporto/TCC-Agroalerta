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
          };
        }
        if (clima.diasSemChuva >= 10) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Acompanhe a previsão de chuva para os próximos dias.",
          };
        }
        return null;
      },
    },
    {
      id: "cafe_excesso_chuva",
      titulo: "Excesso de chuva",
      avaliar: (clima) => {
        if (clima.chuvaAcumulada7dias >= 150) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              clima.chuvaAcumulada7dias +
              "mm de chuva acumulada nos últimos 7 dias. Risco de doenças fúngicas (ferrugem).",
            recomendacao: "Avalie a necessidade de aplicação preventiva de fungicida.",
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
          };
        }
        if (clima.diasSemChuva >= 7) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Monitore a previsão para os próximos dias.",
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
          };
        }
        return null;
      },
    },
  ],

  milho: [
    {
      id: "milho_estiagem",
      titulo: "Risco de estiagem",
      avaliar: (clima, fase) => {
        const faseCritica = fase === "floracao" || fase === "enchimento_graos";
        if (clima.diasSemChuva >= 8 && faseCritica) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              clima.diasSemChuva +
              " dias sem chuva durante " +
              fase +
              ". O milho é muito sensível a déficit hídrico nesta fase (pendoamento/enchimento).",
            recomendacao: "Priorize irrigação suplementar se disponível; monitore sinais de murcha.",
          };
        }
        if (clima.diasSemChuva >= 6) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Acompanhe a previsão para os próximos dias.",
          };
        }
        return null;
      },
    },
    {
      id: "milho_vento_forte",
      titulo: "Ventos fortes / risco de acamamento",
      avaliar: (clima) => {
        if (clima.ventoMaximoKmh >= 55) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem: "Ventos de até " + clima.ventoMaximoKmh + " km/h previstos.",
            recomendacao: "Alto risco de acamamento em plantas altas. Evite aplicações aéreas.",
          };
        }
        return null;
      },
    },
    {
      id: "milho_excesso_chuva",
      titulo: "Excesso de chuva",
      avaliar: (clima) => {
        if (clima.chuvaAcumulada7dias >= 180) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              clima.chuvaAcumulada7dias +
              "mm acumulados em 7 dias. Risco de doenças foliares e encharcamento do solo.",
            recomendacao: "Verifique drenagem da área e avalie necessidade de fungicida preventivo.",
          };
        }
        return null;
      },
    },
  ],

  cana: [
    {
      id: "cana_estiagem_prolongada",
      titulo: "Estiagem prolongada",
      avaliar: (clima, fase) => {
        if (clima.diasSemChuva >= 25) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              clima.diasSemChuva +
              " dias sem chuva. Cana-de-açúcar tolera períodos secos, mas estiagem prolongada compromete o desenvolvimento de colmos.",
            recomendacao: "Se houver irrigação disponível (ex: fertirrigação), considere acionar.",
          };
        }
        if (clima.diasSemChuva >= 18) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Monitore o desenvolvimento da cultura nas próximas semanas.",
          };
        }
        return null;
      },
    },
    {
      id: "cana_geada",
      titulo: "Risco de geada",
      avaliar: (clima) => {
        if (clima.temperaturaMinima <= 3) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              "Temperatura mínima prevista de " +
              clima.temperaturaMinima +
              "°C. Geada pode reduzir o teor de sacarose e danificar folhas.",
            recomendacao: "Avalie antecipar a colheita em talhões próximos ao corte.",
          };
        }
        return null;
      },
    },
    {
      id: "cana_chuva_colheita",
      titulo: "Chuva na janela de colheita",
      avaliar: (clima, fase) => {
        if (fase === "colheita" && clima.probabilidadeChuva7dias >= 60) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              "Probabilidade de " +
              clima.probabilidadeChuva7dias +
              "% de chuva nos próximos 7 dias. Colheita mecanizada fica prejudicada em solo encharcado.",
            recomendacao: "Avalie reorganizar a ordem de corte entre talhões conforme a previsão.",
          };
        }
        return null;
      },
    },
  ],

  feijao: [
    {
      id: "feijao_estiagem",
      titulo: "Risco de estiagem",
      avaliar: (clima, fase) => {
        const faseCritica = fase === "floracao" || fase === "enchimento_vagens";
        if (clima.diasSemChuva >= 6 && faseCritica) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              clima.diasSemChuva +
              " dias sem chuva durante " +
              fase +
              ". O feijão tem sistema radicular raso e é muito sensível a déficit hídrico nesta fase.",
            recomendacao: "Priorize irrigação suplementar se disponível.",
          };
        }
        if (clima.diasSemChuva >= 4) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem: clima.diasSemChuva + " dias sem chuva registrados.",
            recomendacao: "Monitore a previsão de chuva nos próximos dias.",
          };
        }
        return null;
      },
    },
    {
      id: "feijao_excesso_chuva",
      titulo: "Excesso de chuva / risco de doenças fúngicas",
      avaliar: (clima) => {
        if (clima.chuvaAcumulada7dias >= 100) {
          return {
            nivel: NIVEIS.ALTO,
            mensagem:
              clima.chuvaAcumulada7dias +
              "mm acumulados em 7 dias. Feijão é muito suscetível a mofo-branco e antracnose em excesso de umidade.",
            recomendacao: "Avalie aplicação preventiva de fungicida e verifique drenagem do solo.",
          };
        }
        return null;
      },
    },
    {
      id: "feijao_chuva_colheita",
      titulo: "Chuva na janela de colheita",
      avaliar: (clima, fase) => {
        if (fase === "colheita" && clima.probabilidadeChuva7dias >= 50) {
          return {
            nivel: NIVEIS.MEDIO,
            mensagem:
              "Probabilidade de " +
              clima.probabilidadeChuva7dias +
              "% de chuva nos próximos 7 dias durante a colheita.",
            recomendacao: "Chuva na colheita pode manchar e reduzir a qualidade dos grãos. Avalie antecipar.",
          };
        }
        return null;
      },
    },
  ],
};

/**
 * Avalia todas as regras de uma cultura contra os dados climáticos fornecidos.
 * @param {string} cultura - "cafe" | "soja"
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

module.exports = { avaliarAlertas, culturasSuportadas, NIVEIS };
