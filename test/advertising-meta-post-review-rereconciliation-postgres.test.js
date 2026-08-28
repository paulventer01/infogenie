'use strict';

const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const db=require('../db');
const {ensureAuthSchema}=require('../services/auth/schema');
const {ensureTenantSchema}=require('../services/tenants/schema');
const {ensureAgentOrchestratorSchema}=require('../services/agent_orchestrator/schema');
const A=require('../services/agent_orchestrator/meta_reconciliation_read_authorizations');
const Review=require('../services/agent_orchestrator/meta_reconciliation_human_review');
const R=require('../services/agent_orchestrator/meta_post_review_rereconciliation');

const suffix=`pr6f4-${Date.now()}-${Math.random().toString(36).slice(2)}`; let fixtureTag=suffix;
const hex=c=>c.repeat(64), digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const adAccountId='act_123456789', accountFingerprint=digest('123456789');
let tenant,user,otherUser,workflow,draft,request,intent,execution,credential,reviewCase,originalAuth,originalRun,ledgerRoot;
const permission=()=>true;
const opts=(x={})=>({tenantId:tenant,actorUserId:user,actorType:'human',hasPermission:permission,
  reviewCaseId:reviewCase,invocationId:`invoke-${fixtureTag}`,...x});

async function seedGraph(p,credentialMetadata={}){
  tenant=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[`PR6F4 ${fixtureTag}`,fixtureTag])).rows[0].id;
  user=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','owner') RETURNING id`,[`${fixtureTag}@test.invalid`])).rows[0].id;
  otherUser=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','other') RETURNING id`,[`other-${fixtureTag}@test.invalid`])).rows[0].id;
  workflow=`wf-${fixtureTag}`;draft=`draft-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_workflows(id,tenant_id,name,created_by_user_id) VALUES($1,$2,$1,$3)`,[workflow,tenant,user]);
  await p.query(`INSERT INTO orchestrator_campaign_drafts(id,tenant_id,workflow_id,contract_hash,idempotency_key)
    VALUES($1,$2,$3,$4,$5)`,[draft,tenant,workflow,hex('9'),`draft-${fixtureTag}`]);
  const approval=(await p.query(`INSERT INTO orchestrator_approvals(tenant_id,workflow_id,gate,content_hash,decision,object_version,approved_platforms)
    VALUES($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]') RETURNING id`,[tenant,workflow,hex('9')])).rows[0].id;
  await p.query(`INSERT INTO orchestrator_campaign_draft_revisions(id,tenant_id,draft_id,revision,contract_json,contract_hash)
    VALUES($1,$2,$3,1,'{}',$4)`,[`rev-${fixtureTag}`,tenant,draft,hex('9')]);
  const pub=`pub-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_publish_approvals(id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
    VALUES($1,$2,$3,1,$4,'{}',$5,$6,$7,now()+interval '1 hour')`,[pub,tenant,draft,hex('9'),approval,user,`pub-${fixtureTag}`]);
  request=`request-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_publish_requests(id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,[request,tenant,draft,pub,approval,hex('9'),hex('3'),user,`req-${fixtureTag}`,hex('8')]);
  const outbox=`out-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_outbox(id,tenant_id,workflow_id,destination,operation,payload,state,idempotency_key)
    VALUES($1,$2,$3,'internal','create_provider_draft','{}','pending',$4)`,[outbox,tenant,workflow,`out-${fixtureTag}`]);
  intent=`intent-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_delivery_intents(id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)`,[intent,tenant,request,draft,pub,approval,outbox,hex('9'),hex('3'),hex('4'),`intent-${fixtureTag}`,user]);
  const attempt=`delivery-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_delivery_attempts(id,tenant_id,intent_id,outbox_id,draft_id,publishing_request_id,attempt_number,generation,claim_token,lease_holder,lease_expires_at,platform,intent_hash,connector,status,contract_version,operation)
    VALUES($1,$2,$3,$4,$5,$6,1,1,$7,'test',now()+interval '5 min','meta',$8,'fake','started','campaign_delivery_v1','create_provider_draft')`,[attempt,tenant,intent,outbox,draft,request,`claim-${fixtureTag}`,hex('4')]);
  credential=`cred-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_tenant_meta_credential_refs(id,tenant_id,platform,environment,status,account_fingerprint,page_id,version,owner_user_id)
    VALUES($1,$2,'meta','sandbox','active',$3,'1122334455667',$4,$5)`,[credential,tenant,
      credentialMetadata.fingerprint||accountFingerprint,credentialMetadata.version||1,credentialMetadata.ownerOther?otherUser:user]);
  const challenge=`challenge-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_provider_challenges(id,tenant_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,phrase_salt,status,idempotency_key,requested_by,expires_at)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16,'open',$17,$18,now()+interval '5 min')`,[challenge,tenant,draft,pub,approval,request,intent,outbox,attempt,credential,hex('9'),hex('3'),hex('4'),hex('8'),hex('7'),hex('6'),`chal-${fixtureTag}`,user]);
  const confirmation=`confirmation-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_provider_confirmations(id,tenant_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,phrase_salt,phrase_digest,status,idempotency_key,requested_by,expires_at)
    VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,$17,$18,'confirmed',$19,$20,now()+interval '2 min')`,[confirmation,tenant,challenge,draft,pub,approval,request,intent,outbox,attempt,credential,hex('9'),hex('3'),hex('4'),hex('8'),hex('7'),hex('6'),hex('5'),`conf-${fixtureTag}`,user]);
  execution=`execution-${fixtureTag}`;
  await p.query(`INSERT INTO orchestrator_campaign_provider_draft_executions(id,tenant_id,confirmation_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,credential_ref_version,account_fingerprint,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,idempotency_key,requested_by)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,1,$13,1,$14,$15,$16,$17,$18,$19,$20)`,[execution,tenant,confirmation,challenge,draft,pub,approval,request,intent,outbox,attempt,credential,accountFingerprint,hex('9'),hex('3'),hex('4'),hex('8'),hex('7'),`exec-${fixtureTag}`,user]);
  const ids={campaign:'campaign-1',adset:'adset-1',creative:'creative-1',ad:'ad-1'};
  for(const [i,kind] of ['campaign','adset','creative','ad'].entries()) await p.query(`INSERT INTO orchestrator_campaign_provider_objects
    (id,tenant_id,execution_id,confirmation_id,attempt_id,publishing_request_id,intent_id,snapshot_hash,account_fingerprint,
     object_kind,provider_object_id,provider_object_id_digest,display_ref,provider_status,sequence_number,
     parent_campaign_digest,parent_adset_digest,parent_creative_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PAUSED',$14,$15,$16,$17)`,[`obj-${kind}-${fixtureTag}`,tenant,execution,
      confirmation,attempt,request,intent,hex('3'),accountFingerprint,kind,ids[kind],digest(ids[kind]),digest(ids[kind]).slice(0,12),i+1,
      kind==='campaign'?null:digest(ids.campaign),kind==='ad'?digest(ids.adset):null,kind==='ad'?digest(ids.creative):null]);
  await p.query(`UPDATE orchestrator_campaign_provider_draft_executions SET status='complete',outcome='complete',objects_created=4,objects_compensated=0,settled_at=now() WHERE tenant_id=$1 AND id=$2`,[tenant,execution]);
}

