const { avaliarAlertas } = require("../rules");
const FENOMENOS = {
  chuva_intensa: { campo:"chuvaMm",titulo:"Chuva intensa prevista",unidade:"mm/dia" },
  vento_forte: { campo:"ventoMaxKmh",titulo:"Vento forte previsto",unidade:"km/h" },
  calor_extremo: { campo:"tempMax",titulo:"Temperatura elevada prevista",unidade:"°C" },
};
function avaliarNovos(dias,criterios) {
  const riscos=[];
  for(const [categoria,meta] of Object.entries(FENOMENOS)){
    const c=criterios[categoria];
    if(!c||![c.medio,c.alto,c.delta].every(Number.isFinite)||c.alto<=c.medio||c.delta<=0) throw new Error(`Critérios inválidos: ${categoria}`);
    const previstos=dias.filter(d=>Number.isFinite(d[meta.campo])&&d[meta.campo]>=c.medio);
    if(!previstos.length)continue;
    const maximo=Math.max(...previstos.map(d=>d[meta.campo]));
    const nivel=maximo>=c.alto?"alto":"medio";
    riscos.push({categoria,id:`meteo_${categoria}`,titulo:meta.titulo,nivel,intensidade:maximo,unidade:meta.unidade,
      dias:previstos.map(d=>d.data),janela:previstos.length===1?previstos[0].data:`${previstos[0].data} a ${previstos.at(-1).data}`,
      mensagem:`Previsão de até ${maximo} ${meta.unidade}; critério operacional configurado (${c.medio}/${c.alto} ${meta.unidade}).`,
      recomendacao:"Acompanhe as atualizações da previsão e avalie a exposição local. Estes critérios meteorológicos não substituem orientação agronômica específica."});
  }
  return riscos;
}
function geadaDoDia(talhao,dia) {
  if(talhao.cultura!=="cafe")return "Avaliação não disponível para esta cultura";
  if(!Number.isFinite(dia.tempMin))return "Avaliação indisponível (mínima ausente)";
  const r=avaliarAlertas("cafe",talhao.fase,{temperaturaMinima:dia.tempMin,previsaoDiaria:dia.data?[dia]:[]}).find(a=>a.id==="cafe_geada");
  return r ? (r.nivel==="alto"?"Alto":"Moderado")+" (critério existente para café)" : "Não identificado pelo critério de café";
}
module.exports={avaliarNovos,geadaDoDia,FENOMENOS};
