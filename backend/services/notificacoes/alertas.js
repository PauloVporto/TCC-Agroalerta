/**
 * Transforma episódios novos de risco climático em mensagens na fila.
 *
 * O mesmo risco em vários talhões do mesmo produtor e da mesma região vira uma
 * única mensagem por canal, citando todos os talhões: os talhões de uma cidade
 * compartilham as coordenadas e, portanto, os mesmos dados do Open-Meteo.
 * Cada canal só recebe a mensagem se estiver autorizado e se a gravidade do
 * alerta alcançar o mínimo que o produtor escolheu para ele.
 */

const { pool } = require("../db");
const { enfileirar, acordarFila } = require("./fila");
const { obterConsentimentos, obterPreferencias, contatoDoProdutor } = require("./consentimentos");
const { emailAlerta, smsAlerta } = require("./templates");
const { normalizarTelefone } = require("../contato");

const ORDEM_NIVEL = { baixo: 0, medio: 1, alto: 2 };
const ROTULO_NIVEL = { baixo: "baixo", medio: "médio", alto: "alto" };

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

/**
 * @param episodios [{ alertaId, alerta, talhao: { usuarioId, nome, regiao }, clima, consultadoEm }]
 * @returns quantidade de mensagens enfileiradas
 */
async function notificarAlertas(episodios, config) {
  let enfileirados = 0;
  for (const grupo of agruparPorProdutor(episodios)) {
    const usuarioId = grupo[0].talhao.usuarioId;
    const [contato, consentimentos, preferencias] = await Promise.all([
      contatoDoProdutor(usuarioId),
      obterConsentimentos(usuarioId),
      obterPreferencias(usuarioId),
    ]);
    const dados = dadosDoGrupo(grupo, contato.nome);
    const nivel = ORDEM_NIVEL[dados.nivel];
    const comum = {
      usuarioId,
      alertaId: dados.alertaId,
      tipo: "alerta_climatico",
      resumo: `${dados.titulo} (risco ${ROTULO_NIVEL[dados.nivel]}) · ${dados.talhoes.join(", ")}`,
      regiao: dados.regiao,
      nivel: dados.nivel,
      maxTentativas: config.fila.maxTentativas,
    };

    if (consentimentos.email.concedido && nivel >= ORDEM_NIVEL[preferencias.emailNivelMinimo]) {
      const email = emailAlerta(dados);
      const id = await enfileirar(pool, {
        ...comum,
        canal: "email",
        chaveIdempotencia: `alerta:${dados.alertaId}:email`,
        destino: contato.email,
        assunto: email.assunto,
        conteudo: email.texto,
        conteudoHtml: email.html,
      });
      if (id) enfileirados++;
    }
    if (consentimentos.sms.concedido && nivel >= ORDEM_NIVEL[preferencias.smsNivelMinimo]) {
      const id = await enfileirar(pool, {
        ...comum,
        canal: "sms",
        chaveIdempotencia: `alerta:${dados.alertaId}:sms`,
        destino: normalizarTelefone(contato.telefone),
        conteudo: smsAlerta(dados, config.sms.maxSegmentos),
      });
      if (id) enfileirados++;
    }
  }
  if (enfileirados) acordarFila();
  return enfileirados;
}

module.exports = { notificarAlertas };
