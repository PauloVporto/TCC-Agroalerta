/**
 * Conteúdo das notificações: e-mails (texto + HTML responsivo) e SMS.
 *
 * O HTML usa tabelas e estilos inline — o que os clientes de e-mail (Gmail,
 * Outlook, apps de celular) realmente respeitam — com as cores do painel.
 * Os dados meteorológicos vêm prontos do motor de regras e do Open-Meteo:
 * aqui só se formata, nada é estimado.
 */

const { paraGsm7, contarUnidades, limiteDeUnidades, cortar } = require("./textoSms");

const COR = {
  verde: "#1F3D2B",
  creme: "#F7F5EF",
  dourado: "#D4A537",
  marrom: "#6B4A34",
  texto: "#1A1A18",
  borda: "#DDD8C9",
  fundoTabela: "#FAFAF7",
};

const NIVEL = {
  alto: { rotulo: "Alto", cor: "#A33A22", fundo: "#F6EBE6" },
  medio: { rotulo: "Médio", cor: "#8A6A12", fundo: "#F8F1DE" },
  baixo: { rotulo: "Baixo", cor: "#2F6E8F", fundo: "#EEF5F8" },
};

const FONTE_TEXTO = "Arial, Helvetica, sans-serif";
const FONTE_TITULO = "Georgia, 'Times New Roman', serif";
const ASSINATURA = "Agro Alerta — Monitoramento climático inteligente.";
const RODAPE_CONSENTIMENTO =
  "Você recebe esta mensagem porque autorizou notificações por e-mail no Agro Alerta. " +
  "Para deixar de receber, desative o canal em Configurar conta, no painel.";

function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nivelInfo(nivel) {
  return NIVEL[nivel] || NIVEL.medio;
}

function paragrafo(conteudoHtml) {
  return `<p style="margin:0 0 14px;">${conteudoHtml}</p>`;
}

