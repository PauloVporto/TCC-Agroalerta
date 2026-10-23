const {pool}=require('../db');
const categorias=require('./categorias');
const controle=require('./climaControle');
const previsao=require('../previsaoTalhao');
const {geadaDoDia}=require('./climaRegras');
async function previsoes(usuarioId){
  const {rows}=await pool.query('SELECT id,nome,cultura,fase,latitude,longitude FROM talhoes WHERE usuario_id=$1 ORDER BY id',[usuarioId]);
  return Promise.all(rows.map(async t=>{try{
    const p=await previsao.buscar(t.latitude,t.longitude);
    return {id:t.id,nome:t.nome,...p,dias:p.dias.map(d=>({...d,geada:geadaDoDia(t,d)}))};
  }catch(e){return {id:t.id,nome:t.nome,erro:'Previsão indisponível. Verifique coordenadas ou tente novamente mais tarde.'};}}));
}
async function resumo(config){
  const {rows:produtores}=await pool.query(`SELECT id FROM usuarios u WHERE papel='produtor'
    AND EXISTS(SELECT 1 FROM talhoes t WHERE t.usuario_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM talhoes t WHERE t.usuario_id=u.id AND
      (t.latitude NOT BETWEEN -90 AND 90 OR t.longitude NOT BETWEEN -180 AND 180))`);
  let elegiveis=0;
  for(const p of produtores)if(await categorias.permite(p.id,'boletim_diario'))elegiveis++;
  const ultima=(await pool.query('SELECT * FROM boletim_execucoes ORDER BY data_local DESC LIMIT 1')).rows[0]||null;
  const contadores=(await pool.query(`SELECT COUNT(*) FILTER(WHERE enviado_em IS NOT NULL)::int AS enviados,
    COUNT(*) FILTER(WHERE status IN ('entregue','lido'))::int AS entregues FROM notificacao_envios WHERE tipo='boletim_diario'`)).rows[0];
  const historico=(await pool.query(`SELECT id,COALESCE(categoria,CASE WHEN tipo='alerta_climatico' THEN 'geada' END) AS categoria,tipo,status,resumo,criado_em FROM notificacao_envios
    WHERE categoria IS NOT NULL OR (tipo='alerta_climatico' AND canal='whatsapp') ORDER BY id DESC LIMIT 100`)).rows;
  return {controles:await controle.consultar(),implantacao:{boletim:config.boletim.ativo,novosAlertas:config.novosAlertas.ativo},
    fuso:'America/Sao_Paulo',horario:'06:30',proxima:require('./boletim').agenda().proxima,ultima,elegiveis,contadores,historico};
}
module.exports={previsoes,resumo};
