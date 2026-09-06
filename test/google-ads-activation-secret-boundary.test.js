'use strict';
require('./helpers/env');
const test=require('node:test');const assert=require('node:assert/strict');const util=require('node:util');const crypto=require('crypto');
const vault=require('../services/credentials/vault');
const CUSTOMER='1234567890',FP=crypto.createHash('sha256').update(CUSTOMER).digest('hex');
const BLOB={customerId:CUSTOMER,refreshToken:'refresh-secret',clientId:'client-id',clientSecret:'client-secret',
 devToken:'developer-secret',loginCustomerId:'0987654321'};
const bad=code=>e=>e?.code===code&&e.blocked===true&&e.external_action_taken===false;
function client(over={}){
 const enc=vault.encryptString(JSON.stringify(over.blob||BLOB));
 return {async query(sql){
  if(sql.includes('tenant_users'))return{rowCount:over.member===false?0:1,rows:[{}]};
  if(sql.includes('orchestrator_tenant_google_ads_credential_refs'))return{rowCount:1,rows:[{tenant_id:7,id:'cred-1',
   platform:'google_ads',status:'active',revoked_at:null,version:3,owner_user_id:11,account_fingerprint:FP}]};
  if(sql.includes('user_integrations'))return{rowCount:1,rows:[{...enc,status:'connected',credential_version:3}]};
  throw new Error('unexpected query');
 }};
}
const base={tenantId:7,ownerUserId:11,credentialRefId:'cred-1',credentialRefVersion:3,accountFingerprint:FP};
const token=async request=>{
 assert.equal(request.object_kind,'google_ads_activation_token_request');
 assert.equal(request.url,'https://oauth2.googleapis.com/token');
 assert.equal(request.refreshToken,'refresh-secret');
 assert.throws(()=>JSON.stringify(request),bad('validation_failed'));
 return{access_token:'access-secret',expires_in:1800};
};

test('activation uses a distinct, sealed, last-responsible-moment scope',async()=>{
 let escaped,entered=0;
 const out=await vault.withGoogleAdsActivationSecretScope(client(),{...base,tokenTransport:token},async handle=>{
  entered++;escaped=handle;assert.equal(vault.isGoogleAdsActivationSecretScope(handle),true);
  assert.equal(vault.isGoogleAdsPausedDraftSecretScope(handle),false);
  assert.equal(handle.customerId,CUSTOMER);assert.equal(handle.accessToken,'access-secret');
  const visible=JSON.stringify({...handle})+util.inspect(handle);
  for(const secret of [CUSTOMER,FP,'refresh-secret','access-secret','developer-secret'])assert.equal(visible.includes(secret),false);
  assert.throws(()=>JSON.stringify(handle),bad('validation_failed'));return 'ok';
 });
 assert.equal(out,'ok');assert.equal(entered,1);
 assert.throws(()=>escaped.customerId,bad('validation_failed'));
});

test('authority or token failure never enters the provider scope',async()=>{
 let entered=false;
 await assert.rejects(vault.withGoogleAdsActivationSecretScope(client({member:false}),{...base,tokenTransport:token},
  async()=>{entered=true;}),bad('permission_denied'));
 await assert.rejects(vault.withGoogleAdsActivationSecretScope(client(),{...base,tokenTransport:async()=>{throw new Error('secret');}},
  async()=>{entered=true;}),bad('token_exchange_failed'));
 assert.equal(entered,false);
});

test('production token transport and activation endpoint are pinned',()=>{
 assert.equal(typeof vault.googleAdsOAuthTokenTransport,'function');
 assert.equal(vault.GOOGLE_ADS_OAUTH_TOKEN_URL,'https://oauth2.googleapis.com/token');
});
