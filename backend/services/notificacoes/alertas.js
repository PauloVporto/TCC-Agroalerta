/**
 * Transforma episódios novos de risco climático em mensagens na fila.
 *
 * E-mail: todos os riscos. O mesmo risco em vários talhões do mesmo produtor e da
 * mesma região vira uma única mensagem, citando todos os talhões (os talhões de uma
 * cidade compartilham as coordenadas e, portanto, os mesmos dados do Open-Meteo).
 *
 * WhatsApp: só risco de geada — é o que as boas-vindas prometem. Uma mensagem por
 * episódio, propriedade (talhão) e destinatário: a chave de idempotência
 * "alerta:<episódio>:whatsapp" impede repetição. Só sai com dados reais da
 * previsão (dia, temperatura e local); sem eles, nenhuma mensagem afirma que há
 * geada. Vale até o fim do último dia de risco: depois disso, expira sem sair.
 *
 * Cada canal só recebe a mensagem se estiver autorizado e se a gravidade do alerta
 * alcançar o mínimo que o produtor escolheu para ele.
 */

const { pool } = require("../db");
const { enfileirar, acordarFila } = require("./fila");
const { obterConsentimentos, obterPreferencias, contatoDoProdutor, autorizacaoVigente } = require("./consentimentos");
const { emailAlerta, whatsappAlertaGeada } = require("./templates");
const { normalizarTelefone } = require("../contato");

const ORDEM_NIVEL = { baixo: 0, medio: 1, alto: 2 };
const ROTULO_NIVEL = { baixo: "baixo", medio: "médio", alto: "alto" };

function ehRiscoDeGeada(regraId) {
  return /_geada$/.test(String(regraId));
}

// Fim do dia em Brasília (sem horário de verão desde 2019): "2026-10-23" → 23/10 23:59:59 -03:00.
function fimDoDia(dataIso) {
  return new Date(`${dataIso}T23:59:59-03:00`);
}

async function situacaoDoProdutor(usuarioId) {
  const [contato, consentimentos, preferencias] = await Promise.all([
    contatoDoProdutor(usuarioId),
    obterConsentimentos(usuarioId),
    obterPreferencias(usuarioId),
  ]);
  return { contato, consentimentos, preferencias };
}

// ---- E-mail ----------------------------------------------------------------------

function agruparPorProdutor(episodios) {
  const grupos = new Map();
  for (const episodio of episodios) {
    const chave = [episodio.talhao.usuarioId, episodio.alerta.id, episodio.talhao.regiao].join("|");
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(episodio);
  }
  return [...grupos.values()];
}

function dadosDoGrupo(grupo, nome) {
  const principal = grupo.reduce((a, b) => (ORDEM_NIVEL[b.alerta.nivel] > ORDEM_NIVEL[a.alerta.nivel] ? b : a));
  const niveisDiferentes = new Set(grupo.map((e) => e.alerta.nivel)).size > 1;
  return {
    alertaId: Math.min(...grupo.map((e) => e.alertaId)),
    nome,
    titulo: principal.alerta.titulo,
    nivel: principal.alerta.nivel,
    mensagem: principal.alerta.mensagem,
    recomendacao: principal.alerta.recomendacao,
    regiao: principal.talhao.regiao,
    janela: principal.alerta.janela,
    talhoes: grupo.map((e) => (niveisDiferentes ? `${e.talhao.nome} (${ROTULO_NIVEL[e.alerta.nivel]})` : e.talhao.nome)),
    clima: principal.clima,
    consultadoEm: principal.consultadoEm,
  };
}

