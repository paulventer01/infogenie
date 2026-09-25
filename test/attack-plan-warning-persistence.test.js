'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

// Exercise the existing route registration and tenant KV contract without any
// provider calls. Hosted browser acceptance uses real login, policy and PG.
test('attack-plan gate warnings survive tenant persistence and detail reads; refusals never save', async t => {
  const gate = require('../services/ai_governance/route_gate');
  const originalGate = gate.gateRouteText;
  const keyNames = ['OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_INTEGRATIONS_ANTHROPIC_API_KEY'];
  const oldKeys = keyNames.map(k => process.env[k]);
  t.after(() => {
    gate.gateRouteText = originalGate;
    keyNames.forEach((k, i) => { if (oldKeys[i] === undefined) delete process.env[k]; else process.env[k] = oldKeys[i]; });
  });
  keyNames.forEach(k => { process.env[k] = '_DUMMY_WARNING_TEST'; });
  let result = { ok: true, warnings: ['Gate warning: review <this> claim.'] };
  const scans = [], store = new Map(), routes = new Map();
  gate.gateRouteText = async opts => { scans.push(opts); return result; };
  require('../services/ai_content/routes')({
    get: (p, h) => routes.set('GET ' + p, h), post: (p, h) => routes.set('POST ' + p, h),
  }, {
    _tkvCtx: { resolveTenantId: async req => req.tenant.id },
    _tkvRead: async (base, tid, fallback) => store.get(`${base}:t${tid}`) || fallback,
    _tkvMutate: async (base, tid, fallback, mutate) => {
      const key = `${base}:t${tid}`;
      store.set(key, await mutate(store.get(key) || fallback));
    },
  });
  gate.gateRouteText = originalGate;
  async function request(method, route, {tid=11, body={}, query={}, id}={}) {
    let status = 200, json;
    await routes.get(`${method} ${route}`)({tenant:{id:tid},user:{id:3},body,query,params:{id}}, {
      status(n) { status=n; return this; }, json(value) { json=value; return this; },
    });
    return {status, json};
  }
  const posted = await request('POST', '/api/ai-attack-plan', {body:{competitor:'Rival', content_safety_warnings:['Untrusted request warning']}});
  assert.equal(posted.status,200);
  assert.deepEqual(posted.json.content_safety_warnings,result.warnings);
  const saved = store.get('attack_plans:t11')[0];
  assert.deepEqual(saved.content_safety_warnings,posted.json.content_safety_warnings);
  assert.equal(saved.source,'template');assert.equal(saved._fabricated,true);
  assert.equal(scans[0].tenantId,11);assert.equal(scans[0].text,JSON.stringify(saved.plan));
  for (const [route, opts] of [
    ['/api/ai-attack-plan/latest',{}],
    ['/api/ai-attack-plan/latest',{query:{competitor:'rival'}}],
    ['/api/ai-attack-plan/:id',{id:saved.id}],
  ]) {
    const read=await request('GET',route,opts);
    assert.equal(read.status,200);assert.deepEqual(read.json.content_safety_warnings,result.warnings);
    assert.equal(read.json.source,'template');assert.equal(read.json._fabricated,true);
  }
  const list=await request('GET','/api/ai-attack-plan/list');
  assert.equal(list.json.plans.length,1);assert.equal(list.json.plans[0].plan,undefined);
  assert.equal(list.json.plans[0].content_safety_warnings,undefined,'list stays metadata-only');
  assert.equal((await request('GET','/api/ai-attack-plan/:id',{tid:22,id:saved.id})).status,404);
  assert.deepEqual((await request('GET','/api/ai-attack-plan/list',{tid:22})).json.plans,[]);
  assert.equal((await request('GET','/api/ai-attack-plan/latest',{tid:22})).json.plan,null);
  const before=JSON.stringify(store.get('attack_plans:t11'));
  for(const error of ['content_safety_blocked','content_safety_unavailable']) {
    result={ok:false,error,warnings:['Generation stopped']};
    const refused=await request('POST','/api/ai-attack-plan');
    assert.equal(refused.status,403,'preserve existing attack-plan refusal status');
    assert.equal(refused.json.ok,false);assert.equal(refused.json.plan,null);assert.equal(refused.json.error,error);
    assert.equal(JSON.stringify(store.get('attack_plans:t11')),before);
  }
  result={ok:true,warnings:[]};
  const safe=await request('POST','/api/ai-attack-plan',{body:{competitor:'Safe',content_safety_warnings:['forged']}});
  assert.equal(safe.json.content_safety_warnings,undefined);
  assert.equal(store.get('attack_plans:t11')[0].content_safety_warnings,undefined);
  // A pre-feature saved entry needs no migration and remains readable.
  delete saved.content_safety_warnings;
  const legacy=await request('GET','/api/ai-attack-plan/:id',{id:saved.id});
  assert.equal(legacy.status,200);assert.ok(legacy.json.plan);assert.equal(legacy.json.content_safety_warnings,undefined);
  // Warnings participate in the existing serialized-entry size cap.
  result={ok:true,warnings:['W'.repeat(64*1024)]};
  const count=store.get('attack_plans:t11').length;
  await request('POST','/api/ai-attack-plan');
  assert.equal(store.get('attack_plans:t11').length,count);
});
