'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('brief delivery gates the locked tenant snapshot and exact payload; refuses safely and reports provider truth', async t => {
  const db = require('../db'), tenant = require('../services/tenants/context');
  const hooks = require('../services/ai_governance/hooks');
  const old = { pool: db.getPool, has: db.hasDb, tid: tenant.resolveTenantId, gate: hooks.gateGeneratedContent };
  let brief = { id: 7, brand:'DEMO', headline:'Saved brief', greeting:'Retained greeting',
    signals:[{detail:'Retained signal'}], actions:[], sections:[], delivered_to:[], content_safety_warnings:[] };
  let queries = [], scans = [], sends = [], locked = false, available = true, status = 200, failUpdate = false;
  let gate = async () => ({ok:true, content_safety_warnings:['Review claim']});
  let provider = () => status;
  const restore = require('./helpers/marketing-brief-delivery-provider')((body, options) => {
    sends.push({body,options}); assert.equal(locked,true); return provider();
  });
  db.hasDb = () => true; tenant.resolveTenantId = async () => 42;
  db.getPool = () => ({async connect() {
    let owner = false;
    return {release() {}, async query(sql, params) {
      queries.push(sql);
      if (sql.includes('SELECT *')) {
        assert.match(sql,/tenant_id=\$2 FOR UPDATE NOWAIT/); assert.deepEqual(params,[7,42]);
        if (!available) return {rows:[]};
        if (locked) throw Object.assign(new Error('private lock detail'),{code:'55P03'});
        owner = locked = true; return {rows:[structuredClone(brief)]};
      }
      if (sql.startsWith('UPDATE')) {
        if (failUpdate) throw new Error('private database detail');
        assert.equal(locked,true); assert.deepEqual(params.slice(1,3),[7,42]);
        brief.delivered_to.push(...JSON.parse(params[0])); brief.content_safety_warnings = JSON.parse(params[3]);
      }
      if ((sql === 'COMMIT' || sql === 'ROLLBACK') && owner) { locked = owner = false; }
      return {rows:[]};
    }};
  }});
  hooks.gateGeneratedContent = async opts => { scans.push(opts); assert.equal(locked,true); return gate(opts); };
  delete require.cache[require.resolve('../services/marketing_brief/api')];
  const app = require('express')(); app.use(require('express').json());
  app.use((req,res,next) => {req.user={id:1};req.tenant={id:42};next();});
  app.use('/api/marketing-brief',require('../services/marketing_brief/api'));
  const server = await new Promise(r => {const s=app.listen(0,'127.0.0.1',()=>r(s));});
  t.after(async () => {await new Promise(r=>server.close(r));restore();db.getPool=old.pool;db.hasDb=old.has;
    tenant.resolveTenantId=old.tid;hooks.gateGeneratedContent=old.gate;delete require.cache[require.resolve('../services/marketing_brief/api')];});
  const deliver = async (channels=['slack']) => {
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/marketing-brief/7/deliver`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channels})});
    return {status:r.status,body:await r.json()};
  };
  const before = structuredClone(brief);
  available=false;assert.equal((await deliver()).status,404);available=true;
  assert.equal(scans.length,0);assert.equal(sends.length,0);
  for (const channels of [[],['email'],['slack','slack']]) assert.equal((await deliver(channels)).status,400);
  for (const code of ['content_safety_blocked','content_safety_unavailable','throw']) {
    gate=async()=>{if(code==='throw')throw new Error('private scanner error');return {ok:false,error:code};};
    const response=await deliver();assert.equal(response.status,code==='content_safety_blocked'?403:503);
    assert.equal(response.body.ok,false);assert.doesNotMatch(JSON.stringify(response.body),/private/);
    assert.equal(sends.length,0);assert.deepEqual(brief,before);
  }
  gate=async opts=>({ok: !opts.text.startsWith('*📋'),error:'content_safety_blocked'});
  assert.equal((await deliver()).status,403);assert.equal(sends.length,0,'outgoing text has its own gate');
  gate=async()=>({ok:true,content_safety_warnings:['Review claim']});
  brief.signals=[{detail:'x'.repeat(100001)}];assert.equal((await deliver()).status,503);
  brief=structuredClone(before);
  delete process.env.SLACK_WEBHOOK_URL;assert.equal((await deliver()).status,503);assert.equal(sends.length,0);
  process.env.SLACK_WEBHOOK_URL='https://hooks.slack.com/services/synthetic-delivery';
  status=500;assert.equal((await deliver()).status,502);assert.deepEqual(brief,before);
  assert.equal(queries.filter(s=>s.startsWith('UPDATE')).length,0);
  let release, started;const start=new Promise(r=>{started=r;});
  provider=()=>{started();return new Promise(r=>{release=()=>r(200);});};
  scans=[];const first=deliver();await start;
  assert.equal((await deliver()).status,409);assert.equal(sends.length,2);
  release();const success=await first;assert.equal(success.status,200);assert.equal(success.body.ok,true);
  assert.deepEqual(brief.content_safety_warnings,['Review claim']);
  assert.equal(scans.length,2);assert.match(scans[0].text,/Retained signal/);assert.match(scans[0].text,/Retained greeting/);
  assert.equal(scans[1].text,sends.at(-1).body.text);assert.equal(scans[1].tenantId,42);
  assert.equal(scans[1].userId,1);
  assert.equal(require('../services/ai_governance/brand_rules').isContentGeneration(scans[1].surface,scans[1].action),true);
  assert.equal((await deliver()).body.already_delivered,true);assert.equal(sends.length,2);
  brief.headline='Changed brief';provider=()=>200;
  assert.equal((await deliver()).status,200);assert.equal(sends.length,3,'new content is not permanently deduplicated');
  assert.equal(locked,false);
  // Changing configuration during a gate must not swap the already-scanned wire payload.
  brief.headline='Another snapshot';
  gate=async()=>{process.env.SLACK_WEBHOOK_URL='https://discord.com/api/webhooks/synthetic';return {ok:true};};
  assert.equal((await deliver()).status,200);
  assert.equal(sends.at(-1).options.hostname,'hooks.slack.com');
  assert.equal(scans.at(-1).text,sends.at(-1).body.text);
  brief.headline='Discord snapshot';gate=async()=>({ok:true});
  brief.sections=[{title:'DEMO',items:['a'.repeat(2500)]}];
  assert.equal((await deliver()).status,200);
  assert.equal(scans.at(-1).text,sends.at(-1).body.content);
  assert.equal(sends.at(-1).body.content.length,1900);
  // Identical content must be delivered once to each newly configured destination.
  const sentBeforeDestinationChange=sends.length;
  process.env.SLACK_WEBHOOK_URL='https://hooks.slack.com/services/synthetic-destination-one';
  assert.equal((await deliver()).status,200);
  assert.equal((await deliver()).body.already_delivered,true);
  process.env.SLACK_WEBHOOK_URL='https://hooks.slack.com/services/synthetic-destination-two';
  assert.equal((await deliver()).status,200);
  assert.equal((await deliver()).body.already_delivered,true);
  assert.equal(sends.length,sentBeforeDestinationChange+2);
  assert.equal(sends.at(-2).options.path,'/services/synthetic-destination-one');
  assert.equal(sends.at(-1).options.path,'/services/synthetic-destination-two');
  assert.doesNotMatch(JSON.stringify(brief.delivered_to),/synthetic-destination/);
  brief.headline='Record failure snapshot';failUpdate=true;
  const previousRecords=structuredClone(brief.delivered_to);
  const ambiguous=await deliver();
  assert.equal(ambiguous.status,503);assert.equal(ambiguous.body.ok,false);
  assert.equal(ambiguous.body.error,'delivery_record_failed');
  assert.match(ambiguous.body.userMessage,/confirmed delivery.*could not be saved/);
  assert.doesNotMatch(JSON.stringify(ambiguous.body),/private database/);
  assert.deepEqual(brief.delivered_to,previousRecords);assert.equal(locked,false);

});
