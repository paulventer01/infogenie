'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('crypto');
const service=require('../services/agent_orchestrator/meta_post_activation_monitoring');
const reconciliation=require('../services/agent_orchestrator/meta_reconciliation_read_authorizations');
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

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const account=digest('account'),snapshot=digest('snapshot');
function ledger(prefix=''){
  const ids={campaign:`${prefix}campaign`,adset:`${prefix}adset`,creative:`${prefix}creative`,ad:`${prefix}ad`};
  const d=Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,digest(v)]));
  return [
    {object_kind:'campaign',provider_object_id:ids.campaign,provider_object_id_digest:d.campaign,parent_campaign_digest:null,parent_adset_digest:null,parent_creative_digest:null,account_fingerprint:account,snapshot_hash:snapshot,compensated:false},
    {object_kind:'adset',provider_object_id:ids.adset,provider_object_id_digest:d.adset,parent_campaign_digest:d.campaign,parent_adset_digest:null,parent_creative_digest:null,account_fingerprint:account,snapshot_hash:snapshot,compensated:false},
    {object_kind:'creative',provider_object_id:ids.creative,provider_object_id_digest:d.creative,parent_campaign_digest:d.campaign,parent_adset_digest:null,parent_creative_digest:null,account_fingerprint:account,snapshot_hash:snapshot,compensated:false},
    {object_kind:'ad',provider_object_id:ids.ad,provider_object_id_digest:d.ad,parent_campaign_digest:d.campaign,parent_adset_digest:d.adset,parent_creative_digest:d.creative,account_fingerprint:account,snapshot_hash:snapshot,compensated:false},
  ];
}
test('authoritative ledger mismatches fail before run, audit, credential or provider access',async()=>{
  const good=ledger(),root=reconciliation.ledgerRoot(good);
  const cases=[
    ['provider digest',rows=>{rows[0].provider_object_id='changed';}],
    ['compensated',rows=>{rows[1].compensated=true;}],
    ['account',rows=>{rows[2].account_fingerprint=digest('wrong');}],
    ['snapshot',rows=>{rows[3].snapshot_hash=digest('wrong');}],
    ['parent',rows=>{rows[1].parent_campaign_digest=null;}],
    ['duplicate kind',rows=>{rows[3].object_kind='creative';}],
    ['root',()=>{},digest('wrong-root')],
    ['substituted graph',(_rows,state)=>{state.rows=ledger('other-');}],
  ];
  for(const [label,mutate,rootOverride] of cases){
    const state={rows:structuredClone(good),queries:[],credentials:0,providerGets:0};mutate(state.rows,state);
    const lineage={state:'activated',capability_state:'consumed',reconciliation_state:'verified',credential_status:'active',revoked_at:null,
      provider_platform:'meta',execution_account_fingerprint:account,execution_snapshot_hash:snapshot,
      current_credential_version:1,credential_ref_version:1,current_account_fingerprint:account,account_fingerprint:account,
      snapshot_hash:snapshot,ledger_root_hash:rootOverride||root};
    const client={query:async(sql)=>{state.queries.push(sql);if(sql==='BEGIN'||sql==='ROLLBACK')return {rows:[],rowCount:0};
      if(sql.includes('SELECT a.*'))return {rows:[lineage],rowCount:1};if(sql.includes('FROM orchestrator_campaign_provider_objects'))return {rows:state.rows,rowCount:state.rows.length};
      throw new Error('write_reached');},release(){}};
    await assert.rejects(service._test.reserve({connect:async()=>client},{tenantId:1,activationAttemptId:'attempt',actorUserId:1,sessionId:'session'},new Date(),digest('invocation')),
      error=>error.code==='authoritative_binding_mismatch'||error.code==='invalid_ledger_lineage',label);
    assert.equal(state.queries.some(sql=>/INSERT INTO orchestrator_campaign_monitoring_runs|INSERT INTO orchestrator_audit_events/.test(sql)),false,label);
    assert.equal(state.credentials+state.providerGets,0,label);
  }
});
