const{pool,emTransacao}=require("../db");
const{registrarEventoAdmin}=require("./controle");
async function consultar(db=pool){return (await db.query("SELECT boletins_pausados,novos_alertas_pausados,atualizado_em FROM clima_controle WHERE id=1")).rows[0];}
async function salvar(escolhas,usuarioId){
  const campos=Object.keys(escolhas||{});
  if(!campos.length||campos.some(c=>!["boletins_pausados","novos_alertas_pausados"].includes(c)||typeof escolhas[c]!=="boolean")){const e=new Error("Informe controles booleanos válidos.");e.status=400;throw e;}
  return emTransacao(async db=>{
    await db.query("SELECT id FROM clima_controle WHERE id=1 FOR UPDATE");
    for(const c of campos){
      await db.query(`UPDATE clima_controle SET ${c}=$1,atualizado_por=$2,atualizado_em=NOW() WHERE id=1`,[escolhas[c],usuarioId]);
      await registrarEventoAdmin(db,{categoria:"controle",tipo:c,detalhe:`${c}=${escolhas[c]}`,usuarioId});
    }
    return consultar(db);
  });
}
module.exports={consultar,salvar};
