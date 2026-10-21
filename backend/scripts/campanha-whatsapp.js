/** Campanha administrativa autorizada: uma tentativa por número e chave de campanha.
 * Não altera flags, consentimentos, retenções ou configuração dos containers.
 * --autorizado --administrador email --campanha UUID
 */
const assert = require("node:assert/strict");
const { pool, emTransacao } = require("../services/db");
const { lerConfiguracao } = require("../services/notificacoes/config");
const evolution = require("../services/notificacoes/provedores/evolution");
const { autorizacaoVigente } = require("../services/notificacoes/consentimentos");
const { lerControle, registrarEventoAdmin } = require("../services/notificacoes/controle");
const { registrarEvento } = require("../services/notificacoes/eventos");
const { concluirTesteManual } = require("../services/notificacoes/fila");
const { verificarRitmo } = require("../services/notificacoes/limitesWhatsapp");
const { normalizarTelefone, ehCelular, mascararTelefone, numeroParaWhatsapp, telefoneDoWhatsapp } = require("../services/contato");
const { argumento, temOpcao } = require("./comum");

const MENSAGEM = [
  "🌱 Agro Alerta — Teste de Notificações",
  "Olá! Estamos realizando um teste do sistema Agro Alerta.",
  "Seu WhatsApp está cadastrado para receber notificações autorizadas sobre as condições climáticas e riscos de geada na sua propriedade.",
  "Esta é apenas uma mensagem de teste. Não representa um alerta climático real.",
].join("\n\n");
const CONSULTA = `SELECT u.id,u.telefone,c.concedido,c.destino
  FROM usuarios u LEFT JOIN LATERAL (
    SELECT concedido,destino FROM notificacao_consentimentos
    WHERE usuario_id=u.id AND canal='whatsapp' ORDER BY criado_em DESC,id DESC LIMIT 1
  ) c ON TRUE WHERE u.papel='produtor'`;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function elegiveis(rows) {
  return rows.filter((r) => ehCelular(normalizarTelefone(r.telefone)) && autorizacaoVigente("whatsapp", r, r.telefone));
}
function agruparNumeros(rows) {
  const numeros = new Map();
  for (const r of elegiveis(rows)) {
    const destino = normalizarTelefone(r.telefone);
    if (!numeros.has(destino)) numeros.set(destino, []);
    numeros.get(destino).push(r.id);
  }
  return numeros;
}

function validarRemetente(configurado, conectado) {
  const esperado = normalizarTelefone(configurado);
  assert.ok(esperado && esperado.endsWith("9503"), "Configure o número completo autorizado terminado em 9503.");
  assert.equal(conectado, esperado, "Remetente diferente do 9503 autorizado.");
}

async function verificarConexao(config) {
  assert.equal(config.whatsapp.evolution.instancia, "agroalerta");
  assert.equal(config.whatsapp.envioAtivo, true, "Envio real bloqueado na implantação.");
  assert.equal((await lerControle()).enviosBloqueados, false, "Envio bloqueado pelo administrador.");
  const cfg = config.whatsapp.evolution;
  const [estado, dados] = await Promise.all([evolution.estadoDaConexao(cfg), evolution.dadosDaInstancia(cfg)]);
  assert.equal(estado.estado, "open", "WhatsApp desconectado.");
  const remetente = telefoneDoWhatsapp(dados?.numero);
  validarRemetente(config.whatsapp.remetenteEsperado, remetente);
  return remetente;
}

