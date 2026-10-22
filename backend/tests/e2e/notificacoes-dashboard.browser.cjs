// Somente TEST_DATABASE_URL terminada em _teste. Não usa serviços de produção.
const b=require('../integracao/helpers/banco');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const {iniciarApp}=require('../helpers/servidor');
const {iniciarEvolutionFalsa}=require('../integracao/helpers/evolutionFalsa');
const previsao=require('../../services/previsaoTalhao');
(async()=>{
 let browser,servidor,evolution,front;
 try{
  await b.prepararBanco();await b.limparBanco();
  evolution=await iniciarEvolutionFalsa();Object.assign(process.env,evolution.env,{WHATSAPP_EXPECTED_SENDER:'9503',EVOLUTION_WEBHOOK_URL:'http://isolado.test/webhook',EVOLUTION_WEBHOOK_SECRET:'segredo-ficticio'});
  previsao.buscar=async()=>({fonte:'open-meteo',fuso:'America/Sao_Paulo',dias:[{data:'2026-10-21',tempMin:12,tempMax:26,chuvaProbabilidade:40,chuvaMm:3,ventoMaxKmh:10,condicoes:'Parcialmente nublado'}]});
  const produtor=await b.criarProdutor({email:'produtor@example.test',telefone:'5535999991111',consentimentos:{whatsapp:true}});
  const admin=await b.criarProdutor({email:'admin@example.test',papel:'admin'});
  await b.criarTalhaoDeTeste(produtor.id,{nome:'Café da encosta'});await b.criarTalhaoDeTeste(produtor.id,{nome:'Café do vale'});
  const token=await b.criarSessao(produtor.id),adminToken=await b.criarSessao(admin.id);
  servidor=await iniciarApp(app=>{app.use(require('cors')());app.use('/api/auth',require('../../routes/auth'));app.use('/api/notificacoes',require('../../routes/notificacoes'));app.use('/api/admin',require('../../routes/admin'));});
  front=spawn(process.execPath,['serve.js'],{cwd:require('node:path').resolve(__dirname,'../../../frontend'),env:{...process.env,PORT:'55175',PUBLIC_API_BASE:servidor.url+'/api'},stdio:'ignore'});
  await new Promise((resolve,reject)=>{front.once('error',reject);setTimeout(resolve,700);});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  let checks=0;
  for(const width of [1280,390]){
   const context=await browser.newContext({viewport:{width,height:900}});
   await context.addInitScript(t=>{if(!sessionStorage.getItem('agroalerta_token')){sessionStorage.setItem('agroalerta_token',t);sessionStorage.setItem('agroalerta_usuario',JSON.stringify({papel:'produtor',nome:'Produtor fictício'}));}},token);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://localhost:55175/clima-produtor.html');await page.locator('input[data-categoria=boletim_diario]').waitFor();
   assert.equal(await page.locator('input[data-categoria=boletim_diario]').isChecked(),false);checks++;
   assert.equal(await page.locator('input[data-categoria=geada]').isChecked(),true);checks++;
   await page.getByText('Café da encosta',{exact:true}).waitFor();assert.equal(await page.getByText('Café da encosta',{exact:true}).count(),1);checks++;
   await page.locator('input[data-categoria=boletim_diario]').check();await page.getByRole('button',{name:'Salvar categorias'}).click();await page.getByText('Preferências salvas.',{exact:true}).waitFor();
   assert.equal((await require('../../services/notificacoes/categorias').consultar(produtor.id)).preferencias.boletim_diario,true);checks++;
   await page.locator('input[data-categoria=boletim_diario]').uncheck();await page.getByRole('button',{name:'Salvar categorias'}).click();await page.waitForTimeout(120);
   assert.equal((await require('../../services/notificacoes/categorias').consultar(produtor.id)).preferencias.boletim_diario,false);checks++;
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
   await page.screenshot({path:`/tmp/agro-clima-produtor-${width}.png`,fullPage:true});
   const denied=await context.request.get(servidor.url+'/api/admin/clima',{headers:{Authorization:'Bearer '+token}});assert.equal(denied.status(),403);checks++;
   await page.evaluate(t=>{sessionStorage.setItem('agroalerta_token',t);sessionStorage.setItem('agroalerta_usuario',JSON.stringify({papel:'admin',nome:'Administrador fictício'}));},adminToken);
   await page.goto('http://localhost:55175/whatsapp.html');await page.getByTestId('controles-clima-notificacoes').waitFor({state:'visible'});await page.getByText(/produtores elegíveis/).first().waitFor();
   assert.match(await page.getByText(/Próxima janela:/).textContent(),/06h30/);checks++;
   assert.equal(await page.getByLabel('Pausar boletins',{exact:true}).isChecked(),true);checks++;
   await page.getByLabel('Pausar boletins',{exact:true}).uncheck();await page.getByRole('button',{name:'Salvar controles climáticos',exact:true}).click();await page.getByText('Preferências salvas.',{exact:true}).waitFor();
   assert.equal((await b.pool.query('SELECT boletins_pausados FROM clima_controle')).rows[0].boletins_pausados,false);checks++;
   await page.getByLabel('Pausar boletins',{exact:true}).check();await page.getByRole('button',{name:'Salvar controles climáticos',exact:true}).click();await page.waitForTimeout(150);
   assert.equal((await b.pool.query('SELECT boletins_pausados FROM clima_controle')).rows[0].boletins_pausados,true);checks++;
   assert.match(page.url(),/dashboard.dc.html#notificacoes$/);checks++;

   assert.equal(await page.getByTestId('preferencias-notificacoes').count(),0);checks++;
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks++;
   await page.screenshot({path:`/tmp/agro-clima-admin-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);checks++;
   await context.close();
  }
  assert.equal(evolution.envios().length,0);checks++;
  console.log(`${checks} verificações Chrome no painel integrado aprovadas: desktop/mobile, preferências, previsão, admin, permissões; zero envios.`);
 }finally{if(browser)await browser.close();if(front)front.kill();if(servidor)await servidor.fechar();if(evolution)await evolution.fechar();await b.pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
