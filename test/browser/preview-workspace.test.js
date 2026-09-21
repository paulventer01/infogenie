'use strict';
// Hosted-only acceptance: disposable TLS database from the exact devcontainer image.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const ROOT=path.resolve(__dirname,'../..'), ORIGIN='http://127.0.0.1:5000';
test('preview boots, authenticates, renders the journey and preserves its account across restart', {timeout:360000,skip:process.env.INFOGENIE_REQUIRE_PREVIEW_TEST!=='1'?'optional local run: no disposable preview database':false},async t=>{
  assert.equal(process.env.INFOGENIE_REQUIRE_PREVIEW_TEST,'1','Run only against the disposable preview CI database');
  let child,browser,page,log='',stage='startup';
  const stop=async()=>{if(child && child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}child=null;};
  t.after(async()=>{
    fs.mkdirSync('/tmp/preview-artifacts',{recursive:true});
    if(page){await page.screenshot({path:'/tmp/preview-artifacts/last-screen.png',fullPage:true}).catch(()=>{});
      t.diagnostic('Last stage: '+stage+'; URL: '+page.url());
      t.diagnostic((await page.evaluate(()=>document.body.innerText).catch(()=>'' )).slice(0,7000));}
    t.diagnostic(log);
    await browser?.close();await stop();
  });
  async function start(){
    child=spawn(process.execPath,['scripts/preview/start.js'],{cwd:ROOT,env:{...process.env,CODESPACES:'true',CODESPACE_NAME:'preview-ci-workspace',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'},stdio:['ignore','pipe','pipe']});
    for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{log=(log+chunk).slice(-18000);});
    const deadline=Date.now()+150000;
    while(Date.now()<deadline){
      assert.equal(child.exitCode,null,log);
      try{if((await fetch(ORIGIN+'/login',{signal:AbortSignal.timeout(3000)})).status===200)return;}catch{}
      await new Promise(r=>setTimeout(r,500));
    }
    assert.fail('Preview never served login: '+log);
  }
  await start();
  const accessPath=path.join(ROOT,'.preview-workspace/access.json');
  const original=fs.readFileSync(accessPath,'utf8'), account=JSON.parse(original);
  assert.equal(fs.statSync(accessPath).mode&0o777,0o600);
  assert.equal(account.email,'reviewer@example.test');
  browser=await require('puppeteer').launch({headless:true,pipe:true,args:['--disable-dev-shm-usage']});
  page=await browser.newPage(); page.setDefaultTimeout(60000);
  const externalResponses=[];
  page.on('response',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol) && u.origin!==ORIGIN) externalResponses.push(u.origin);});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function login(){
    const documentResponse=await page.goto(ORIGIN+'/login?next=%2Fmanage%2Fclient-reporting',{waitUntil:'networkidle2'});
    assert.match(documentResponse.headers()['content-security-policy'],/connect-src 'self'(;|$)/);
    assert.equal(await page.$('#ms-clarity'),null);
    await page.waitForFunction(()=>document.body.innerText.includes('Preview login'));
    stage='fill login';
    await page.locator('#email').fill(account.email);await page.locator('#pass').fill(account.password);
    stage='submit login';
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login' && r.request().method()==='POST'),
      page.locator('form button[type="submit"]').click()]);
    assert.equal(response.status(),200);
    stage='finish workspace startup';
    await page.waitForFunction(()=>window.__igLegacyReady===true);
    stage='load client selector';
    await page.waitForSelector('select[name="client_id"]:enabled');
  }
  await page.setViewport({width:1440,height:1000});await login();
  stage='workspace home';
  await page.goto(ORIGIN+'/',{waitUntil:'networkidle2'});
  await page.waitForSelector('select[name="workspace_client"]');
  assert.ok(await page.evaluate(()=>document.body.innerText.includes('A clear place to start.')));
  await page.select('select[name="workspace_client"]',String(account.clientId));
  await page.waitForFunction(()=>document.body.innerText.includes('Setup needed'));
  await page.screenshot({path:'/tmp/workspace-home-desktop.png',fullPage:true});
  await page.setViewport({width:390,height:844});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
  fs.mkdirSync('/tmp/preview-artifacts',{recursive:true});
  await page.screenshot({path:'/tmp/preview-artifacts/workspace-home-mobile.png',fullPage:true});
  fs.renameSync('/tmp/workspace-home-desktop.png','/tmp/preview-artifacts/workspace-home-desktop.png');
  await page.setViewport({width:1440,height:1000});
  await page.goto(ORIGIN+'/manage/client-reporting?client='+account.clientId,{waitUntil:'networkidle2'});
  await page.waitForSelector('form[aria-label="Reporting profile"]');
  assert.equal(await page.$eval('select[name="client_id"]',el=>el.value),String(account.clientId));
  stage='select client';
  await page.select('select[name="client_id"]',String(account.clientId));
  await page.waitForSelector('form[aria-label="Reporting profile"]');
  assert.equal(await page.$$eval('nav[aria-label="Reporting journey"] button',items=>items.length),4);
  assert.ok(await page.evaluate(()=>document.body.innerText.includes('Test workspace')));
  stage='edit report title';
  await page.locator('#ig-react-panel [name="report_title"]:enabled').fill('DEMO — Monthly client review');
  await page.waitForFunction(()=>document.querySelector('#ig-react-panel [name="report_title"]')?.value==='DEMO — Monthly client review');
  stage='save report';
  await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT' && new URL(r.url()).pathname.endsWith('/profile')),
    page.locator('form[aria-label="Reporting profile"] button[type="submit"]').click()]);
  stage='Codespaces authenticated mutation';
  // Match the public Origin / internal rewrite Host combination seen in Codespaces.
  const cookies=(await page.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
  const endpoint=ORIGIN+`/api/client-reporting/clients/${account.clientId}/profile`;
  const read=await fetch(endpoint,{headers:{Cookie:cookies}});const saved=await read.json();
  assert.equal(saved.ok,true);
  const {version,created_at,updated_at,client_id,...fields}=saved.profile;
  for(const [origin,allowed] of [['https://preview-ci-workspace-5000.app.github.dev',true],['https://other-workspace-5000.app.github.dev',false]]) {
    const response=await fetch(endpoint,{method:'PUT',headers:{Cookie:cookies,Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({...fields,expected_version:version})});
    const result=await response.json();
    if(allowed){assert.equal(response.status,200);assert.equal(result.ok,true);}
    else{assert.equal(response.status,403);assert.equal(result.error,'csrf_rejected');}
  }
  await page.reload({waitUntil:'networkidle2'});
  stage='load saved report';
  await page.waitForSelector('#report-review [aria-label="Client report preview"]');
  fs.mkdirSync('/tmp/preview-artifacts',{recursive:true});
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.waitForFunction(()=>document.querySelector('[name="report_title"]')?.value==='DEMO — Monthly client review' && !document.body.innerText.includes('Verifying account, workspace'));
  assert.equal(await page.$eval('button[aria-current="page"]',el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  await page.screenshot({path:'/tmp/preview-artifacts/reporting-desktop.png',fullPage:true});
  await page.setViewport({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('#report-client').getBoundingClientRect().right<=innerWidth && document.documentElement.scrollWidth<=innerWidth+1,{timeout:5000});
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
    overflowing:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>({tag:e.tagName,id:e.id,classes:e.className,right:e.getBoundingClientRect().right}))}));
  t.diagnostic(JSON.stringify(geometry));
  assert.ok(geometry.scroll<=geometry.width+1,'no mobile page overflow');
  assert.equal(await page.$eval('#report-client',el=>el.getBoundingClientRect().right<=innerWidth),true);
  assert.equal(await page.$eval('main header h1',el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  await page.screenshot({path:'/tmp/preview-artifacts/reporting-mobile.png',fullPage:true});
  stage='campaign brief to approval';
  await require('../helpers/campaign-journey-browser')(page,account,ORIGIN);
  await stop();
  fs.renameSync(accessPath,accessPath+'.pending'); // interrupted first boot after commit, before rename
  await new Promise(r=>setTimeout(r,2000));await start();
  assert.equal(fs.readFileSync(accessPath,'utf8'),original,'restart retains test credentials and workspace');
  await page.deleteCookie(...await page.cookies());await login();
  await page.select('select[name="client_id"]',String(account.clientId));
  await page.waitForFunction(()=>document.querySelector('[name="report_title"]')?.value==='DEMO — Monthly client review');
  assert.deepEqual(errors,[]);
  assert.deepEqual(externalResponses,[],'preview browser has no external HTTP responses');
});
