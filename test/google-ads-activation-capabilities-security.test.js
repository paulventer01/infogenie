'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const service=require('../services/security/google_ads_activation_capabilities');
const api=require('../services/agent_orchestrator/google_ads_activation_capabilities_api');
const opts=(x={})=>({tenantId:1,actorUserId:7,actorType:'human',principalType:'user',sessionId:'real-session',
 hasExplicitTenantPermission:p=>p===service.PERMISSION,...x});
test('Google activation authority requires a real human and exact database grant',()=>{
 assert.equal(service.PERMISSION,'advertising.campaign.activate');
 for(const x of [{actorType:'agent'},{principalType:'api_key'},{sessionId:''},{hasExplicitTenantPermission:()=>false}])
  assert.throws(()=>service._human(opts(x)),e=>['human_session_required','permission_denied'].includes(e.code));
 assert.equal(api._human({user:{id:7},session:{userId:7},sessionID:'sid'}),true);
 assert.equal(api._human({user:{id:7},session:{userId:7},sessionID:'sid',viaApiKey:true}),false);
 assert.equal(api._grant({tenantRole:{permissions:['advertising.campaign.activate']}}),true);
});
test('service has no Google transport, vault, automatic behavior, provider write or secret projection',()=>{
 const source=fs.readFileSync(require.resolve('../services/security/google_ads_activation_capabilities'),'utf8');
 assert.doesNotMatch(source,/require\([^)]*(vault|connector|googleapis)|fetch\s*\(|axios|setInterval|setTimeout|scheduler|queue|retry/i);
 assert.doesNotMatch(source,/provider_object_id|customer_id|access_token|refresh_token|client_secret/i);
 assert.match(source,/external_action_taken:false/);
 assert.match(source,/FOR UPDATE OF run,a,op,d,pr,pa,di,cred,t,tu,role,g,k/);
 assert.match(source,/newer\.rowCount/);
 assert.match(source,/post_review_reconciliation_required/);
 assert.match(source,/SAVEPOINT google_ads_activation_issue/);
 assert.match(source,/ROLLBACK TO SAVEPOINT google_ads_activation_issue/);
 assert.match(source,/pa\.revoked_at AS approval_revoked_at/);
});
test('uniqueness races replay only the identically bound durable winner',async()=>{
 const crypto=require('node:crypto'),sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
 const x={tenant_id:1,id:'run_1',state:'verified',completed_at:new Date(),created_at:new Date(),external_action_taken:true,object_count:3,
  workflow_id:'wf_1',draft_id:'draft_1',draft_revision:2,current_revision:2,draft_status:'approved_for_publish',contract_hash:'contract',
  publishing_request_id:'request_1',request_revision:2,request_contract_hash:'contract',publish_approval_id:'approval_1',request_approval_id:'approval_1',
  workflow_approval_id:9,request_workflow_approval_id:9,approval_revision:2,approval_contract_hash:'contract',approval_active:true,approval_expires_at:new Date(Date.now()+600000),
  snapshot_hash:'snapshot',intent_id:'intent_1',intent_hash:'intent',current_intent_hash:'intent',operation_id:'operation_1',authorization_id:'auth_1',
  credential_owner_user_id:7,owner_user_id:7,credential_ref_id:'credential_1',credential_ref_version:4,current_credential_version:4,
  credential_status:'active',account_fingerprint:'fingerprint',ledger_root_hash:'ledger'};
 const confirmedAt=new Date(),confirmationHash=sha(`1|7|real-session|confirm_1|${service.CONFIRMATION}|${confirmedAt.toISOString()}`);
 const winner={...x,id:'gaac_winner',reconciliation_run_id:x.id,source_authorization_id:x.authorization_id,actor_user_id:7,
  session_id_hash:sha('real-session'),confirmation_hash:confirmationHash,status:'issued',issued_at:new Date(),expires_at:new Date(Date.now()+60000)};
 let dbNow=new Date(confirmedAt),priorExists=false;const client={query:async sql=>{
  if(sql.startsWith('SELECT operation_id FROM'))return {rowCount:1,rows:[{operation_id:x.operation_id}]};
  if(sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return {rowCount:1,rows:[{id:x.operation_id}]};
  if(sql.startsWith('SELECT run.*'))return {rowCount:1,rows:[x]};
  if(sql.startsWith('SELECT id,state,version'))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT 1 FROM orchestrator_google_ads_reconciliation_runs'))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT clock_timestamp()'))return {rows:[{now:dbNow}]};
  if(sql.includes('confirmation_hash=$2 FOR UPDATE'))return priorExists?{rowCount:1,rows:[winner]}:{rowCount:0,rows:[]};
  if(sql.startsWith(`INSERT INTO ${service.TABLE||'orchestrator_google_ads_activation_capabilities'}`)){const e=new Error('race');e.code='23505';throw e;}
  if(sql.includes('(confirmation_hash=$2 OR reconciliation_run_id=$3)'))return {rowCount:1,rows:[winner]};
  return {rowCount:0,rows:[]};
 }};
 const input={...opts(),reconciliationRunId:x.id,confirmationId:'confirm_1',confirmation:service.CONFIRMATION,confirmedAt:confirmedAt.toISOString()};
 const replay=await service.issue(client,input);assert.equal(replay.capability_id,'gaac_winner');assert.equal(replay.replay,true);
 winner.confirmation_hash=sha('conflicting-binding');
 await assert.rejects(service.issue(client,input),{code:'capability_conflict'});
 winner.confirmation_hash=confirmationHash;
 priorExists=true;
 dbNow=new Date(confirmedAt.getTime()+service.MAX_CONFIRMATION_AGE_MS+1);
 assert.equal((await service.issue(client,input)).capability_id,'gaac_winner');
 client.query=async sql=>{if(sql.startsWith('SELECT operation_id FROM'))return {rowCount:1,rows:[{operation_id:x.operation_id}]};
  if(sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return {rowCount:1,rows:[{id:x.operation_id}]};
  if(sql.startsWith('SELECT run.*'))return {rowCount:1,rows:[x]};if(sql.startsWith('SELECT id,state,version')||sql.startsWith('SELECT 1 FROM orchestrator_google_ads_reconciliation_runs'))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT clock_timestamp()'))return {rows:[{now:dbNow}]};if(sql.includes('confirmation_hash=$2 FOR UPDATE'))return {rowCount:0,rows:[]};return {rowCount:0,rows:[]};};
 await assert.rejects(service.issue(client,{...input,confirmationId:'new_confirm'}),{code:'fresh_confirmation_required'});
});
test('issuance replay durably expires a stale winner and API reports expiry',async()=>{
 const crypto=require('node:crypto'),sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
 const x={tenant_id:1,id:'run_1',state:'verified',completed_at:new Date(),created_at:new Date(),external_action_taken:true,object_count:3,
  workflow_id:'wf',draft_id:'draft',draft_revision:1,current_revision:1,draft_status:'approved_for_publish',contract_hash:'contract',publishing_request_id:'request',
  request_revision:1,request_contract_hash:'contract',publish_approval_id:'approval',request_approval_id:'approval',workflow_approval_id:2,
  request_workflow_approval_id:2,approval_revision:1,approval_contract_hash:'contract',approval_active:true,approval_expires_at:new Date(Date.now()+600000),snapshot_hash:'snapshot',intent_id:'intent',
  intent_hash:'intent-hash',current_intent_hash:'intent-hash',operation_id:'operation',authorization_id:'auth',credential_owner_user_id:7,owner_user_id:7,
  credential_ref_id:'credential',credential_ref_version:1,current_credential_version:1,credential_status:'active',account_fingerprint:'fingerprint',ledger_root_hash:'ledger'};
 const confirmedAt=new Date(),confirmationHash=sha(`1|7|real-session|confirm_1|${service.CONFIRMATION}|${confirmedAt.toISOString()}`),cap={...x,id:'gaac_old',reconciliation_run_id:x.id,
  source_authorization_id:x.authorization_id,actor_user_id:7,session_id_hash:sha('real-session'),confirmation_hash:confirmationHash,status:'issued',
  issued_at:new Date(Date.now()-120000),expires_at:new Date(Date.now()-60000)};
 const statements=[];const client={query:async sql=>{statements.push(sql);
  if(sql.startsWith('SELECT operation_id FROM'))return {rowCount:1,rows:[{operation_id:x.operation_id}]};
  if(sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return {rowCount:1,rows:[{id:x.operation_id}]};
  if(sql.startsWith('SELECT run.*'))return {rowCount:1,rows:[x]};
  if(sql.startsWith('SELECT id,state,version')||sql.startsWith('SELECT 1 FROM orchestrator_google_ads_reconciliation_runs'))return {rowCount:0,rows:[]};
  if(sql.startsWith('SELECT clock_timestamp()'))return {rows:[{now:new Date()}]};if(sql.includes('confirmation_hash=$2 FOR UPDATE'))return {rowCount:1,rows:[cap]};return {rowCount:0,rows:[]};}};
 const out=await service.issue(client,{...opts(),reconciliationRunId:x.id,confirmationId:'confirm_1',confirmation:service.CONFIRMATION,confirmedAt:confirmedAt.toISOString()});
 assert.equal(out.status,'expired');assert.equal(out.replay,true);assert.ok(statements.some(sql=>sql.includes("SET status='expired'")));
 assert.throws(()=>api._requireUsable(out),{code:'capability_expired'});
});
test('issuance requires a valid, timestamp-bound human confirmation',async()=>{
 let authorityCalls=0;const client={query:async()=>{authorityCalls++;throw new Error('authority must not be queried');}};
 const base={...opts(),reconciliationRunId:'run_1',confirmationId:'confirm_1',confirmation:service.CONFIRMATION};
 await assert.rejects(service.issue(client,{...base,confirmedAt:'not-a-date'}),{code:'validation_failed'});
 assert.equal(authorityCalls,0);
 const source=fs.readFileSync(require.resolve('../services/security/google_ads_activation_capabilities'),'utf8');
 assert.match(source,/now-confirmedAt>MAX_CONFIRMATION_AGE_MS/);
 assert.match(source,/confirmedAt>now/);
 assert.match(source,/CONFIRMATION}\|\$\{confirmedAt\.toISOString\(\)}/);
 assert.equal(service.MAX_CONFIRMATION_AGE_MS,5*60*1000);
});
test('revoked approval and transition lock ordering fail closed',async()=>{
 const source=fs.readFileSync(require.resolve('../services/security/google_ads_activation_capabilities'),'utf8');
 const locked=source.slice(source.indexOf('async function locked'),source.indexOf('async function reserve'));
 assert.ok(locked.indexOf('const authority=await authoritative')<locked.indexOf(`SELECT * FROM \${TABLE}`));
 const authoritative=source.slice(source.indexOf('async function authoritative'),source.indexOf('function bound'));
 assert.ok(authoritative.indexOf('orchestrator_google_ads_provider_draft_operations')<authoritative.indexOf('SELECT run.*'));
 const revoked={id:'run',tenant_id:1,state:'verified',completed_at:new Date(),created_at:new Date(),external_action_taken:true,object_count:3,
  draft_status:'approved_for_publish',current_revision:1,draft_revision:1,request_revision:1,approval_revision:1,contract_hash:'same',
  request_contract_hash:'same',approval_contract_hash:'same',publish_approval_id:'approval',request_approval_id:'approval',workflow_approval_id:1,
  request_workflow_approval_id:1,approval_revoked_at:new Date(),approval_active:true,intent_hash:'intent',current_intent_hash:'intent',
  credential_status:'active',credential_ref_version:1,current_credential_version:1,credential_owner_user_id:7,owner_user_id:7};
 const client={query:async sql=>{if(sql.startsWith('SELECT operation_id FROM'))return {rowCount:1,rows:[{operation_id:'operation'}]};
  if(sql.startsWith('SELECT id FROM orchestrator_google_ads_provider_draft_operations'))return {rowCount:1,rows:[{id:'operation'}]};
  if(sql.startsWith('SELECT run.*'))return {rowCount:1,rows:[revoked]};
  if(sql.startsWith('SELECT id,state,version')||sql.startsWith('SELECT 1 FROM orchestrator_google_ads_reconciliation_runs'))return {rowCount:0,rows:[]};throw new Error(sql);}};
 await assert.rejects(service._authoritative(client,1,7,'run'),{code:'authoritative_binding_mismatch'});
});
test('transitions recheck publishing approval expiry after acquiring all locks',()=>{
 const source=fs.readFileSync(require.resolve('../services/security/google_ads_activation_capabilities'),'utf8');
 assert.match(source,/pa\.expires_at AS approval_expires_at/);
 const locked=source.slice(source.indexOf('async function locked'),source.indexOf('async function reserve'));
 assert.ok(locked.indexOf('SELECT * FROM ${TABLE}')<locked.indexOf('SELECT clock_timestamp() now'));
 assert.ok(locked.indexOf('SELECT clock_timestamp() now')<locked.indexOf('authority.approval_expires_at'));
 assert.match(locked,/new Date\(authority\.approval_expires_at\)>now\)\)throw deny\('authoritative_binding_mismatch'\)/);
});
test('issuance rechecks approval expiry and binds complete review provenance',()=>{
 const source=fs.readFileSync(require.resolve('../services/security/google_ads_activation_capabilities'),'utf8');
 const issue=source.slice(source.indexOf('async function issue'),source.indexOf('async function locked'));
 assert.ok(issue.indexOf('await authoritative')<issue.indexOf('approval_expires_at'));
 assert.ok(issue.indexOf('confirmation_hash=$2 FOR UPDATE')<issue.indexOf('fresh_confirmation_required'));
 for(const field of ['review_case_id','closure_event_id','rereconciliation_attempt_id'])assert.match(source,new RegExp(`\\['${field}','${field}'\\]`));
});
test('terminal metadata replay still revalidates current database authority',async()=>{
 const row={tenant_id:1,id:'gaac_one',actor_user_id:7,session_id_hash:require('node:crypto').createHash('sha256').update('real-session').digest('hex'),
  workflow_id:'wf',reconciliation_run_id:'run',status:'consumed',issued_at:new Date(),expires_at:new Date(Date.now()+1000),consumed_at:new Date()};
 let calls=0;const client={query:async sql=>{calls++;if(/SELECT reconciliation_run_id FROM orchestrator_google_ads_activation_capabilities/.test(sql))return {rowCount:1,rows:[row]};return {rowCount:0,rows:[]};}};
 await assert.rejects(service.get(client,{...opts(),capabilityId:'gaac_one'}),{code:'authority_not_found'});
 assert.equal(calls,2);
});
