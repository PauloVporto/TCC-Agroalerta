/**
 * Validação, normalização e mascaramento dos contatos do produtor.
 *
 * Telefones são guardados em E.164 (+55 + DDD + número), o formato exigido pela
 * API da SMSGo. SMS só chega a celular: fixo (8 dígitos após o DDD) é aceito no
 * cadastro, mas não pode ser usado para o canal SMS.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// Códigos de área (DDD) em uso no Brasil, conforme o plano de numeração da Anatel.
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function emailValido(email) {
  return EMAIL.test(String(email || "").trim());
}

/**
 * Aceita o número como o produtor digitar — "(35) 99999-0000", "+55 35 99999-0000",
 * "035999990000" — e devolve "+5535999990000", ou null se não for um telefone
 * brasileiro válido.
 */
function normalizarTelefone(telefone) {
  let digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    digitos = digitos.slice(2);
  } else if (digitos.startsWith("0") && (digitos.length === 11 || digitos.length === 12)) {
    digitos = digitos.slice(1);
  }

  if (!DDDS.has(Number(digitos.slice(0, 2)))) return null;
  const assinante = digitos.slice(2);
  const celular = assinante.length === 9 && assinante.startsWith("9");
  const fixo = assinante.length === 8 && /^[2-5]/.test(assinante);
  return celular || fixo ? "+55" + digitos : null;
}

function ehCelular(telefone) {
  const normalizado = normalizarTelefone(telefone);
  return normalizado !== null && normalizado.length === 14;
}

// "+5535999990000" → "(35) 99999-0000"
function formatarTelefone(telefone) {
  const normalizado = normalizarTelefone(telefone);
  if (!normalizado) return telefone || "";
  const ddd = normalizado.slice(3, 5);
  const numero = normalizado.slice(5);
  const corte = numero.length - 4;
  return "(" + ddd + ") " + numero.slice(0, corte) + "-" + numero.slice(corte);
}

// Para logs: "(35) 9****-0000"
function mascararTelefone(telefone) {
  if (!normalizarTelefone(telefone)) return "***";
  return formatarTelefone(telefone).replace(/\) (\d)\d+-/, (_, primeiro) => ") " + primeiro + "****-");
}

// Para logs: "pr***@fazenda.com.br"
function mascararEmail(email) {
  const [usuario, dominio] = String(email || "").split("@");
  if (!dominio) return "***";
  return usuario.slice(0, 2) + "***@" + dominio;
}

module.exports = {
  emailValido,
  normalizarTelefone,
  ehCelular,
  formatarTelefone,
  mascararTelefone,
  mascararEmail,
};
