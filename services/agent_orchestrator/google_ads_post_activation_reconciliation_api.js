'use strict';
const express=require('express');
const db=require('../../db');
const tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit');
const service=require('./google_ads_post_activation_reconciliation');
const router=express.Router();
const PUBLIC_ERRORS=new Set(['human_session_required','permission_denied','validation_failed','activation_attempt_not_found',
  'reconciliation_not_found','activation_attempt_ineligible','authoritative_binding_mismatch','idempotency_conflict',
  'invalid_reconciliation_transition']);
const limiter=createRateLimiter({name:'google-ads-post-activation-reconciliation',windowMs:60000,max:10,failClosed:true,
  keyFn:req=>human(req)&&req.tenant?`${req.tenant.id}|${req.user.id}`:null});
function human(req){const kind=String(req?.user?.principalType||req?.user?.principal_type||'user').toLowerCase();return !!(req?.user
  &&Number.isSafeInteger(req.user.id)&&req.user.id>0&&req.viaApiKey!==true&&req.user.viaApiKey!==true
  &&!['api_key','worker','service','service_account','automation','autonomous','agent'].includes(kind)
  &&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length);}
const grant=req=>!!(req?.tenantRole&&Array.isArray(req.tenantRole.permissions)&&req.tenantRole.permissions.includes(service.PERMISSION));
const status=code=>code==='human_session_required'?401:code==='permission_denied'?403:
  ['activation_attempt_not_found','reconciliation_not_found'].includes(code)?404:
  ['activation_attempt_ineligible','authoritative_binding_mismatch','idempotency_conflict','invalid_reconciliation_transition'].includes(code)?409:
  code==='validation_failed'?400:500;
const publicCode=code=>PUBLIC_ERRORS.has(code)?code:'reconciliation_request_failed';
function common(req,tenantId){return {pool:db.getPool(),tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',
  sessionId:req.sessionID,hasExplicitTenantPermission:key=>key===service.PERMISSION&&grant(req)};}
function route(label,fn){return async(req,res)=>{try{if(!human(req))throw Object.assign(new Error(),{code:'human_session_required'});
  if(!grant(req))throw Object.assign(new Error(),{code:'permission_denied'});
  const tenantId=await tenantCtx.resolveTenantId(req,{label:`google-ads-post-activation-reconciliation:${label}`});
  return res.json(await fn(common(req,tenantId),req));
 }catch(e){const code=publicCode(e.code);return res.status(status(code)).json({error:code,external_action_taken:false});}};}
router.post('/',limiter,express.json({limit:'2kb'}),route('observe',async(common,req)=>{const body=req.body||{};
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2
    ||!Object.hasOwn(body,'activation_attempt_id')||!Object.hasOwn(body,'invocation_id'))throw Object.assign(new Error(),{code:'validation_failed'});
  return service.reconcile({...common,activationAttemptId:body.activation_attempt_id,invocationId:body.invocation_id,allowLive:true});}));
router.get('/:runId',limiter,route('get',(common,req)=>service.getRun({...common,runId:req.params.runId})));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._publicCode=publicCode;module.exports._limiter=limiter;
