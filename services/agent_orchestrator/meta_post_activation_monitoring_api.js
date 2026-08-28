'use strict';
const express=require('express');
const db=require('../../db');
const tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit');
const service=require('./meta_post_activation_monitoring');
const router=express.Router();
const limiter=createRateLimiter({name:'meta-delivery-monitoring',windowMs:60_000,max:20,failClosed:true,
  keyFn:req=>req&&req.user&&req.tenant?`${req.tenant.id}|${req.user.id}`:null});
function human(req){return !!(req&&req.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0&&req.viaApiKey!==true
  &&req.user.viaApiKey!==true&&!['api_key','worker','service','autonomous','agent'].includes(String(req.user.principalType||req.user.principal_type||'').toLowerCase())
  &&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length);}
function grant(req){return !!(req&&req.tenantRole&&Array.isArray(req.tenantRole.permissions)&&req.tenantRole.permissions.includes(service.PERMISSION));}
function status(code){return code==='human_session_required'?401:code==='permission_denied'?403:
  code==='activation_attempt_not_found'||code==='monitoring_run_not_found'?404:
  code==='activation_attempt_ineligible'||code==='authoritative_binding_mismatch'||code==='idempotency_conflict'?409:400;}
function route(label,fn){return async(req,res)=>{try{if(!human(req))throw Object.assign(new Error(),{code:'human_session_required'});if(!grant(req))throw Object.assign(new Error(),{code:'permission_denied'});
  const tenantId=await tenantCtx.resolveTenantId(req,{label:`meta-delivery-monitoring:${label}`});
  const common={pool:db.getPool(),tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',sessionId:req.sessionID,
    hasExplicitTenantPermission:key=>key===service.PERMISSION&&grant(req)};return res.json(await fn(common,req));
  }catch(e){return res.status(status(e.code)).json({error:e.code||'monitoring_request_failed'});}};}
router.post('/',limiter,express.json({limit:'2kb'}),route('observe',async(common,req)=>{const body=req.body||{};
  if(Object.keys(body).length!==2||!Object.hasOwn(body,'activation_attempt_id')||!Object.hasOwn(body,'invocation_id'))throw Object.assign(new Error(),{code:'validation_failed'});
  return service.observe({...common,activationAttemptId:body.activation_attempt_id,invocationId:body.invocation_id});}));
router.get('/:runId',limiter,route('get',(common,req)=>service.getRun({...common,runId:req.params.runId})));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._limiter=limiter;
