const { pool,emTransacao }=require("../db");
const previsao=require("../previsaoTalhao");
const categorias=require("./categorias");
const controle=require("./climaControle");
const {enfileirar,acordarFila}=require("./fila");
const {normalizarTelefone}=require("../contato");
const {geadaDoDia}=require("./climaRegras");
const FUSO="America/Sao_Paulo";
function relogio(agora=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:FUSO,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(agora).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return {data:`${p.year}-${p.month}-${p.day}`,minutos:Number(p.hour)*60+Number(p.minute)};
}
function agenda(agora=new Date(),janelaMin=30){
  const r=relogio(agora);const hoje=new Date(`${r.data}T06:30:00-03:00`);
  const proxima=agora<hoje?hoje:new Date(hoje.getTime()+86400000);
  return {data:r.data,deveExecutar:r.minutos>=390&&r.minutos<390+janelaMin,
    proxima:proxima.toISOString(),expiraEm:new Date(hoje.getTime()+janelaMin*60000)};
}
const valor=(v)=>Number.isFinite(v)?v.toLocaleString("pt-BR",{maximumFractionDigits:1}):"Indisponível";
function mensagensDoDia(talhoes,data){
  const cabecalho="🌱 Agro Alerta — Clima do Talhão\n\nBom dia!";
  const rodape="\n\nFonte: Open-Meteo.\nPrevisão sujeita a alterações.";
  const blocos=talhoes.map(({talhao,dia})=>[
    `📍 Talhão: ${talhao.nome}\n📅 Data: ${data.split('-').reverse().join('/')}`,
    `🌡️ Mínima: ${valor(dia.tempMin)} °C\n☀️ Máxima: ${valor(dia.tempMax)} °C\n🌧️ Chance de chuva: ${valor(dia.chuvaProbabilidade)}%\n💧 Precipitação prevista: ${valor(dia.chuvaMm)} mm\n💨 Vento máximo: ${valor(dia.ventoMaxKmh)} km/h`,
    `Condições: ${dia.condicoes}\n❄️ Risco de geada: ${geadaDoDia(talhao,dia)}`].join("\n\n"));
  const partes=[];let atual=cabecalho;
  for(const bloco of blocos){if(atual.length+bloco.length+rodape.length>3500&&atual!==cabecalho){partes.push(atual+rodape);atual=cabecalho;}atual+="\n\n"+bloco;}
  if(atual!==cabecalho)partes.push(atual+rodape);
  return partes;
}
async function executar({config,agora=new Date(),buscar=previsao.buscar,relogioAtual=()=>new Date(),log=console.log}={}){
  const a=agenda(agora,config.boletim.janelaMin);
  if(!config.boletim.ativo||!a.deveExecutar)return {ignorado:true,motivo:"Fora da janela ou implantação desativada"};
  if((await controle.consultar()).boletins_pausados)return {ignorado:true,motivo:"Boletins pausados"};
  const lock=await pool.connect();let travado=false;
  try{
    travado=(await lock.query("SELECT pg_try_advisory_lock(hashtext('agroalerta_boletim_diario')) AS ok")).rows[0].ok;
    if(!travado)return {ignorado:true,motivo:"Outra execução em andamento"};
    const anterior=(await pool.query("SELECT status FROM boletim_execucoes WHERE data_local=$1",[a.data])).rows[0];
    if(anterior?.status==="concluido")return {ignorado:true,motivo:"Já concluído hoje"};
    await pool.query(`INSERT INTO boletim_execucoes(data_local,status) VALUES($1,'processando')
      ON CONFLICT(data_local) DO UPDATE SET status='processando',erro=NULL`,[a.data]);
    const {rows:produtores}=await pool.query(`SELECT u.id,u.telefone FROM usuarios u JOIN notificacao_categorias c ON c.usuario_id=u.id
      WHERE u.papel='produtor' AND c.boletim_diario ORDER BY u.id`);
    const resumo={produtores:produtores.length,enfileirados:0,falhas:0,semTalhoes:0};
    for(const p of produtores){
      if(!(await categorias.permite(p.id,"boletim_diario")))continue;
      const{rows:talhoes}=await pool.query("SELECT id,nome,cultura,fase,latitude,longitude FROM talhoes WHERE usuario_id=$1 ORDER BY id",[p.id]);
      if(!talhoes.length){resumo.semTalhoes++;continue;}
      try{
        const dados=[];
        for(const t of talhoes){
          if(!previsao.coordenadasValidas(t.latitude,t.longitude))throw new Error("Coordenadas inválidas");
          const prev=await buscar(t.latitude,t.longitude);
          if(prev.fonte!=="open-meteo")throw new Error("Fonte não autorizada");
          const dia=prev.dias.find(d=>d.data===a.data);
          if(!dia||![dia.tempMin,dia.tempMax,dia.chuvaProbabilidade,dia.chuvaMm,dia.ventoMaxKmh].every(Number.isFinite))throw new Error("Previsão diária incompleta");
          dados.push({talhao:t,dia});
        }
        if(!agenda(relogioAtual(),config.boletim.janelaMin).deveExecutar || relogio(relogioAtual()).data!==a.data) throw new Error("Janela diária encerrada");
        const mensagens=mensagensDoDia(dados,a.data);
        resumo.enfileirados+=await emTransacao(async db=>{
          await db.query("SELECT id FROM usuarios WHERE id=$1 FOR UPDATE",[p.id]);
          if((await controle.consultar(db)).boletins_pausados || !(await categorias.permite(p.id,"boletim_diario",db)))return 0;
          let n=0;
          for(const[i,texto]of mensagens.entries())if(await enfileirar(db,{usuarioId:p.id,canal:"whatsapp",tipo:"boletim_diario",categoria:"boletim_diario",prioridade:10,
            chaveIdempotencia:`boletim:${a.data}:usuario:${p.id}:parte:${i}`,destino:normalizarTelefone(p.telefone),conteudo:texto,resumo:`Boletim diário ${a.data}`,maxTentativas:config.fila.maxTentativas,expiraEm:a.expiraEm}))n++;
          return n;
        });
      }catch(e){resumo.falhas++;log(`[boletim] produtor ${p.id}: ${e.message}`);}
    }
    await pool.query("UPDATE boletim_execucoes SET status=$2,finalizado_em=NOW(),resumo=$3 WHERE data_local=$1",[a.data,resumo.falhas?"parcial":"concluido",resumo]);
    if(resumo.enfileirados)acordarFila();
    return resumo;
  }catch(e){await pool.query("UPDATE boletim_execucoes SET status='falhou',erro=$2,finalizado_em=NOW() WHERE data_local=$1",[a.data,e.message]);throw e;}
  finally{try{if(travado)await lock.query("SELECT pg_advisory_unlock(hashtext('agroalerta_boletim_diario'))");}finally{lock.release();}}
}
let timer=null,rodada=null;
function iniciar(config,log=console.log){if(timer||!config.boletim.ativo)return;const tick=()=>{if(!rodada)rodada=executar({config,log}).catch(e=>log("[boletim] "+e.message)).finally(()=>{rodada=null;});};timer=setInterval(tick,30000);timer.unref();tick();}
function parar(){clearInterval(timer);timer=null;return rodada||Promise.resolve();}
module.exports={relogio,agenda,mensagensDoDia,executar,iniciar,parar};