function tabela(linhas) {
  const corpo = linhas
    .map(
      ([rotulo, valor]) =>
        `<tr>` +
        `<td style="padding:9px 12px;border-bottom:1px solid ${COR.borda};font-size:12px;letter-spacing:0.5px;text-transform:uppercase;color:${COR.marrom};width:42%;vertical-align:top;">${escapar(rotulo)}</td>` +
        `<td style="padding:9px 12px;border-bottom:1px solid ${COR.borda};font-size:14px;color:${COR.texto};vertical-align:top;">${escapar(valor)}</td>` +
        `</tr>`
    )
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="border-collapse:collapse;border:1px solid ${COR.borda};border-radius:8px;background:${COR.fundoTabela};margin:0 0 20px;">` +
    corpo +
    `</table>`
  );
}

function subtitulo(textoTitulo) {
  return `<h2 style="margin:24px 0 10px;font-family:${FONTE_TITULO};font-size:18px;line-height:1.3;color:${COR.texto};">${escapar(textoTitulo)}</h2>`;
}

function layout({ assunto, preheader, conteudoHtml, rodape = RODAPE_CONSENTIMENTO }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapar(assunto)}</title>
<style>
  @media (max-width: 620px) {
    .aa-card { padding: 24px 18px !important; }
    .aa-titulo { font-size: 22px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COR.creme};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.creme};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:${COR.verde};padding:22px 32px;border-radius:12px 12px 0 0;">
<div style="font-family:${FONTE_TITULO};font-size:24px;font-weight:bold;color:${COR.creme};">Agro Alerta</div>
<div style="margin-top:4px;font-family:${FONTE_TEXTO};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${COR.dourado};">Monitoramento climático</div>
</td></tr>
<tr><td class="aa-card" style="background:#FFFFFF;padding:32px;border:1px solid ${COR.borda};border-top:0;border-radius:0 0 12px 12px;font-family:${FONTE_TEXTO};font-size:15px;line-height:1.6;color:${COR.texto};">
${conteudoHtml}
</td></tr>
<tr><td style="padding:20px 8px;text-align:center;font-family:${FONTE_TEXTO};font-size:12px;line-height:1.5;color:${COR.marrom};">
<strong>${escapar(ASSINATURA)}</strong><br>${escapar(rodape)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---- Boas-vindas ------------------------------------------------------------

const BOAS_VINDAS_PARAGRAFOS = [
  "Seu cadastro no Agro Alerta foi realizado com sucesso.",
  "Agora você poderá receber notificações sobre riscos climáticos na região da sua propriedade.",
  "O Agro Alerta monitora as condições meteorológicas para ajudar você a acompanhar possíveis riscos para sua produção.",
];

const SMS_BOAS_VINDAS =
  "Agro Alerta: Cadastro realizado com sucesso! Voce recebera alertas climaticos conforme suas preferencias.";

function emailBoasVindas({ nome }) {
  const assunto = "Bem-vindo ao Agro Alerta!";
  const saudacao = `Olá, ${nome}!`;
  const texto = [saudacao, ...BOAS_VINDAS_PARAGRAFOS, ASSINATURA, "--", RODAPE_CONSENTIMENTO].join("\n\n");
  const conteudoHtml =
    `<h1 class="aa-titulo" style="margin:0 0 18px;font-family:${FONTE_TITULO};font-size:26px;line-height:1.25;color:${COR.verde};">${escapar(saudacao)}</h1>` +
    BOAS_VINDAS_PARAGRAFOS.map((p) => paragrafo(escapar(p))).join("");
  return {
    assunto,
    texto,
    html: layout({ assunto, preheader: BOAS_VINDAS_PARAGRAFOS[0], conteudoHtml }),
  };
}

function smsBoasVindas() {
  return SMS_BOAS_VINDAS;
}

// ---- Teste manual de provedor (scripts/testar-*.js) --------------------------

const TESTE_PARAGRAFOS = [
  "Esta é uma mensagem de teste do Agro Alerta.",
  "Se você a recebeu, a integração de e-mail com o Resend está funcionando.",
];
const RODAPE_TESTE = "Mensagem de teste enviada manualmente pelo script de validação do Agro Alerta.";
const SMS_TESTE = "Agro Alerta: mensagem de teste. Se voce recebeu, a integracao de SMS esta funcionando.";

function emailTeste() {
  const assunto = "Agro Alerta: teste de envio de e-mail";
  const conteudoHtml =
    `<h1 class="aa-titulo" style="margin:0 0 18px;font-family:${FONTE_TITULO};font-size:26px;line-height:1.25;color:${COR.verde};">Teste de envio</h1>` +
    TESTE_PARAGRAFOS.map((p) => paragrafo(escapar(p))).join("");
  return {
    assunto,
    texto: [...TESTE_PARAGRAFOS, ASSINATURA, "--", RODAPE_TESTE].join("\n\n"),
    html: layout({ assunto, preheader: TESTE_PARAGRAFOS[0], conteudoHtml, rodape: RODAPE_TESTE }),
  };
}

function smsTeste() {
  return SMS_TESTE;
}

// ---- Alerta climático --------------------------------------------------------

function numeroBr(valor, casas) {
  return Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function dadosMeteorologicos(clima) {
  return [
    ["Temperatura mínima prevista (7 dias)", numeroBr(clima.temperaturaMinima, 1) + " °C"],
    ["Chuva prevista (7 dias)", numeroBr(clima.chuvaAcumulada7dias, 1) + " mm"],
    ["Dias seguidos sem chuva (até ontem)", String(clima.diasSemChuva)],
    ["Maior chance diária de chuva (7 dias)", clima.probabilidadeChuva7dias + "%"],
    ["Vento máximo previsto (7 dias)", numeroBr(clima.ventoMaximoKmh, 0) + " km/h"],
  ];
}

function dataHoraBr(data) {
  return data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/**
 * @param {object} alerta
 *   nome, titulo, nivel, mensagem, recomendacao, regiao, janela,
 *   talhoes (nomes), clima (indicadores do Open-Meteo), consultadoEm (Date)
 */
function emailAlerta(alerta) {
  const nivel = nivelInfo(alerta.nivel);
  const assunto = `Alerta ${nivel.rotulo.toLowerCase()}: ${alerta.titulo} em ${alerta.regiao}`;
  const talhoes = alerta.talhoes.join(", ");
  const resumoLinhas = [
    ["Tipo de risco", alerta.titulo],
    ["Gravidade", nivel.rotulo],
    ["Região afetada", alerta.regiao],
    [alerta.talhoes.length > 1 ? "Talhões" : "Talhão", talhoes],
    ["Período", alerta.janela],
  ];
  const dados = dadosMeteorologicos(alerta.clima);
  const fonte =
    `Fonte: Open-Meteo (previsão de 7 dias e histórico de 30 dias), consultado em ${dataHoraBr(alerta.consultadoEm)}. ` +
    "Este alerta apoia a decisão e não substitui a avaliação de um agrônomo.";
  const introducao = `Olá, ${alerta.nome}. O Agro Alerta identificou um risco climático para ${
    alerta.talhoes.length > 1 ? "os seus talhões" : "o seu talhão"
  } em ${alerta.regiao}.`;

  const texto = [
    `${alerta.titulo} — nível ${nivel.rotulo.toLowerCase()}`,
    introducao,
    alerta.mensagem,
    resumoLinhas.map(([r, v]) => `${r}: ${v}`).join("\n"),
    "Dados meteorológicos\n" + dados.map(([r, v]) => `${r}: ${v}`).join("\n"),
    "Recomendações preventivas\n" + alerta.recomendacao,
    fonte,
    ASSINATURA,
    "--",
    RODAPE_CONSENTIMENTO,
  ].join("\n\n");

  const conteudoHtml =
    `<span style="display:inline-block;margin:0 0 14px;padding:4px 12px;border:1px solid ${nivel.cor};border-radius:999px;background:${nivel.fundo};color:${nivel.cor};font-size:11px;letter-spacing:1px;text-transform:uppercase;">Alerta climático · nível ${escapar(nivel.rotulo)}</span>` +
    `<h1 class="aa-titulo" style="margin:0 0 16px;font-family:${FONTE_TITULO};font-size:26px;line-height:1.25;color:${COR.verde};">${escapar(alerta.titulo)}</h1>` +
    paragrafo(escapar(introducao)) +
    `<p style="margin:0 0 20px;padding:12px 14px;border-left:3px solid ${nivel.cor};background:${nivel.fundo};color:${COR.texto};">${escapar(alerta.mensagem)}</p>` +
    tabela(resumoLinhas) +
    subtitulo("Dados meteorológicos") +
    tabela(dados) +
    subtitulo("Recomendações preventivas") +
    paragrafo(escapar(alerta.recomendacao)) +
    `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${COR.marrom};">${escapar(fonte)}</p>`;

  return {
    assunto,
    texto,
    html: layout({ assunto, preheader: alerta.mensagem, conteudoHtml }),
  };
}

