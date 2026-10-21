const { pool, emTransacao } = require("../db");
const { obterConsentimentos, autorizacaoVigente, contatoDoProdutor } = require("./consentimentos");
const { normalizarTelefone } = require("../contato");
const { registrarEvento } = require("./eventos");
const CATEGORIAS = ["boletim_diario","geada","chuva_intensa","vento_forte","calor_extremo"];

async function consultar(usuarioId, db=pool) {
  const contato=await contatoDoProdutor(usuarioId,db);
  const consentimentos=await obterConsentimentos(usuarioId,db);
  const {rows}=await db.query("SELECT * FROM notificacao_categorias WHERE usuario_id=$1",[usuarioId]);
  const whatsappValido = !!contato && autorizacaoVigente("whatsapp",consentimentos.whatsapp,contato.telefone);
  const r=rows[0];
  const mesmoTelefone = !!r && normalizarTelefone(r.telefone_autorizado)===normalizarTelefone(contato?.telefone);
  const preferencias={};
  for(const categoria of CATEGORIAS) preferencias[categoria] = categoria==="geada" && r?.geada==null
    ? whatsappValido : !!(mesmoTelefone && r?.[categoria]);
  return { preferencias, whatsappValido, geadaLegada: r?.geada==null, atualizadoEm:r?.atualizado_em||null };
}
async function permite(usuarioId,categoria,db=pool) {
  const s=await consultar(usuarioId,db);
  return s.whatsappValido && !!s.preferencias[categoria];
}
async function salvar(usuarioId, escolhas) {
  const campos=Object.keys(escolhas||{});
  if(!campos.length || campos.some(c=>!CATEGORIAS.includes(c)||typeof escolhas[c]!=="boolean")) {
    const e=new Error("Informe categorias conhecidas com true ou false.");e.status=400;throw e;
  }
  return emTransacao(async db=>{
    // Serializa decisões e enfileiramento do boletim para este produtor.
    await db.query("SELECT id FROM usuarios WHERE id=$1 FOR UPDATE",[usuarioId]);
    const atual=await consultar(usuarioId,db);
    if(campos.some(c=>escolhas[c])&&!atual.whatsappValido){const e=new Error("Autorize primeiro o WhatsApp para o celular atual.");e.status=400;throw e;}
    const contato=await contatoDoProdutor(usuarioId,db);
    await db.query("INSERT INTO notificacao_categorias(usuario_id,telefone_autorizado) VALUES($1,$2) ON CONFLICT DO NOTHING",[usuarioId,contato.telefone]);
    await db.query(`UPDATE notificacao_categorias SET boletim_diario=false,chuva_intensa=false,
      vento_forte=false,calor_extremo=false,geada=CASE WHEN geada IS NULL THEN NULL ELSE false END
      WHERE usuario_id=$1 AND telefone_autorizado IS DISTINCT FROM $2`,[usuarioId,contato.telefone]);
    for(const c of campos){
      await db.query(`UPDATE notificacao_categorias SET ${c}=$2,telefone_autorizado=$3,atualizado_em=NOW() WHERE usuario_id=$1`,[usuarioId,escolhas[c],contato.telefone]);
      await db.query("INSERT INTO notificacao_categorias_auditoria(usuario_id,categoria,autorizado,telefone,origem) VALUES($1,$2,$3,$4,'perfil')",[usuarioId,c,escolhas[c],contato.telefone]);
      if(!escolhas[c]){
        const {rows}=await db.query(`UPDATE notificacao_envios SET status='cancelado',erro_codigo='categoria_revogada',atualizado_em=NOW()
          WHERE usuario_id=$1 AND canal='whatsapp' AND status='pendente' AND
          (categoria=$2 OR ($2='geada' AND tipo='alerta_climatico' AND categoria IS NULL)) RETURNING id`,[usuarioId,c]);
        for(const e of rows) await registrarEvento(db,e.id,"cancelado","cancelado",`Autorização da categoria ${c} revogada.`);
      }
    }
    return consultar(usuarioId,db);
  });
}
module.exports={CATEGORIAS,consultar,permite,salvar};
