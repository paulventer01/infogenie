'use strict';
const assert = require('node:assert/strict');

module.exports = async function checklistSave({page,baseUrl,actors,db,fx}) {
  const {ensureLaunchComplianceSchema,DEFAULT_ITEMS}=require('../../services/launch_compliance/schema');
  await ensureLaunchComplianceSchema();
  const pool=db.getPool(),tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'),scan=scanner.scanOutput;
  const name='DEMO checklist save acceptance', copy='DEMO guaranteed returns';
  const rows=async()=> (await pool.query('SELECT * FROM campaign_compliance_checklists WHERE tenant_id=$1',[tid])).rows;
  async function click(label) {
    await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);
    await page.evaluate(label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label);
  }
  async function save(status) {
    const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/launch-compliance/checklists'&&r.request().method()==='POST'),click('✅ Start Compliance Review')]);
    assert.equal(r.status(),status);return r.json();
  }
  const api=path=>page.evaluate(async path=>{const r=await fetch('/api/launch-compliance/checklists'+path);return {status:r.status,body:await r.json()};},path);
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce',content_safety_explicit=true WHERE tenant_id=$1",[tid]);
    page.removeAllListeners('request');page.on('request',r=>{
      const url=new URL(r.url());
      if(!['data:','blob:'].includes(url.protocol)&&url.origin!==baseUrl) return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/auth/me'&&!url.pathname.startsWith('/api/launch-compliance/'))
        return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/manage/launch-compliance',{waitUntil:'networkidle2'});
    await page.locator('input[placeholder="Q3 Meta Brand Campaign"]').fill(name);
    await page.locator('textarea').fill(copy);
    const before=await rows();
    for(const unavailable of [false,true]) {
      if(unavailable) scanner.scanOutput=()=>{throw new Error('synthetic scanner outage');};
      const refused=await save(unavailable?503:403);assert.equal(refused.ok,false);assert.ok(refused.userMessage);
      await page.waitForSelector('[role="alert"]');
      assert.equal(await page.$eval('textarea',e=>e.value),copy);
      assert.equal(await page.$eval('input[placeholder="Q3 Meta Brand Campaign"]',e=>e.value),name);
      assert.deepEqual(await rows(),before);
    }
    scanner.scanOutput=scan;
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const saved=await save(200),row=saved.checklist,warnings=row.content_safety_warnings;
    assert.ok(warnings.length);assert.equal(row.ad_copy,copy);assert.equal(row.items.length,DEFAULT_ITEMS.length);
    assert.ok(row.items.every(i=>i.tenant_id===tid&&i.checklist_id===row.id));
    assert.deepEqual((await rows()).find(r=>r.id===row.id).content_safety_warnings,warnings);
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS'));
    for(const path of ['', '/'+row.id]) {
      const r=await api(path);assert.equal(r.status,200);
      const item=path?r.body.checklist:r.body.checklists.find(c=>c.id===row.id);
      assert.deepEqual(item.content_safety_warnings,warnings);assert.equal(item.ad_copy,copy);
    }
    const {login,request}=require('./index');
    const foreignOwner=await fx.seedUser({tenantId:actors.other.tid,owner:true});
    const other=await login(baseUrl,foreignOwner.email,foreignOwner.password);assert.equal(other.status,200);
    assert.equal((await request(baseUrl,'GET','/api/launch-compliance/checklists/'+row.id,{cookie:other.cookie})).status,404);
    const viewer=await login(baseUrl,actors.viewer.email,actors.viewer.password);assert.equal(viewer.status,200);
    assert.equal((await request(baseUrl,'POST','/api/launch-compliance/checklists',{cookie:viewer.cookie,body:{campaign_name:'Forbidden'}})).status,403);
    assert.equal((await request(baseUrl,'GET','/api/launch-compliance/checklists/'+row.id)).status,401);
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(name=>[...document.querySelectorAll('div')].some(e=>e.textContent===name),{},name);
    await page.evaluate(name=>[...document.querySelectorAll('div')].find(e=>e.textContent===name).click(),name);
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS'));
    for(const warning of warnings) assert.ok((await page.evaluate(()=>document.body.innerText)).includes(warning));
    assert.equal((await rows()).length,before.length+1,'reload and reads cannot create another checklist');
  } finally {
    scanner.scanOutput=scan;
    await pool.query('DELETE FROM compliance_checklist_items WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM campaign_compliance_checklists WHERE tenant_id=$1',[tid]);
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=$1',[tid]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
