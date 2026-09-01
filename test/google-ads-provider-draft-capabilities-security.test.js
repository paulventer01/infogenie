'use strict';
require('./helpers/env'); // vault key must exist before the vault caches it
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const express=require('express');
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
  assert.match(api,/gaOauthState = \{ value: state, userId: req\.user\.id, tenantId \}/);
  assert.match(api,/gaPending = \{[\s\S]*tenantId: initiatingTenantId/);
});
test('approval expiry is carried through authoritative locks and checked at transition time',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_capabilities'),'utf8');
  assert.match(source,/pa\.expires_at AS approval_expires_at/);
  assert.match(source,/new Date\(x\.row\.approval_expires_at\)>transitionNow/);
  assert.match(source,/new Date\(row\.approval_expires_at\)>freshNow/);
});
test('Google Ads OAuth state is opaque, tenant-pinned, single-use, and constant-time checked',()=>{
  const state=oauth._oauthState();
  assert.match(state,/^[A-Za-z0-9_-]{64}$/);
  const req={user:{id:7},session:{gaOauthState:{value:state,userId:7,tenantId:101}},tenant:{id:202}};
  assert.equal(oauth._consumeOauthState(req,state),101); // active tenant switching cannot redirect ownership
  assert.equal(oauth._consumeOauthState(req,state),null); // replay
  const mismatch={user:{id:7},session:{gaOauthState:{value:state,userId:7,tenantId:101}}};
  assert.equal(oauth._consumeOauthState(mismatch,oauth._oauthState()),null);
  assert.equal(mismatch.session.gaOauthState,undefined);
  const source=fs.readFileSync(require.resolve('../services/google_ads_oauth/api'),'utf8');
  assert.match(source,/tenantId: initiatingTenantId/);
  assert.match(source,/saveCredentials[\s\S]*tenantId: initiatingTenantId/);
  assert.match(source,/equalBytes = crypto\.timingSafeEqual\(expected, normalized\)/);
  assert.match(source,/await _activeMember\(req\.user\.id, initiatingTenantId\)/);
  assert.doesNotMatch(source,/createHmac|_signState/);
  assert.doesNotMatch(source,/_oauthState\([^)]*(clientSecret|secret)/);
  assert.doesNotMatch(source,/google-ads-oauth:bind-customer/);
});
test('Google Ads OAuth membership is authoritatively revalidated for the stored tenant',async()=>{
  const db=require('../db');
  const originalHasDb=db.hasDb,originalGetPool=db.getPool;
  let active=true;
  db.hasDb=()=>true;
  db.getPool=()=>({query:async(sql,args)=>{
    assert.match(sql,/tu\.status='active'/);assert.deepEqual(args,[101,7]);
    return {rowCount:active?1:0};
  }});
  try {
    assert.equal(await oauth._activeMember(7,101),true);
    active=false;
    assert.equal(await oauth._activeMember(7,101),false);
  } finally { db.hasDb=originalHasDb;db.getPool=originalGetPool; }
});
test('Google Ads OAuth persistence delegates authority to vault for the pinned initiating tenant',async()=>{
  const credentialVault=require('../services/credentials/vault');
  const originalSave=credentialVault.saveCredentials;
  const persisted=[];
  try {
    credentialVault.saveCredentials=async(userId,platform,credentials,opts)=>{
      persisted.push({userId,platform,credentials,opts});
      if(opts.tenantId===101) throw new Error('saveCredentials: active tenant membership with tenant.integrations.manage required');
      return {ok:true,version:2,referenceId:'google_ads_7_2'};
    };
    const denied=await oauth._saveCredentialsForTenant(7,101,{customerId:'111'});
    const saved=await oauth._saveCredentialsForTenant(7,202,{customerId:'222'});
    assert.equal(denied,null);
    assert.deepEqual(saved,{ok:true,version:2,referenceId:'google_ads_7_2'});
    assert.equal(persisted.length,2);
    assert.equal(persisted[0].opts.tenantId,101);
    assert.equal(persisted[1].opts.tenantId,202);

    const source=fs.readFileSync(require.resolve('../services/google_ads_oauth/api'),'utf8');
    assert.doesNotMatch(source,/async function _canManageTenantIntegrations/);
    assert.match(source,/customerIds\.length === 1[\s\S]*_saveCredentialsForTenant\(req\.user\.id, initiatingTenantId/);
    assert.match(source,/router\.post\('\/bind-customer'[\s\S]*_saveCredentialsForTenant\(req\.user\.id, p\.tenantId/);
  } finally { credentialVault.saveCredentials=originalSave; }
});
test('Google Ads OAuth persistence does not swallow unexpected vault errors',async()=>{
  const credentialVault=require('../services/credentials/vault');
  const originalSave=credentialVault.saveCredentials;
  try {
    credentialVault.saveCredentials=async()=>{ throw new Error('saveCredentials: no DATABASE_URL'); };
    await assert.rejects(oauth._saveCredentialsForTenant(7,101,{customerId:'111'}),/no DATABASE_URL/);
  } finally { credentialVault.saveCredentials=originalSave; }
});
test('Google Ads OAuth authorization routes use the bounded tenant/user/IP limiter',()=>{
  const source=fs.readFileSync(require.resolve('../services/google_ads_oauth/api'),'utf8');
  assert.match(source,/createRateLimiter\(\{[\s\S]*name: 'google-ads-oauth-authorization'[\s\S]*max: 20/);
  assert.match(source,/`google-ads-oauth\|\$\{tenantId\}\|\$\{userId\}\|\$\{_requestIp\(req\)\}`/);
  assert.match(source,/router\.get\('\/oauth\/start', oauthAuthorizationLimiter,/);
  assert.match(source,/router\.get\('\/oauth\/callback', oauthAuthorizationLimiter,/);
});
test('Google Ads OAuth limiter permits one normal completion and enforces its bound',async t=>{
  oauth._oauthAuthorizationLimiter.reset();
  const app=express();
  app.use((req,res,next)=>{req.user={id:7};req.tenant={id:101};req.session={};next();});
  app.get('/start',oauth._oauthAuthorizationLimiter,(req,res)=>res.json({ok:true}));
  app.get('/callback',oauth._oauthAuthorizationLimiter,(req,res)=>res.json({ok:true}));
  const server=app.listen(0);t.after(()=>server.close());
  await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/start`)).status,200);
  assert.equal((await fetch(`${origin}/callback`)).status,200);
  for(let i=0;i<18;i++) assert.equal((await fetch(`${origin}/callback`)).status,200);
  const limited=await fetch(`${origin}/callback`);
  assert.equal(limited.status,429);
  assert.deepEqual(await limited.json(),{ok:false,error:'rate_limited',retryAfterSec:600});
  oauth._oauthAuthorizationLimiter.reset();
});
test('Google Ads credential persistence locks the pinned tenant authority inside one transaction',()=>{
  const source=fs.readFileSync(require.resolve('../services/credentials/vault'),'utf8');
  assert.match(source,/GOOGLE_ADS_INTEGRATIONS_PERMISSION = 'tenant\.integrations\.manage'/);
  assert.match(source,/FROM tenants t[\s\S]*tu\.status='active'[\s\S]*\(r\.tenant_id=t\.id OR r\.tenant_id IS NULL\)[\s\S]*t\.status='active' AND r\.permissions \? \$3[\s\S]*FOR UPDATE OF t, tu, r/);
  const body=source.slice(source.indexOf('async function saveCredentials'),
    source.indexOf('async function getGoogleAdsCredentialReference'));
  // One transaction, one connection, one encryption — the authority lock rides
  // the existing write, it does not open a second one.
  assert.equal((body.match(/BEGIN/g)||[]).length,1);
  assert.equal((body.match(/connect\(\)/g)||[]).length,1);
  assert.equal((body.match(/_encrypt\(/g)||[]).length,1);
  assert.match(body,/_lockGoogleAdsTenantAuthority\(client, tenantId, uid\)[\s\S]*INSERT INTO user_integrations/);
  assert.match(body,/_lockGoogleAdsTenantAuthority\(client, tenantId, uid\)[\s\S]*INSERT INTO orchestrator_tenant_google_ads_credential_refs/);
  // The pinned tenant is the only authority input: no session tenant, no global matrix.
  assert.doesNotMatch(body,/session|activeTenantId|permission_matrix|permission_enforce|ROUTE_GROUPS/i);
});
test('Google Ads credential persistence fails closed on tenant, membership and permission revocation',async()=>{
  const db=require('../db');
  const credentialVault=require('../services/credentials/vault');
  const originalHasDb=db.hasDb,originalGetPool=db.getPool;
  const PINNED=101,OTHER=202;
  const scenarios=[
    ['tenant_owner system role','active','active',null,['tenant.integrations.manage'],true],
    ['tenant_admin system role','active','active',null,['tenant.integrations.manage','tenant.audit.view'],true],
    ['custom tenant-local role','active','active',PINNED,['tenant.integrations.manage'],true],
    ['inactive membership','active','invited',null,['tenant.integrations.manage'],false],
    ['revoked membership','active','suspended',null,['tenant.integrations.manage'],false],
    ['wrong-tenant custom role','active','active',OTHER,['tenant.integrations.manage'],false],
    ['permission denied','active','active',PINNED,['advertising.provider_drafts.create'],false],
    ['suspended tenant','suspended','active',null,['tenant.integrations.manage'],false],
  ];
  try {
    db.hasDb=()=>true;
    for(const [name,tenantStatus,membershipStatus,roleTenantId,permissions,allowed] of scenarios){
      const log=[];let connects=0;
      const client={
        query:async(sql,args=[])=>{
          const text=String(sql);log.push({text,args});
          if(/FROM tenants t/.test(text)){
            assert.match(text,/FOR UPDATE OF t, tu, r/,name);
            assert.match(text,/t\.status='active'/,name);
            assert.match(text,/tu\.status='active'/,name);
            assert.match(text,/\(r\.tenant_id=t\.id OR r\.tenant_id IS NULL\)/,name);
            assert.match(text,/r\.permissions \? \$3/,name);
            assert.equal(args[0],PINNED,name);
            assert.equal(args[2],'tenant.integrations.manage',name);
            const roleApplies=roleTenantId===null||roleTenantId===args[0];
            const admitted=tenantStatus==='active'&&membershipStatus==='active'
              &&roleApplies&&permissions.includes(args[2]);
            return {rowCount:admitted?1:0,rows:admitted?[{}]:[]};
          }
          if(/INSERT INTO user_integrations/.test(text)) return {rowCount:1,rows:[{credential_version:3}]};
          return {rowCount:0,rows:[]};
        },
        release(){},
      };
      db.getPool=()=>({
        connect:async()=>{connects++;return client;},
        // schema ensure runs on the pool, never inside the credential transaction
        query:async()=>({rowCount:0,rows:[]}),
      });
      const save=credentialVault.saveCredentials(7,'google_ads',{customerId:'1234567890'},{tenantId:PINNED});
      const at=(re)=>log.findIndex(entry=>re.test(entry.text));
      if(allowed){
        assert.deepEqual(await save,{ok:true,version:3,referenceId:'google_ads_7_3'},name);
        assert.equal(connects,1,`${name} single connection`);
        assert.ok(at(/^BEGIN$/)>=0&&at(/FROM tenants t/)>at(/^BEGIN$/),`${name} locks inside the transaction`);
        assert.ok(at(/FROM tenants t/)<at(/INSERT INTO user_integrations/),`${name} locks before the credential`);
        assert.ok(at(/FROM tenants t/)<at(/INSERT INTO orchestrator_tenant_google_ads_credential_refs/),
          `${name} locks before the reference`);
        assert.equal(log.filter(entry=>/^COMMIT$/.test(entry.text)).length,1,`${name} one commit`);
        assert.equal(log.filter(entry=>/^ROLLBACK$/.test(entry.text)).length,0,`${name} no rollback`);
      } else {
        await assert.rejects(save,/tenant\.integrations\.manage required/,name);
        assert.equal(connects,1,`${name} single connection`);
        assert.equal(log.filter(entry=>/^ROLLBACK$/.test(entry.text)).length,1,`${name} rolled back`);
        assert.equal(log.filter(entry=>/^COMMIT$/.test(entry.text)).length,0,`${name} never committed`);
        assert.equal(at(/user_integrations/),-1,`${name} wrote no credential`);
        assert.equal(at(/orchestrator_tenant_google_ads_credential_refs/),-1,`${name} wrote no reference`);
      }
    }
  } finally { db.hasDb=originalHasDb;db.getPool=originalGetPool; }
});
