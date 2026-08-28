'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const service=require('../services/agent_orchestrator/meta_post_activation_monitoring');
const api=require('../services/agent_orchestrator/meta_post_activation_monitoring_api');

const base=[
  {object_kind:'campaign',observation:'observed',delivery_classification:'expected_active',account_relationship_matches:true,campaign_relationship_matches:'not_applicable',adset_relationship_matches:'not_applicable',creative_relationship_matches:'not_applicable'},
  {object_kind:'adset',observation:'observed',delivery_classification:'expected_active',account_relationship_matches:true,campaign_relationship_matches:true,adset_relationship_matches:'not_applicable',creative_relationship_matches:'not_applicable'},
  {object_kind:'creative',observation:'observed',delivery_classification:'unchanged_non_delivering',account_relationship_matches:true,campaign_relationship_matches:'not_applicable',adset_relationship_matches:'not_applicable',creative_relationship_matches:'not_applicable'},
  {object_kind:'ad',observation:'observed',delivery_classification:'expected_active',account_relationship_matches:true,campaign_relationship_matches:true,adset_relationship_matches:true,creative_relationship_matches:true},
];
test('classifies exact active graph, pending Ad, discrepancy, and partial failure honestly',()=>{
  assert.equal(service.evaluate({observations:base}).state,'verified_active');
  assert.equal(service.evaluate({observations:base.map(x=>x.object_kind==='ad'?{...x,delivery_classification:'delivery_pending'}:x)}).state,'delivery_pending');
  const changed=service.evaluate({observations:base.map(x=>x.object_kind==='adset'?{...x,campaign_relationship_matches:false}:x)});
  assert.equal(changed.state,'discrepancy_detected');assert.ok(changed.classifications.includes('changed_parent_relationship'));
  assert.equal(service.evaluate({observations:base.slice(0,3)}).state,'failed');
});
test('public response cannot expose provider, account, credential, token, URL, or lineage hashes',()=>{
  const text=JSON.stringify(service.publicRun({id:'safe',activation_attempt_id:'attempt',state:'verified_active',observations:base,
    classifications:[],audit_ref:'audit',started_at:'start',completed_at:'done',provider_object_id:'secret',account_fingerprint:'secret',credential_ref_id:'secret',ledger_root_hash:'secret'}));
  for(const forbidden of ['provider_object_id','account_fingerprint','credential_ref','ledger_root','access_token','https://'])assert.equal(text.includes(forbidden),false);
});
test('API requires a matching human session and explicit grant (no owner bypass)',()=>{
  const req={user:{id:7,isOwner:true},session:{userId:7},sessionID:'session',tenantRole:{permissions:[]}};
  assert.equal(api._human(req),true);assert.equal(api._grant(req),false);
  assert.equal(api._human({...req,viaApiKey:true}),false);
  assert.equal(api._human({...req,user:{...req.user,principalType:'worker'}}),false);
  assert.equal(api._grant({...req,tenantRole:{permissions:[service.PERMISSION]}}),true);
});