async function seedReview(p){
  const issued=await A.issue(p,{tenantId:tenant,requestedBy:user,hasPermission:permission,executionId:execution,
    publishingRequestId:request,snapshotHash:hex('3'),intentId:intent,intentHash:hex('4'),credentialRefId:credential,
    credentialRefVersion:1,accountFingerprint,ledgerRootHash:ledgerRoot});
  // The production issuer computes the root; obtain it from the durable authorization.
  originalAuth=issued.authorization_id;
  const authRow=(await p.query(`SELECT * FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND id=$2`,[tenant,originalAuth])).rows[0];
  originalRun=`original-${fixtureTag}`;
  const c=await p.connect();try{await c.query('BEGIN');await A.consumeIntoReconciliationRun(c,{tenantId:tenant,requestedBy:user,hasPermission:permission,authorizationId:originalAuth,invocationId:`original-${fixtureTag}`},{id:originalRun,auditRef:`original-audit-${fixtureTag}`,observingAt:new Date(),observationDeadline:new Date(Date.now()+60000)});await c.query(`UPDATE orchestrator_campaign_reconciliation_runs SET state='failed',classifications=ARRAY['observation_failure'],completed_at=now() WHERE tenant_id=$1 AND id=$2`,[tenant,originalRun]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  let rc=await Review.createOrGet(p,{tenantId:tenant,actorUserId:user,actorType:'human',hasPermission:permission,reconciliationRunId:originalRun});
  rc=await Review.acknowledge(p,{tenantId:tenant,actorUserId:user,actorType:'human',hasPermission:permission,caseId:rc.case_id,decisionId:`ack-${fixtureTag}`,expectedVersion:rc.version,classification:'external_remediation_required',note:'External remediation is ready for verification'});
  rc=await Review.close(p,{tenantId:tenant,actorUserId:user,actorType:'human',hasPermission:permission,caseId:rc.case_id,decisionId:`close-${fixtureTag}`,expectedVersion:rc.version,classification:'external_remediation_required',note:'External remediation is ready for fresh verification'});
  reviewCase=rc.case_id;
}

if(!db.hasDb())test('PR6F-4 production PostgreSQL tests require DATABASE_URL',()=>assert.fail('DATABASE_URL is required; skips are forbidden'));else{
 before(async()=>{await ensureAuthSchema();await ensureTenantSchema();await ensureAgentOrchestratorSchema();await seedGraph(db.getPool());
   // Compute the real ledger root before calling the production issuer.
   const rows=(await db.getPool().query(`SELECT * FROM orchestrator_campaign_provider_objects WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number`,[tenant,execution])).rows;
   ledgerRoot=A.ledgerRoot(rows);
   await seedReview(db.getPool());
 });

 test('failure after production authorization issuance rolls the entire transaction back',async()=>{
  const p=db.getPool();await assert.rejects(R._test.start(p,opts({invocationId:`original-${fixtureTag}`}),new Date()),/unique|duplicate/i);
  const counts=(await p.query(`SELECT
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND purpose='post_review') auths,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id<>$2) runs,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1) attempts,
    (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_post_review_rereconciliation_started') audits`,[tenant,originalRun])).rows[0];
  assert.deepEqual(counts,{auths:0,runs:0,attempts:0,audits:0});
 });

 test('aborted credential rotation lock serializes issuance; concurrent production observation runs exactly once',async()=>{
  const p=db.getPool(),locker=await p.connect();await locker.query('BEGIN');
  await locker.query(`SELECT id FROM orchestrator_tenant_meta_credential_refs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenant,credential]);
  let settled=false,providerGets=0;
  const transport=async({url,method})=>{assert.equal(method,'GET');providerGets+=1;const id=new URL(url).pathname.split('/').pop();
    const bodies={
      'campaign-1':{id:'campaign-1',account_id:'123456789',status:'PAUSED',effective_status:'PAUSED'},
      'adset-1':{id:'adset-1',account_id:'123456789',status:'PAUSED',effective_status:'PAUSED',campaign_id:'campaign-1'},
      'creative-1':{id:'creative-1',account_id:'123456789'},
      'ad-1':{id:'ad-1',account_id:'123456789',status:'PAUSED',effective_status:'PAUSED',campaign_id:'campaign-1',adset_id:'adset-1',creative:{id:'creative-1'}},
    };return{status:200,json:bodies[id]};};
  const credentials=async()=>({accessToken:'test-token-never-persisted',adAccountId});
  const firstPromise=R.rereconcile(p,opts(),{transport,now:()=>new Date().toISOString()},credentials).finally(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(settled,false,'credential metadata lock must block issuance');
  await locker.query('ROLLBACK');locker.release();
  const secondPromise=R.rereconcile(p,opts({invocationId:`concurrent-${fixtureTag}`}),{transport},credentials);
  const [first,replay]=await Promise.all([firstPromise,secondPromise]);
  assert.equal(providerGets,4);assert.equal(first.rereconciliation_attempt_id,replay.rereconciliation_attempt_id);
  assert.equal(first.reconciliation.state,'verified');
  const again=await R.rereconcile(p,opts({invocationId:`replay-${fixtureTag}`}),{transport},credentials);
  assert.equal(again.rereconciliation_attempt_id,first.rereconciliation_attempt_id);assert.equal(providerGets,4);
  const counts=(await p.query(`SELECT
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND purpose='post_review') auths,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id<>$2) runs,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1) attempts`,[tenant,originalRun])).rows[0];
  assert.deepEqual(counts,{auths:1,runs:1,attempts:1});
  await assert.rejects(p.query(`UPDATE orchestrator_campaign_reconciliation_rereconciliation_attempts SET audit_ref='changed' WHERE tenant_id=$1`,[tenant]),/immutable/);
  await assert.rejects(p.query(`DELETE FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1`,[tenant]),/immutable/);
 });

 test('production metadata boundary rejects every frozen credential mismatch without new PR6F-4 state',async()=>{
  const p=db.getPool();const binding={tenantId:tenant,credentialRefId:credential,credentialRefVersion:1,
    credentialOwnerUserId:user,accountFingerprint};
  const before=(await p.query(`SELECT
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND purpose='post_review') auths,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1) runs,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1) attempts,
    (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_post_review_rereconciliation_started') audits`,[tenant])).rows[0];
  const mismatches=[
    {...binding,tenantId:tenant+1000000},
    {...binding,credentialRefId:`wrong-${fixtureTag}`},
    {...binding,credentialRefVersion:2},
    {...binding,credentialOwnerUserId:otherUser},
    {...binding,accountFingerprint:hex('6')},
  ];
  for(const mismatch of mismatches){const c=await p.connect();try{await c.query('BEGIN');await assert.rejects(A.assertCredentialMetadata(c,mismatch),{code:'credential_boundary_mismatch'});await c.query('ROLLBACK');}finally{c.release();}}
  await p.query(`UPDATE orchestrator_tenant_meta_credential_refs SET status='revoked',revoked_at=now() WHERE tenant_id=$1 AND id=$2`,[tenant,credential]);
  const c=await p.connect();try{await c.query('BEGIN');await assert.rejects(A.assertCredentialMetadata(c,binding),{code:'credential_boundary_mismatch'});await c.query('ROLLBACK');}finally{c.release();}
  const after=(await p.query(`SELECT
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND purpose='post_review') auths,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1) runs,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1) attempts,
    (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_post_review_rereconciliation_started') audits`,[tenant])).rows[0];
  assert.deepEqual(after,before);
 });

 test('committed credential revocation racing issuance fails before all PR6F-4 state',async()=>{
  fixtureTag=`${suffix}-revoke-race`;const p=db.getPool();await seedGraph(p);
  ledgerRoot=A.ledgerRoot((await p.query(`SELECT * FROM orchestrator_campaign_provider_objects
    WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number`,[tenant,execution])).rows);
  await seedReview(p);
  const originalBefore=(await p.query(`SELECT row_to_json(x)::text value FROM
    (SELECT status,consumed_at,invocation_id_hash FROM orchestrator_campaign_reconciliation_read_authorizations
     WHERE tenant_id=$1 AND id=$2) x`,[tenant,originalAuth])).rows[0].value;
  const runBefore=(await p.query(`SELECT row_to_json(x)::text value FROM
    (SELECT state,classifications,completed_at FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id=$2) x`,[tenant,originalRun])).rows[0].value;
  const reviewBefore=(await p.query(`SELECT row_to_json(x)::text value FROM
    (SELECT state,classification,version,closed_at FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2) x`,[tenant,reviewCase])).rows[0].value;
  const locker=await p.connect();await locker.query('BEGIN');
  await locker.query(`SELECT id FROM orchestrator_tenant_meta_credential_refs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenant,credential]);
  let settled=false;const waiting=R._test.start(p,opts(),new Date()).finally(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(settled,false);
  await locker.query(`UPDATE orchestrator_tenant_meta_credential_refs SET status='revoked',revoked_at=now()
    WHERE tenant_id=$1 AND id=$2`,[tenant,credential]);await locker.query('COMMIT');locker.release();
  await assert.rejects(waiting,{code:'credential_boundary_mismatch'});
  const counts=(await p.query(`SELECT
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND purpose='post_review') auths,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id<>$2) runs,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1) attempts,
    (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_post_review_rereconciliation_started') audits`,[tenant,originalRun])).rows[0];
  assert.deepEqual(counts,{auths:0,runs:0,attempts:0,audits:0});
  assert.equal((await p.query(`SELECT row_to_json(x)::text value FROM (SELECT status,consumed_at,invocation_id_hash FROM
    orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND id=$2) x`,[tenant,originalAuth])).rows[0].value,originalBefore);
  assert.equal((await p.query(`SELECT row_to_json(x)::text value FROM (SELECT state,classifications,completed_at FROM
    orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id=$2) x`,[tenant,originalRun])).rows[0].value,runBefore);
  assert.equal((await p.query(`SELECT row_to_json(x)::text value FROM (SELECT state,classification,version,closed_at FROM
    orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1 AND id=$2) x`,[tenant,reviewCase])).rows[0].value,reviewBefore);
 });

 for(const [label,metadata] of Object.entries({
  changed_version:{version:2},wrong_owner:{ownerOther:true},wrong_account_fingerprint:{fingerprint:hex('6')},
 })) test(`full production ${label} fixture fails before authorization issuance`,async()=>{
  fixtureTag=`${suffix}-${label}`;const p=db.getPool();await seedGraph(p,metadata);
  ledgerRoot=A.ledgerRoot((await p.query(`SELECT * FROM orchestrator_campaign_provider_objects
    WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number`,[tenant,execution])).rows);await seedReview(p);
  const originalAuthBefore=(await p.query(`SELECT row_to_json(a)::text value FROM orchestrator_campaign_reconciliation_read_authorizations a
    WHERE tenant_id=$1 AND id=$2`,[tenant,originalAuth])).rows[0].value;
  const originalRunBefore=(await p.query(`SELECT row_to_json(r)::text value FROM orchestrator_campaign_reconciliation_runs r
    WHERE tenant_id=$1 AND id=$2`,[tenant,originalRun])).rows[0].value;
  const reviewBefore=(await p.query(`SELECT row_to_json(r)::text value FROM orchestrator_campaign_reconciliation_review_cases r
    WHERE tenant_id=$1 AND id=$2`,[tenant,reviewCase])).rows[0].value;
  await assert.rejects(R._test.start(p,opts(),new Date()),{code:'credential_boundary_mismatch'});
  const counts=(await p.query(`SELECT
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_read_authorizations WHERE tenant_id=$1 AND purpose='post_review') auths,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id<>$2) runs,
    (SELECT count(*)::int FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1) attempts,
    (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_post_review_rereconciliation_started') audits`,[tenant,originalRun])).rows[0];
  assert.deepEqual(counts,{auths:0,runs:0,attempts:0,audits:0});
  assert.equal((await p.query(`SELECT row_to_json(a)::text value FROM orchestrator_campaign_reconciliation_read_authorizations a WHERE tenant_id=$1 AND id=$2`,[tenant,originalAuth])).rows[0].value,originalAuthBefore);
  assert.equal((await p.query(`SELECT row_to_json(r)::text value FROM orchestrator_campaign_reconciliation_runs r WHERE tenant_id=$1 AND id=$2`,[tenant,originalRun])).rows[0].value,originalRunBefore);
  assert.equal((await p.query(`SELECT row_to_json(r)::text value FROM orchestrator_campaign_reconciliation_review_cases r WHERE tenant_id=$1 AND id=$2`,[tenant,reviewCase])).rows[0].value,reviewBefore);
 });
}