function riscoCurto(titulo) {
  const semPrefixo = titulo.replace(/^Risco de /i, "");
  return semPrefixo.charAt(0).toLowerCase() + semPrefixo.slice(1);
}

/**
 * SMS de alerta em um único segmento (por padrão): se a região for longa — vários
 * talhões, por exemplo —, primeiro sai o fecho e depois a região é encurtada.
 */
function smsAlerta({ titulo, nivel, regiao, janela }, maxSegmentos = 1) {
  const limite = limiteDeUnidades(maxSegmentos);
  const montar = (reg, comFecho) =>
    paraGsm7(
      `Agro Alerta: Alerta de ${riscoCurto(titulo)} (risco ${nivelInfo(nivel).rotulo.toLowerCase()}) em ${reg}. ` +
        `Periodo: ${janela}.` +
        (comFecho ? " Acompanhe as condicoes climaticas." : "")
    );

  const completo = montar(regiao, true);
  if (contarUnidades(completo) <= limite) return completo;
  const semFecho = montar(regiao, false);
  if (contarUnidades(semFecho) <= limite) return semFecho;
  const espacoRegiao = limite - contarUnidades(montar("", false));
  return cortar(montar(cortar(paraGsm7(regiao), Math.max(espacoRegiao, 10)), false), limite);
}

module.exports = {
  emailBoasVindas,
  smsBoasVindas,
  emailAlerta,
  smsAlerta,
  emailTeste,
  smsTeste,
};
