'use strict';
const express=require('express');
const db=require('../../db');
const tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit');
const capability=require('../security/google_ads_provider_draft_capabilities');
const router=express.Router();
function human(req){const kind=String(req?.user?.principalType||req?.user?.principal_type||'user').toLowerCase();return !!(req?.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0
  &&req.viaApiKey!==true&&req.user.viaApiKey!==true&&!['api_key','worker','service','service_account','automation','autonomous','agent'].includes(kind)
  &&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length);}
function grant(req){return !!(req?.tenantRole&&Array.isArray(req.tenantRole.permissions)&&req.tenantRole.permissions.includes(capability.PERMISSION));}
const limiter=createRateLimiter({name:'google-ads-provider-draft-capabilities',windowMs:60_000,max:20,failClosed:true,keyFn:req=>human(req)&&req.tenant?`${req.tenant.id}|${req.user.id}`:null});
function identify(req,res,next){if(!human(req))return res.status(401).json({error:'human_session_required',external_action_taken:false});next();}
function fail(code){throw capability._deny(code);}
function exact(body,allowed,required=allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(body,k)))fail('validation_failed');}
function status(code){return code==='human_session_required'?401:code==='permission_denied'?403:code==='capability_expired'?410:
  ['capability_rejected','authority_not_found'].includes(code)?404:['authoritative_binding_mismatch','capability_conflict'].includes(code)?409:400;}
async function transaction(fn){const c=await db.getPool().connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function common(req,tenantId){return {tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',sessionId:req.sessionID,
  hasExplicitTenantPermission:p=>p===capability.PERMISSION&&grant(req)};}
function route(label,fn){return async(req,res)=>{try{if(!human(req))fail('human_session_required');if(!grant(req))fail('permission_denied');
  const tenantId=await tenantCtx.resolveTenantId(req,{label:`google-ads-provider-draft-capability:${label}`});const result=await fn(common(req,tenantId),req);
  if(result?.expired)fail('capability_expired');res.status(label==='issue'?201:200).json(result);
}catch(e){res.status(status(e.code)).json({error:e.code||'capability_request_failed',external_action_taken:false});}};}
const json=express.json({limit:'3kb'});
router.post('/',identify,limiter,json,route('issue',(base,req)=>{exact(req.body,['campaign_draft_id','campaign_draft_revision','publishing_request_id','publish_approval_id','delivery_intent_id','credential_reference_id','credential_reference_version','google_ads_customer_id','final_confirmation_id','final_confirmation','confirmed_at','ttl_ms'],['campaign_draft_id','campaign_draft_revision','publishing_request_id','publish_approval_id','delivery_intent_id','credential_reference_id','credential_reference_version','google_ads_customer_id','final_confirmation_id','final_confirmation','confirmed_at']);const b=req.body;return transaction(c=>capability.issue(c,{...base,draftId:b.campaign_draft_id,draftRevision:b.campaign_draft_revision,publishingRequestId:b.publishing_request_id,publishApprovalId:b.publish_approval_id,intentId:b.delivery_intent_id,credentialRefId:b.credential_reference_id,credentialRefVersion:b.credential_reference_version,googleAdsCustomerId:b.google_ads_customer_id,finalConfirmationId:b.final_confirmation_id,finalConfirmation:b.final_confirmation,confirmedAt:b.confirmed_at,ttlMs:b.ttl_ms}));}));
router.post('/:capabilityId/reserve',identify,limiter,json,route('reserve',(base,req)=>{exact(req.body,['reservation_id']);return transaction(c=>capability.reserve(c,{...base,capabilityId:req.params.capabilityId,reservationId:req.body.reservation_id}));}));
router.post('/:capabilityId/consume',identify,limiter,json,route('consume',(base,req)=>{exact(req.body,['reservation_id','invocation_id']);return transaction(c=>capability.consume(c,{...base,capabilityId:req.params.capabilityId,reservationId:req.body.reservation_id,invocationId:req.body.invocation_id}));}));
router.post('/:capabilityId/revoke',identify,limiter,json,route('revoke',(base,req)=>{exact(req.body,[],[]);return transaction(c=>capability.revoke(c,{...base,capabilityId:req.params.capabilityId}));}));
router.get('/:capabilityId',identify,route('get',(base,req)=>capability.get(db.getPool(),{...base,capabilityId:req.params.capabilityId})));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._transaction=transaction;
