'use strict';
const express=require('express');
const db=require('../../db');
const tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit');
const review=require('./google_ads_post_activation_review');
const router=express.Router();
const PUBLIC_ERRORS=new Set(['human_session_required','permission_denied','validation_failed','invalid_note','invalid_disposition',
  'reconciliation_not_found','reconciliation_not_reviewable','reconciliation_evidence_invalid','review_case_not_found',
  'concurrent_creation_conflict','version_conflict','idempotency_conflict','invalid_review_transition']);
function human(req){const kind=String(req?.user?.principalType||req?.user?.principal_type||'user').toLowerCase();return !!(req?.user
  &&Number.isSafeInteger(req.user.id)&&req.user.id>0&&req.viaApiKey!==true&&req.user.viaApiKey!==true
  &&!['api_key','worker','service','service_account','automation','autonomous','agent'].includes(kind)
  &&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length);}
const grant=req=>!!(req?.tenantRole&&Array.isArray(req.tenantRole.permissions)&&req.tenantRole.permissions.includes(review.PERMISSION));
const limiter=createRateLimiter({name:'google-ads-post-activation-review',windowMs:60000,max:30,failClosed:true,
  keyFn:req=>human(req)&&req.tenant?`${req.tenant.id}|${req.user.id}`:null});
const status=code=>code==='human_session_required'?401:code==='permission_denied'?403:
  ['reconciliation_not_found','review_case_not_found'].includes(code)?404:
  ['reconciliation_not_reviewable','reconciliation_evidence_invalid','concurrent_creation_conflict','version_conflict',
    'idempotency_conflict','invalid_review_transition'].includes(code)?409:
  ['validation_failed','invalid_note','invalid_disposition'].includes(code)?400:500;
const publicCode=code=>PUBLIC_ERRORS.has(code)?code:'post_activation_review_request_failed';
function common(req,tenantId){return {pool:db.getPool(),tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',
  sessionId:req.sessionID,hasExplicitTenantPermission:key=>key===review.PERMISSION&&grant(req)};}
function route(label,fn){return async(req,res)=>{try{if(!human(req))throw Object.assign(new Error(),{code:'human_session_required'});
  if(!grant(req))throw Object.assign(new Error(),{code:'permission_denied'});
  const tenantId=await tenantCtx.resolveTenantId(req,{label:`google-ads-post-activation-review:${label}`});
  return res.json(await fn(common(req,tenantId),req));
 }catch(e){const code=publicCode(e.code);return res.status(status(code)).json({error:code,external_action_taken:false});}};}
function exact(body,keys){return !!(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===keys.length
  &&keys.every(key=>Object.hasOwn(body,key)));}
router.post('/',limiter,express.json({limit:'2kb'}),route('create',async(o,req)=>{if(!exact(req.body,['reconciliation_run_id']))
  throw Object.assign(new Error(),{code:'validation_failed'});return review.createOrGet({...o,reconciliationRunId:req.body.reconciliation_run_id});}));
router.get('/',limiter,route('list',(o,req)=>review.listCases({...o,state:req.query.state,limit:req.query.limit,cursor:req.query.cursor})));
router.get('/:caseId',limiter,route('get',(o,req)=>review.getCase({...o,caseId:req.params.caseId})));
for(const action of ['acknowledge','escalate','close'])router.post(`/:caseId/${action}`,limiter,express.json({limit:'2kb'}),route(action,async(o,req)=>{
  if(!exact(req.body,['decision_id','expected_version','disposition','note']))throw Object.assign(new Error(),{code:'validation_failed'});
  return review[action]({...o,caseId:req.params.caseId,decisionId:req.body.decision_id,expectedVersion:req.body.expected_version,
    disposition:req.body.disposition,note:req.body.note});}));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._publicCode=publicCode;
module.exports._exact=exact;module.exports._limiter=limiter;
