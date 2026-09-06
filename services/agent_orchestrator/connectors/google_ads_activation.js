'use strict';

// PR10D.2 — narrow Google Ads activation connector. Exactly one campaign and
// its ad group may move from PAUSED to ENABLED in one atomic mutate. The bound
// campaign budget is identity evidence only and is never included in a write.
const https = require('https');
const vault = require('./services/credentials/vault');

const API_ORIGIN = 'https://googleads.googleapis.com';
const API_VERSION = 'v17';
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const LIVE_OPT_IN_ENV = 'INFOGENIE_LIVE_GOOGLE_ADS_ACTIVATION';
const OBJECT_SEQUENCE = Object.freeze(['campaign_budget', 'campaign', 'ad_group']);
const SAFE_KEY = /^[A-Za-z0-9_.:-]{1,256}$/;
const CUSTOMER_DIGITS = /^[0-9]{10}$/;

function invalid(code) { const e = new Error(code); e.code = code; throw e; }
function digits(v) { return String(v || '').replace(/[\s-]/g, ''); }
function liveOptedIn(input) { return input?.allowLive === true && process.env[LIVE_OPT_IN_ENV] === '1'; }

function validate(input) {
  if (!input || typeof input !== 'object') invalid('invalid_activation_input');
  for (const key of ['url','method','body','payload','operations','mutateOperations','status','budget','bid','spend','customerId']) {
    if (Object.hasOwn(input, key)) invalid('caller_provider_control_rejected');
  }
  if (!input.operation || !SAFE_KEY.test(String(input.operation.provider_operation_key || ''))) invalid('invalid_operation');
  if (!vault.isGoogleAdsActivationSecretScope(input.credentials)) invalid('invalid_activation_secret_scope');
  const customerId = digits(input.credentials.customerId);
  if (!CUSTOMER_DIGITS.test(customerId)) invalid('invalid_account_binding');
  const objects = Array.isArray(input.objects) ? input.objects : [];
  if (objects.length !== 3 || objects.some((x, i) => !x || x.object_kind !== OBJECT_SEQUENCE[i]
    || x.provider_status !== 'PAUSED' || !/^[0-9]{1,32}$/.test(String(x.provider_object_id || '')))) {
    invalid('invalid_object_binding');
  }
  if (input.inject !== undefined && (!input.inject || typeof input.inject.mutate !== 'function')) invalid('invalid_inject');
  return Object.freeze({
    provider_operation_key: String(input.operation.provider_operation_key), customer_id: customerId,
    login_customer_id: input.credentials.loginCustomerId ? digits(input.credentials.loginCustomerId) : null,
    access_token: input.credentials.accessToken, developer_token: input.credentials.developerToken,
    campaign_id: String(objects[1].provider_object_id), ad_group_id: String(objects[2].provider_object_id),
  });
}

function buildGoogleAdsActivationRequest(bound) {
  const campaign = `customers/${bound.customer_id}/campaigns/${bound.campaign_id}`;
  const adGroup = `customers/${bound.customer_id}/adGroups/${bound.ad_group_id}`;
  return Object.freeze({
    url: `${API_ORIGIN}/${API_VERSION}/customers/${bound.customer_id}/googleAds:mutate`, method: 'POST',
    timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES,
    body: Object.freeze({
      mutateOperations: Object.freeze([
        Object.freeze({campaignOperation:Object.freeze({update:Object.freeze({resourceName:campaign,status:'ENABLED'}),updateMask:'status'})}),
        Object.freeze({adGroupOperation:Object.freeze({update:Object.freeze({resourceName:adGroup,status:'ENABLED'}),updateMask:'status'})}),
      ]), partialFailure: false, validateOnly: false,
    }),
  });
}

