'use strict';
const express=require('express'),db=require('../../db'),tenantCtx=require('../tenants/context');
const service=require('../security/google_ads_activation_capabilities');
const router=express.Router(),json=express.json({limit:'2kb'});
function human(req){const kind=String(req?.user?.principalType||req?.user?.principal_type||'user').toLowerCase();return !!(req?.user&&Number.isSafeInteger(req.user.id)&&req.user.id>0
 &&req.viaApiKey!==true&&req.user.viaApiKey!==true&&!['api_key','worker','service','service_account','automation','autonomous','agent'].includes(kind)
 &&req.session&&Number(req.session.userId)===req.user.id&&typeof req.sessionID==='string'&&req.sessionID.length);}
const grant=req=>!!(req?.tenantRole&&Array.isArray(req.tenantRole.permissions)&&req.tenantRole.permissions.includes(service.PERMISSION));
const status=code=>code==='human_session_required'?401:code==='permission_denied'?403:code==='capability_expired'?410:
 ['capability_rejected','authority_not_found'].includes(code)?404:['authoritative_binding_mismatch','post_review_reconciliation_required','capability_conflict'].includes(code)?409:400;
async function tx(fn){const c=await db.getPool().connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function exact(body,keys,required=keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(body,k)))throw service._deny('validation_failed');}
function common(req,tenantId){return {tenantId,actorUserId:req.user.id,actorType:'human',principalType:'user',sessionId:req.sessionID,
 hasExplicitTenantPermission:p=>p===service.PERMISSION&&grant(req)};}
function requireUsable(out){if(out.status==='expired')throw service._deny('capability_expired');return out;}
function route(label,fn){return async(req,res)=>{try{if(!human(req))throw service._deny('human_session_required');if(!grant(req))throw service._deny('permission_denied');
 const tenantId=await tenantCtx.resolveTenantId(req,{label:`google-ads-activation-capability:${label}`});const out=await fn(common(req,tenantId),req);
 requireUsable(out);res.status(label==='issue'&&!out.replay?201:200).json(out);
 }catch(e){res.status(status(e.code)).json({error:e.code||'capability_request_failed',external_action_taken:false});}};}
router.post('/',json,route('issue',(base,req)=>{exact(req.body,['reconciliation_run_id','confirmation_id','confirmation','confirmed_at','ttl_ms'],['reconciliation_run_id','confirmation_id','confirmation','confirmed_at']);return tx(c=>service.issue(c,{...base,reconciliationRunId:req.body.reconciliation_run_id,confirmationId:req.body.confirmation_id,confirmation:req.body.confirmation,confirmedAt:req.body.confirmed_at,ttlMs:req.body.ttl_ms}));}));
router.post('/:capabilityId/reserve',json,route('reserve',(base,req)=>{exact(req.body,['reservation_id']);return tx(c=>service.reserve(c,{...base,capabilityId:req.params.capabilityId,reservationId:req.body.reservation_id}));}));
router.post('/:capabilityId/consume',json,route('consume',(base,req)=>{exact(req.body,['reservation_id','invocation_id']);return tx(c=>service.consume(c,{...base,capabilityId:req.params.capabilityId,reservationId:req.body.reservation_id,invocationId:req.body.invocation_id}));}));
router.post('/:capabilityId/revoke',json,route('revoke',(base,req)=>{exact(req.body,[],[]);return tx(c=>service.revoke(c,{...base,capabilityId:req.params.capabilityId}));}));
router.get('/:capabilityId',route('get',(base,req)=>tx(c=>service.get(c,{...base,capabilityId:req.params.capabilityId}))));
module.exports=router;module.exports._human=human;module.exports._grant=grant;module.exports._requireUsable=requireUsable;
