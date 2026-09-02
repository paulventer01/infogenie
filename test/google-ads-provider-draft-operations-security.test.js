'use strict';
require('./helpers/env'); // vault key must exist before the vault caches it
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const operations=require('../services/security/google_ads_provider_draft_operations');

const source=fs.readFileSync(require.resolve('../services/security/google_ads_provider_draft_operations'),'utf8');
const vaultSource=fs.readFileSync(require.resolve('../services/credentials/vault'),'utf8');
const helper=vaultSource.slice(
  vaultSource.indexOf('async function assertGoogleAdsProviderDraftCredentialRefMetadata'),
  vaultSource.indexOf('function _pageIdOf'));
const actor={tenantId:1,actorUserId:2,actorType:'human',principalType:'user',sessionId:'sid',
  hasExplicitTenantPermission:(key)=>key===operations.PERMISSION};
const refuse={query:async()=>{throw new Error('no database work expected');}};

test('operation ledger reuses the narrow explicit provider-draft permission',()=>{
  assert.equal(operations.PERMISSION,'advertising.provider_drafts.create');
  assert.deepEqual(Object.keys(operations.RESULT_CODES),['failed','unknown']);
});

test('operation ledger has no provider SDK, network, secret resolution or mutation reachability',()=>{
  for(const [label,text] of [['operations',source],['vault helper',helper]]) {
    assert.ok(text.length>200,label);
    assert.doesNotMatch(text,/google-ads-api|googleapis|axios|\bfetch\s*\(|https?:\/\//i,label);
    assert.doesNotMatch(text,/\bgetCredentials\b|resolveGoogleAdsCredentials|decryptString|_decrypt\(/,label);
    assert.doesNotMatch(text,/access_token|refresh_token|developer_token|customer_id|customerId/i,label);
    assert.doesNotMatch(text,/provider_mutations|createCampaign|mutateCampaign|connectors?\//i,label);
  }
  assert.doesNotMatch(helper,/user_integrations/);
  assert.match(helper,/FROM orchestrator_tenant_google_ads_credential_refs[\s\S]*FOR UPDATE/);
  assert.match(source,/published:false,activated:false,external_action_taken:false/);
});

test('the public projection is frozen and free of credential and account lineage',async()=>{
  const row={id:'gapo_x',status:'in_progress',result_code:null,capability_id:'gac_x',
    created_at:new Date('2026-01-01Z'),started_at:new Date('2026-01-01T00:00:01Z'),settled_at:null,
    account_fingerprint:'a'.repeat(64),credential_ref_id:'secret-ish',session_id_hash:'b'.repeat(64)};
  const out=await operations.get({query:async()=>({rowCount:1,rows:[row]})},{...actor,operationId:'gapo_x'});
  assert.deepEqual(Object.keys(out).sort(),['activated','created_at','external_action_taken','operation_id',
    'published','replay','result_code','settled_at','started_at','status'].sort());
  assert.equal(Object.isFrozen(out),true);
  assert.equal(out.external_action_taken,false);
  assert.equal(out.published,false);
  assert.equal(out.activated,false);
  const serialized=JSON.stringify(out);
  assert.equal(serialized.includes('credential'),false);
  assert.equal(serialized.includes('aaaa'),false);
  assert.equal(serialized.includes('bbbb'),false);
});

test('settlement refuses to claim provider success and admits only the matching result code',async()=>{
  const attempts=[
    {status:'succeeded',resultCode:'provider_create_succeeded'},
    {status:'succeeded',resultCode:'provider_create_failed'},
    {status:'in_progress',resultCode:'ready_for_provider'},
    {status:'failed',resultCode:'provider_outcome_unknown'},
    {status:'unknown',resultCode:'provider_create_failed'},
    {status:'failed',resultCode:undefined},
  ];
  for(const attempt of attempts) {
    await assert.rejects(operations.settle(refuse,{...actor,operationId:'gapo_x',...attempt}),
      (error)=>error.code==='operation_rejected'&&error.blocked===true&&error.external_action_taken===false,
      JSON.stringify(attempt));
  }
});

test('non-human principals and missing grants are refused before any database work',async()=>{
  for(const principalType of ['api_key','worker','service','service_account','automation','autonomous','agent']) {
    await assert.rejects(operations.fund(refuse,{...actor,principalType,capabilityId:'gac_x',
      reservationId:'r',invocationId:'i',idempotencyKey:'k'}),(e)=>e.code==='human_session_required');
  }
  await assert.rejects(operations.fund(refuse,{...actor,hasExplicitTenantPermission:()=>false,
    capabilityId:'gac_x',reservationId:'r',invocationId:'i',idempotencyKey:'k'}),
  (e)=>e.code==='permission_denied');
  await assert.rejects(operations.get(refuse,{...actor,hasExplicitTenantPermission:()=>false,operationId:'gapo_x'}),
    (e)=>e.code==='permission_denied');
});

test('funding validates identifiers and the capability spend before the ledger insert',()=>{
  assert.match(source,/const reserved=await capability\.reserve\(c,o\);/);
  assert.match(source,/const consumed=await capability\.consume\(c,o\);/);
  assert.match(source,/status='consumed'[\s\S]*FOR UPDATE/);
  assert.match(source,/await vault\.assertGoogleAdsProviderDraftCredentialRefMetadata\(c,\{tenantId,ownerUserId:actorId/);
  // The ledger row is funded inside the caller's transaction; a savepoint keeps
  // a duplicate-key race recoverable without committing or aborting it.
  assert.doesNotMatch(source,/'BEGIN'|'COMMIT'|'ROLLBACK'\)/);
  assert.match(source,/SAVEPOINT gapdo_fund/);
  assert.match(source,/error\?\.code!=='23505'\)throw error/);
  assert.match(source,/VALUES\(\$1,\$2,'pending'/);
});
