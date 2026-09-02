'use strict';
require('./helpers/env'); // vault key must exist before the vault caches it
const test=require('node:test');const assert=require('node:assert/strict');
const util=require('node:util');const fs=require('fs');const crypto=require('crypto');
const vault=require('../services/credentials/vault');

const source=fs.readFileSync(require.resolve('../services/credentials/vault'),'utf8');
const slice=source.slice(source.indexOf('// ── PR10B.2a Google Ads paused-draft SECRET boundary'),
  source.indexOf('// ── Simple API-key vault'));
const code=slice.split('\n').filter((line)=>!/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
const CUSTOMER='1234567890';
const FP=crypto.createHash('sha256').update(CUSTOMER,'utf8').digest('hex');
const REFRESH='refresh-token-plaintext';
const BLOB={customerId:CUSTOMER,refreshToken:REFRESH,clientId:'cid',clientSecret:'csecret',
  devToken:'dev-token',loginCustomerId:'0987654321'};
const bad=(code)=>(e)=>e&&e.code===code&&e.blocked===true&&e.external_action_taken===false;

// Stubbed transaction client: membership, the locked reference row and the
// locked vault row. No Postgres, no network.
function client(over={}) {
  const blob=over.blob===undefined?BLOB:over.blob;
  const enc=vault.encryptString(JSON.stringify(blob||{}));
  return {calls:[],async query(sql){this.calls.push(sql);
    if(sql.includes('tenant_users'))return{rowCount:over.member===false?0:1,rows:[{}]};
    if(sql.includes('orchestrator_tenant_google_ads_credential_refs'))return{rowCount:over.ref===null?0:1,
      rows:[{tenant_id:7,id:'cred-1',platform:'google_ads',status:over.refStatus||'active',
        revoked_at:over.refRevoked||null,version:over.refVersion===undefined?3:over.refVersion,
        owner_user_id:11,account_fingerprint:FP}]};
    if(sql.includes('user_integrations'))return{rowCount:1,rows:[{ciphertext:enc.ciphertext,iv:enc.iv,tag:enc.tag,
      status:over.vaultStatus||'connected',credential_version:over.vaultVersion===undefined?3:over.vaultVersion}]};
    throw new Error(`unexpected query: ${sql}`);
  }};
}
const token=async()=>({access_token:'access-token-plaintext',expires_in:3600});
const base={tenantId:7,ownerUserId:11,credentialRefId:'cred-1',credentialRefVersion:3,accountFingerprint:FP};
const open=(over,opts,fn)=>vault.withGoogleAdsPausedDraftSecretScope(client(over),
  {...base,tokenTransport:token,...opts},fn||(async()=>'done'));

test('the secret boundary has no network client of its own and pins the token endpoint',()=>{
  assert.ok(code.length>1000);
  assert.doesNotMatch(code,/require\(|https\.request|\bfetch\s*\(|axios|google-ads-api|googleads\.googleapis/);
  assert.equal(vault.GOOGLE_ADS_OAUTH_TOKEN_URL,'https://oauth2.googleapis.com/token');
  assert.match(code,/url: GOOGLE_ADS_OAUTH_TOKEN_URL/);
  // Nothing is memoized: no module-level plaintext cache keyed by anything.
  assert.doesNotMatch(code,/new Map\(|new WeakMap\(|cache|memo/i);
  assert.doesNotMatch(code,/console\.|logger/);
  assert.match(code,/FOR UPDATE/);
});

test('the boundary refuses a missing client, callback, transport or oversized deadline',async()=>{
  const V=bad('validation_failed');
  await assert.rejects(vault.withGoogleAdsPausedDraftSecretScope(null,base,async()=>1),V);
  await assert.rejects(vault.withGoogleAdsPausedDraftSecretScope(client(),{...base,tokenTransport:token},null),V);
  await assert.rejects(vault.withGoogleAdsPausedDraftSecretScope(client(),base,async()=>1),V);
  await assert.rejects(open({},{tokenTimeoutMs:vault.GOOGLE_ADS_MAX_TOKEN_TIMEOUT_MS+1}),V);
  await assert.rejects(open({},{tenantId:0}),V);
  await assert.rejects(open({},{ownerUserId:-1}),V);
});

test('the scope handle hides secrets, refuses serialization and dies when it closes',async()=>{
  let escaped=null;
  const returned=await open({},{},async(handle)=>{
    escaped=handle;
    assert.equal(vault.isGoogleAdsPausedDraftSecretScope(handle),true);
    assert.equal(`${handle.accessToken}|${handle.developerToken}|${handle.customerId}|${handle.loginCustomerId}`,
      `access-token-plaintext|dev-token|${CUSTOMER}|0987654321`);
    // Everything enumerable is safe to log: no token, customer id or fingerprint.
    assert.deepEqual(Object.keys(handle).sort(),['access_token_expires_at','account_fingerprint_matches',
      'credential_ref_id','credential_ref_version','has_secret_access','object_kind'].sort());
    const visible=JSON.stringify({...handle})+util.inspect(handle);
    for(const secret of ['access-token-plaintext','dev-token',CUSTOMER,FP,REFRESH])
      assert.equal(visible.includes(secret),false,secret);
    assert.match(util.inspect(handle),/redacted/);
    assert.throws(()=>JSON.stringify(handle),bad('validation_failed'));
    assert.equal(Object.isFrozen(handle),true);
    return 'provider-step-result';
  });
  assert.equal(returned,'provider-step-result');
  // A handle captured out of scope no longer answers.
  assert.throws(()=>escaped.accessToken,bad('validation_failed'));
  assert.throws(()=>escaped.customerId,bad('validation_failed'));
  assert.equal(escaped.credential_ref_id,'cred-1');
});

test('the token request is sealed, pinned and never reused between scopes',async()=>{
  const seen=[];
  const transport=async(request)=>{seen.push(request);
    assert.equal(request.url,vault.GOOGLE_ADS_OAUTH_TOKEN_URL);
    assert.equal(request.method,'POST');
    assert.equal(request.grant_type,'refresh_token');
    assert.equal(request.refreshToken,REFRESH);
    assert.equal(request.clientSecret,'csecret');
    assert.deepEqual(Object.keys(request).sort(),['grant_type','method','object_kind','timeoutMs','url']);
    assert.throws(()=>JSON.stringify(request),bad('validation_failed'));
    assert.equal(util.inspect(request).includes(REFRESH),false);
    return {access_token:'access-token-plaintext',expires_in:1800};};
  await open({},{tokenTransport:transport});
  await open({},{tokenTransport:transport});
  assert.equal(seen.length,2,'no plaintext token is cached across scopes');
  assert.throws(()=>seen[0].refreshToken,bad('validation_failed'));
});

test('drift, revocation, version mismatch and a bad exchange all fail closed',async()=>{
  let entered=false;
  const enter=async()=>{entered=true;return 1;};
  const junk=(o)=>[{},{tokenTransport:async()=>o},'token_exchange_failed'];
  const cases=[
    [{member:false},{},'permission_denied'],[{ref:null},{},'missing_credentials'],
    [{refStatus:'revoked',refRevoked:new Date()},{},'missing_credentials'],
    [{refVersion:4},{},'context_mismatch'],[{},{credentialRefVersion:4},'context_mismatch'],
    [{},{accountFingerprint:'a'.repeat(64)},'context_mismatch'],[{},{ownerUserId:12},'permission_denied'],
    [{},{accountFingerprint:CUSTOMER},'validation_failed'],[{vaultVersion:4},{},'context_mismatch'],
    [{vaultStatus:'disconnected'},{},'missing_credentials'],
    [{blob:{...BLOB,customerId:'999'}},{},'context_mismatch'],
    [{blob:{...BLOB,refreshToken:''}},{},'missing_credentials'],
    [{blob:{...BLOB,devToken:'_DUMMYdev'}},{},'missing_credentials'],
    [{blob:{...BLOB,loginCustomerId:'12'}},{},'validation_failed'],
    // A transport that throws, times out, or answers with junk never yields a token.
    [{},{tokenTransport:async()=>{throw new Error(`leaky ${REFRESH}`);}},'token_exchange_failed'],
    junk({expires_in:60}),junk({access_token:'a b',expires_in:60}),junk({access_token:'ok',expires_in:0}),
    junk({access_token:'ok',expires_in:999999}),
    [{},{tokenTimeoutMs:15,tokenTransport:()=>new Promise(()=>{})},'token_exchange_failed'],
  ];
  for(const [over,opts,code] of cases) {
    await assert.rejects(open(over,opts,enter),(e)=>{
      assert.ok(bad(code)(e),`${code} expected, got ${e&&e.code}`);
      assert.equal(String(e.message).includes(REFRESH),false,'no plaintext in the error');
      return true;
    },JSON.stringify({over:Object.keys(over),opts:Object.keys(opts),code}));
  }
  assert.equal(entered,false,'the callback never runs on a failed precondition');
});
