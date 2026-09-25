'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { approvalText } = require('../services/safe_agent/approval_text');

test('approval scans decoded nested values, keys and simulation without truncation', () => {
  assert.match(approvalText({title:'DEMO',proposal:{actions:[{detail:'guaranteed\nreturns'}]},simulation:{risk:'zero risk'}}), /guaranteed\nreturns/);
  assert.match(approvalText({proposal:{'guaranteed returns':'x'}}), /guaranteed returns/);
  assert.throws(() => approvalText({proposal:{text:'x'.repeat(100001)}}));
  let deep = {}; for(let i=0;i<45;i++) deep={deep};
  assert.throws(() => approvalText({proposal:deep}));
});

test('safe agent approval gates before atomic writes and fails closed', async t => {
  const db=require('../db'), tenant=require('../services/tenants/context');
  const gate=require('../services/ai_governance/route_gate'), hooks=require('../services/ai_governance/hooks');
  const old={pool:db.getPool,tid:tenant.resolveTenantId,gate:gate.gateRouteText,audit:hooks.governSafe};
  let calls=[], status='pending_approval', row, result, conflict=false, failAudit=false, user=1;
  const client={release(){calls.push('release');},async query(sql){
    calls.push(sql);
    if(failAudit && sql.includes('INSERT')) throw new Error('secret database detail');
    return {rows:sql.includes('RETURNING')&&!conflict?[{id:1}]:[]};
  }};
  db.getPool=()=>({async query(sql){calls.push(sql);return {rows:row?[{...row,status}]:[]};},async connect(){calls.push('connect');return client;}});
  tenant.resolveTenantId=async req=>req.tenant?.id;
  gate.gateRouteText=async opts=>{calls.push('scan');assert.match(opts.text,/Stored copy/);return result;};
  hooks.governSafe=async()=>{};
  const app=express(); app.use(express.json());
  app.use((req,res,next)=>{req.tenant={id:Number(req.headers['x-tenant']||1)};if(req.headers['x-no-user']!=='1')req.user={id:user};next();});
  app.use('/api/safe-agent',require('../services/safe_agent/api'));
  const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
  t.after(async()=>{await new Promise(r=>server.close(r));db.getPool=old.pool;tenant.resolveTenantId=old.tid;gate.gateRouteText=old.gate;hooks.governSafe=old.audit;});
  const send=async(headers={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/safe-agent/approve/1`,{method:'POST',headers});return {status:r.status,body:await r.json(),retry:r.headers.get('retry-after')};};
  row={id:1,title:'Stored copy',proposal:{actions:[]},simulation:{},budget_guardrail:null};
  for(const error of ['content_safety_blocked','content_safety_unavailable']) {
    calls=[];result={ok:false,error};assert.equal((await send()).status,error.endsWith('unavailable')?503:403);assert.ok(!calls.includes('connect'));
  }
  result={ok:true,content_safety_warnings:['Warning']}; calls=[];
  assert.deepEqual((await send()).body.content_safety_warnings,['Warning']);
  assert.ok(calls.indexOf('scan')<calls.indexOf('BEGIN'));assert.ok(calls.includes('COMMIT'));
  conflict=true;calls=[];assert.equal((await send()).status,409);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(s=>s.includes('INSERT')));conflict=false;
  failAudit=true;calls=[];const failed=await send();assert.equal(failed.status,503);assert.ok(calls.includes('ROLLBACK'));assert.doesNotMatch(JSON.stringify(failed),/secret database/);failAudit=false;
  row=null;calls=[];assert.equal((await send()).status,404);assert.ok(!calls.includes('scan'));
  calls=[];assert.equal((await send({'x-no-user':'1'})).status,429);assert.deepEqual(calls,[]);
  user=2;for(let i=0;i<20;i++) assert.equal((await send()).status,404);
  calls=[];const limited=await send();assert.equal(limited.status,429);assert.ok(Number(limited.retry)>0);assert.deepEqual(calls,[]);
  assert.equal((await send({'x-tenant':'2'})).status,404);
});
