'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const service=require('../services/security/google_ads_activation_capabilities');
const api=require('../services/agent_orchestrator/google_ads_activation_capabilities_api');
const opts=(x={})=>({tenantId:1,actorUserId:7,actorType:'human',principalType:'user',sessionId:'real-session',
 hasExplicitTenantPermission:p=>p===service.PERMISSION,...x});
test('Google activation authority requires a real human and exact database grant',()=>{
 assert.equal(service.PERMISSION,'advertising.campaign.activate');
 for(const x of [{actorType:'agent'},{principalType:'api_key'},{sessionId:''},{hasExplicitTenantPermission:()=>false}])
  assert.throws(()=>service._human(opts(x)),e=>['human_session_required','permission_denied'].includes(e.code));
 assert.equal(api._human({user:{id:7},session:{userId:7},sessionID:'sid'}),true);
 assert.equal(api._human({user:{id:7},session:{userId:7},sessionID:'sid',viaApiKey:true}),false);
 assert.equal(api._grant({tenantRole:{permissions:['advertising.campaign.activate']}}),true);
});
test('service has no Google transport, vault, automatic behavior, provider write or secret projection',()=>{
 const source=fs.readFileSync(require.resolve('../services/security/google_ads_activation_capabilities'),'utf8');
 assert.doesNotMatch(source,/require\([^)]*(vault|connector|googleapis)|fetch\s*\(|axios|setInterval|setTimeout|scheduler|queue|retry/i);
 assert.doesNotMatch(source,/provider_object_id|customer_id|access_token|refresh_token|client_secret/i);
 assert.match(source,/external_action_taken:false/);
 assert.match(source,/FOR UPDATE OF run,a,op,d,pr,pa,di,cred,t,tu,role,g,k/);
 assert.match(source,/newer\.rowCount/);
 assert.match(source,/post_review_reconciliation_required/);
});
test('terminal metadata replay still revalidates current database authority',async()=>{
 const row={tenant_id:1,id:'gaac_one',actor_user_id:7,session_id_hash:require('node:crypto').createHash('sha256').update('real-session').digest('hex'),
  workflow_id:'wf',reconciliation_run_id:'run',status:'consumed',issued_at:new Date(),expires_at:new Date(Date.now()+1000),consumed_at:new Date()};
 let calls=0;const client={query:async sql=>{calls++;if(/SELECT \* FROM orchestrator_google_ads_activation_capabilities/.test(sql))return {rowCount:1,rows:[row]};return {rowCount:0,rows:[]};}};
 await assert.rejects(service.get(client,{...opts(),capabilityId:'gaac_one'}),{code:'authority_not_found'});
 assert.equal(calls,2);
});
