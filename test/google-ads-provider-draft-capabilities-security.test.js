'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const service=require('../services/security/google_ads_provider_draft_capabilities');
const api=require('../services/agent_orchestrator/google_ads_provider_draft_capabilities_api');
const oauth=require('../services/google_ads_oauth/api');

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
  let n=0;const client={query:async()=>{n++;if(n===1||n===3)return {rowCount:1,rows:[cap]};if(n===2)return {rowCount:1,rows:[{}]};return {rowCount:1,rows:[]};}};
  const out=await service.revoke(client,{tenantId:1,actorUserId:2,actorType:'human',principalType:'user',sessionId:'sid',capabilityId:'gac_x',now:new Date('2026-01-01Z'),hasExplicitTenantPermission:()=>true});
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
test('authoritative actor lineage and server confirmation timing fail closed',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/pa\.actor_user_id AS approval_actor_user_id/);
  assert.match(source,/pr\.requested_by AS request_actor_user_id/);
  assert.match(source,/di\.requested_by AS intent_actor_user_id/);
  assert.match(source,/Number\(x\.approval_actor_user_id\)!==Number\(ids\.actorUserId\)/);
  assert.match(source,/SELECT clock_timestamp\(\) AS now/);
  assert.match(source,/orchestrator_google_ads_provider_draft_confirmations[\s\S]*FOR UPDATE/);
  assert.match(source,/FOR UPDATE`[^;]+;\n  const clock=.*clock_timestamp/);
  assert.match(source,/confirmation\.consumed_at/);
  assert.match(source,/session_id_hash,hash\(o\.sessionId\)/);
  assert.match(source,/issued_at:freshNow/);
});
test('Google Ads credential synchronization remains metadata-only',()=>{
  const source=fs.readFileSync(require.resolve('../services/credentials/vault'),'utf8');
  assert.match(source,/INSERT INTO orchestrator_tenant_google_ads_credential_refs/);
  assert.match(source,/account_fingerprint,version,owner_user_id/);
  assert.match(source,/SET status='revoked',revoked_at=clock_timestamp\(\)/);
  assert.match(source,/return \{ ok: true, version, \.\.\.\(referenceId \? \{ referenceId \} : \{\}\) \}/);
  const api=fs.readFileSync(require.resolve('../services/google_ads_oauth/api'),'utf8');
  assert.match(api,/credentialReference: \{\s*id: saved\.referenceId, version: saved\.version/);
  assert.doesNotMatch(api,/credentialReference[^\n]*(customerId|token|secret|fingerprint)/i);
  const authorityApi=fs.readFileSync(require.resolve('../services/agent_orchestrator/google_ads_provider_draft_capabilities_api'),'utf8');
  assert.doesNotMatch(authorityApi,/google_ads_customer_id/);
  assert.doesNotMatch(source,/googleAdsCustomerId/);
  const authoritySource=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(authoritySource,/const peek=.*capabilities/);
  assert.match(authoritySource,/const row=revalidate\?await authoritative[\s\S]*SELECT \* FROM orchestrator_google_ads_provider_draft_capabilities[\s\S]*FOR UPDATE/);
  assert.match(api,/gaOauthTenantId/);
  assert.match(api,/gaPending = \{[\s\S]*tenantId: initiatingTenantId/);
});
test('approval expiry is carried through authoritative locks and checked at transition time',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/pa\.expires_at AS approval_expires_at/);
  assert.match(source,/new Date\(x\.row\.approval_expires_at\)>transitionNow/);
});
test('Google Ads OAuth state cryptographically pins the initiating user and tenant',()=>{
  const secret='test-oauth-secret';
  const state=oauth._oauthState(7,101,secret);
  assert.equal(oauth._stateTenant(state,7,secret),101);
  assert.equal(oauth._stateTenant(state,8,secret),null);
  assert.equal(oauth._stateTenant(state.replace('.101.','.202.'),7,secret),null);
  const source=fs.readFileSync(require.resolve('../services/google_ads_oauth/api'),'utf8');
  assert.match(source,/tenantId: initiatingTenantId/);
  assert.match(source,/saveCredentials[\s\S]*tenantId: initiatingTenantId/);
  assert.doesNotMatch(source,/google-ads-oauth:bind-customer/);
});