async function notificarPorEmail(episodios, config) {
  let enfileirados = 0;
  for (const grupo of agruparPorProdutor(episodios)) {
    const usuarioId = grupo[0].talhao.usuarioId;
    const { contato, consentimentos, preferencias } = await situacaoDoProdutor(usuarioId);
    if (!autorizacaoVigente("email", consentimentos.email, contato.telefone)) continue;
    const dados = dadosDoGrupo(grupo, contato.nome);
    if (ORDEM_NIVEL[dados.nivel] < ORDEM_NIVEL[preferencias.emailNivelMinimo]) continue;

    const email = emailAlerta(dados);
    const id = await enfileirar(pool, {
      usuarioId,
      alertaId: dados.alertaId,
      canal: "email",
      tipo: "alerta_climatico",
      chaveIdempotencia: `alerta:${dados.alertaId}:email`,
      destino: contato.email,
      assunto: email.assunto,
      conteudo: email.texto,
      conteudoHtml: email.html,
      resumo: `${dados.titulo} (risco ${ROTULO_NIVEL[dados.nivel]}) · ${dados.talhoes.join(", ")}`,
      regiao: dados.regiao,
      nivel: dados.nivel,
      maxTentativas: config.fila.maxTentativas,
    });
    if (id) enfileirados++;
  }
  return enfileirados;
}

// ---- WhatsApp: geada ---------------------------------------------------------------

/**
 * Dados do alerta de geada tirados da previsão; null quando falta algo para
 * afirmar o risco (dia, temperatura ou local do talhão).
 */
function dadosDaGeada({ alerta, talhao, clima }) {
  const diasDeRisco = Array.isArray(alerta.dias) ? alerta.dias : [];
  const previstos = (clima.previsaoDiaria || []).filter((d) => diasDeRisco.includes(d.data) && Number.isFinite(d.tempMin));
  const localizacao = talhao.regiao || talhao.enderecoFormatado || talhao.endereco;
  if (previstos.length === 0 || !localizacao) return null;

  const maisFrio = previstos.reduce((a, b) => (b.tempMin < a.tempMin ? b : a));
  return {
    recomendacao: alerta.recomendacao || null,
    propriedade: talhao.nome,
    localizacao,
    temperatura: maisFrio.tempMin,
    nivel: alerta.nivel,
    data: maisFrio.data,
    hora: maisFrio.horaMinima || null,
    periodo: previstos.length > 1 ? alerta.janela : null,
    expiraEm: fimDoDia(previstos[previstos.length - 1].data),
  };
}

async function notificarGeadaPorWhatsapp(episodios, config, log) {
  let enfileirados = 0;
  for (const episodio of episodios.filter((e) => ehRiscoDeGeada(e.alerta.id))) {
    const { talhao, alerta } = episodio;
    const { contato, consentimentos, preferencias } = await situacaoDoProdutor(talhao.usuarioId);
    if (!autorizacaoVigente("whatsapp", consentimentos.whatsapp, contato.telefone)) continue;
    if (ORDEM_NIVEL[alerta.nivel] < ORDEM_NIVEL[preferencias.whatsappNivelMinimo]) continue;

    const geada = dadosDaGeada(episodio);
    if (!geada) {
      log(`[alertas] episódio ${episodio.alertaId} sem dia, temperatura ou local previstos: alerta de geada não enviado.`);
      continue;
    }
    const id = await enfileirar(pool, {
      usuarioId: talhao.usuarioId,
      alertaId: episodio.alertaId,
      canal: "whatsapp",
      tipo: "alerta_climatico",
      chaveIdempotencia: `alerta:${episodio.alertaId}:whatsapp`,
      destino: normalizarTelefone(contato.telefone),
      conteudo: whatsappAlertaGeada(geada),
      resumo: `${alerta.titulo} (risco ${ROTULO_NIVEL[alerta.nivel]}) · ${talhao.nome}`,
      regiao: talhao.regiao,
      nivel: alerta.nivel,
      maxTentativas: config.fila.maxTentativas,
      expiraEm: geada.expiraEm,
    });
    if (id) enfileirados++;
  }
  return enfileirados;
}

/**
 * @param episodios [{ alertaId, alerta, talhao: { usuarioId, nome, regiao, endereco... }, clima, consultadoEm }]
 * @returns quantidade de mensagens enfileiradas
 */
async function notificarAlertas(episodios, config, log = console.log) {
  const enfileirados = (await notificarPorEmail(episodios, config)) + (await notificarGeadaPorWhatsapp(episodios, config, log));
  if (enfileirados) acordarFila();
  return enfileirados;
}

module.exports = { notificarAlertas, dadosDaGeada, ehRiscoDeGeada };
