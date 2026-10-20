/**
 * Texto de SMS dentro do alfabeto GSM-7 e do limite de segmentos.
 *
 * Um SMS em GSM-7 leva 160 caracteres (153 por parte quando a mensagem é
 * dividida). Basta um caractere fora desse alfabeto — "ã", "ç", "°", um emoji —
 * para a operadora usar UCS-2, que leva só 70 por segmento e multiplica a
 * cobrança. Por isso o texto perde os acentos antes de ser enfileirado.
 */

const GSM7_BASICO =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// Caracteres da tabela de extensão: cada um ocupa duas posições do segmento.
const GSM7_EXTENSAO = "^{}\\[~]|€";

const UNIDADES_SEGMENTO_UNICO = 160;
const UNIDADES_POR_PARTE = 153;

function paraGsm7(texto) {
  return String(texto)
    .replace(/\s*°\s*C\b/g, "C")
    .replace(/[°ºª]/g, "")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’´`]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("")
    .filter((c) => GSM7_BASICO.includes(c) || GSM7_EXTENSAO.includes(c))
    .join("")
    .trim();
}

function unidades(caractere) {
  return GSM7_EXTENSAO.includes(caractere) ? 2 : 1;
}

function contarUnidades(texto) {
  let total = 0;
  for (const c of texto) total += unidades(c);
  return total;
}

function contarSegmentos(texto) {
  const total = contarUnidades(texto);
  return total <= UNIDADES_SEGMENTO_UNICO ? 1 : Math.ceil(total / UNIDADES_POR_PARTE);
}

function limiteDeUnidades(maxSegmentos) {
  return maxSegmentos <= 1 ? UNIDADES_SEGMENTO_UNICO : maxSegmentos * UNIDADES_POR_PARTE;
}

// Corta o texto (com "...") para caber em `limite` posições.
function cortar(texto, limite) {
  if (contarUnidades(texto) <= limite) return texto;
  let saida = "";
  let usadas = 0;
  for (const c of texto) {
    if (usadas + unidades(c) > limite - 3) break;
    saida += c;
    usadas += unidades(c);
  }
  return saida.trimEnd() + "...";
}

module.exports = { paraGsm7, contarUnidades, contarSegmentos, limiteDeUnidades, cortar };
