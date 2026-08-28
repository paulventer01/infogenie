'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../../db');
const schema = require('../../services/agent_orchestrator/schema');
const capability = require('../../services/security/meta_activation_capabilities');
const activation = require('../../services/agent_orchestrator/meta_campaign_activation');
const { makeFixtures } = require('../helpers');

const H = crypto.createHash('sha256').update('{}').digest('hex');
const LEDGER = 'b'.repeat(64);
const ACCOUNT = '1234567890';
const ACCOUNT_FP = crypto.createHash('sha256').update(ACCOUNT).digest('hex');
const permission = (key) => key === capability.PERMISSION;

async function tx(fn) {
  const client = await db.getPool().connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function fixtureQuery(sql, params) {
  const client=await db.getPool().connect();
  try { await client.query("SET session_replication_role='replica'"); return await client.query(sql,params); }
  finally { await client.query("SET session_replication_role='origin'"); client.release(); }
}

test('PostgreSQL capability lifecycle locks, rolls back, and permits only one concurrent consumption', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is mandatory for this zero-skip suite');
  const fx = makeFixtures();
  await fx.ensureSchemas();
  await schema.ensureAgentOrchestratorSchema();
  const tenant = await fx.seedTenant();
  const user = await fx.seedUser({ tenantId: tenant.id, owner: false });
  const suffix = crypto.randomUUID();
  const ids = Object.fromEntries(['workflow','draft','approval','request','intent','execution','reconciliation','confirmation']
    .map((name) => [name, `${name}-${suffix}`]));
  t.after(async () => {
    const cleanup = await db.getPool().connect();
    try {
      await cleanup.query("SET session_replication_role='replica'");
      await cleanup.query('DELETE FROM orchestrator_audit_events WHERE workflow_id=$1',[ids.workflow]);
      await cleanup.query('DELETE FROM orchestrator_campaign_activation_events WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_campaign_activation_attempts WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_campaign_activation_capabilities WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_campaign_reconciliation_rereconciliation_attempts WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_campaign_reconciliation_review_cases WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_campaign_provider_objects WHERE tenant_id=$1 AND execution_id=$2',[tenant.id,ids.execution]);
      for (const [table,id] of [['orchestrator_campaign_reconciliation_runs',ids.reconciliation],
        ['orchestrator_campaign_provider_draft_executions',ids.execution],['orchestrator_campaign_delivery_intents',ids.intent],
        ['orchestrator_campaign_publish_requests',ids.request],['orchestrator_campaign_drafts',ids.draft]]) {
        await cleanup.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND id=$2`,[tenant.id,id]);
      }
      await cleanup.query('DELETE FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_tenant_meta_credential_refs WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.workflow]);
      await cleanup.query('DELETE FROM tenant_users WHERE tenant_id=$1',[tenant.id]);
      await cleanup.query('DELETE FROM users WHERE id=$1',[user.id]);
      await cleanup.query('DELETE FROM tenants WHERE id=$1',[tenant.id]);
    } finally { await cleanup.query("SET session_replication_role='origin'"); cleanup.release(); }
  });

  // These rows model an already-authorized PR6 chain. FK dependencies outside
  // the authority graph are deliberately bypassed only while arranging the
  // fixture; all lifecycle operations run with normal PostgreSQL enforcement.
  const seed = await db.getPool().connect();
  try {
    await seed.query("SET session_replication_role='replica'");
    await seed.query('INSERT INTO orchestrator_workflows (id,tenant_id,name) VALUES ($1,$2,$3)',
      [ids.workflow,tenant.id,'PR7A PostgreSQL fixture']);
    await seed.query(`INSERT INTO orchestrator_campaign_drafts
      (id,tenant_id,workflow_id,contract_hash,idempotency_key,current_revision)
      VALUES ($1,$2,$3,$4,$5,1)`, [ids.draft,tenant.id,ids.workflow,H,`draft-${suffix}`]);
    await seed.query(`INSERT INTO orchestrator_campaign_publish_approvals
      (id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
      VALUES ($1,$2,$3,1,$4,'{}'::jsonb,1,$5,$6,now()+interval '1 hour')`,
    [ids.approval,tenant.id,ids.draft,H,user.id,`approval-${suffix}`]);
    await seed.query(`INSERT INTO orchestrator_campaign_publish_requests
      (id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
      VALUES ($1,$2,$3,$4,1,1,$5,$5,$6,$7,$5)`, [ids.request,tenant.id,ids.draft,ids.approval,H,user.id,`request-${suffix}`]);
    await seed.query(`INSERT INTO orchestrator_campaign_delivery_intents
      (id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
      VALUES ($1,$2,$3,$4,$5,1,$6,1,$7,$7,$7,$8,$9)`,
    [ids.intent,tenant.id,ids.request,ids.draft,ids.approval,`outbox-${suffix}`,H,`intent-${suffix}`,user.id]);
    await seed.query(`INSERT INTO orchestrator_campaign_provider_draft_executions
      (id,tenant_id,confirmation_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,credential_ref_version,account_fingerprint,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,idempotency_key,requested_by,platform,connector,status,outcome,settled_at,objects_created,objects_compensated,published,external_action_taken)
      VALUES ($1,$2,$3,$4,$5,1,$6,1,$7,$8,$9,$10,$11,2,$12,1,$13,$13,$13,$13,$13,$14,$15,'meta','meta','complete','complete',now(),4,0,false,true)`,
    [ids.execution,tenant.id,ids.confirmation,`challenge-${suffix}`,ids.draft,ids.approval,ids.request,ids.intent,
      `outbox-${suffix}`,`attempt-${suffix}`,`credential-${suffix}`,ACCOUNT_FP,H,`execution-${suffix}`,user.id]);
    await seed.query(`INSERT INTO orchestrator_tenant_meta_credential_refs
      (id,tenant_id,environment,status,account_fingerprint,page_id,version,owner_user_id)
      VALUES ($1,$2,'test','active',$3,'1122334455667',2,$4)`,[`credential-${suffix}`,tenant.id,ACCOUNT_FP,user.id]);
    const providerIds=Object.fromEntries(['campaign','adset','creative','ad'].map((kind)=>[kind,`${kind}_${suffix}`]));
    const providerDigests=Object.fromEntries(Object.entries(providerIds).map(([kind,id])=>[kind,crypto.createHash('sha256').update(id).digest('hex')]));
    for (const [index,kind] of ['campaign','adset','creative','ad'].entries()) {
      const providerId=providerIds[kind], digest=providerDigests[kind];
      await seed.query(`INSERT INTO orchestrator_campaign_provider_objects
        (id,tenant_id,execution_id,confirmation_id,attempt_id,publishing_request_id,intent_id,snapshot_hash,
         account_fingerprint,object_kind,provider_object_id,provider_object_id_digest,display_ref,sequence_number,
         parent_campaign_digest,parent_adset_digest,parent_creative_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [`object-${kind}-${suffix}`,tenant.id,ids.execution,ids.confirmation,`attempt-${suffix}`,ids.request,ids.intent,H,
        ACCOUNT_FP,kind,providerId,digest,digest.slice(0,12),index+1,kind==='campaign'?null:providerDigests.campaign,
        kind==='ad'?providerDigests.adset:null,kind==='ad'?providerDigests.creative:null]);
    }
    await seed.query(`INSERT INTO orchestrator_campaign_reconciliation_runs
      (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,execution_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,audit_ref,state,observing_at,observation_deadline,completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,2,$15,$13,$14,'verified',now()-interval '2 minutes',now()-interval '1 minute',now())`,
    [tenant.id,ids.reconciliation,`auth-${suffix}`,H,user.id,ids.workflow,ids.draft,ids.request,ids.execution,H,
      ids.intent,`credential-${suffix}`,LEDGER,`recon-audit-${suffix}`,ACCOUNT_FP]);
  } finally { await seed.query("SET session_replication_role='origin'"); seed.release(); }

  const base = { tenantId:tenant.id,actorUserId:user.id,actorType:'human',principalType:'user',sessionId:`session-${suffix}`,
    hasExplicitTenantPermission:permission,draftId:ids.draft,draftRevision:1,snapshotHash:H,publishApprovalId:ids.approval,
    publishingRequestId:ids.request,intentId:ids.intent,executionId:ids.execution,reconciliationRunId:ids.reconciliation,
    advertisingAccountId:ACCOUNT,credentialRefId:`credential-${suffix}`,credentialRefVersion:2,
    accountFingerprint:ACCOUNT_FP,ledgerRootHash:LEDGER,finalConfirmationId:ids.confirmation,
    finalConfirmation:capability.CONFIRMATION,confirmedAt:new Date(),ttlMs:300000 };
  const denial = (code) => (error) => error.code === code;

  await assert.rejects(tx((client)=>capability.issue(client,{...base,tenantId:tenant.id+100000})),denial('reconciliation_not_verified'));
  await fixtureQuery("UPDATE orchestrator_campaign_reconciliation_runs SET state='failed' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.reconciliation]);
  await assert.rejects(tx((client)=>capability.issue(client,base)),denial('authoritative_binding_mismatch'));
  await fixtureQuery("UPDATE orchestrator_campaign_reconciliation_runs SET state='verified' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.reconciliation]);
  await fixtureQuery('UPDATE orchestrator_campaign_publish_requests SET snapshot_hash=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.request,'c'.repeat(64)]);
  await assert.rejects(tx((client)=>capability.issue(client,base)),denial('authoritative_binding_mismatch'));
  await fixtureQuery('UPDATE orchestrator_campaign_publish_requests SET snapshot_hash=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.request,H]);
  await assert.rejects(tx((client)=>capability.issue(client,{...base,credentialRefVersion:3})),denial('authoritative_binding_mismatch'));
  await assert.rejects(tx((client)=>capability.issue(client,{...base,confirmedAt:new Date(Date.now()-capability.MAX_CONFIRMATION_AGE_MS-1)})),denial('fresh_confirmation_required'));

  const reviewId=`review-${suffix}`;
  const fixture=await db.getPool().connect();
  try {
    await fixture.query("SET session_replication_role='replica'");
    await fixture.query(`INSERT INTO orchestrator_campaign_reconciliation_review_cases
      (tenant_id,id,reconciliation_run_id,authorization_id,workflow_id,draft_id,publishing_request_id,snapshot_hash,intent_id,intent_hash,execution_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,original_state,original_classifications,original_requested_by,original_created_at,original_completed_at,created_by,audit_ref,state,version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,$11,2,$12,$13,'discrepancy_detected','{}',$14,now(),now(),$14,$15,'open',1)`,
    [tenant.id,reviewId,ids.reconciliation,`auth-${suffix}`,ids.workflow,ids.draft,ids.request,H,ids.intent,ids.execution,`credential-${suffix}`,ACCOUNT_FP,LEDGER,user.id,`review-audit-${suffix}`]);
  } finally { await fixture.query("SET session_replication_role='origin'"); fixture.release(); }
  await assert.rejects(tx((client)=>capability.issue(client,base)),denial('post_review_reconciliation_required'));
  const lineage=await db.getPool().connect();
  try {
    await lineage.query("SET session_replication_role='replica'");
    await lineage.query("UPDATE orchestrator_campaign_reconciliation_review_cases SET state='closed',version=2,closed_at=now() WHERE tenant_id=$1 AND id=$2",[tenant.id,reviewId]);
    await lineage.query(`INSERT INTO orchestrator_campaign_reconciliation_rereconciliation_attempts
      (tenant_id,id,review_case_id,review_version,closure_event_id,original_reconciliation_run_id,original_authorization_id,new_authorization_id,new_reconciliation_run_id,invocation_id_hash,initiated_by,audit_ref)
      VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)`,[tenant.id,`rerecon-${suffix}`,reviewId,1,`old-${suffix}`,`old-auth-${suffix}`,`new-auth-${suffix}`,ids.reconciliation,H,user.id,`rerecon-audit-${suffix}`]);
  } finally { await lineage.query("SET session_replication_role='origin'"); lineage.release(); }
  await assert.rejects(tx((client)=>capability.issue(client,base)),denial('post_review_reconciliation_required'));
  await fixtureQuery('UPDATE orchestrator_campaign_reconciliation_rereconciliation_attempts SET review_version=2 WHERE tenant_id=$1 AND new_reconciliation_run_id=$2',[tenant.id,ids.reconciliation]);
  const issued = await tx((client) => capability.issue(client,base));
  await assert.rejects(db.getPool().query('UPDATE orchestrator_campaign_activation_capabilities SET snapshot_hash=$3 WHERE tenant_id=$1 AND id=$2',[tenant.id,issued.capability_id,'d'.repeat(64)]),/immutable_binding/);
  const audit=await db.getPool().query("SELECT detail FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_activation_capability_issued' AND workflow_id=$2",[tenant.id,ids.workflow]);
  assert.deepEqual(Object.keys(audit.rows.at(-1).detail),['capability_id']);

  const activationCap=await tx((client)=>capability.issue(client,{...base,finalConfirmationId:`activate-${suffix}`,confirmedAt:new Date()}));
  let calls=0;
  const activated=await activation.activate({...base,capabilityId:activationCap.capability_id,invocationId:`activate-invocation-${suffix}`,
    getCredentials:async()=>({accessToken:'test-token',adAccountId:ACCOUNT}),
    transport:async(request)=>{
      calls++;
      if(calls===1){
        const committed=await db.getPool().query(`SELECT c.status,a.state FROM orchestrator_campaign_activation_capabilities c
          JOIN orchestrator_campaign_activation_attempts a ON a.tenant_id=c.tenant_id AND a.capability_id=c.id
          WHERE c.tenant_id=$1 AND c.id=$2`,[tenant.id,activationCap.capability_id]);
        assert.deepEqual(committed.rows[0],{status:'consumed',state:'started'});
      }
      if(request.method==='GET')return {status:200,json:{id:`creative_${suffix}`,account_id:ACCOUNT,status:'PAUSED'}};
      return {status:200,json:{success:true}};
    }});
  assert.equal(activated.state,'activated'); assert.equal(calls,4); assert.equal(activated.object_outcomes.length,4);
  const durable=await db.getPool().query(`SELECT a.state,a.settled_at,count(e.*)::int AS events
    FROM orchestrator_campaign_activation_attempts a JOIN orchestrator_campaign_activation_events e
      ON e.tenant_id=a.tenant_id AND e.attempt_id=a.id WHERE a.tenant_id=$1 AND a.id=$2 GROUP BY a.tenant_id,a.id`,
  [tenant.id,activated.activation_attempt_id]);
  assert.equal(durable.rows[0].state,'activated'); assert.ok(durable.rows[0].settled_at); assert.equal(durable.rows[0].events,8);
  const terminalAudit=await db.getPool().query("SELECT detail FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='meta_activation_activated' AND detail->>'activation_attempt_id'=$2",[tenant.id,activated.activation_attempt_id]);
  assert.equal(terminalAudit.rowCount,1);
  await assert.rejects(activation.activate({...base,capabilityId:activationCap.capability_id,invocationId:`replay-${suffix}`,
    getCredentials:async()=>({accessToken:'never',adAccountId:ACCOUNT}),transport:async()=>assert.fail('replay egress')}),denial('capability_rejected'));

  const ambiguousCap=await tx((client)=>capability.issue(client,{...base,finalConfirmationId:`ambiguous-${suffix}`,confirmedAt:new Date()}));
  const ambiguous=await activation.activate({...base,capabilityId:ambiguousCap.capability_id,invocationId:`ambiguous-invocation-${suffix}`,
    getCredentials:async()=>({accessToken:'test-token',adAccountId:ACCOUNT}),
    transport:async()=>({transportError:'timeout',mayHaveActed:true})});
  assert.equal(ambiguous.state,'outcome_unknown'); assert.equal(ambiguous.object_outcomes[0].outcome,'outcome_unknown');
  const unknown=await db.getPool().query('SELECT state FROM orchestrator_campaign_activation_attempts WHERE tenant_id=$1 AND id=$2',[tenant.id,ambiguous.activation_attempt_id]);
  assert.equal(unknown.rows[0].state,'outcome_unknown');

  await db.getPool().query("UPDATE orchestrator_campaign_publish_approvals SET revoked_at=now(),revoke_reason='operator revoked' WHERE tenant_id=$1 AND id=$2",[tenant.id,ids.approval]);
  await assert.rejects(tx((client)=>capability.reserve(client,{...base,capabilityId:issued.capability_id,reservationId:'revoked-approval'})),denial('authoritative_binding_mismatch'));
  await fixtureQuery('UPDATE orchestrator_campaign_publish_approvals SET revoked_at=NULL,revoke_reason=NULL WHERE tenant_id=$1 AND id=$2',[tenant.id,ids.approval]);

  const revoked=await tx((client)=>capability.issue(client,{...base,finalConfirmationId:`revoke-${suffix}`,confirmedAt:new Date()}));
  await tx((client)=>capability.revoke(client,{...base,capabilityId:revoked.capability_id}));
  await assert.rejects(tx((client)=>capability.reserve(client,{...base,capabilityId:revoked.capability_id,reservationId:'revoked-replay'})),denial('capability_rejected'));
  const expiring=await tx((client)=>capability.issue(client,{...base,finalConfirmationId:`expire-${suffix}`,confirmedAt:new Date(),ttlMs:1}));
  await new Promise((resolve)=>setTimeout(resolve,5));
  const expired=await tx((client)=>capability.reserve(client,{...base,capabilityId:expiring.capability_id,reservationId:'expired'}));
  assert.equal(expired.expired,true);
  await assert.rejects(tx(async (client) => { await capability.reserve(client,{...base,capabilityId:issued.capability_id,reservationId:'rolled-back'}); throw new Error('force rollback'); }),/force rollback/);
  const afterRollback = await db.getPool().query('SELECT status FROM orchestrator_campaign_activation_capabilities WHERE tenant_id=$1 AND id=$2',[tenant.id,issued.capability_id]);
  assert.equal(afterRollback.rows[0].status,'issued');
  await tx((client) => capability.reserve(client,{...base,capabilityId:issued.capability_id,reservationId:'reservation'}));

  const c1=await db.getPool().connect(); const c2=await db.getPool().connect();
  try {
    await c1.query('BEGIN'); await c2.query('BEGIN');
    await capability.consume(c1,{...base,capabilityId:issued.capability_id,reservationId:'reservation',invocationId:'invocation-one'});
    const loser=capability.consume(c2,{...base,capabilityId:issued.capability_id,reservationId:'reservation',invocationId:'invocation-two'});
    await new Promise((resolve)=>setTimeout(resolve,50));
    await c1.query('COMMIT');
    await assert.rejects(loser,(error)=>error.code==='capability_rejected');
    await c2.query('ROLLBACK');
  } finally { c1.release(); c2.release(); }
  const final = await db.getPool().query('SELECT status,invocation_id_hash FROM orchestrator_campaign_activation_capabilities WHERE tenant_id=$1 AND id=$2',[tenant.id,issued.capability_id]);
  assert.equal(final.rows[0].status,'consumed');
  assert.equal(final.rows[0].invocation_id_hash,crypto.createHash('sha256').update('invocation-one').digest('hex'));
});