function assertAuthorizedActivationShape(request, bound) {
  if (!request || request.method !== 'POST') invalid('unsafe_google_ads_request');
  let url; try { url = new URL(request.url); } catch (_e) { invalid('unsafe_google_ads_request'); }
  if (url.origin !== API_ORIGIN || url.pathname !== `/${API_VERSION}/customers/${bound.customer_id}/googleAds:mutate`) invalid('unsafe_google_ads_request');
  const body = request.body, ops = body?.mutateOperations;
  if (!body || body.partialFailure !== false || body.validateOnly !== false || !Array.isArray(ops) || ops.length !== 2) invalid('unsafe_google_ads_request');
  const campaign = ops[0]?.campaignOperation, adGroup = ops[1]?.adGroupOperation;
  if (!campaign?.update || campaign.updateMask !== 'status' || campaign.update.status !== 'ENABLED'
    || campaign.update.resourceName !== `customers/${bound.customer_id}/campaigns/${bound.campaign_id}`
    || !adGroup?.update || adGroup.updateMask !== 'status' || adGroup.update.status !== 'ENABLED'
    || adGroup.update.resourceName !== `customers/${bound.customer_id}/adGroups/${bound.ad_group_id}`) invalid('unsafe_google_ads_request');
  const serialized = JSON.stringify(body);
  if (/campaignBudgetOperation|amountMicros|budget|bid|remove|create|partialFailure"\s*:\s*true/i.test(serialized)) invalid('unsafe_google_ads_request');
  return request;
}

function headers(bound) {
  const h = {Authorization:`Bearer ${bound.access_token}`,'developer-token':bound.developer_token,Accept:'application/json','Content-Type':'application/json'};
  if (bound.login_customer_id) h['login-customer-id'] = bound.login_customer_id;
  return h;
}

function defaultTransport(options) {
  const url = new URL(options.url), body = JSON.stringify(options.body);
  if (url.origin !== API_ORIGIN || options.method !== 'POST') invalid('unsafe_google_ads_request');
  return new Promise((resolve) => {
    let settled = false, size = 0; const chunks = [];
    const finish = x => { if (!settled) { settled = true; resolve(x); } };
    const req = https.request(url,{method:'POST',headers:{...options.headers,'Content-Length':Buffer.byteLength(body)},timeout:options.timeoutMs},res=>{
      res.on('data',chunk=>{size+=chunk.length;if(size>options.maxResponseBytes){req.destroy();finish({oversized:true,mayHaveActed:true});}else chunks.push(chunk);});
      res.on('end',()=>{if(settled)return;if(res.statusCode>=300&&res.statusCode<400)return finish({redirect:true});
        try{finish({status:res.statusCode,json:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
        catch(_e){finish({status:res.statusCode,malformed:true,mayHaveActed:true});}});
    });
    req.on('timeout',()=>{req.destroy();finish({transportError:true,mayHaveActed:true});});
    req.on('error',()=>finish({transportError:true,mayHaveActed:true}));req.end(body);
  });
}

function result(bound, status) {
  const succeeded = status === 'succeeded', unknown = status === 'unknown';
  return Object.freeze({ok:succeeded,result_code:`provider_activation_${status}`,objects_activated:succeeded?2:0,
    activated:succeeded,serving:succeeded,external_action_taken:succeeded?true:(unknown?null:false),
    requires_reconciliation:unknown,retry:false,provider_operation_key:bound.provider_operation_key});
}
function success(res,bound){
  if(!res||res.status<200||res.status>=300||!res.json||res.json.error)return false;
  const rows=res.json.mutateOperationResponses;if(!Array.isArray(rows)||rows.length!==2)return false;
  return rows[0]?.campaignResult?.resourceName===`customers/${bound.customer_id}/campaigns/${bound.campaign_id}`
    &&rows[1]?.adGroupResult?.resourceName===`customers/${bound.customer_id}/adGroups/${bound.ad_group_id}`;
}

async function activateGoogleAdsCampaign(input) {
  const bound=validate(input),request=assertAuthorizedActivationShape(buildGoogleAdsActivationRequest(bound),bound);
  const injected=input.inject?.mutate;if(!injected&&!liveOptedIn(input))invalid('live_google_ads_disabled');
  const send=injected||((call)=>defaultTransport({...call,headers:headers(bound)}));
  let res;try{res=await send(request);}catch(_e){return result(bound,'unknown');}
  if(res?.redirect)return result(bound,'failed');
  if(res?.transportError||res?.malformed||res?.oversized||Number(res?.status)>=500)return result(bound,'unknown');
  if(!res||Number(res.status)<200||Number(res.status)>=300||res.json?.error)return result(bound,'failed');
  return success(res,bound)?result(bound,'succeeded'):result(bound,'unknown');
}

module.exports={API_ORIGIN,API_VERSION,TIMEOUT_MS,MAX_RESPONSE_BYTES,LIVE_OPT_IN_ENV,OBJECT_SEQUENCE,
  buildGoogleAdsActivationRequest,assertAuthorizedActivationShape,activateGoogleAdsCampaign};
