'use strict';

const crypto = require('crypto');
const auth = require('./meta_reconciliation_read_authorizations');

const STATES = Object.freeze(['pending', 'observing', 'verified', 'discrepancy_detected', 'failed']);
const TERMINAL_STATES = Object.freeze(['verified', 'discrepancy_detected', 'failed']);
const KINDS = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const OBSERVATION_LEASE_MS = 30 * 1000;

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function fail(code) { const e = new Error(code); e.code = code; e.blocked = true; e.external_action_taken = false; return e; }
function actor(opts) {
  if (!Number.isSafeInteger(opts.requestedBy) || opts.requestedBy < 1) throw fail('authentication_required');
  if (typeof opts.hasPermission !== 'function' || opts.hasPermission(auth.PERMISSION) !== true) throw fail('permission_denied');
}
function safeObservation(o) {
  return Object.freeze({
    object_kind: KINDS.includes(o.object_kind) ? o.object_kind : 'unknown',
    outcome: String(o.outcome || 'malformed'),
    status_classification: String(o.status_classification || 'unknown'),
    account_binding_matches: o.account_binding_matches,
    campaign_parent_matches: o.campaign_parent_matches,
    adset_parent_matches: o.adset_parent_matches,
    creative_link_matches: o.creative_link_matches,
    error_classification: o.error_classification ? String(o.error_classification) : undefined,
    observed_at: String(o.observed_at || ''),
  });
}

function evaluate(result) {
  const observations = Array.isArray(result && result.observations) ? result.observations.map(safeObservation) : [];
  if (Number(result && result.attempted_observations) !== 4 || Number(result && result.completed_observations) !== 4
      || observations.length !== 4 || new Set(observations.map((o) => o.object_kind)).size !== 4
      || KINDS.some((kind) => !observations.some((o) => o.object_kind === kind))) {
    return { state: 'failed', classifications: ['partial_observation'], observations };
  }
  const discrepancies = [];
  const failures = [];
  for (const o of observations) {
    if (o.outcome === 'missing') discrepancies.push(`${o.object_kind}_missing`);
    else if (o.outcome !== 'observed') failures.push(`${o.object_kind}_${o.error_classification || o.outcome}`);
    if (o.outcome !== 'observed') continue;
    if (o.account_binding_matches !== true) discrepancies.push(`${o.object_kind}_account_mismatch`);
    if (o.object_kind !== 'creative' && o.status_classification !== 'paused' && o.status_classification !== 'inactive') {
      discrepancies.push(`${o.object_kind}_${o.status_classification === 'active' || o.status_classification === 'delivering' ? o.status_classification : 'unsafe_status'}`);
    }
    if (o.campaign_parent_matches !== 'not_applicable' && o.campaign_parent_matches !== true) discrepancies.push(`${o.object_kind}_campaign_mismatch`);
    if (o.adset_parent_matches !== 'not_applicable' && o.adset_parent_matches !== true) discrepancies.push(`${o.object_kind}_adset_mismatch`);
    if (o.creative_link_matches !== 'not_applicable' && o.creative_link_matches !== true) discrepancies.push(`${o.object_kind}_creative_mismatch`);
  }
  if (failures.length) return { state: 'failed', classifications: [...new Set(failures)].sort(), observations };
  if (discrepancies.length) return { state: 'discrepancy_detected', classifications: [...new Set(discrepancies)].sort(), observations };
  return { state: 'verified', classifications: [], observations };
}

function publicRun(row) {
  return Object.freeze({
    reconciliation_run_id: row.id,
    state: row.state,
    object_kinds: KINDS,
    observations: Array.isArray(row.observations) ? row.observations.map(safeObservation) : [],
    discrepancy_classifications: row.state === 'discrepancy_detected' ? (row.classifications || []) : [],
    failure_classifications: row.state === 'failed' ? (row.classifications || []) : [],
    audit_reference: row.audit_ref,
    created_at: row.created_at,
    completed_at: row.completed_at || null,
  });
}

