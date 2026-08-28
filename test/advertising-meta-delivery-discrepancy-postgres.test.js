'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureCredentialsSchema } = require('../services/credentials/vault');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');

const TEST_DDL_ADVISORY_LOCK = 87231402;

if (!db.hasDb()) {
  test('PostgreSQL delivery-discrepancy schema skipped — no DATABASE_URL',
    { skip: 'no DATABASE_URL' }, () => {});
} else {
  before(async () => {
    const root = db.getPool();
    const client = await root.connect();
    const originalGetPool = db.getPool;
    const lockedPool = {
      query: client.query.bind(client),
      connect: async () => ({ query: client.query.bind(client), release() {} }),
    };
    await client.query('SELECT pg_advisory_lock($1)', [TEST_DDL_ADVISORY_LOCK]);
    try {
      db.getPool = () => lockedPool;
      await ensureAuthSchema();
      await ensureTenantSchema();
      await ensureCredentialsSchema();
      await ensureAgentOrchestratorSchema();
    } finally {
      db.getPool = originalGetPool;
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [TEST_DDL_ADVISORY_LOCK]);
      } finally {
        client.release();
      }
    }
  });

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
      .replace(/\s+/g, ' ').toLowerCase();
    assert.match(caseGuard, /delete_prohibited/);
    assert.match(caseGuard, /terminal_immutable/);
    assert.match(caseGuard, /new\.version <> old\.version \+ 1/);
    assert.match(caseGuard, /old\.state = 'open'.*acknowledged.*escalated/);
    assert.match(caseGuard, /old\.state = 'acknowledged'.*escalated.*resolved/);
    assert.match(caseGuard, /old\.state = 'escalated'.*resolved/);
    assert.match(caseGuard, /immutable_lineage/);
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
}
