'use strict';

const express = require('express');
const db = require('../../db');
const tenantCtx = require('../tenants/context');
const { createRateLimiter } = require('../security/rate_limit');
const service = require('./delivery_discrepancies');
const router = express.Router();

const limiter = createRateLimiter({ name:'delivery-discrepancies', windowMs:60_000, max:30, failClosed:true,
  keyFn:req => human(req) && req.tenant ? `${req.tenant.id}|${req.user.id}` : null });
function human(req) { const kind=String(req?.user?.principalType||req?.user?.principal_type||'user').toLowerCase();
  return !!(req?.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0&&req.viaApiKey!==true&&req.user.viaApiKey!==true
    &&!['api_key','worker','service','service_account','automation','autonomous','agent'].includes(kind)
    &&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length); }
function grant(req) { return !!(req?.tenantRole&&Array.isArray(req.tenantRole.permissions)
  &&req.tenantRole.permissions.includes(service.PERMISSION)); }
function fail(code) { const e=new Error(code);e.code=code;throw e; }
function identify(req,res,next) { if(!human(req))return res.status(401).json({error:'human_session_required'});next(); }
function status(code) { return code==='human_session_required'?401:code==='permission_denied'?403:
  code==='case_not_found'||code==='monitoring_run_not_found'?404:
  ['source_ineligible','authoritative_binding_mismatch','version_conflict','decision_id_conflict','invalid_transition'].includes(code)?409:400; }
function route(label,fn) { return async(req,res)=>{try{
  if(!human(req))fail('human_session_required');if(!grant(req))fail('permission_denied');
  const tenantId=await tenantCtx.resolveTenantId(req,{label:`delivery-discrepancies:${label}`});
  const common={pool:db.getPool(),tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',sessionId:req.sessionID,
    hasExplicitTenantPermission:key=>key===service.PERMISSION&&grant(req)};
  res.json(await fn(common,req));
}catch(e){res.status(status(e.code)).json({error:e.code||'delivery_discrepancy_request_failed'});} }; }
const json=express.json({limit:'4kb'});
function exact(body,allowed,required=allowed) { if(!body||typeof body!=='object'||Array.isArray(body)
  ||Object.keys(body).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(body,k)))fail('validation_failed'); }

router.post('/',identify,limiter,json,route('create',(common,req)=>{exact(req.body,['monitoring_run_id']);
  return service.createOrGet({...common,monitoringRunId:req.body.monitoring_run_id});}));
router.get('/',identify,limiter,route('list',(common,req)=>{const allowed=['limit','cursor','state'];
  if(Object.keys(req.query).some(k=>!allowed.includes(k)))fail('validation_failed');
  return service.list({...common,limit:req.query.limit,cursor:req.query.cursor,state:req.query.state});}));
router.get('/:caseId',identify,limiter,route('get',(common,req)=>service.get({...common,caseId:req.params.caseId})));
function decision(action){return route(action,(common,req)=>{const allowed=action==='acknowledge'?['expected_version','decision_id','note']:['expected_version','decision_id','classification','note'];
    exact(req.body,allowed,action==='acknowledge'?['expected_version','decision_id']:['expected_version','decision_id','classification']);
    return service.transition({...common,caseId:req.params.caseId,action,expectedVersion:req.body.expected_version,
      decisionId:req.body.decision_id,classification:req.body.classification,note:req.body.note});});}
router.post('/:caseId/acknowledge',identify,limiter,json,decision('acknowledge'));
router.post('/:caseId/escalate',identify,limiter,json,decision('escalate'));
router.post('/:caseId/resolve',identify,limiter,json,decision('resolve'));

module.exports=router;
module.exports._human=human;module.exports._grant=grant;module.exports._limiter=limiter;
