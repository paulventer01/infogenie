'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const {
  sweepExpiredResearchEvidence,
} = require('../services/agent_orchestrator/research_retention');
const { ensureResearchLimits } = require('../services/agent_orchestrator/research_store');

const HAS_DB = db.hasDb();
const SHA256_A = 'a'.repeat(64);
const SUFFIX = `aorrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

async function insertWorkflow(p, tenantId, wfId) {
  await p.query(
    `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
    [wfId, tenantId, `research host ${wfId}`]
  );
}

async function insertApproval(p, tenantId, wfId) {
  const row = (await p.query(
    `INSERT INTO orchestrator_approvals
       (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'research_execution',$3,'approved',1,$4::jsonb)
     RETURNING id`,
    [tenantId, wfId, `hash-${wfId}`, JSON.stringify(['meta', 'google', 'tiktok'])]
  )).rows[0];
  return row.id;
}

async function insertRun(p, tenantId, wfId, approvalId) {
  const id = nid('run');
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters)
     VALUES ($1,$2,$3,$4,1,$5::text[],$6,'pending','','{}'::jsonb)`,
    [id, tenantId, wfId, approvalId, ['meta'], nid('idemp')]
  );
  return id;
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  await insertWorkflow(p, tenantId, wfId);
  const approvalId = await insertApproval(p, tenantId, wfId);
  const runId = await insertRun(p, tenantId, wfId, approvalId);
  return { wfId, approvalId, runId };
}

async function insertComp(p, tenantId, runId) {
  const id = nid('comp');
  await p.query(
    `INSERT INTO orchestrator_research_competitors
       (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
        discovery_source, captured_at, dedup_key)
     VALUES ($1,$2,$3,'meta',$4,'Acme Ads','ad_library', now(), $5)`,
    [id, tenantId, runId, nid('adv'), nid('cdedup')]
  );
  return id;
}

async function insertExpiredEvidence(p, tenantId, runId, competitorId) {
  const id = nid('ev');
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO orchestrator_research_evidence
       (id, tenant_id, research_run_id, competitor_id, platform, source_type,
        provider_external_id, canonical_source_url, headline, body_text, excerpt, advertiser_name,
        captured_at, provider_metrics, provenance_method, connector_id, connector_version,
        content_fingerprint, dedup_key, retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,'meta','ad_creative',$5,$6,'hl','body','ex','Acme',$7::timestamptz,'{}'::jsonb,
             'ad_library','meta_research','1.0.0',$8,$9,'standard',$10::timestamptz,$11::timestamptz)`,
    [
      id, tenantId, runId, competitorId, nid('ext'),
      `https://www.facebook.com/ads/library/?id=${nid('ad')}`,
      createdAt, SHA256_A, nid('ededup'), expiresAt, createdAt,
    ]
  );
  return id;
}

async function runSkipLockedHeldRowOnce(p, tenantId) {
  const host = await seedHost(p, tenantId);
  const comp = await insertComp(p, tenantId, host.runId);
  const lockedId = await insertExpiredEvidence(p, tenantId, host.runId, comp);
  const freeIds = [];
  for (let i = 0; i < 3; i += 1) {
    freeIds.push(await insertExpiredEvidence(p, tenantId, host.runId, comp));
  }

  const locker = await p.connect();
  let sweepP = null;
  try {
    await locker.query('BEGIN');
    await locker.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenantId, lockedId]
    );
    const started = Date.now();
    sweepP = sweepExpiredResearchEvidence();
    const timedOut = Object.assign(new Error('sweep blocked on held row'), { code: 'XX000' });
    let timer;
    const result = await Promise.race([
      sweepP,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timedOut), 2000);
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    sweepP = null;
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `sweep must return in < 2s, took ${elapsed}ms`);
    assert.ok(result);
    assert.strictEqual(result.failures, 0, 'SKIP LOCKED must not trip delete_noop');

    const freeGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id = ANY($2::text[])`,
      [tenantId, freeIds]
    )).rows;
    assert.strictEqual(freeGone.length, 0, 'unlocked expired rows must be purged');
    const lockedKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantId, lockedId]
    )).rows;
    assert.strictEqual(lockedKept.length, 1, 'held row must be skipped');
  } catch (err) {
    if (sweepP) {
      try { await locker.query('ROLLBACK'); } catch { /* ignore */ }
      await sweepP.catch(() => {});
      sweepP = null;
    }
    throw err;
  } finally {
    try { await locker.query('ROLLBACK'); } catch { /* ignore */ }
    locker.release();
  }

  const second = await sweepExpiredResearchEvidence();
  assert.strictEqual(second.failures, 0);
  assert.ok(second.purged >= 1);
  const leftover = (await p.query(
    `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
    [tenantId, lockedId]
  )).rows;
  assert.strictEqual(leftover.length, 0, 'second sweep must purge the previously locked row');
}

if (!HAS_DB) {
  test('advertising-orchestrator research retention concurrency skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    tenantA = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORRC A ${SUFFIX}`, `aorrc-a-${SUFFIX}`]
    )).rows[0].id;
    await ensureResearchLimits(p, tenantA, { records: 100000, bytes: 104857600 });
  });

  after(async () => {
    const p = db.getPool();
    if (!tenantA) return;
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantA]);
  });

  test('SKIP LOCKED held-row scenario succeeds 20 consecutive times', async () => {
    const p = db.getPool();
    for (let i = 0; i < 20; i += 1) {
      await runSkipLockedHeldRowOnce(p, tenantA);
    }
  });

  test('two concurrent sweeps partition expired rows without a noop race', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const ids = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(await insertExpiredEvidence(p, tenantA, host.runId, comp));
    }

    const [first, second] = await Promise.all([
      sweepExpiredResearchEvidence(),
      sweepExpiredResearchEvidence(),
    ]);
    assert.ok(first && second);
    assert.strictEqual(first.failures, 0, 'ok must not be false because of a noop race');
    assert.strictEqual(second.failures, 0, 'ok must not be false because of a noop race');
    assert.ok(
      (first.purged || 0) + (second.purged || 0) >= ids.length,
      'union of purged counts must cover the seeded expired set'
    );

    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id = ANY($2::text[])`,
      [tenantA, ids]
    )).rows[0].n;
    assert.strictEqual(leftover, 0, 'union of purged rows must be complete');
  });
}
