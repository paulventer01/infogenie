'use strict';
const express=require('express'),db=require('../../db'),tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit'),service=require('./optimization_execution'),router=express.Router();
function human(req){const p=String(req?.user?.principalType||req?.user?.principal_type||'').toLowerCase();return !!(req?.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0&&p==='human'&&req.viaApiKey!==true&&req.user.viaApiKey!==true&&req.session&&Number(req.session.userId)===req.user.id&&req.sessionID);}
function grant(req){return !!req?.tenantRole?.permissions?.includes(service.PERMISSION);}
const limiter=createRateLimiter({name:'optimization-executions',windowMs:60_000,max:30,failClosed:true,keyFn:req=>human(req)&&req.tenant?`${req.tenant.id}|${req.user.id}`:null}),fail=code=>{throw Object.assign(new Error(code),{code});};
function identify(req,res,next){if(!human(req))return res.status(401).json({error:'human_session_required'});next();}
function exact(v,allowed,required=allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('validation_failed');}
function status(c){return c==='human_session_required'?401:c==='permission_denied'?403:c==='request_not_found'?404:['source_ineligible','invocation_id_conflict','decision_id_conflict','version_conflict','invalid_transition','creator_approver_conflict'].includes(c)?409:400;}
function route(label,fn){return async(req,res)=>{try{if(!human(req))fail('human_session_required');if(!grant(req))fail('permission_denied');const tenantId=await tenantCtx.resolveTenantId(req,{label:`optimization-executions:${label}`}),common={pool:db.getPool(),tenantId,actorUserId:req.user.id,actorType:'human',principalType:'human',sessionId:req.sessionID,hasExplicitTenantPermission:k=>k===service.PERMISSION&&grant(req)};res.json(await fn(common,req));}catch(e){res.status(status(e.code)).json({error:e.code||'optimization_execution_request_failed'});}};}
const json=express.json({limit:'4kb'});
router.post('/',identify,limiter,json,route('create',(o,r)=>{exact(r.body,['recommendation_set_id','recommendation_id','invocation_id']);return service.createOrGet({...o,recommendationSetId:r.body.recommendation_set_id,recommendationId:r.body.recommendation_id,invocationId:r.body.invocation_id});}));
router.get('/',identify,limiter,route('list',(o,r)=>{if(Object.keys(r.query).some(k=>!['limit','cursor','state'].includes(k)))fail('validation_failed');return service.list({...o,...r.query});}));
router.get('/:requestId',identify,limiter,route('get',(o,r)=>service.get({...o,requestId:r.params.requestId})));
function decision(action){return route(action,(o,r)=>{exact(r.body,['expected_version','decision_id','note'],['expected_version','decision_id']);return service.transition({...o,requestId:r.params.requestId,action,expectedVersion:r.body.expected_version,decisionId:r.body.decision_id,note:r.body.note});});}
router.post('/:requestId/submit',identify,limiter,json,decision('submit'));
router.post('/:requestId/approve',identify,limiter,json,decision('approve'));
router.post('/:requestId/reject',identify,limiter,json,decision('reject'));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._limiter=limiter;
