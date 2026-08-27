'use strict';

const crypto = require('crypto');
const auth = require('./meta_reconciliation_read_authorizations');

const STATES = Object.freeze(['pending', 'observing', 'verified', 'discrepancy_detected', 'failed']);
const TERMINAL_STATES = Object.freeze(['verified', 'discrepancy_detected', 'failed']);
const KINDS = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

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

async function findExisting(pool, tenantId, authorizationId, invocationHash) {
  const r = await pool.query(`SELECT * FROM orchestrator_campaign_reconciliation_runs
    WHERE tenant_id=$1 AND (authorization_id=$2 OR invocation_id_hash=$3)`, [tenantId, authorizationId, invocationHash]);
  if (!r.rowCount) return null;
  if (r.rows.length !== 1 || r.rows[0].authorization_id !== authorizationId || r.rows[0].invocation_id_hash !== invocationHash) throw fail('idempotency_conflict');
  return publicRun(r.rows[0]);
}

async function reconcile(pool, opts = {}, observerOptions = {}, getCredentialsImpl) {
  actor(opts);
  const tenantId = Number(opts.tenantId); const authorizationId = String(opts.authorizationId || ''); const invocationId = String(opts.invocationId || '');
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !SAFE_ID.test(authorizationId) || !SAFE_ID.test(invocationId)) throw fail('validation_failed');
  const invocationHash = hash(invocationId);
  const existing = await findExisting(pool, tenantId, authorizationId, invocationHash);
  if (existing) return existing;
  let consumed;
  try { consumed = await auth.consumeAtomic(pool, opts); }
  catch (e) { throw e; }
  const id = `mrr_${crypto.randomUUID()}`; const auditRef = `mrr-audit:${hash(id).slice(0, 20)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO orchestrator_campaign_reconciliation_runs
      (tenant_id,id,authorization_id,invocation_id_hash,requested_by,workflow_id,draft_id,publishing_request_id,
       execution_id,snapshot_hash,intent_id,intent_hash,credential_ref_id,credential_ref_version,account_fingerprint,
       ledger_root_hash,state,audit_ref) VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17) RETURNING *`,
    [tenantId,id,authorizationId,invocationHash,consumed.requested_by,consumed.workflow_id,consumed.draft_id,
      consumed.publishing_request_id,consumed.execution_id,consumed.snapshot_hash,consumed.intent_id,consumed.intent_hash,
      consumed.credential_ref_id,consumed.credential_ref_version,consumed.account_fingerprint,consumed.ledger_root_hash,auditRef]);
    await audit(client, inserted.rows[0], 'meta_paused_draft_reconciliation_pending');
    await client.query(`UPDATE orchestrator_campaign_reconciliation_runs SET state='observing',observing_at=now() WHERE tenant_id=$1 AND id=$2`, [tenantId,id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    const replay = await findExisting(pool, tenantId, authorizationId, invocationHash);
    if (replay) return replay;
    throw e;
  } finally { client.release(); }

  let evaluation;
  try {
    const observed = await auth.observeWithConsumedCredential(pool, consumed, observerOptions, getCredentialsImpl);
    evaluation = evaluate(observed);
  } catch (e) {
    evaluation = { state: 'failed', classifications: [e && e.code === 'credential_boundary_mismatch' ? 'credential_boundary_failure' : 'observation_failure'], observations: [] };
  }
  const done = await pool.query(`UPDATE orchestrator_campaign_reconciliation_runs
    SET state=$3,observations=$4::jsonb,classifications=$5,completed_at=now()
    WHERE tenant_id=$1 AND id=$2 AND state='observing' RETURNING *`,
  [tenantId,id,evaluation.state,JSON.stringify(evaluation.observations),evaluation.classifications]);
  if (done.rowCount !== 1) throw fail('invalid_reconciliation_transition');
  await audit(pool, done.rows[0], `meta_paused_draft_reconciliation_${evaluation.state}`);
  return publicRun(done.rows[0]);
}

async function getRun(pool, opts = {}) {
  actor(opts); const tenantId = Number(opts.tenantId); const id = String(opts.runId || '');
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !SAFE_ID.test(id)) throw fail('validation_failed');
  const r = await pool.query(`SELECT * FROM orchestrator_campaign_reconciliation_runs WHERE tenant_id=$1 AND id=$2`, [tenantId,id]);
  if (r.rowCount !== 1) throw fail('reconciliation_not_found');
  return publicRun(r.rows[0]);
}

module.exports = { STATES, TERMINAL_STATES, KINDS, evaluate, publicRun, reconcile, getRun };
