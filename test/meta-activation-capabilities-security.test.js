'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const capability=require('../services/security/meta_activation_capabilities');
const {SYSTEM_ROLES,listPermissions}=require('../services/tenants/permissions');

function base(overrides={}) { return {tenantId:1,actorUserId:7,actorType:'human',principalType:'user',sessionId:'session-1',
  hasExplicitTenantPermission:(key)=>key===capability.PERMISSION,capabilityId:'mac_1',reservationId:'reservation-1',...overrides}; }

test('activation permission exists but no owner/admin system role inherits it',()=>{
  assert.ok(listPermissions().some((item)=>item.key===capability.PERMISSION));
  for(const role of SYSTEM_ROLES.filter((item)=>/owner|admin/.test(item.key))) assert.ok(!role.permissions.includes(capability.PERMISSION),role.key);
});

test('rejects non-human, sessionless, wildcard and ordinary permission evaluators before SQL',async()=>{
  for(const opts of [base({actorType:'worker'}),base({principalType:'api_key'}),base({sessionId:null}),
    base({hasExplicitTenantPermission:undefined}),base({hasExplicitTenantPermission:()=>false}),base({hasPermission:()=>true,hasExplicitTenantPermission:undefined})]) {
    await assert.rejects(capability.reserve({query:()=>assert.fail('SQL reached')},opts),(e)=>e.code==='human_session_required'||e.code==='permission_denied');
  }
});

