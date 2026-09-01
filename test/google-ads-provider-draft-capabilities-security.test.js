'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const service=require('../services/security/google_ads_provider_draft_capabilities');
const api=require('../services/agent_orchestrator/google_ads_provider_draft_capabilities_api');

test('Google Ads authority reuses the narrow explicit provider-draft permission',()=>{
  assert.equal(service.PERMISSION,'advertising.provider_drafts.create');
  assert.equal(service.CONFIRMATION,'AUTHORIZE GOOGLE ADS PAUSED DRAFT');
  assert.equal(api._grant({tenantRole:{permissions:[service.PERMISSION]}}),true);
  assert.equal(api._grant({can:()=>true,tenantRole:{permissions:['*']}}),false);
});
test('only an exact authenticated human session is admitted',()=>{
  const req={user:{id:7,principalType:'user'},session:{userId:7},sessionID:'sid'};
  assert.equal(api._human(req),true);
  for(const principalType of ['api_key','worker','service','service_account','automation','autonomous','agent'])
    assert.equal(api._human({...req,user:{...req.user,principalType}}),false);
  assert.equal(api._human({...req,viaApiKey:true}),false);
  assert.equal(api._human({...req,session:{userId:8}}),false);
});
test('authority module has no provider connector, SDK, network, secret resolution or mutation reachability',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.doesNotMatch(source,/google-ads-api|axios|\bfetch\s*\(|https?\.|resolveCredential|access_token|refresh_token|developer_token|authorization header/i);
  assert.doesNotMatch(source,/connectors?\/|provider_mutations|createCampaign|mutateCampaign/i);
  assert.match(source,/external_action_taken:false/);
});
test('public projection never exposes account or credential lineage',async()=>{
  const row={id:'gac_x',status:'issued',issued_at:new Date('2026-01-01Z'),expires_at:new Date('2026-01-01T00:05:00Z'),account_fingerprint:'a'.repeat(64),credential_ref_id:'secret-ish'};
  const client={query:async()=>({rowCount:1,rows:[row]})};
  const out=await service.get(client,{tenantId:1,actorUserId:2,actorType:'human',principalType:'user',sessionId:'sid',capabilityId:'gac_x',hasExplicitTenantPermission:()=>true});
  assert.deepEqual(Object.keys(out).sort(),['capability_id','consumed_at','expires_at','external_action_taken','issued_at','reserved_at','revoked_at','status'].sort());
  assert.equal(out.external_action_taken,false);assert.equal(JSON.stringify(out).includes('credential'),false);assert.equal(JSON.stringify(out).includes('aaaa'),false);
});
test('expiry sentinel is sanitized and never carries the capability database row',async()=>{
  const cap={id:'gac_x',tenant_id:1,status:'issued',actor_user_id:2,session_id_hash:require('crypto').createHash('sha256').update('sid').digest('hex'),expires_at:new Date('2025-01-01Z'),workflow_id:'wf'};
  let n=0;const client={query:async()=>{n++;if(n===1)return {rowCount:1,rows:[cap]};if(n===2)return {rowCount:1,rows:[{}]};return {rowCount:1,rows:[]};}};
  const out=await service.reserve(client,{tenantId:1,actorUserId:2,actorType:'human',principalType:'user',sessionId:'sid',capabilityId:'gac_x',reservationId:'r1',now:new Date('2026-01-01Z'),hasExplicitTenantPermission:()=>true});
  assert.deepEqual(out,{expired:true,capability_id:'gac_x',error:'capability_expired',external_action_taken:false});
  assert.equal(Object.hasOwn(out,'cap'),false);assert.equal(Object.isFrozen(out),true);
});
test('duplicate issuance is mapped to a deterministic sanitized domain conflict',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/code==='23505'\)throw deny\('capability_conflict'\)/);
  const error=service._deny('capability_conflict');assert.equal(error.external_action_taken,false);assert.equal(error.code,'capability_conflict');
});
test('authoritative approval revocation is selected under the validated alias',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/pa\.revoked_at AS approval_revoked_at/);
  assert.match(source,/x\.approval_revoked_at/);
});
test('draft status and owner-gate authority remain fail-closed and narrowly scoped',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/d\.status AS draft_status/);
  assert.match(source,/x\.draft_status!==\'approved_for_publish\'/);
  const server=fs.readFileSync(require.resolve('../server'),'utf8');
  assert.match(server,/google-ads-provider-draft-capabilities\(\?:\\\/\|\$\)/);
  assert.doesNotMatch(server,/google-ads-provider-draft-capabilities-export/);
});
test('authoritative actor lineage and post-lock issuance timing fail closed',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/pa\.actor_user_id AS approval_actor_user_id/);
  assert.match(source,/pr\.requested_by AS request_actor_user_id/);
  assert.match(source,/di\.requested_by AS intent_actor_user_id/);
  assert.match(source,/Number\(x\.approval_actor_user_id\)!==Number\(ids\.actorUserId\)/);
  assert.match(source,/SELECT clock_timestamp\(\) AS now/);
  assert.match(source,/confirmed>freshNow\|\|freshNow-confirmed>MAX_CONFIRMATION_AGE_MS/);
  assert.match(source,/issued_at:freshNow/);
});
test('Google Ads credential synchronization remains metadata-only',()=>{
  const source=fs.readFileSync(require.resolve('../services/credentials/vault'),'utf8');
  assert.match(source,/INSERT INTO orchestrator_tenant_google_ads_credential_refs/);
  assert.match(source,/account_fingerprint,version,owner_user_id/);
  assert.match(source,/SET status='revoked',revoked_at=clock_timestamp\(\)/);
});
