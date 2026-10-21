'use strict';
(()=>{
 const $=id=>document.getElementById(id),base=window.AGROALERTA_API_BASE||'http://localhost:3001/api';
 const nomes={boletim_diario:'Boletim diário',geada:'Geada',chuva_intensa:'Chuva intensa',vento_forte:'Vento forte',calor_extremo:'Calor extremo'};
 async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(sessionStorage.getItem('agroalerta_token')||'')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok)throw Error(r.status===401?'Entre no Agro Alerta para acessar suas preferências.':d.erro||'Não foi possível concluir.');return d;}
 const texto=(pai,tag,value)=>{const el=document.createElement(tag);el.textContent=value;pai.append(el);return el;};
 const v=n=>Number.isFinite(n)?n.toLocaleString('pt-BR'):'Indisponível';
 async function carregar(){
  const [prefs,previsoes,historico]=await Promise.all([api('/notificacoes/categorias'),api('/notificacoes/previsoes'),api('/notificacoes/historico')]);
  $('consentimento').textContent=prefs.whatsappValido?'WhatsApp autorizado para o telefone atual.' :'Autorize o WhatsApp para seu celular em Configurar conta antes de ativar categorias.';
  if(prefs.geadaLegada)texto($('consentimento'),'span',' A geada existente foi preservada. Ao salvar, sua escolha passa a ser explícita.');
  $('categorias').replaceChildren();
  for(const [c,nome]of Object.entries(nomes)){const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.name=c;input.checked=prefs.preferencias[c];l.append(input,document.createTextNode(' Receber '+nome.toLowerCase()));$('categorias').append(l);}
  $('previsoes').replaceChildren();
  for(const t of previsoes.talhoes){const article=document.createElement('article');texto(article,'h3',t.nome);if(t.erro)texto(article,'p',t.erro);else for(const d of t.dias){texto(article,'h4',d.data.split('-').reverse().join('/'));texto(article,'p',`Mínima: ${v(d.tempMin)} °C · Máxima: ${v(d.tempMax)} °C · Chuva: ${v(d.chuvaProbabilidade)}% · ${v(d.chuvaMm)} mm · Vento: ${v(d.ventoMaxKmh)} km/h`);texto(article,'p',d.condicoes+' · Geada: '+d.geada);}$('previsoes').append(article);}
  if(!previsoes.talhoes.length)texto($('previsoes'),'p','Cadastre um talhão para consultar a previsão.');
  $('historico').replaceChildren();for(const e of historico.envios)texto($('historico'),'p',`${e.resumo||nomes[e.categoria]||e.tipo} — ${e.status}`);
  if(!historico.envios.length)texto($('historico'),'p','Nenhuma notificação registrada.');
 }
 $('preferencias').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries([...$('categorias').querySelectorAll('input')].map(i=>[i.name,i.checked]));try{await api('/notificacoes/categorias','PUT',body);$('feedback').textContent='Preferências salvas.';}catch(e){$('feedback').textContent=e.message;}});
 carregar().catch(e=>$('feedback').textContent=e.message);
})();
