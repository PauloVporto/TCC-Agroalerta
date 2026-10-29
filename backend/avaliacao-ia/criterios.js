/**
 * Rubrica de avaliação (escala inteira de 1 a 5) e prompt do juiz.
 * "Consistência" não passa pelo juiz: é calculada comparando as duas execuções do cenário.
 */
const CRITERIOS_JULGADOS = ["coerencia", "clareza", "relevancia", "ausenciaInvencao"];

const RUBRICA = {
  coerencia: {
    titulo: "Coerência",
    pergunta: "A resposta é correta e coerente com os dados e com o gabarito (níveis, tendência, riscos), sem se contradizer?",
    ancoras: { 5: "totalmente coerente com dados e gabarito, sem contradições", 3: "pequena imprecisão ou ressalva que não muda a conclusão", 1: "contradiz os dados ou o gabarito" },
  },
  clareza: {
    titulo: "Clareza",
    pergunta: "O texto é simples, objetivo e fácil de entender por um produtor rural?",
    ancoras: { 5: "direto, bem organizado, linguagem simples", 3: "compreensível, mas com rodeios ou termos desnecessários", 1: "confuso ou ilegível" },
  },
  relevancia: {
    titulo: "Relevância",
    pergunta: "A resposta cobre o que importa para a decisão do produtor (pontos-chave) e evita ruído ou alarmes desnecessários?",
    ancoras: { 5: "cobre todos os pontos-chave e nada fora de lugar", 3: "cobre parte do essencial ou traz conteúdo supérfluo", 1: "omite o essencial ou foge do assunto" },
  },
  ausenciaInvencao: {
    titulo: "Ausência de informações inventadas",
    pergunta: "A resposta usa só o que está nos dados? Contexto geral só é aceitável se estiver claramente rotulado como geral.",
    ancoras: { 5: "nada fora dos dados fornecidos", 3: "uma afirmação específica sem sustentação nos dados", 1: "várias invenções (números, eventos, causas)" },
  },
};

function textoRubrica() {
  return CRITERIOS_JULGADOS.map((c) => {
    const r = RUBRICA[c];
    return "- " + c + " (" + r.titulo + "): " + r.pergunta +
      " 5 = " + r.ancoras[5] + "; 3 = " + r.ancoras[3] + "; 1 = " + r.ancoras[1] + ".";
  }).join("\n");
}

function promptJuiz({ descricaoModulo, dadosEntrada, gabarito, pontosChave, naoDeve, textoResposta, numerosSuspeitos }) {
  return (
    "Você é um avaliador técnico e independente das respostas de um assistente de IA do AgroAlerta, sistema de alertas para produtores rurais. " +
    "Seja criterioso e não complacente: use toda a escala de 1 a 5 e dê 5 apenas quando não houver ressalva.\n\n" +
    "Módulo avaliado: " + descricaoModulo + "\n\n" +
    "## Dados que o assistente recebeu\n" + dadosEntrada + "\n\n" +
    "## Gabarito do cenário (referência)\n" + gabarito + "\n" +
    (pontosChave && pontosChave.length ? "Pontos-chave esperados: " + pontosChave.join("; ") + "\n" : "") +
    (naoDeve && naoDeve.length ? "A resposta NÃO deve: " + naoDeve.join("; ") + "\n" : "") +
    "\n## Resposta do assistente (texto exibido ao produtor; o JSON técnico já foi convertido em texto, não avalie o formato)\n<<<\n" + textoResposta + "\n>>>\n\n" +
    "## Verificação automática de números\n" +
    (numerosSuspeitos && numerosSuspeitos.length
      ? "Números citados que não aparecem nos dados: " + numerosSuspeitos.join(", ") + ". Podem ser derivações legítimas (somas, variações); julgue."
      : "Todos os números citados aparecem nos dados ou são derivações simples deles.") +
    "\n\n## Critérios (nota inteira de 1 a 5)\n" + textoRubrica() + "\n\n" +
    "Responda APENAS com JSON válido, sem markdown, neste formato (justificativa com no máximo 25 palavras):\n" +
    '{"coerencia":{"nota":0,"justificativa":""},"clareza":{"nota":0,"justificativa":""},"relevancia":{"nota":0,"justificativa":""},"ausenciaInvencao":{"nota":0,"justificativa":""}}'
  );
}

module.exports = { CRITERIOS_JULGADOS, RUBRICA, promptJuiz };
