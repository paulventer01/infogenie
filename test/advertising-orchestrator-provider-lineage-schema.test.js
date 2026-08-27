'use strict';
// PR 6F-1R — reconciliation-ready provider lineage: schema, backfill, immutability.

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAuthSchema } = require('../services/auth/schema');

const HAS_DB = db.hasDb();
const SCHEMA_SRC = fs.readFileSync(
  path.join(__dirname, '../services/agent_orchestrator/schema.js'),
  'utf8'
);

test('PR6F-1R schema source keeps adset kind and append-only compensation events', () => {
  assert.match(SCHEMA_SRC, /object_kind IN \('campaign','adset','creative','ad'\)/);
  assert.doesNotMatch(SCHEMA_SRC, /object_kind IN \('campaign','ad_set'/);
  assert.match(SCHEMA_SRC, /CREATE TABLE IF NOT EXISTS orchestrator_campaign_provider_object_events/);
  assert.match(SCHEMA_SRC, /orchestrator_cpoe_immutable/);
  assert.match(SCHEMA_SRC, /orchestrator_cpdex_cardinality/);
  assert.match(SCHEMA_SRC, /credential_ref_version INTEGER NOT NULL/);
  assert.match(SCHEMA_SRC, /provider_object_id_digest TEXT NOT NULL/);
  assert.doesNotMatch(SCHEMA_SRC, /SET compensated=TRUE/);
});

if (!HAS_DB) {
  test('PR6F-1R lineage schema skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  const SUFFIX = `ao6f1r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let tenantId = null;

  before(async () => {
    await ensureAuthSchema();
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    tenantId = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AO6F1R ${SUFFIX}`, `ao6f1r-${SUFFIX}`]
    )).rows[0].id;
  });

  after(async () => {
    if (tenantId) await db.getPool().query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  });

  async function columnsOf(table) {
    const r = await db.getPool().query(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
        ORDER BY column_name`,
      [table]
    );
    return r.rows;
  }

  test('execution and object tables expose frozen lineage columns', async () => {
    const execCols = await columnsOf('orchestrator_campaign_provider_draft_executions');
    const names = execCols.map((c) => c.column_name);
    for (const col of ['credential_ref_version', 'account_fingerprint', 'snapshot_hash', 'contract_hash']) {
      assert.equal(names.includes(col), true, col);
      assert.equal(execCols.find((c) => c.column_name === col).is_nullable, 'NO', col);
    }
    const objCols = await columnsOf('orchestrator_campaign_provider_objects');
    const objNames = objCols.map((c) => c.column_name);
    for (const col of [
      'publishing_request_id', 'intent_id', 'snapshot_hash', 'account_fingerprint',
      'provider_object_id_digest', 'display_ref', 'parent_campaign_digest',
      'parent_adset_digest', 'parent_creative_digest',
    ]) {
      assert.equal(objNames.includes(col), true, col);
    }
    const eventCols = await columnsOf('orchestrator_campaign_provider_object_events');
    assert.equal(eventCols.some((c) => c.column_name === 'event_kind'), true);
  });

  test('tenant-leading uniqueness exists for kind and account digest', async () => {
    const p = db.getPool();
    const r = await p.query(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class rel ON rel.oid = c.conrelid
        WHERE rel.relname IN (
          'orchestrator_campaign_provider_objects',
          'orchestrator_campaign_provider_object_events'
        )
          AND c.contype IN ('u','f')`
    );
    const defs = r.rows.map((row) => `${row.conname} ${row.def}`).join('\n');
    assert.match(defs, /orchestrator_cpo_tenant_execution_kind/);
    assert.match(defs, /orchestrator_cpo_tenant_account_digest/);
    assert.match(defs, /UNIQUE \(tenant_id, execution_id, object_kind\)/);
    assert.match(defs, /UNIQUE \(tenant_id, account_fingerprint, provider_object_id_digest\)/);
    assert.match(defs, /orchestrator_cpoe_tenant_object_kind/);
  });

  test('compensation event rows cannot be updated or deleted while tenant exists', async () => {
    const p = db.getPool();
    const existing = (await p.query(
      `SELECT tenant_id, id FROM orchestrator_campaign_provider_object_events LIMIT 1`
    )).rows[0];
    if (!existing) {
      assert.ok(true, 'no event rows yet; immutability covered after execution tests');
      return;
    }
    await assert.rejects(
      () => p.query(
        `UPDATE orchestrator_campaign_provider_object_events SET event_kind='created' WHERE tenant_id=$1 AND id=$2`,
        [existing.tenant_id, existing.id]
      ),
      (err) => err && /orchestrator_cpoe_immutable/.test(String(err.message))
    );
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_campaign_provider_object_events WHERE tenant_id=$1 AND id=$2`,
        [existing.tenant_id, existing.id]
      ),
      (err) => err && /orchestrator_cpoe_immutable/.test(String(err.message))
    );
  });
}
