'use strict';
require('./helpers/env');
const test=require('node:test');const assert=require('node:assert/strict');
const connector=require('../services/agent_orchestrator/connectors/google_ads_activation');

const CUSTOMER='1234567890',CAMPAIGN='123',ADGROUP='456';
function credentials(){
 const x=Object.create(null);Object.defineProperties(x,{
  object_kind:{value:'google_ads_activation_secret_scope',enumerable:true},
  accessToken:{value:'access-token'},developerToken:{value:'developer-token'},
  customerId:{value:CUSTOMER},loginCustomerId:{value:'0987654321'},
  [Symbol.for('infogenie.google_ads_activation_secret_scope')]:{value:true},
 });return Object.freeze(x);
}
const objects=[
 {object_kind:'campaign_budget',sequence_number:1,provider_object_id:'789',provider_status:'PAUSED'},
 {object_kind:'campaign',sequence_number:2,provider_object_id:CAMPAIGN,provider_status:'PAUSED'},
 {object_kind:'ad_group',sequence_number:3,provider_object_id:ADGROUP,provider_status:'PAUSED'},
];
const base={operation:{provider_operation_key:'operation-key'},credentials:credentials(),objects};
function success(){return{status:200,json:{mutateOperationResponses:[
 {campaignResult:{resourceName:`customers/${CUSTOMER}/campaigns/${CAMPAIGN}`}},
 {adGroupResult:{resourceName:`customers/${CUSTOMER}/adGroups/${ADGROUP}`}},
]}};}

test('builds one atomic, identity-bound two-object activation with no budget mutation',()=>{
 const bound={customer_id:CUSTOMER,campaign_id:CAMPAIGN,ad_group_id:ADGROUP};
 const request=connector.assertAuthorizedActivationShape(connector.buildGoogleAdsActivationRequest(bound),bound);
 assert.equal(request.body.partialFailure,false);assert.equal(request.body.validateOnly,false);
 assert.equal(request.body.mutateOperations.length,2);
 assert.deepEqual(request.body.mutateOperations.map(x=>Object.keys(x)),[['campaignOperation'],['adGroupOperation']]);
 assert.equal(request.body.mutateOperations[0].campaignOperation.update.status,'ENABLED');
 assert.equal(request.body.mutateOperations[1].adGroupOperation.update.status,'ENABLED');
 assert.doesNotMatch(JSON.stringify(request),/campaignBudgetOperation|amountMicros|bid|spend/i);
});

test('a confirmed complete response succeeds after exactly one send',async()=>{
 let calls=0,seen;
 const out=await connector.activateGoogleAdsCampaign({...base,inject:{mutate:async request=>{calls++;seen=request;return success();}}});
 assert.equal(calls,1);assert.equal(seen.body.mutateOperations.length,2);
 assert.deepEqual(out,{ok:true,result_code:'provider_activation_succeeded',objects_activated:2,
  activated:true,serving:true,external_action_taken:true,requires_reconciliation:false,retry:false,
  provider_operation_key:'operation-key'});
});

test('determinate rejection is failed; ambiguous and incomplete outcomes are unknown',async()=>{
 const rejected=await connector.activateGoogleAdsCampaign({...base,inject:{mutate:async()=>({status:400,json:{error:{code:400}}})}});
 assert.equal(rejected.result_code,'provider_activation_failed');assert.equal(rejected.external_action_taken,false);
 for(const response of [{status:503,json:{}},{transportError:true,mayHaveActed:true},
  {status:200,json:{}},{status:200,json:{...success().json,partialFailureError:{code:13}}},
  {status:200,json:{mutateOperationResponses:[success().json.mutateOperationResponses[0]]}}]){
  const out=await connector.activateGoogleAdsCampaign({...base,inject:{mutate:async()=>response}});
  assert.equal(out.result_code,'provider_activation_unknown');assert.equal(out.requires_reconciliation,true);
  assert.equal(out.external_action_taken,null);assert.equal(out.retry,false);
 }
});

test('live writes are off by default and caller/provider-shape drift fails closed',async()=>{
 await assert.rejects(connector.activateGoogleAdsCampaign(base),e=>e.code==='live_google_ads_disabled');
 await assert.rejects(connector.activateGoogleAdsCampaign({...base,status:'ENABLED',inject:{mutate:async()=>success()}}),
  e=>e.code==='caller_provider_control_rejected');
 await assert.rejects(connector.activateGoogleAdsCampaign({...base,objects:objects.map((x,i)=>i===0?{...x,provider_status:'ENABLED'}:x),
  inject:{mutate:async()=>success()}}),e=>e.code==='invalid_object_binding');
 const bound={customer_id:CUSTOMER,campaign_id:CAMPAIGN,ad_group_id:ADGROUP};
 const request=JSON.parse(JSON.stringify(connector.buildGoogleAdsActivationRequest(bound)));
 request.body.mutateOperations[0].campaignOperation.update.status='PAUSED';
 assert.throws(()=>connector.assertAuthorizedActivationShape(request,bound));
});
