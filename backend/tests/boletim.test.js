const {test}=require('node:test');const assert=require('node:assert/strict');
const {agenda,relogio,mensagensDoDia}=require('../services/notificacoes/boletim');
const {interpretar,coordenadasValidas}=require('../services/previsaoTalhao');
const {avaliarNovos,geadaDoDia}=require('../services/notificacoes/climaRegras');
const {lerConfiguracao}=require('../services/notificacoes/config');
test('06h30 Brasília equivale a 09h30 UTC, janela encerra às 07h',()=>{
 assert.equal(agenda(new Date('2026-10-21T09:29:59Z')).deveExecutar,false);
 assert.equal(agenda(new Date('2026-10-21T09:30:00Z')).deveExecutar,true);
 assert.equal(agenda(new Date('2026-10-21T09:59:59Z')).deveExecutar,true);
 assert.equal(agenda(new Date('2026-10-21T10:00:00Z')).deveExecutar,false);
});
test('virada de dia usa data local e nunca recupera boletim anterior',()=>{
 assert.equal(relogio(new Date('2026-10-22T01:00Z')).data,'2026-10-21');
 assert.equal(agenda(new Date('2026-10-22T08:00Z')).deveExecutar,false);
 assert.equal(agenda(new Date('2026-10-21T10:00Z')).proxima,'2026-10-22T09:30:00.000Z');
});
test('coordenadas e previsão ausentes não viram clima fictício',()=>{
 for(const p of [[null,0],[91,0],[0,181],['-21',-45],[NaN,0]])assert.equal(coordenadasValidas(...p),false);
 assert.equal(coordenadasValidas(-21,-45),true);
 assert.throws(()=>interpretar({}));assert.equal(interpretar({daily:{time:['2026-10-21']}}).dias[0].tempMin,null);
});
test('mensagem agrupa talhões, preserva fonte e avaliação geada por cultura',()=>{
 const dia={tempMin:1,tempMax:22,chuvaProbabilidade:30,chuvaMm:5,ventoMaxKmh:12,condicoes:'Limpo'};
 const mensagens=mensagensDoDia(['A','B'].map(nome=>({talhao:{nome,cultura:'cafe'},dia})),'2026-10-21');
 assert.equal(mensagens.length,1);assert.match(mensagens[0],/Talhão: A/);assert.match(mensagens[0],/Talhão: B/);assert.match(mensagens[0],/Open-Meteo/);
 assert.match(geadaDoDia({cultura:'cafe'},dia),/Alto/);assert.match(geadaDoDia({cultura:'milho'},dia),/não disponível/);
});
for(const [categoria,campo,limite]of [['chuva_intensa','chuvaMm',50],['vento_forte','ventoMaxKmh',40],['calor_extremo','tempMax',35]])test('limiar configurável '+categoria,()=>{
 const c=lerConfiguracao({}).novosAlertas;
 assert.equal(avaliarNovos([{data:'2026-10-21',[campo]:limite-1}],c).length,0);
 assert.equal(avaliarNovos([{data:'2026-10-21',[campo]:limite}],c)[0].categoria,categoria);
 assert.equal(avaliarNovos([{data:'2026-10-21',[campo]:c[categoria].alto}],c)[0].nivel,'alto');
});
test('novas funcionalidades desativadas por padrão e critérios inválidos recusados',()=>{
 const c=lerConfiguracao({});assert.equal(c.boletim.ativo,false);assert.equal(c.novosAlertas.ativo,false);
 assert.throws(()=>avaliarNovos([],{chuva_intensa:{medio:10,alto:5,delta:1}}));
});
