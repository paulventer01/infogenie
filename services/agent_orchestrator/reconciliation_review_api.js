'use strict';

const express=require('express');
const db=require('../../db');
const tenantCtx=require('../tenants/context');
const {createRateLimiter}=require('../security/rate_limit');
const review=require('./meta_reconciliation_human_review');
const rereconciliation=require('./meta_post_review_rereconciliation');
const router=express.Router();
const reviewLimiter=createRateLimiter({
  name:'reconciliation-review',windowMs:60_000,max:60,failClosed:true,
  keyFn:(req)=>req&&req.user&&req.tenant?`${req.tenant.id}|${req.user.id}`:null,
});

function status(code){return code==='authentication_required'?401:code==='permission_denied'?403:
  code==='review_case_not_found'||code==='reconciliation_not_found'?404:
  code==='version_conflict'||code==='idempotency_conflict'||code==='concurrent_creation_conflict'
    ||code==='review_case_ineligible'||code==='closure_classification_ineligible'?409:400;}
function isHumanSessionRequest(req){
  return !!(req&&req.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0
    &&req.viaApiKey!==true&&req.user.viaApiKey!==true&&req.session
    &&Number(req.session.userId)===req.user.id);
}
function hasExplicitTenantReviewGrant(req){
  return !!(req&&req.tenant&&req.tenantRole&&Array.isArray(req.tenantRole.permissions)
    &&req.tenantRole.permissions.includes(review.PERMISSION));
}
function reviewAuthorizationError(req){
  if(!isHumanSessionRequest(req)) return 'human_session_required';
  if(!hasExplicitTenantReviewGrant(req)) return 'permission_denied';
  return null;
}
function route(label,fn){return async(req,res)=>{try{
  const authError=reviewAuthorizationError(req);
  if(authError) return res.status(authError==='human_session_required'?401:403).json({ok:false,error:authError});
  const tenantId=await tenantCtx.resolveTenantId(req,{label:`reconciliation-review:${label}`});
  const common={tenantId,actorUserId:req.user.id,actorType:'human',hasPermission:(key)=>key===review.PERMISSION&&hasExplicitTenantReviewGrant(req)};
  const result=await fn(common,req); return res.json({ok:true,...result});
}catch(e){return res.status(status(e.code)).json({ok:false,error:e.code||'review_request_failed'});}};}

router.post('/',reviewLimiter,express.json(),route('create',async(o,req)=>({case:await review.createOrGet(db.getPool(),{
  ...o,reconciliationRunId:req.body&&req.body.reconciliation_run_id})})));
router.get('/',reviewLimiter,route('list',async(o,req)=>review.listCases(db.getPool(),{
  ...o,state:req.query.state,limit:req.query.limit,cursor:req.query.cursor})));
router.get('/:caseId',reviewLimiter,route('get',async(o,req)=>({case:await review.getCase(db.getPool(),{...o,caseId:req.params.caseId})})));
router.post('/:caseId/rereconcile',reviewLimiter,express.json(),route('rereconcile',async(o,req)=>({rereconciliation:await rereconciliation.rereconcile(db.getPool(),{
  tenantId:o.tenantId,actorUserId:o.actorUserId,actorType:o.actorType,hasPermission:o.hasPermission,
  reviewCaseId:req.params.caseId,invocationId:req.body&&req.body.invocation_id,
})})));
for(const [action,method] of [['acknowledge','acknowledge'],['escalate','escalate'],['close','close']]){
  router.post(`/:caseId/${action}`,reviewLimiter,express.json(),route(action,async(o,req)=>({case:await review[method](db.getPool(),{
    ...o,caseId:req.params.caseId,decisionId:req.body&&req.body.decision_id,expectedVersion:req.body&&req.body.expected_version,
    classification:req.body&&req.body.classification,note:req.body&&req.body.note})})));
}
module.exports=router;
module.exports._isHumanSessionRequest=isHumanSessionRequest;
module.exports._hasExplicitTenantReviewGrant=hasExplicitTenantReviewGrant;
module.exports._reviewAuthorizationError=reviewAuthorizationError;
module.exports._reviewLimiter=reviewLimiter;