async function audit(client, row, event) {
  await client.query(`INSERT INTO orchestrator_audit_events
    (tenant_id,workflow_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.tenant_id, row.workflow_id, event, row.requested_by, JSON.stringify({ reconciliation_run_id: row.id, audit_reference: row.audit_ref })]);
}

function assertSameInvocation(row, authorizationId, invocationHash) {
  if (row.authorization_id !== authorizationId || row.invocation_id_hash !== invocationHash) throw fail('idempotency_conflict');
}

async function existingOrRecover(pool, tenantId, authorizationId, invocationHash, now = new Date(), auditImpl = audit) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM orchestrator_campaign_reconciliation_runs
      WHERE tenant_id=$1 AND (authorization_id=$2 OR invocation_id_hash=$3) FOR UPDATE`,
    [tenantId,authorizationId,invocationHash]);
    if (!r.rowCount) { await client.query('COMMIT'); return null; }
    if (r.rowCount !== 1) throw fail('idempotency_conflict');
    let row = r.rows[0]; assertSameInvocation(row,authorizationId,invocationHash);
    if (row.state === 'observing' && new Date(row.observation_deadline) <= now) {
      const recovered = await client.query(`UPDATE orchestrator_campaign_reconciliation_runs
        SET state='failed',classifications=ARRAY['interrupted_observation']::TEXT[],completed_at=$3
        WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,[tenantId,row.id,now]);
      if (recovered.rowCount !== 1) throw fail('invalid_reconciliation_transition');
      row=recovered.rows[0]; await auditImpl(client,row,'meta_paused_draft_reconciliation_failed');
    }
    await client.query('COMMIT'); return publicRun(row);
  } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { client.release(); }
}

async function createObservingRun(pool, opts, tenantId, authorizationId, invocationHash, now, consumeIntoRunImpl = auth.consumeIntoReconciliationRun, auditImpl = audit) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    // consume() locks and revalidates the authorization plus authoritative
    // lineage. Its state changes remain reversible until this transaction also
    // contains the run and initial provenance record.
    const id=`mrr_${crypto.randomUUID()}`; const auditRef=`mrr-audit:${hash(id).slice(0,20)}`;
    const deadline=new Date(now.getTime()+OBSERVATION_LEASE_MS);
    const started=await consumeIntoRunImpl(client,{...opts,now},{id,auditRef,observingAt:now,observationDeadline:deadline});
    await auditImpl(client,started.row,'meta_paused_draft_reconciliation_observing');
    await client.query('COMMIT'); return started;
  } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { client.release(); }
}

async function finishRun(pool, tenantId, id, evaluation, now = new Date(), auditImpl = audit) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const locked=await client.query(`SELECT * FROM orchestrator_campaign_reconciliation_runs
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
    if (locked.rowCount!==1) throw fail('invalid_reconciliation_transition');
    if (TERMINAL_STATES.includes(locked.rows[0].state)) { await client.query('COMMIT'); return publicRun(locked.rows[0]); }
    if (locked.rows[0].state!=='observing') throw fail('invalid_reconciliation_transition');
    const done=await client.query(`UPDATE orchestrator_campaign_reconciliation_runs
      SET state=$3,observations=$4::jsonb,classifications=$5,completed_at=$6
      WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,
    [tenantId,id,evaluation.state,JSON.stringify(evaluation.observations),evaluation.classifications,now]);
    if (done.rowCount!==1) throw fail('invalid_reconciliation_transition');
    await auditImpl(client,done.rows[0],`meta_paused_draft_reconciliation_${evaluation.state}`);
    await client.query('COMMIT'); return publicRun(done.rows[0]);
  } catch (e) { try { await client.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { client.release(); }
}

async function reconcile(pool, opts = {}, observerOptions = {}, getCredentialsImpl) {
  actor(opts);
  const tenantId = Number(opts.tenantId); const authorizationId = String(opts.authorizationId || ''); const invocationId = String(opts.invocationId || '');
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !SAFE_ID.test(authorizationId) || !SAFE_ID.test(invocationId)) throw fail('validation_failed');
  const invocationHash = hash(invocationId);
  const now=opts.now instanceof Date?opts.now:new Date();
  const existing = await existingOrRecover(pool, tenantId, authorizationId, invocationHash, now);
  if (existing) return existing;
  let started;
  try { started=await createObservingRun(pool,opts,tenantId,authorizationId,invocationHash,now); }
  catch (e) { const replay=await existingOrRecover(pool,tenantId,authorizationId,invocationHash,now); if (replay) return replay; throw e; }

  let evaluation;
  try {
    const observed = await auth.observeWithConsumedCredential(pool, started.consumed, observerOptions, getCredentialsImpl);
    evaluation = evaluate(observed);
  } catch (e) {
    evaluation = { state: 'failed', classifications: [e && e.code === 'credential_boundary_mismatch' ? 'credential_boundary_failure' : 'observation_failure'], observations: [] };
  }
  return finishRun(pool,tenantId,started.row.id,evaluation,opts.now instanceof Date?opts.now:new Date());
}

async function getRun(pool, opts = {}) {
  actor(opts); const tenantId = Number(opts.tenantId); const id = String(opts.runId || '');
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !SAFE_ID.test(id)) throw fail('validation_failed');
  const r = await pool.query(`SELECT * FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id=$2`, [tenantId,id]);
  if (r.rowCount !== 1) throw fail('reconciliation_not_found');
  return publicRun(r.rows[0]);
}

module.exports = { STATES, TERMINAL_STATES, KINDS, OBSERVATION_LEASE_MS, evaluate, publicRun, reconcile, getRun,
  _test:{ existingOrRecover,createObservingRun,finishRun } };
