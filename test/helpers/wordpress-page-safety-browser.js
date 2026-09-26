'use strict';
const assert = require('node:assert/strict');

// Real UI/login/API/tenant policy and PostgreSQL audit. Only topic/article generation
// and the reserved WordPress transport are fixtures; no external page is created.
module.exports = async function pagePublishSafety({page,baseUrl,actors,db,fx}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const realFetch=global.fetch, calls=[];
  let release;
  let title='guaranteed returns', topicCount=1, providerStatus=201, hold, entered;
  global.fetch=async (url,opts)=>{
    if(String(url)!=='https://wordpress.example.test/wp-json/wp/v2/pages') return realFetch(url,opts);
    calls.push(JSON.parse(opts.body));
    if(entered) entered();
    if(hold) await hold;
    // This reserved transport is a fully buffered JSON fixture, not a live fetch
    // body stream. Keep its completion independent of the held request's stream tasks.
    const payload={id:40+calls.length,link:`https://wordpress.example.test/page/${40+calls.length}`,status:'draft'};
    return {ok:providerStatus>=200&&providerStatus<300,status:providerStatus,json:async()=>payload};
  };
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    page.removeAllListeners('request');
    page.on('request',request=>{
      const u=new URL(request.url());
      if(!['data:','blob:'].includes(u.protocol)&&u.origin!==baseUrl) return void request.abort('blockedbyclient');
      const fixture=u.pathname==='/api/generate-article-topics'?{topics:Array.from({length:topicCount},(_,i)=>({title:topicCount===1?title:`${title} ${i+1}`,keyword:'DEMO marketing'}))}:
        u.pathname==='/api/generate-seo-article'?{content:'<p>A useful DEMO guide.</p>',wordCount:5}:null;
      if(fixture) return void request.respond({status:200,contentType:'application/json',body:JSON.stringify(fixture)});
      if(request.method()==='GET'&&u.pathname.startsWith('/api/')&&u.pathname!=='/api/auth/me')
        return void request.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void request.continue();
    });
    await page.goto(baseUrl+'/grow/autoseo',{waitUntil:'networkidle2'});
    await page.evaluate(()=>{
      window.analysisData={domain:'demo.example.test',industry:'Marketing',competitors:[]};
      window._wpCreds={siteUrl:'https://wordpress.example.test',username:'fixture',appPassword:'synthetic-only'};
    });
    async function click(text) {
      await page.waitForFunction(text=>[...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()===text&&!b.matches(':disabled')),{},text);
      await page.evaluate(text=>[...document.querySelectorAll('#view-autoseo button')].find(b=>b.textContent.trim()===text&&!b.matches(':disabled')).click(),text);
    }
    await page.waitForFunction(()=>!document.querySelector('#view-autoseo')?.textContent.includes('Set Domain →'));
    async function writeArticle(topicsButton) {
      const [topics]=await Promise.all([
        page.waitForResponse(r=>new URL(r.url()).pathname==='/api/generate-article-topics'),click(topicsButton),
      ]);
      assert.equal(topics.status(),200);
      await page.waitForFunction(title=>document.querySelector('#view-autoseo')?.textContent.includes(title)&&
        [...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()==='✨ Regenerate Topics'&&!b.matches(':disabled')),{},title);
      const [article]=await Promise.all([
        page.waitForResponse(r=>new URL(r.url()).pathname==='/api/generate-seo-article'),click('✍️ Write'),
      ]);
      assert.equal(article.status(),200);
      await page.waitForFunction(()=>![...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.includes('Writing…'))&&
        [...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.trim()==='🟦 Publish'&&!b.matches(':disabled')));
    }
    await writeArticle('✨ Generate 30 Article Topics');
    async function submit(button='🟦 Publish') {
      const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/publish-to-wordpress'&&r.request().method()==='POST'),click(button)]);
      return {status:r.status(),body:await r.json()};
    }
    assert.equal((await submit('🟦 Publish All to WP')).status,403);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="status"]')?.textContent.includes('Revise its title'));
    assert.equal(calls.length,0);
    assert.ok((await page.$eval('#view-autoseo',e=>e.textContent)).includes(title),'refused article remains available');
    title='DEMO revised guide';await writeArticle('✨ Regenerate Topics');
    scanner.scanOutput=()=>{throw Error('synthetic outage');};
    assert.equal((await submit()).status,503);assert.equal(calls.length,0);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="status"]')?.textContent.includes('Nothing was sent'));
    scanner.scanOutput=scan;
    providerStatus=403;assert.equal((await submit()).status,502);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="status"]')?.textContent.includes('WordPress rejected'));
    assert.equal(calls.length,1);
    // A second tenant's stricter policy cannot be replaced by the body tenant_id.
    const {request,login}=require('./index');
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);
    assert.equal(viewer.status,200);
    assert.equal((await request(baseUrl,'POST','/api/publish-to-wordpress',{cookie:viewer.cookie,headers:{Origin:baseUrl},body:{siteUrl:'https://wordpress.example.test',username:'fixture',appPassword:'synthetic-only',content:'DEMO'}})).status,403);
    assert.equal(calls.length,1);
    const otherOwner=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const otherCookie=await login(baseUrl,otherOwner.email,otherOwner.password);
    assert.equal(otherCookie.status,200);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const foreign=await request(baseUrl,'POST','/api/publish-to-wordpress',{cookie:otherCookie.cookie,headers:{Origin:baseUrl},body:{
      tenant_id:tid,siteUrl:'https://wordpress.example.test',username:'fixture',appPassword:'synthetic-only',title:'guaranteed returns',content:'DEMO'}});
    assert.equal(foreign.status,403);assert.equal(calls.length,1);
    // Warnings reach the existing article UI; rapid repeated actions send once.
    title='guaranteed returns';await writeArticle('✨ Regenerate Topics');providerStatus=201;
    hold=new Promise(r=>{release=r;});const started=new Promise(r=>{entered=r;});
    const pending=submit();
    await Promise.race([started,pending.then(()=>{throw Error('WordPress response arrived before held transport');})]);
    console.log('[wordpress acceptance] held transport entered');
    await page.waitForFunction(()=>document.querySelector('#view-autoseo fieldset').disabled);
    await page.evaluate(()=>[...document.querySelectorAll('#view-autoseo button')].find(b=>b.textContent.trim()==='🟦 Publish All to WP').click());
    console.log('[wordpress acceptance] duplicate action checked; releasing transport');
    release();hold=null;entered=null;
    const accepted=await pending;assert.equal(accepted.status,200);assert.ok(accepted.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="status"]')?.textContent.includes('confirmed the draft'));
    await page.waitForFunction(()=>document.querySelector('#view-autoseo')?.textContent.includes('CONTENT SAFETY WARNINGS'));
    assert.equal(calls.length,2);assert.equal(calls.at(-1).status,'draft');assert.equal(calls.at(-1).title,title);
    assert.ok((await pool.query('SELECT id FROM ai_governance_events WHERE tenant_id=$1',[tid])).rows.length,'real policy audit was recorded');
    // Fresh real login gives the supported maximum batch its full bounded window.
    const batchOwner=await fx.seedUser({tenantId:tid,owner:true});
    await page.goto(baseUrl+'/login?next=/grow/autoseo',{waitUntil:'domcontentloaded'});
    await page.locator('#email').fill(batchOwner.email);await page.locator('#pass').fill(batchOwner.password);
    const [logged]=await Promise.all([
      page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST'),
      page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('form button[type="submit"]').click(),
    ]);assert.equal(logged.status(),200);
    await page.evaluate(()=>{
      window.analysisData={domain:'demo.example.test',industry:'Marketing',competitors:[]};
      window._wpCreds={siteUrl:'https://wordpress.example.test',username:'fixture',appPassword:'synthetic-only'};
    });
    await page.waitForFunction(()=>!document.querySelector('#view-autoseo')?.textContent.includes('Set Domain →'));
    title='DEMO batch article';topicCount=60;
    await click('✨ Generate 30 Article Topics');
    for(let i=0;i<60;i++) {
      const [written]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/generate-seo-article'),click('✍️ Write')]);
      assert.equal(written.status(),200);
    }
    await page.waitForFunction(()=>![...document.querySelectorAll('#view-autoseo button')].some(b=>b.textContent.includes('Writing…')));
    const beforeBatch=calls.length;
    await click('🟦 Publish All to WP');
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="status"]')?.textContent.includes('confirmed 60 draft(s)'));
    assert.equal(calls.length-beforeBatch,60);
    assert.deepEqual(calls.slice(beforeBatch).map(c=>c.title),Array.from({length:60},(_,i)=>`DEMO batch article ${i+1}`));
    assert.ok(calls.slice(beforeBatch).every(c=>c.status==='draft'));
    // The next attempt is refused before provider delivery, with actionable UI.
    topicCount=1;title='DEMO extra draft';await writeArticle('✨ Regenerate Topics');
    assert.equal((await submit()).status,429);
    await page.waitForFunction(()=>document.querySelector('#view-autoseo [role="status"]')?.textContent.includes('Wait 60 seconds'));
    assert.equal(calls.length-beforeBatch,60);

  } finally {
    if(release) release();
    global.fetch=realFetch;scanner.scanOutput=scan;
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,actors.other.tid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
