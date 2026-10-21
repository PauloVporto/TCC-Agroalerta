const {emTransacao}=require("../db");
const previsao=require("../previsaoTalhao");
const categorias=require("./categorias");
const controle=require("./climaControle");
const{avaliarNovos}=require("./climaRegras");
const{enfileirar,acordarFila}=require("./fila");
const{normalizarTelefone}=require("../contato");

async function processarTalhao(talhao,config,{buscar=previsao.buscar,agora=new Date(),log=console.log}={}){
  if(!config.novosAlertas?.ativo||(await controle.consultar()).novos_alertas_pausados)return 0;
  const prefs=await categorias.consultar(talhao.usuarioId);
  if(!prefs.whatsappValido||!["chuva_intensa","vento_forte","calor_extremo"].some(c=>prefs.preferencias[c]))return 0;
  if(!previsao.coordenadasValidas(talhao.latitude,talhao.longitude))throw new Error("Coordenadas inválidas");
  const prev=await buscar(talhao.latitude,talhao.longitude);
  if(prev.fonte!=="open-meteo")throw new Error("Fonte não autorizada");
  let total=0;
  const hoje=require("./boletim").relogio(agora).data;
  for(const risco of avaliarNovos(prev.dias.filter(d=>d.data>=hoje),config.novosAlertas)){
    if(!prefs.preferencias[risco.categoria])continue;
    const texto=["⚠️ Agro Alerta — "+risco.titulo,`📍 Talhão: ${talhao.nome}\nLocalização: ${talhao.regiao||talhao.endereco||"Coordenadas cadastradas"}`,
      `Nível: ${risco.nivel==="alto"?"Alto":"Moderado"}\nPeríodo previsto: ${risco.janela}`,risco.mensagem,risco.recomendacao,
      "Fonte: Open-Meteo. Previsão sujeita a alterações."].join("\n\n");
    total+=await emTransacao(async db=>{
      await db.query("SELECT id FROM usuarios WHERE id=$1 FOR UPDATE",[talhao.usuarioId]);
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`meteo:${talhao.id}:${risco.categoria}`]);
      if((await controle.consultar(db)).novos_alertas_pausados || !(await categorias.permite(talhao.usuarioId,risco.categoria,db)))return 0;
    const anterior=(await db.query(`SELECT id,nivel,intensidade FROM alertas_gerados
      WHERE talhao_id=$1 AND regra_id=$2 AND ultima_deteccao_em>NOW()-INTERVAL '24 hours'
      ORDER BY id DESC LIMIT 1`,[talhao.id,risco.id])).rows[0];
    const subiu=anterior?.nivel==="medio"&&risco.nivel==="alto";
    const agravou=anterior&&risco.intensidade>=anterior.intensidade+config.novosAlertas[risco.categoria].delta;
    if(anterior&&!subiu&&!agravou){await db.query("UPDATE alertas_gerados SET ultima_deteccao_em=NOW() WHERE id=$1",[anterior.id]);return 0;}
    const contato=await require("./consentimentos").contatoDoProdutor(talhao.usuarioId,db);
      const {rows}=await db.query(`INSERT INTO alertas_gerados(talhao_id,regra_id,nivel,titulo,mensagem,recomendacao,janela,regiao,categoria,intensidade)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[talhao.id,risco.id,risco.nivel,risco.titulo,risco.mensagem,risco.recomendacao,risco.janela,talhao.regiao,risco.categoria,risco.intensidade]);
      return (await enfileirar(db,{usuarioId:talhao.usuarioId,alertaId:rows[0].id,canal:"whatsapp",tipo:"alerta_meteorologico",categoria:risco.categoria,prioridade:100,
        chaveIdempotencia:`meteo:${rows[0].id}:whatsapp`,destino:normalizarTelefone(contato.telefone),conteudo:texto,resumo:risco.titulo,nivel:risco.nivel,
        regiao:talhao.regiao,maxTentativas:config.fila.maxTentativas,expiraEm:new Date(`${risco.dias.at(-1)}T23:59:59-03:00`)}))?1:0;
    });
  }
  if(total){acordarFila();log(`[clima] ${total} alerta(s) novo(s) no talhão ${talhao.id}`);}
  return total;
}
module.exports={processarTalhao};
