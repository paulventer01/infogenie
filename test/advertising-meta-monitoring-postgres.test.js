'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');

if (!db.hasDb()) {
  test('PostgreSQL Meta monitoring schema skipped — no DATABASE_URL',
    { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
  });

  test('PR7C monitoring persistence has tenant-leading idempotency and lineage constraints', async () => {
    const p = db.getPool();
    const columns = (await p.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='orchestrator_campaign_monitoring_runs'
    `)).rows.map((row) => row.column_name);
    for (const name of ['tenant_id', 'activation_attempt_id', 'invocation_id_hash',
      'capability_id', 'publishing_request_id', 'snapshot_hash', 'intent_id', 'execution_id',
      'reconciliation_run_id', 'credential_ref_id', 'credential_ref_version',
      'account_fingerprint', 'ledger_root_hash', 'observations', 'classifications',
      'failure_classifications', 'observation_deadline', 'completed_at']) {
      assert.ok(columns.includes(name), `missing ${name}`);
    }
    const definitions = (await p.query(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid='orchestrator_campaign_monitoring_runs'::regclass
    `)).rows.map((row) => row.definition).join('\n');
    assert.match(definitions, /UNIQUE \(tenant_id, activation_attempt_id\)/);
    assert.match(definitions, /UNIQUE \(tenant_id, invocation_id_hash\)/);
    assert.match(definitions, /FOREIGN KEY \(tenant_id, activation_attempt_id\)/);
    assert.match(definitions, /FOREIGN KEY \(tenant_id, capability_id\)/);
    assert.match(definitions, /FOREIGN KEY \(tenant_id, reconciliation_run_id\)/);
  });

  test('PR7C lifecycle is bounded and terminal rows are database-immutable', async () => {
    const p = db.getPool();
    const checks = (await p.query(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid='orchestrator_campaign_monitoring_runs'::regclass AND contype='c'
    `)).rows.map((row) => row.definition).join('\n');
    for (const state of ['pending', 'observing', 'verified_active', 'delivery_pending',
      'discrepancy_detected', 'failed']) assert.match(checks, new RegExp(`'${state}'`));
    assert.match(checks, /observation_deadline > started_at/);
    assert.match(checks, /jsonb_typeof\(observations\).*array/);

    const trigger = await p.query(`
      SELECT pg_get_triggerdef(t.oid) AS definition, pg_get_functiondef(t.tgfoid) AS fn
        FROM pg_trigger t
       WHERE t.tgrelid='orchestrator_campaign_monitoring_runs'::regclass
         AND t.tgname='orchestrator_cmr_guard' AND NOT t.tgisinternal
    `);
    assert.equal(trigger.rowCount, 1);
    assert.match(trigger.rows[0].definition, /BEFORE (?:DELETE OR UPDATE|UPDATE OR DELETE)/);
    const guard = trigger.rows[0].fn.replace(/\s+/g, ' ').toLowerCase();
    assert.match(guard, /tg_op\s*=\s*'delete'.*orchestrator_cmr_delete_prohibited/);
    assert.match(guard, /old\.state.*verified_active.*delivery_pending.*discrepancy_detected.*failed.*orchestrator_cmr_terminal_immutable/);
    assert.match(guard, /if not.*old\.state\s*=\s*'pending'.*new\.state\s*=\s*'observing'/);
    assert.match(guard, /old\.state\s*=\s*'observing'.*verified_active.*delivery_pending.*discrepancy_detected.*failed/);
    assert.match(guard, /orchestrator_cmr_immutable_binding/);
    assert.match(guard, /orchestrator_cmr_invalid_transition/);
  });

  test('PR7C monitoring rows support explicit PostgreSQL row locking', async () => {
    const c = await db.getPool().connect();
    try {
      await c.query('BEGIN');
      // The production create/recovery path uses this tenant-leading lock shape.
      await c.query(`SELECT id FROM orchestrator_campaign_monitoring_runs
        WHERE tenant_id=$1 AND activation_attempt_id=$2 FOR UPDATE`, [-2147483648, 'absent']);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
}
