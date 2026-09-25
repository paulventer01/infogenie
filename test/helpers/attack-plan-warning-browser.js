'use strict';
const assert = require('node:assert/strict');

// Real Next/Express/login/policy/tenant KV; only the upstream SDK transport is
// synthetic. The harness blocks external sockets, including accidental fallback.
module.exports = async function attackPlanWarnings({page, baseUrl, actors, db, fx}) {
  const pool = db.getPool(), tid = actors.owner.tid, otherTid = actors.other.tid;
  const keys = [`attack_plans:t${tid}`, `attack_plans:t${otherTid}`];
  const scanner = require('../../services/ai_governance/output_gate'), scan = scanner.scanOutput;
  const OpenAI = require('openai').OpenAI;
  const transport = OpenAI.prototype.fetchWithTimeout;
  const keyNames = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'AI_INTEGRATIONS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'];
  const oldKeys = keyNames.map(k => process.env[k]);
  let calls = 0;
  const plan = {executiveSummary:'DEMO provider fixture: guaranteed returns', weeklyPlan:[], keywordTargets:[], criticalWins:[]};
  OpenAI.prototype.fetchWithTimeout = async function(url, ...args) {
    const target = new URL(url);
    if (target.hostname !== 'api.openai.com' || target.pathname !== '/v1/chat/completions')
      return transport.call(this, url, ...args);
    calls++;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}),
      {status:200, headers:{'Content-Type':'application/json'}});
  };
  keyNames.forEach(k => { process.env[k] = k.includes('ANTHROPIC') ? '_DUMMY_ATTACK_WARNING' : 'synthetic-attack-warning-provider'; });
  const api = (path, body) => page.evaluate(async(path, body) => {
    const r = await fetch('/api/ai-attack-plan' + path, body === undefined ? {} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    return {status:r.status, body:await r.json()};
  }, path, body);
  const rows = () => db.kvGet(keys[0], []);
  async function click(label) {
    await page.waitForFunction(label => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === label && !b.disabled), {}, label);
    await page.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label && !b.disabled).click(), label);
  }
  async function warningsVisible(expected) {
    await page.waitForSelector('#attackPlanModal [data-ap-safety-warnings="1"]');
    assert.deepEqual(await page.$$eval('#attackPlanModal [data-ap-safety-warnings] li', els => els.map(e => e.textContent)), expected);
  }
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce',content_safety_explicit=true WHERE tenant_id=$1", [tid]);
    const legacy = {id:'ap_1000000000000_000000000001', competitor:'DEMO legacy rival', plan:{...plan, executiveSummary:'DEMO legacy saved plan'}, sources:['GPT-4o']};
    const foreign = {...legacy, id:'ap_1000000000000_000000000002', competitor:'PRIVATE foreign rival', content_safety_warnings:['PRIVATE foreign warning']};
    await db.kvSet(keys[0], [legacy]); await db.kvSet(keys[1], [foreign]);
    page.removeAllListeners('request');
    page.on('request', r => {
      const url = new URL(r.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== baseUrl) return void r.abort('blockedbyclient');
      if (r.method() === 'GET' && url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/me' && !url.pathname.startsWith('/api/ai-attack-plan/'))
        return void r.respond({status:200, contentType:'application/json', body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl + '/analyse/battleplan', {waitUntil:'networkidle2'});
    await click('View plan');
    await page.waitForFunction(() => document.querySelector('#attackPlanModalBody')?.textContent.includes('DEMO legacy saved plan'));
    assert.equal(await page.$('[data-ap-safety-warnings]'), null);
    await page.evaluate(() => window._apCloseModal());
    const before = await rows();
    for (const unavailable of [false, true]) {
      if (unavailable) scanner.scanOutput = () => { throw new Error('synthetic scanner outage'); };
      const refused = await api('', {competitor:'DEMO refused rival', content_safety_warnings:[]});
      assert.equal(refused.status,403,'existing attack-plan refusal contract');
      assert.equal(refused.body.error, unavailable ? 'content_safety_unavailable' : 'content_safety_blocked');
      assert.equal(refused.body.plan,null); assert.equal(refused.body.ok,false);
      assert.deepEqual(await rows(),before);
    }
    scanner.scanOutput = scan;
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1", [tid]);
    // Drive the real React generation button and legacy response bridge.
    await page.waitForFunction(() => typeof window.openFullAttackPlanModal === 'function');
    await page.evaluate(() => {
      window.analysisData = {url:'demo.example.test', industry:{name:'DEMO marketing'}, competitors:[{name:'DEMO warning rival'}]};
      document.dispatchEvent(new Event('ig:analysis-ready'));
    });
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/ai-attack-plan' && r.request().method() === 'POST'),
      click('🚀 Generate Attack Plan'),
    ]);
    assert.equal(response.status(),200);
    const generated = await response.json(), warnings = generated.content_safety_warnings;
    assert.ok(warnings.length); assert.deepEqual(generated.plan,plan); assert.equal(calls,3);
    await warningsVisible(warnings);
    const saved = (await rows())[0];
    assert.deepEqual(saved.content_safety_warnings,warnings); assert.deepEqual(saved.plan,plan);
    for (const path of ['/latest','/latest?competitor=DEMO%20warning%20rival','/'+saved.id]) {
      const read = await api(path); assert.equal(read.status,200);
      assert.deepEqual(read.body.content_safety_warnings,warnings); assert.deepEqual(read.body.plan,plan);
    }
    const list = await api('/list');
    assert.equal(list.body.plans.length,2); assert.equal(list.body.plans[0].plan,undefined);
    assert.doesNotMatch(JSON.stringify(list.body),/PRIVATE foreign/);
    assert.equal((await api('/'+foreign.id)).status,404);
    assert.equal((await api('/latest?competitor=PRIVATE%20foreign%20rival')).body.plan,null);
    // A second real tenant login cannot read this owner's plan or warnings.
    const {login,request} = require('./index');
    const foreignOwner = await fx.seedUser({tenantId:otherTid, owner:true});
    const other = await login(baseUrl,foreignOwner.email,foreignOwner.password);
    assert.equal(other.status,200); assert.ok(other.cookie);
    assert.equal((await request(baseUrl,'GET','/api/ai-attack-plan/'+saved.id,{cookie:other.cookie})).status,404);
    const otherList = await request(baseUrl,'GET','/api/ai-attack-plan/list',{cookie:other.cookie});
    assert.equal(otherList.status,200);
    assert.deepEqual(otherList.json.plans.map(p => p.id),[foreign.id]);
    const viewer = await login(baseUrl,actors.viewer.email,actors.viewer.password);
    assert.equal(viewer.status,200);
    assert.equal((await request(baseUrl,'POST','/api/ai-attack-plan',{cookie:viewer.cookie,body:{competitor:'Forbidden'}})).status,403);
    assert.equal(calls,3,'permission refusal cannot reach the provider');
    assert.equal((await request(baseUrl,'GET','/api/ai-attack-plan/'+saved.id)).status,401);
    await page.reload({waitUntil:'networkidle2'});
    await click('View plan');
    await warningsVisible(warnings);
    assert.match(await page.$eval('#attackPlanModalBody',el => el.textContent),/DEMO provider fixture/);
    await page.evaluate(() => window._apSwitchTab('weekly'));
    await warningsVisible(warnings);
    assert.equal(calls,3,'detail reads, tab changes and reload must not regenerate');
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText),/PRIVATE foreign/);
    await page.evaluate(() => window._apCloseModal());
    // Reopening an older warningless entry clears warnings from the prior dialog.
    await page.evaluate(() => [...document.querySelectorAll('[data-bp-saved-plans] button')].filter(b => b.textContent.trim() === 'View plan')[1].click());
    await page.waitForFunction(() => document.querySelector('#attackPlanModalBody')?.textContent.includes('DEMO legacy saved plan'));
    assert.equal(await page.$('[data-ap-safety-warnings]'),null);
    assert.equal(calls,3);
  } finally {
    scanner.scanOutput = scan; OpenAI.prototype.fetchWithTimeout = transport;
    keyNames.forEach((k,i) => { if(oldKeys[i] === undefined) delete process.env[k]; else process.env[k] = oldKeys[i]; });
    await pool.query('DELETE FROM kv_store WHERE key=ANY($1::text[])',[keys]);
    await pool.query('DELETE FROM ai_governance_events WHERE tenant_id=ANY($1::int[])',[[tid,otherTid]]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