async function reservar(campanha, destino, produtor, remetente) {
  return emTransacao(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO notificacao_envios
       (usuario_id,canal,tipo,chave_idempotencia,destino,conteudo,resumo,status,modo,provedor,
        remetente,tentativas,max_tentativas,tentativa_iniciada_em)
       VALUES($1,'whatsapp','teste',$2,$3,$4,$5,'processando','real','evolution',$6,1,1,NOW())
       ON CONFLICT(chave_idempotencia) DO NOTHING RETURNING id`,
      [produtor.id, `campanha:${campanha}:whatsapp:${destino}`, destino, MENSAGEM,
        `Campanha de teste autorizada ${campanha}`, remetente]);
    if (!rows.length) return null;
    await registrarEvento(db, rows[0].id, "campanha_autorizada", "processando",
      `Campanha ${campanha}: transmissão única autorizada, consentimento vigente; sem reenvio automático.`);
    return rows[0].id;
  });
}

async function despacharNumero(config, campanha, destino, ids) {
  // Compartilha a exclusão do worker automático para respeitar os mesmos limites.
  const lock = await pool.connect();
  let adquirido = false;
  try {
    for (let i = 0; i < 30 && !adquirido; i++) {
      adquirido = (await lock.query("SELECT pg_try_advisory_lock(hashtext('agroalerta_despacho_whatsapp')) AS ok")).rows[0].ok;
      if (!adquirido) await esperar(500);
    }
    if (!adquirido) return { numero: mascararTelefone(destino), motivo: "Despachante ocupado; não transmitido." };
    const key = `campanha:${campanha}:whatsapp:${destino}`;
    const existente = await pool.query("SELECT id,status FROM notificacao_envios WHERE chave_idempotencia=$1", [key]);
    if (existente.rows.length) {
      // Não repetir uma reserva interrompida: o provedor pode ter recebido.
      if (existente.rows[0].status === "processando") {
        await concluirTesteManual(existente.rows[0].id, { erro: { incerto: true, codigo: "campanha_interrompida", message: "Tentativa anterior interrompida: sem reenvio." } });
      }
      return null;
    }
    const atuais = async () => elegiveis((await pool.query(CONSULTA + " AND u.id=ANY($1) ORDER BY u.id", [ids])).rows)
      .filter((r) => normalizarTelefone(r.telefone) === destino);
    let produtores = await atuais();
    if (!produtores.length) return { numero: mascararTelefone(destino), motivo: "Consentimento revogado ou contato alterado; não transmitido." };
    const ritmo = await verificarRitmo({ id: 0, usuario_id: produtores[0].id }, config.whatsapp);
    if (!ritmo.ok) return { numero: mascararTelefone(destino), motivo: ritmo.codigo };
    if (ritmo.esperaMs) await esperar(ritmo.esperaMs);
    const remetente = await verificarConexao(config);
    produtores = await atuais(); // Conferência final depois das esperas e chamadas de conexão.
    if (!produtores.length) return { numero: mascararTelefone(destino), motivo: "Consentimento deixou de vigorar; não transmitido." };
    const envio = await reservar(campanha, destino, produtores[0], remetente);
    if (!envio) return null;
    try {
      const { provedorId } = await evolution.enviarTexto(config.whatsapp.evolution, { numero: numeroParaWhatsapp(destino), texto: MENSAGEM });
      await concluirTesteManual(envio, { provedorId });
      console.log(JSON.stringify({ numero: mascararTelefone(destino), envioId: envio, aceito: true }));
    } catch (erro) {
      if (erro.incerto === undefined) erro.incerto = true;
      await concluirTesteManual(envio, { erro });
      console.log(JSON.stringify({ numero: mascararTelefone(destino), envioId: envio, erro: erro.codigo || "resultado_incerto", semReenvio: true }));
    }
    return null;
  } finally {
    try { if (adquirido) await lock.query("SELECT pg_advisory_unlock(hashtext('agroalerta_despacho_whatsapp'))"); }
    finally { lock.release(); }
  }
}

async function main() {
  assert.ok(temOpcao("autorizado"), "Campanha exige autorização explícita do proprietário.");
  const campanha = argumento("campanha");
  assert.match(campanha || "", /^[a-zA-Z0-9-]{16,80}$/, "Identificador fixo de campanha obrigatório.");
  const { rows: admins } = await pool.query("SELECT id FROM usuarios WHERE email=LOWER($1) AND papel='admin'", [argumento("administrador") || ""]);
  assert.equal(admins.length, 1, "Administrador não autorizado.");
  const config = lerConfiguracao();
  await verificarConexao(config);
  assert.equal(await evolution.webhookEmDia(config.whatsapp.evolution), true, "Webhook não está configurado corretamente.");
  const { rows } = await pool.query(CONSULTA + " ORDER BY u.id");
  const numeros = agruparNumeros(rows);
  const audit = { campanha, produtores: rows.length, consentimentoValido: elegiveis(rows).length, numerosUnicos: numeros.size };
  console.log(JSON.stringify(audit));
  await registrarEventoAdmin(pool, { categoria: "controle", tipo: "campanha_teste_autorizada", detalhe: JSON.stringify(audit), usuarioId: admins[0].id });
  const naoEnviadas = [];
  for (const [destino, ids] of numeros) {
    const resultado = await despacharNumero(config, campanha, destino, ids);
    if (resultado) naoEnviadas.push(resultado);
  }
  let envios;
  for (let i = 0; i < 21; i++) {
    envios = (await pool.query(`SELECT id,destino,status,provedor_id,confirmado_servidor_em,entregue_em,lido_em
      FROM notificacao_envios WHERE chave_idempotencia LIKE $1 ORDER BY id`, [`campanha:${campanha}:whatsapp:%`])).rows;
    if (envios.every((e) => ["entregue", "lido", "falhou", "incerto"].includes(e.status)) || i === 20) break;
    await esperar(3000);
  }
  const resumo = { ...audit, aceitas: envios.filter((e) => e.provedor_id).length,
    confirmadasServidor: envios.filter((e) => e.confirmado_servidor_em).length,
    entregues: envios.filter((e) => e.entregue_em).length, lidas: envios.filter((e) => e.lido_em).length,
    falhas: envios.filter((e) => e.status === "falhou").length,
    incertas: envios.filter((e) => e.status === "incerto").length,
    semConfirmacaoEntrega: envios.filter((e) => !e.entregue_em && e.status !== "falhou").length,
    naoEnviadas, envios: envios.map(({ destino, ...e }) => ({ ...e, numero: mascararTelefone(destino) })) };
  await registrarEventoAdmin(pool, { categoria: "controle", tipo: "campanha_teste_resultado", detalhe: JSON.stringify(resumo), usuarioId: admins[0].id });
  console.log(JSON.stringify({ resultado: resumo }));
}

module.exports = { MENSAGEM, elegiveis, agruparNumeros, validarRemetente };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
