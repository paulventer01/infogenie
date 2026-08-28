'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureCredentialsSchema } = require('../services/credentials/vault');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const reconciliation = require('../services/agent_orchestrator/meta_reconciliation_read_authorizations');
const capability = require('../services/security/meta_activation_capabilities');
const discrepancy = require('../services/agent_orchestrator/delivery_discrepancies');
const { sha256Hex } = require('../services/agent_orchestrator/hash');

const TEST_DDL_ADVISORY_LOCK = 87231402;
let schemaBootstrap;

function bootstrapSchemasOnce() {
  if (schemaBootstrap) return schemaBootstrap;
  schemaBootstrap = (async () => {
    const root = db.getPool();
    const client = await root.connect();
    const originalGetPool = db.getPool;
    let poolReplaced = false;
    let lockHeld = false;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [TEST_DDL_ADVISORY_LOCK]);
      lockHeld = true;
      const lockedPool = {
        query: client.query.bind(client),
        connect: async () => ({ query: client.query.bind(client), release() {} }),
      };
      db.getPool = () => lockedPool;
      poolReplaced = true;
      await ensureAuthSchema();
      await ensureTenantSchema();
      await ensureCredentialsSchema();
      await ensureAgentOrchestratorSchema();
    } finally {
      if (poolReplaced) db.getPool = originalGetPool;
      try {
        if (lockHeld) await client.query('SELECT pg_advisory_unlock($1)', [TEST_DDL_ADVISORY_LOCK]);
      } finally {
        client.release();
      }
    }
  })();
  return schemaBootstrap;
}

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const hex = (character) => character.repeat(64);
const permitted = () => true;
const actor = (fixture, extra = {}) => ({ tenantId: fixture.tenant, actorUserId: fixture.user,
  actorType: 'human', principalType: 'user', sessionId: `session-${fixture.tag}`,
  hasExplicitTenantPermission: permitted, pool: db.getPool(), ...extra });
const sourceSnapshot = async (f) => (await db.getPool().query(
  `SELECT row_to_json(m)::text value FROM orchestrator_campaign_monitoring_runs m WHERE tenant_id=$1 AND id=$2`,
  [f.tenant,f.run])).rows[0].value;
const caseEvidence = async (f,id) => (await db.getPool().query(`SELECT c.state,c.version,
  (SELECT count(*)::int FROM orchestrator_campaign_delivery_discrepancy_events e WHERE e.tenant_id=c.tenant_id AND e.case_id=c.id) events,
  (SELECT count(*)::int FROM orchestrator_audit_events a WHERE a.tenant_id=c.tenant_id AND a.detail->>'discrepancy_case_id'=c.id) audits,
  (to_jsonb(c)-ARRAY['state','version','classification','note','updated_at','resolved_at'])::text lineage
  FROM orchestrator_campaign_delivery_discrepancy_cases c WHERE tenant_id=$1 AND id=$2`,[f.tenant,id])).rows[0];

