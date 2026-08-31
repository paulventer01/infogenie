'use strict';
const express=require('express'),db=require('../../db'),tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit'),service=require('./optimization_recommendations'),router=express.Router();
function human(req){const kind=String(req?.user?.principalType||req?.user?.principal_type||'user').toLowerCase();return !!(req?.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0&&req.viaApiKey!==true&&req.user.viaApiKey!==true&&!['api_key','worker','service','service_account','automation','autonomous','agent'].includes(kind)&&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length);}
function grant(req){return !!(req?.tenantRole&&Array.isArray(req.tenantRole.permissions)&&req.tenantRole.permissions.includes(service.PERMISSION));}
const limiter=createRateLimiter({name:'optimization-recommendations',windowMs:60_000,max:30,failClosed:true,keyFn:req=>human(req)&&req.tenant?`${req.tenant.id}|${req.user.id}`:null});
const fail=code=>{throw Object.assign(new Error(code),{code});};
function identify(req,res,next){if(!human(req))return res.status(401).json({error:'human_session_required'});next();}
function status(c){return c==='human_session_required'?401:c==='permission_denied'?403:c==='set_not_found'||c==='monitoring_run_not_found'?404:['source_ineligible','resolved_case_required','case_ineligible','authoritative_binding_mismatch','version_conflict','decision_id_conflict','invalid_transition'].includes(c)?409:400;}
function exact(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('validation_failed');}
function route(label,fn){return async(req,res)=>{try{if(!human(req))fail('human_session_required');if(!grant(req))fail('permission_denied');const tenantId=await tenantCtx.resolveTenantId(req,{label:`optimization-recommendations:${label}`});const common={pool:db.getPool(),tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',sessionId:req.sessionID,hasExplicitTenantPermission:k=>k===service.PERMISSION&&grant(req)};res.json(await fn(common,req));}catch(e){res.status(status(e.code)).json({error:e.code||'optimization_recommendation_request_failed'});}};}
const json=express.json({limit:'4kb'});
router.post('/',identify,limiter,json,route('create',(o,req)=>{exact(req.body,['monitoring_run_id','invocation_id']);return service.createOrGet({...o,monitoringRunId:req.body.monitoring_run_id,invocationId:req.body.invocation_id});}));
router.get('/',identify,limiter,route('list',(o,req)=>{const allowed=['limit','cursor','state'];if(Object.keys(req.query).some(k=>!allowed.includes(k)))fail('validation_failed');return service.list({...o,limit:req.query.limit,cursor:req.query.cursor,state:req.query.state});}));
router.get('/:setId',identify,limiter,route('get',(o,req)=>service.get({...o,setId:req.params.setId})));
function decision(action){return route(action,(o,req)=>{exact(req.body,['expected_version','decision_id','note'],['expected_version','decision_id']);return service.transition({...o,setId:req.params.setId,action,expectedVersion:req.body.expected_version,decisionId:req.body.decision_id,note:req.body.note});});}
router.post('/:setId/submit',identify,limiter,json,decision('submit'));
router.post('/:setId/approve',identify,limiter,json,decision('approve'));
router.post('/:setId/reject',identify,limiter,json,decision('reject'));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._limiter=limiter;