test('capability implementation has no provider mutation reachability or sensitive audit payload',()=>{
  const source=fs.readFileSync(require.resolve('../services/security/meta_activation_capabilities'),'utf8');
  assert.doesNotMatch(source,/require\([^)]*connector|\b(?:getCredentials|resolveMetaAdsCredentials|withTenantMetaCredential|fetch|axios)\s*\(|\b(?:POST|PATCH|DELETE)\b/i);
  const auditBody=source.slice(source.indexOf('async function audit'),source.indexOf('// Every mutable'));
  assert.doesNotMatch(auditBody,/(?:account_fingerprint|credential_ref|provider_object|token|header|raw_response)/i);
  assert.match(source,/FOR UPDATE OF rr,d,pr,pa,di,ex/);
  assert.match(source,/status='consumed'/); assert.match(source,/status='revoked'/); assert.match(source,/status='expired'/);
});

test('authoritative graph rejects a revoked publish approval while it is locked',async()=>{
  const crypto=require('crypto'); const h=(v)=>crypto.createHash('sha256').update(v).digest('hex');
  const snapshot={a:1}; const snapshotHash=h(JSON.stringify(snapshot));
  const row={id:'run',state:'verified',completed_at:new Date(),platform:'meta',connector:'meta',execution_status:'complete',
    execution_outcome:'complete',objects_created:4,objects_compensated:0,published:false,external_action_taken:true,
    current_revision:1,request_revision:1,execution_revision:1,approval_revoked_at:new Date(),approval_active:true,
    approval_draft_id:'draft',draft_id:'draft',approval_revision:1,approval_workflow_approval_id:2,request_workflow_approval_id:2,
    approval_contract_hash:h('contract'),current_contract_hash:h('contract'),request_contract_hash:h('contract'),
    approval_snapshot_json:snapshot,snapshot_hash:snapshotHash,request_snapshot_hash:snapshotHash,publish_approval_id:'approval',
    execution_publish_approval_id:'approval',intent_hash:h('intent'),current_intent_hash:h('intent')};
  const client={query:async(sql)=>{assert.match(sql,/JOIN orchestrator_campaign_publish_approvals pa/);
    assert.match(sql,/FOR UPDATE OF rr,d,pr,pa,di,ex/); return {rowCount:1,rows:[row]};}};
  await assert.rejects(capability._authoritative(client,1,'run'),(error)=>error.code==='authoritative_binding_mismatch');
});

test('expiry returns a commit-safe denial sentinel instead of throwing after mutation',async()=>{
  const calls=[]; const past=new Date(Date.now()-1000);
  const client={query:async(sql)=>{calls.push(sql);
    if(/SELECT \* FROM orchestrator_campaign_activation_capabilities/.test(sql)) return {rowCount:1,rows:[{
      tenant_id:1,id:'mac_1',actor_user_id:7,session_id_hash:require('crypto').createHash('sha256').update('session-1').digest('hex'),
      status:'issued',expires_at:past,reconciliation_run_id:'run-1'}]};
    if(/SELECT workflow_id FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:1,rows:[{workflow_id:'wf'}]};
    return {rowCount:1,rows:[]};}};
  const result=await capability.reserve(client,base());
  assert.deepEqual(result,{expired:true,capability_id:'mac_1',error:'capability_expired',external_action_taken:false});
  assert.ok(calls.some((sql)=>/SET status='expired'/.test(sql)));
  assert.ok(calls.some((sql)=>/INSERT INTO orchestrator_audit_events/.test(sql)));
  assert.ok(!calls.some((sql)=>/SET status='reserved'/.test(sql)));
});

test('expiry refuses to mutate when tenant-bound workflow provenance is missing',async()=>{
  const h=require('crypto').createHash('sha256').update('session-1').digest('hex'); const calls=[];
  const client={query:async(sql)=>{calls.push(sql);
    if(/SELECT \* FROM orchestrator_campaign_activation_capabilities/.test(sql)) return {rowCount:1,rows:[{
      id:'mac_1',actor_user_id:7,session_id_hash:h,status:'issued',expires_at:new Date(0),reconciliation_run_id:'run-1'}]};
    if(/SELECT workflow_id FROM orchestrator_campaign_reconciliation_runs/.test(sql)) return {rowCount:0,rows:[]};
    return {rowCount:1,rows:[]};}};
  await assert.rejects(capability.reserve(client,base()),(error)=>error.code==='capability_rejected');
  assert.ok(!calls.some((sql)=>/SET status='expired'/.test(sql)));
});

test('issue rejects an advertising account that does not derive the authoritative fingerprint',async()=>{
  const crypto=require('crypto'); const h=(v)=>crypto.createHash('sha256').update(v).digest('hex');
  const now=new Date(); const row={id:'run',state:'verified',completed_at:now,platform:'meta',connector:'meta',
    execution_status:'complete',execution_outcome:'complete',objects_created:4,objects_compensated:0,published:false,
    external_action_taken:true,current_revision:1,request_revision:1,execution_revision:1,snapshot_hash:h('snapshot'),
    request_snapshot_hash:h('snapshot'),publish_approval_id:'approval',execution_publish_approval_id:'approval',intent_hash:h('intent'),current_intent_hash:h('intent'),
    execution_id:'execution',draft_id:'draft',publishing_request_id:'request',intent_id:'intent-id',
    credential_ref_id:'credential',credential_ref_version:1,account_fingerprint:h('123'),ledger_root_hash:h('ledger'),workflow_id:'wf'};
  const client={query:async(sql)=>/FROM orchestrator_campaign_reconciliation_runs/.test(sql)?{rowCount:1,rows:[row]}:
    /FROM orchestrator_campaign_reconciliation_review_cases/.test(sql)?{rowCount:0,rows:[]}:{rowCount:1,rows:[]}};
  const opts={...base(),reconciliationRunId:'run',draftId:'draft',draftRevision:1,snapshotHash:h('snapshot'),
    publishApprovalId:'approval',publishingRequestId:'request',intentId:'intent-id',executionId:'execution',
    credentialRefId:'credential',credentialRefVersion:1,accountFingerprint:h('123'),ledgerRootHash:h('ledger'),
    advertisingAccountId:'act_999',finalConfirmationId:'confirm-1',finalConfirmation:capability.CONFIRMATION,
    confirmedAt:now,now};
  await assert.rejects(capability.issue(client,opts),(error)=>error.code==='authoritative_binding_mismatch');
});