// Build the complete production PR6 -> PR7C graph.  In particular, the ledger
// root, reconciliation, capability and activation rows are produced/advanced
// through the production contracts rather than through surrogate test tables.
async function seedMonitoring(state, label, sharedTag) {
  const p=db.getPool(),fixtureTag=`pr7d-${label}-${crypto.randomUUID()}`,tag=sharedTag||fixtureTag,snapshotHash=sha256Hex({}),intentHash=hex('4');
  const tenant=(await p.query(`INSERT INTO tenants(name,slug,status) VALUES($1,$2,'active') RETURNING id`,[fixtureTag,fixtureTag])).rows[0].id;
  const user=(await p.query(`INSERT INTO users(email,password_hash,name) VALUES($1,'x','operator') RETURNING id`,[`${fixtureTag}@test.invalid`])).rows[0].id;
  const workflow=`wf-${tag}`,draft=`draft-${tag}`,request=`request-${tag}`,intent=`intent-${tag}`,execution=`execution-${tag}`;
  await p.query(`INSERT INTO orchestrator_workflows(id,tenant_id,name,created_by_user_id) VALUES($1,$2,$1,$3)`,[workflow,tenant,user]);
  await p.query(`INSERT INTO orchestrator_campaign_drafts(id,tenant_id,workflow_id,contract_hash,idempotency_key) VALUES($1,$2,$3,$4,$5)`,[draft,tenant,workflow,hex('9'),`draft-${tag}`]);
  const approval=(await p.query(`INSERT INTO orchestrator_approvals(tenant_id,workflow_id,gate,content_hash,decision,object_version,approved_platforms)
    VALUES($1,$2,'campaign_publishing',$3,'approved',1,'["meta"]') RETURNING id`,[tenant,workflow,hex('9')])).rows[0].id;
  await p.query(`INSERT INTO orchestrator_campaign_draft_revisions(id,tenant_id,draft_id,revision,contract_json,contract_hash) VALUES($1,$2,$3,1,'{}',$4)`,[`rev-${tag}`,tenant,draft,hex('9')]);
  const pub=`pub-${tag}`;
  await p.query(`INSERT INTO orchestrator_campaign_publish_approvals(id,tenant_id,draft_id,revision,contract_hash,snapshot_json,workflow_approval_id,actor_user_id,idempotency_key,expires_at)
    VALUES($1,$2,$3,1,$4,'{}',$5,$6,$7,now()+interval '1 hour')`,[pub,tenant,draft,hex('9'),approval,user,`pub-${tag}`]);
  await p.query(`INSERT INTO orchestrator_campaign_publish_requests(id,tenant_id,draft_id,publish_approval_id,workflow_approval_id,revision,contract_hash,snapshot_hash,requested_by,idempotency_key,request_hash)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`,[request,tenant,draft,pub,approval,hex('9'),snapshotHash,user,`req-${tag}`,hex('8')]);
  const outbox=`out-${tag}`;
  await p.query(`INSERT INTO orchestrator_outbox(id,tenant_id,workflow_id,destination,operation,payload,state,idempotency_key) VALUES($1,$2,$3,'internal','create_provider_draft','{}','pending',$4)`,[outbox,tenant,workflow,`out-${tag}`]);
  await p.query(`INSERT INTO orchestrator_campaign_delivery_intents(id,tenant_id,publishing_request_id,draft_id,publish_approval_id,workflow_approval_id,outbox_id,revision,contract_hash,snapshot_hash,intent_hash,idempotency_key,requested_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12)`,[intent,tenant,request,draft,pub,approval,outbox,hex('9'),snapshotHash,intentHash,`intent-${tag}`,user]);
  const delivery=`delivery-${tag}`,credential=`cred-${tag}`,account=hash('123456789');
  await p.query(`INSERT INTO orchestrator_campaign_delivery_attempts(id,tenant_id,intent_id,outbox_id,draft_id,publishing_request_id,attempt_number,generation,claim_token,lease_holder,lease_expires_at,platform,intent_hash,connector,status,contract_version,operation)
    VALUES($1,$2,$3,$4,$5,$6,1,1,$7,'test',now()+interval '5 min','meta',$8,'fake','started','campaign_delivery_v1','create_provider_draft')`,[delivery,tenant,intent,outbox,draft,request,`claim-${tag}`,intentHash]);
  await p.query(`INSERT INTO orchestrator_tenant_meta_credential_refs(id,tenant_id,platform,environment,status,account_fingerprint,page_id,version,owner_user_id) VALUES($1,$2,'meta','sandbox','active',$3,'1122334455667',1,$4)`,[credential,tenant,account,user]);
  const challenge=`challenge-${tag}`,confirmation=`confirmation-${tag}`;
  await p.query(`INSERT INTO orchestrator_campaign_provider_challenges(id,tenant_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,phrase_salt,status,idempotency_key,requested_by,expires_at)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16,'open',$17,$18,now()+interval '5 min')`,[challenge,tenant,draft,pub,approval,request,intent,outbox,delivery,credential,hex('9'),snapshotHash,intentHash,hex('8'),hex('7'),hex('6'),`chal-${tag}`,user]);
  await p.query(`INSERT INTO orchestrator_campaign_provider_confirmations(id,tenant_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,phrase_salt,phrase_digest,status,idempotency_key,requested_by,expires_at)
    VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,1,$12,$13,$14,$15,$16,$17,$18,'confirmed',$19,$20,now()+interval '2 min')`,[confirmation,tenant,challenge,draft,pub,approval,request,intent,outbox,delivery,credential,hex('9'),snapshotHash,intentHash,hex('8'),hex('7'),hex('6'),hex('5'),`conf-${tag}`,user]);
  await p.query(`INSERT INTO orchestrator_campaign_provider_draft_executions(id,tenant_id,confirmation_id,challenge_id,draft_id,revision,publish_approval_id,workflow_approval_id,publishing_request_id,intent_id,outbox_id,attempt_id,credential_ref_id,credential_ref_version,account_fingerprint,generation,contract_hash,snapshot_hash,intent_hash,request_hash,claim_token_hash,idempotency_key,requested_by)
    VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,1,$13,1,$14,$15,$16,$17,$18,$19,$20)`,[execution,tenant,confirmation,challenge,draft,pub,approval,request,intent,outbox,delivery,credential,account,hex('9'),snapshotHash,intentHash,hex('8'),hex('7'),`exec-${tag}`,user]);
  const ids={campaign:'campaign-1',adset:'adset-1',creative:'creative-1',ad:'ad-1'};
  for(const [i,kind] of ['campaign','adset','creative','ad'].entries()) await p.query(`INSERT INTO orchestrator_campaign_provider_objects
    (id,tenant_id,execution_id,confirmation_id,attempt_id,publishing_request_id,intent_id,snapshot_hash,account_fingerprint,object_kind,provider_object_id,provider_object_id_digest,display_ref,sequence_number,parent_campaign_digest,parent_adset_digest,parent_creative_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[`obj-${kind}-${tag}`,tenant,execution,confirmation,delivery,request,intent,snapshotHash,account,kind,ids[kind],hash(ids[kind]),hash(ids[kind]).slice(0,12),i+1,kind==='campaign'?null:hash(ids.campaign),kind==='ad'?hash(ids.adset):null,kind==='ad'?hash(ids.creative):null]);
  await p.query(`UPDATE orchestrator_campaign_provider_draft_executions
    SET status='complete',outcome='complete',settled_at=now(),objects_created=4,objects_compensated=0,external_action_taken=true
    WHERE tenant_id=$1 AND id=$2 AND status='started'`,[tenant,execution]);
  const ledgerRoot=reconciliation.ledgerRoot((await p.query(`SELECT * FROM orchestrator_campaign_provider_objects WHERE tenant_id=$1 AND execution_id=$2 ORDER BY sequence_number`,[tenant,execution])).rows);
  const auth=await reconciliation.issue(p,{tenantId:tenant,requestedBy:user,hasPermission:permitted,executionId:execution,publishingRequestId:request,snapshotHash,intentId:intent,intentHash,credentialRefId:credential,credentialRefVersion:1,accountFingerprint:account,ledgerRootHash:ledgerRoot});
  const recon=`recon-${tag}`,client=await p.connect();
  try{await client.query('BEGIN');await reconciliation.consumeIntoReconciliationRun(client,{tenantId:tenant,requestedBy:user,hasPermission:permitted,authorizationId:auth.authorization_id,invocationId:`recon-${tag}`},{id:recon,auditRef:`recon-audit-${tag}`,observingAt:new Date(Date.now()-2000),observationDeadline:new Date(Date.now()+60000)});await client.query(`UPDATE orchestrator_campaign_reconciliation_runs SET state='verified',completed_at=now() WHERE tenant_id=$1 AND id=$2`,[tenant,recon]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const authoritative=(await p.query(`SELECT rr.workflow_id,rr.draft_id,rr.publishing_request_id,rr.snapshot_hash,rr.intent_id,rr.intent_hash,rr.execution_id,
    rr.credential_ref_id,rr.credential_ref_version,rr.account_fingerprint,rr.ledger_root_hash,rr.state,ex.status,ex.outcome,ex.platform,ex.connector,
    ex.objects_created,ex.objects_compensated,ex.external_action_taken,pr.publish_approval_id,pa.workflow_approval_id
    FROM orchestrator_campaign_reconciliation_runs rr JOIN orchestrator_campaign_provider_draft_executions ex ON ex.tenant_id=rr.tenant_id AND ex.id=rr.execution_id
    JOIN orchestrator_campaign_publish_requests pr ON pr.tenant_id=rr.tenant_id AND pr.id=rr.publishing_request_id
    JOIN orchestrator_campaign_publish_approvals pa ON pa.tenant_id=pr.tenant_id AND pa.id=pr.publish_approval_id WHERE rr.tenant_id=$1 AND rr.id=$2`,[tenant,recon])).rows[0];
  assert.deepEqual(authoritative,{workflow_id:workflow,draft_id:draft,publishing_request_id:request,snapshot_hash:snapshotHash,intent_id:intent,intent_hash:intentHash,
    execution_id:execution,credential_ref_id:credential,credential_ref_version:1,account_fingerprint:account,ledger_root_hash:ledgerRoot,state:'verified',status:'complete',outcome:'complete',
    platform:'meta',connector:'meta',objects_created:4,objects_compensated:0,external_action_taken:true,publish_approval_id:pub,workflow_approval_id:approval});
  const cap=await (async()=>{const c=await p.connect();try{await c.query('BEGIN');const value=await capability.issue(c,{tenantId:tenant,actorUserId:user,actorType:'human',principalType:'user',sessionId:`session-${tag}`,hasExplicitTenantPermission:permitted,draftId:draft,draftRevision:1,snapshotHash,publishApprovalId:pub,publishingRequestId:request,intentId:intent,executionId:execution,reconciliationRunId:recon,advertisingAccountId:'123456789',credentialRefId:credential,credentialRefVersion:1,accountFingerprint:account,ledgerRootHash:ledgerRoot,finalConfirmationId:`final-${tag}`,finalConfirmation:capability.CONFIRMATION,confirmedAt:new Date(),ttlMs:300000});await capability.reserve(c,{tenantId:tenant,actorUserId:user,actorType:'human',principalType:'user',sessionId:`session-${tag}`,hasExplicitTenantPermission:permitted,capabilityId:value.capability_id,reservationId:`reserve-${tag}`});await capability.consume(c,{tenantId:tenant,actorUserId:user,actorType:'human',principalType:'user',sessionId:`session-${tag}`,hasExplicitTenantPermission:permitted,capabilityId:value.capability_id,reservationId:`reserve-${tag}`,invocationId:`activate-${tag}`});await c.query('COMMIT');return value.capability_id;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}})();
  const attempt=`activation-${tag}`;
  await p.query(`INSERT INTO orchestrator_campaign_activation_attempts(tenant_id,id,capability_id,invocation_id_hash,actor_user_id,session_id_hash,publishing_request_id,snapshot_hash,intent_id,execution_id,reconciliation_run_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,state,audit_ref,settled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,'activated',$15,now())`,[tenant,attempt,cap,hash(`attempt-${tag}`),user,hash(`session-${tag}`),request,snapshotHash,intent,execution,recon,credential,account,ledgerRoot,`activation-audit-${tag}`]);
  const run=`monitor-${tag}`;
  await p.query(`INSERT INTO orchestrator_campaign_monitoring_runs(tenant_id,id,activation_attempt_id,invocation_id_hash,actor_user_id,session_id_hash,capability_id,publishing_request_id,snapshot_hash,intent_id,execution_id,reconciliation_run_id,credential_ref_id,credential_ref_version,account_fingerprint,ledger_root_hash,workflow_id,state,classifications,failure_classifications,audit_ref,observation_deadline,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17,$18,$19,$20,now()+interval '1 minute',CASE WHEN $17 IN ('pending','observing') THEN NULL ELSE now() END)`,[tenant,run,attempt,hash(`monitor-${tag}`),user,hash(`session-${tag}`),cap,request,snapshotHash,intent,execution,recon,credential,account,ledgerRoot,workflow,state,state==='discrepancy_detected'?['unexpected_account']:[],state==='failed'?['read_failure']:[],`monitor-audit-${tag}`]);
  return {tag,tenant,user,run,attempt,cap,request,intent,execution,recon,credential,workflow,ledgerRoot};
}

if (!db.hasDb()) {
  test('PostgreSQL delivery-discrepancy schema skipped — no DATABASE_URL',
    { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(() => bootstrapSchemasOnce());

  test('PR7D persistence uses tenant-leading identities, lineage, and idempotency', async () => {
    const p = db.getPool();
    const caseDefs = (await p.query(`SELECT pg_get_constraintdef(oid) definition
      FROM pg_constraint
      WHERE conrelid='orchestrator_campaign_delivery_discrepancy_cases'::regclass`))
      .rows.map((r) => r.definition).join('\n');
    assert.match(caseDefs, /PRIMARY KEY \(tenant_id, id\)/);
    assert.match(caseDefs, /UNIQUE \(tenant_id, monitoring_run_id\)/);
    for (const parent of ['monitoring_runs', 'activation_attempts', 'activation_capabilities',
      'provider_draft_executions', 'reconciliation_runs']) {
      assert.match(caseDefs, new RegExp(`REFERENCES orchestrator_campaign_${parent}\\(tenant_id, id\\)`));
    }
    for (const state of ['delivery_pending', 'discrepancy_detected', 'failed']) {
      assert.match(caseDefs, new RegExp(`'${state}'`));
    }
    for (const forbidden of ['verified_active', 'pending', 'observing']) {
      const sourceCheck = (await p.query(`SELECT pg_get_constraintdef(oid) definition
        FROM pg_constraint WHERE conrelid='orchestrator_campaign_delivery_discrepancy_cases'::regclass
          AND conname='orchestrator_cddc_source_state_check'`)).rows[0].definition;
      assert.doesNotMatch(sourceCheck, new RegExp(`'${forbidden}'`));
    }

    const eventDefs = (await p.query(`SELECT pg_get_constraintdef(oid) definition
      FROM pg_constraint
      WHERE conrelid='orchestrator_campaign_delivery_discrepancy_events'::regclass`))
      .rows.map((r) => r.definition).join('\n');
    assert.match(eventDefs, /PRIMARY KEY \(tenant_id, id\)/);
    assert.match(eventDefs, /UNIQUE \(tenant_id, case_id, case_version\)/);
    const decisionIndex = await p.query(`SELECT indexdef FROM pg_indexes
      WHERE indexname='orchestrator_cdde_tenant_decision_unique'`);
    assert.match(decisionIndex.rows[0].indexdef,
      /UNIQUE INDEX .*\(tenant_id, decision_id\).*WHERE \(decision_id IS NOT NULL\)/);
  });

  test('PR7D database guards enforce lifecycle, immutable lineage, and append-only events', async () => {
    const p = db.getPool();
    const triggerFns = (await p.query(`
      SELECT t.tgname, pg_get_triggerdef(t.oid) definition, pg_get_functiondef(t.tgfoid) fn
      FROM pg_trigger t
      WHERE t.tgrelid IN (
        'orchestrator_campaign_delivery_discrepancy_cases'::regclass,
        'orchestrator_campaign_delivery_discrepancy_events'::regclass)
        AND NOT t.tgisinternal`)).rows;
    const caseGuard = triggerFns.find((r) => r.tgname === 'orchestrator_cddc_guard').fn
      .toLowerCase().replace(/\s+/g, ' ');
    assert.match(caseGuard, /orchestrator_cddc_delete_prohibited/);
    assert.match(caseGuard, /orchestrator_cddc_terminal_immutable/);
    assert.match(caseGuard, /orchestrator_cddc_immutable_lineage/);
    assert.match(caseGuard,
      /new\.version\s*<>\s*old\.version\s*\+\s*1.*orchestrator_cddc_invalid_version/);
    assert.match(caseGuard,
      /old\.state\s*=\s*'open'\s+and\s+new\.state\s+in\s*\(\s*'acknowledged'\s*,\s*'escalated'\s*\)/);
    assert.match(caseGuard,
      /old\.state\s*=\s*'acknowledged'\s+and\s+new\.state\s+in\s*\(\s*'escalated'\s*,\s*'resolved'\s*\)/);
    assert.match(caseGuard,
      /old\.state\s*=\s*'escalated'\s+and\s+new\.state\s*=\s*'resolved'/);
    assert.match(caseGuard, /orchestrator_cddc_invalid_transition/);
    const eventGuard = triggerFns.find((r) => r.tgname === 'orchestrator_cdde_guard').fn
      .replace(/\s+/g, ' ').toLowerCase();
    assert.match(eventGuard, /append_only/);
    assert.match(eventGuard, /case_mismatch/);
    assert.match(eventGuard, /nonmonotonic/);
    const consistency = triggerFns.find((r) => r.tgname === 'orchestrator_cddc_event_consistency');
    assert.match(consistency.definition, /DEFERRABLE INITIALLY DEFERRED/);
    assert.match(consistency.fn, /orchestrator_cddc_event_required/);
  });

  test('PR7D classifications are bounded and excluded technical claims are absent', async () => {
    const p = db.getPool();
    const checks = (await p.query(`SELECT pg_get_constraintdef(oid) definition
      FROM pg_constraint WHERE conrelid='orchestrator_campaign_delivery_discrepancy_cases'::regclass
        AND contype='c'`)).rows.map((r) => r.definition).join('\n');
    for (const value of ['delivery_confirmed_externally', 'provider_delay_accepted',
      'provider_configuration_required', 'credential_remediation_required',
      'campaign_remediation_required', 'monitoring_failure_accepted', 'false_positive',
      'other_documented_resolution']) assert.match(checks, new RegExp(`'${value}'`));
    for (const value of ['verified_active', 'activated', 'fixed', 'remediated_automatically']) {
      const classification = checks.match(/CHECK \(\(classification[\s\S]*?\)\)\)/)?.[0] || '';
      assert.doesNotMatch(classification, new RegExp(`'${value}'`));
    }
  });

  test('production PR7C eligibility, immutable lineage, idempotent creation and safe projection', async () => {
    for (const state of ['delivery_pending','discrepancy_detected','failed']) {
      const fixture=await seedMonitoring(state,state); const options=actor(fixture,{monitoringRunId:fixture.run});
      const sourceBefore=(await db.getPool().query(`SELECT row_to_json(m)::text value FROM orchestrator_campaign_monitoring_runs m WHERE tenant_id=$1 AND id=$2`,[fixture.tenant,fixture.run])).rows[0].value;
      const first=await discrepancy.createOrGet(options), replay=await discrepancy.createOrGet(options);
      assert.equal(replay.discrepancy_case_id,first.discrepancy_case_id);
      const row=(await db.getPool().query(`SELECT * FROM orchestrator_campaign_delivery_discrepancy_cases WHERE tenant_id=$1 AND id=$2`,[fixture.tenant,first.discrepancy_case_id])).rows[0];
      assert.deepEqual([row.activation_attempt_id,row.capability_id,row.publishing_request_id,row.intent_id,row.execution_id,row.reconciliation_run_id,row.credential_ref_id,row.workflow_id,row.ledger_root_hash],
        [fixture.attempt,fixture.cap,fixture.request,fixture.intent,fixture.execution,fixture.recon,fixture.credential,fixture.workflow,fixture.ledgerRoot]);
      const counts=(await db.getPool().query(`SELECT
        (SELECT count(*)::int FROM orchestrator_campaign_delivery_discrepancy_events WHERE tenant_id=$1 AND case_id=$2) events,
        (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='delivery_discrepancy_created' AND detail->>'discrepancy_case_id'=$2) audits`,[fixture.tenant,first.discrepancy_case_id])).rows[0];
      assert.deepEqual(counts,{events:1,audits:1});
      assert.equal((await db.getPool().query(`SELECT row_to_json(m)::text value FROM orchestrator_campaign_monitoring_runs m WHERE tenant_id=$1 AND id=$2`,[fixture.tenant,fixture.run])).rows[0].value,sourceBefore);
      const exposed=JSON.stringify(first); for(const secret of ['credential_ref','account_fingerprint','ledger_root','snapshot_hash','provider_object']) assert.doesNotMatch(exposed,new RegExp(secret));
    }
    for (const state of ['pending','observing','verified_active']) {
      const fixture=await seedMonitoring(state,`ineligible-${state}`);
      await assert.rejects(discrepancy.createOrGet(actor(fixture,{monitoringRunId:fixture.run})),{code:'source_ineligible'});
      assert.equal((await db.getPool().query(`SELECT count(*)::int n FROM orchestrator_campaign_delivery_discrepancy_cases WHERE tenant_id=$1`,[fixture.tenant])).rows[0].n,0);
    }
  });

  test('real DML enforces lifecycle, versioning, replay, collisions and tenant isolation', async () => {
    const f=await seedMonitoring('failed','lifecycle'),source=await sourceSnapshot(f),created=await discrepancy.createOrGet(actor(f,{monitoringRunId:f.run}));
    let evidence=await caseEvidence(f,created.discrepancy_case_id),lineage=evidence.lineage;
    assert.deepEqual([evidence.state,evidence.version,evidence.events,evidence.audits],['open',1,1,1]);assert.equal(await sourceSnapshot(f),source);
    const acknowledged=await discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'acknowledge',decisionId:'ack',expectedVersion:1,note:'  Human   operator note  '}));
    assert.equal(acknowledged.case_version,2);assert.equal(acknowledged.note,'Human operator note');
    evidence=await caseEvidence(f,created.discrepancy_case_id);assert.deepEqual([evidence.state,evidence.version,evidence.events,evidence.audits,evidence.lineage],['acknowledged',2,2,2,lineage]);assert.equal(await sourceSnapshot(f),source);
    const replay=await discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'acknowledge',decisionId:'ack',expectedVersion:1,note:'  Human   operator note  '}));
    assert.equal(replay.case_version,2);assert.equal(replay.event_history.length,2);assert.deepEqual(await caseEvidence(f,created.discrepancy_case_id),evidence);assert.equal(await sourceSnapshot(f),source);
    await assert.rejects(discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'escalate',decisionId:'ack',expectedVersion:2,classification:'provider_delay_accepted'})),{code:'decision_id_conflict'});
    assert.deepEqual(await caseEvidence(f,created.discrepancy_case_id),evidence);assert.equal(await sourceSnapshot(f),source);
    await assert.rejects(discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'resolve',decisionId:'stale',expectedVersion:1,classification:'false_positive'})),{code:'version_conflict'});
    assert.deepEqual(await caseEvidence(f,created.discrepancy_case_id),evidence);assert.equal(await sourceSnapshot(f),source);
    const escalated=await discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'escalate',decisionId:'escalate',expectedVersion:2,classification:'provider_delay_accepted'}));
    assert.deepEqual([escalated.case_state,escalated.case_version],['escalated',3]);evidence=await caseEvidence(f,created.discrepancy_case_id);assert.deepEqual([evidence.events,evidence.audits,evidence.lineage],[3,3,lineage]);assert.equal(await sourceSnapshot(f),source);
    const resolved=await discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'resolve',decisionId:'resolve',expectedVersion:3,classification:'false_positive'}));
    assert.deepEqual([resolved.case_state,resolved.case_version],['resolved',4]);evidence=await caseEvidence(f,created.discrepancy_case_id);assert.deepEqual([evidence.events,evidence.audits,evidence.lineage],[4,4,lineage]);assert.equal(await sourceSnapshot(f),source);
    await assert.rejects(discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'resolve',decisionId:'again',expectedVersion:4,classification:'false_positive'})),{code:'invalid_transition'});assert.equal(await sourceSnapshot(f),source);
    await assert.rejects(discrepancy.transition(actor(f,{caseId:created.discrepancy_case_id,action:'escalate',decisionId:'secret',expectedVersion:4,classification:'provider_delay_accepted',note:'Authorization: bearer token'})),{code:'unsafe_note'});assert.equal(await sourceSnapshot(f),source);
    const other=await seedMonitoring('failed','other-tenant',f.tag),otherSource=await sourceSnapshot(other);
    const otherCreated=await discrepancy.createOrGet(actor(other,{monitoringRunId:other.run}));
    await discrepancy.transition(actor(other,{caseId:otherCreated.discrepancy_case_id,action:'acknowledge',decisionId:'ack',expectedVersion:1}));
    assert.equal((await discrepancy.list(actor(other))).items[0].discrepancy_case_id,otherCreated.discrepancy_case_id);
    await assert.rejects(discrepancy.get(actor(other,{caseId:created.discrepancy_case_id})),{code:'case_not_found'});
    await assert.rejects(discrepancy.transition(actor(other,{caseId:created.discrepancy_case_id,action:'acknowledge',decisionId:'cross',expectedVersion:1})),{code:'case_not_found'});
    assert.equal(await sourceSnapshot(f),source);assert.equal(await sourceSnapshot(other),otherSource);
    assert.equal((await db.getPool().query(`SELECT count(DISTINCT tenant_id)::int tenants FROM orchestrator_campaign_provider_objects WHERE provider_object_id='campaign-1' AND tenant_id IN ($1,$2)`,[f.tenant,other.tenant])).rows[0].tenants,2);
    assert.equal((await db.getPool().query(`SELECT count(DISTINCT tenant_id)::int tenants FROM orchestrator_campaign_monitoring_runs WHERE id=$3 AND tenant_id IN ($1,$2)`,[f.tenant,other.tenant,f.run])).rows[0].tenants,2);
    assert.equal((await db.getPool().query(`SELECT count(DISTINCT tenant_id)::int tenants FROM orchestrator_campaign_delivery_discrepancy_events WHERE decision_id='ack' AND tenant_id IN ($1,$2)`,[f.tenant,other.tenant])).rows[0].tenants,2);
  });

  test('separate PostgreSQL connections serialize identical and competing decisions', async () => {
    const f=await seedMonitoring('discrepancy_detected','concurrent'),source=await sourceSnapshot(f),created=await discrepancy.createOrGet(actor(f,{monitoringRunId:f.run}));
    const input=actor(f,{caseId:created.discrepancy_case_id,action:'escalate',decisionId:'same',expectedVersion:1,classification:'provider_configuration_required'});
    const [one,two]=await Promise.all([discrepancy.transition(input),discrepancy.transition(input)]);
    assert.equal(one.case_version,2);assert.equal(two.case_version,2);
    let counts=(await db.getPool().query(`SELECT
      (SELECT count(*)::int FROM orchestrator_campaign_delivery_discrepancy_events WHERE tenant_id=$1 AND case_id=$2 AND decision_id='same') events,
      (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='delivery_discrepancy_escalate' AND detail->>'discrepancy_case_id'=$2) audits`,[f.tenant,created.discrepancy_case_id])).rows[0];
    assert.deepEqual(counts,{events:1,audits:1});assert.equal((await discrepancy.transition(input)).case_version,2);assert.equal(await sourceSnapshot(f),source);
    const a=actor(f,{caseId:created.discrepancy_case_id,action:'resolve',decisionId:'winner-a',expectedVersion:2,classification:'false_positive'});
    const b=actor(f,{caseId:created.discrepancy_case_id,action:'resolve',decisionId:'winner-b',expectedVersion:2,classification:'provider_delay_accepted'});
    const settled=await Promise.allSettled([discrepancy.transition(a),discrepancy.transition(b)]);
    assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);assert.equal(settled.filter(x=>x.status==='rejected').length,1);
    counts=(await db.getPool().query(`SELECT
      (SELECT count(*)::int FROM orchestrator_campaign_delivery_discrepancy_events WHERE tenant_id=$1 AND case_id=$2 AND decision_id IN ('winner-a','winner-b')) events,
      (SELECT count(*)::int FROM orchestrator_audit_events WHERE tenant_id=$1 AND event='delivery_discrepancy_resolve' AND detail->>'discrepancy_case_id'=$2) audits`,[f.tenant,created.discrepancy_case_id])).rows[0];
    assert.deepEqual(counts,{events:1,audits:1});assert.equal((await caseEvidence(f,created.discrepancy_case_id)).events,3);assert.equal(await sourceSnapshot(f),source);
  });

  test('real event and audit insertion failures roll back the complete transition', async () => {
    const p=db.getPool(),f=await seedMonitoring('failed','rollback'),source=await sourceSnapshot(f),created=await discrepancy.createOrGet(actor(f,{monitoringRunId:f.run}));
    const input={caseId:created.discrepancy_case_id,action:'escalate',expectedVersion:1,classification:'monitoring_failure_accepted'};
    const snapshot=async()=> (await p.query(`SELECT c.state,c.version,
      (SELECT count(*)::int FROM orchestrator_campaign_delivery_discrepancy_events e WHERE e.tenant_id=c.tenant_id AND e.case_id=c.id) events,
      (SELECT count(*)::int FROM orchestrator_audit_events a WHERE a.tenant_id=c.tenant_id AND a.event LIKE 'delivery_discrepancy_%') audits
      FROM orchestrator_campaign_delivery_discrepancy_cases c WHERE tenant_id=$1 AND id=$2`,[f.tenant,created.discrepancy_case_id])).rows[0];
    const before=await snapshot(),suffix=crypto.randomUUID().replaceAll('-','_');
    const eventFn=`pr7d_reject_event_${suffix}`,auditFn=`pr7d_reject_audit_${suffix}`;
    await p.query(`CREATE FUNCTION ${eventFn}() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN IF NEW.decision_id='fail-event' THEN RAISE EXCEPTION 'injected_event_failure'; END IF; RETURN NEW; END$$`);
    await p.query(`CREATE TRIGGER ${eventFn} BEFORE INSERT ON orchestrator_campaign_delivery_discrepancy_events
      FOR EACH ROW EXECUTE FUNCTION ${eventFn}()`);
    try { await assert.rejects(discrepancy.transition(actor(f,{...input,decisionId:'fail-event'})),/injected_event_failure/); }
    finally { await p.query(`DROP TRIGGER IF EXISTS ${eventFn} ON orchestrator_campaign_delivery_discrepancy_events`);await p.query(`DROP FUNCTION IF EXISTS ${eventFn}()`); }
    assert.deepEqual(await snapshot(),before);assert.equal(await sourceSnapshot(f),source);

    await p.query(`CREATE FUNCTION ${auditFn}() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN IF NEW.event='delivery_discrepancy_escalate' THEN RAISE EXCEPTION 'injected_audit_failure'; END IF; RETURN NEW; END$$`);
    await p.query(`CREATE TRIGGER ${auditFn} BEFORE INSERT ON orchestrator_audit_events FOR EACH ROW EXECUTE FUNCTION ${auditFn}()`);
    try { await assert.rejects(discrepancy.transition(actor(f,{...input,decisionId:'fail-audit'})),/injected_audit_failure/); }
    finally { await p.query(`DROP TRIGGER IF EXISTS ${auditFn} ON orchestrator_audit_events`);await p.query(`DROP FUNCTION IF EXISTS ${auditFn}()`); }
    assert.deepEqual(await snapshot(),before);assert.equal(await sourceSnapshot(f),source);
  });
}
