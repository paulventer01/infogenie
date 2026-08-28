'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const service=require('../services/agent_orchestrator/delivery_discrepancies');
const api=require('../services/agent_orchestrator/delivery_discrepancies_api');
const {listPermissions,SYSTEM_ROLES}=require('../services/tenants/permissions');
const matrix=require('../services/tenants/permission_matrix');

test('registers one separate delivery-resolution permission with no default owner/admin grant',()=>{
  assert.equal(listPermissions().filter(p=>p.key===service.PERMISSION).length,1);
  for(const key of ['advertising.campaign.monitor','advertising.campaign.activate','advertising.reconciliation.read','advertising.reconciliation.review'])assert.notEqual(key,service.PERMISSION);
  for(const role of SYSTEM_ROLES.filter(r=>/owner|admin/.test(r.key)))assert.equal(role.permissions.includes(service.PERMISSION),false,role.key);
  const row=matrix.ROUTE_GROUPS.find(r=>r.prefix==='/api/agent-orchestrator/delivery-discrepancies');
  assert.equal(row.view,service.PERMISSION);assert.equal(row.write,service.PERMISSION);
});
test('requires an authenticated matching human session and exact active-tenant grant',()=>{
  const req={user:{id:7,isOwner:true},session:{userId:7},sessionID:'session',tenantRole:{permissions:[]}};
  assert.equal(api._human(req),true);assert.equal(api._grant(req),false);
  for(const bad of [{...req,viaApiKey:true},{...req,user:{...req.user,viaApiKey:true}},
    {...req,user:{...req.user,principalType:'service_account'}},{...req,session:null},{...req,session:{userId:8}}])assert.equal(api._human(bad),false);
  assert.equal(api._grant({...req,tenantRole:{permissions:[service.PERMISSION]}}),true);
});
test('normalizes safe notes and rejects secrets, controls, provider payloads, and excess length',()=>{
  assert.equal(service.sanitizeNote('  Provider   delay accepted  '),'Provider delay accepted');
  for(const bad of ['Authorization: Bearer abc','cookie: sid=x','access_token=abc','-----BEGIN PRIVATE KEY-----','{"data":{"id":"provider"}}','bad\u0000note','x'.repeat(1001)])
    assert.throws(()=>service.sanitizeNote(bad),e=>e.code==='unsafe_note');
});
test('public projection exposes only safe operational evidence',()=>{const row={tenant_id:1,id:'case',monitoring_run_id:'run',source_state:'failed',source_classifications:['read_failure'],state:'open',version:1,
  classification:null,note:null,audit_ref:'audit',created_at:'created',updated_at:'updated',resolved_at:null,credential_ref_id:'secret',account_fingerprint:'secret',ledger_root_hash:'secret'};
  const text=JSON.stringify(service.publicCase(row,[{case_version:1,new_state:'open',audit_ref:'audit',created_at:'created',decision_id:'secret',input_hash:'secret',actor_user_id:7}]));
  for(const forbidden of ['credential_ref','account_fingerprint','ledger_root','decision_id','input_hash','actor_user_id'])assert.equal(text.includes(forbidden),false);
});
test('implementation has no provider, credential, monitoring retry, activation, or worker reachability',()=>{
  const source=fs.readFileSync(require.resolve('../services/agent_orchestrator/delivery_discrepancies'),'utf8');
  assert.doesNotMatch(source,/require\([^)]*(?:connector|vault|meta_post_activation_monitoring)|\b(?:fetch|getCredentials|resolveMetaAdsCredentials|observeMetaDelivery)\s*\(/i);
  assert.doesNotMatch(source,/UPDATE\s+orchestrator_campaign_monitoring_runs/i);
  assert.match(source,/FOR UPDATE OF m,a,c,pr,pa,di,ex,rr,ref/);
});
test('only eligible source states and bounded operational classifications are exported',()=>{
  assert.deepEqual([...service.ELIGIBLE].sort(),['delivery_pending','discrepancy_detected','failed']);
  for(const forbidden of ['verified','verified_active','activated','fixed','remediated_automatically'])assert.equal(service.CLASSIFICATIONS.has(forbidden),false);
});
test('legacy owner gate exemption is narrowly anchored',()=>{const source=fs.readFileSync(require.resolve('../server'),'utf8');
  assert.match(source,/\^\\\/api\\\/agent-orchestrator\\\/delivery-discrepancies\(\?:\\\/\|\$\)\//);
});
