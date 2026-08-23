'use strict';

process.env.PERMISSION_ENFORCEMENT = 'on';
process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

require('./helpers/env');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { OrchError } = require('../services/agent_orchestrator/errors');
const {
  assertEvidenceHonesty,
  assertPageHonesty,
  stampPageHonesty,
  nonLiveHonestyMetrics,
  FAKE_SOURCES,
} = require('../services/agent_orchestrator/research_honesty');
const { persistPage } = require('../services/agent_orchestrator/research_ingest');
const {
  insertEvidenceItem,
  insertCompetitor,
  ensureResearchLimits,
} = require('../services/agent_orchestrator/research_store');
const { bindPage } = require('../services/agent_orchestrator/connectors/factory');
const db = require('../db');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');

const FIXTURE_DIR = path.join(__dirname, '..', 'services/agent_orchestrator/fixtures/research');
const PLATFORMS = [
  ['meta', 'meta.v1.json'],
  ['google', 'google.v1.json'],
  ['tiktok', 'tiktok.v1.json'],
];

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isHonestyFail(err, reason) {
  return err instanceof OrchError
    && err.code === 'validation_failed'
    && (!reason || (err.extra && err.extra.reason === reason));
}

function throwsHonesty(fn, reason) {
  assert.throws(fn, (err) => isHonestyFail(err, reason));
}

function stripHonesty(metrics) {
  const next = { ...(metrics || {}) };
  delete next.source;
  delete next._fabricated;
  delete next._estimated;
  return next;
}

function liveMetrics(extra) {
  return { ...(extra || {}), source: 'live' };
}

function refuseWritePool() {
  return {
    query: async () => {
      throw new Error('persist must fail closed before any durable write');
    },
  };
}

function baseBindReq(over) {
  return {
    connector_id: 'meta_research',
    connector_version: '1.0.0',
    contract_version: 'v1',
    tenant_id: 9,
    research_run_id: 'run-honesty-001',
    ...over,
  };
}

for (const [name, file] of PLATFORMS) {
  test(`${name} fixture evidence is stamped mock/_fabricated and is not provider_reported`, () => {
    const page = loadJson(file);
    assert.ok(page.evidence.length >= 1);
    for (const ev of page.evidence) {
      assert.strictEqual(ev.metrics_kind, 'estimated');
      assert.notStrictEqual(ev.metrics_kind, 'provider_reported');
      assert.strictEqual(ev.provider_metrics.source, 'mock');
      assert.ok(FAKE_SOURCES.includes(ev.provider_metrics.source));
      assert.strictEqual(ev.provider_metrics._fabricated, true);
      assert.strictEqual(ev.provider_metrics._estimated, true);
      assert.equal(Object.prototype.hasOwnProperty.call(ev.provider_metrics, 'verified'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(ev.provider_metrics, 'fact'), false);
      assertEvidenceHonesty({ mode: 'fixture', evidence: ev, page });
    }
    assert.strictEqual(page.continuation_state.honesty_class, 'fixture');
    assert.equal(Object.prototype.hasOwnProperty.call(page.continuation_state, 'source'), false);
    assertPageHonesty({ mode: 'fixture', page });
  });

  test(`${name} missing classification fails closed`, () => {
    const ev = clone(loadJson(file).evidence[0]);
    ev.provider_metrics = stripHonesty(ev.provider_metrics);
    throwsHonesty(() => assertEvidenceHonesty({ mode: 'fixture', evidence: ev }), 'missing_classification');
    throwsHonesty(() => assertPageHonesty({
      mode: 'fixture',
      page: { competitors: [], evidence: [ev], continuation_state: {} },
    }), 'missing_classification');
  });

  test(`${name} invalid classification fails closed`, () => {
    const ev = clone(loadJson(file).evidence[0]);
    ev.provider_metrics = { ...stripHonesty(ev.provider_metrics), source: 'not-a-class' };
    throwsHonesty(() => assertEvidenceHonesty({ mode: 'fixture', evidence: ev }), 'invalid_classification');
    throwsHonesty(() => assertEvidenceHonesty({ mode: 'not-a-mode', evidence: ev }), 'invalid_classification');
  });

  test(`${name} fixture+live and live+fixture classifications conflict`, () => {
    const ev = clone(loadJson(file).evidence[0]);
    throwsHonesty(
      () => assertEvidenceHonesty({ mode: 'live', evidence: ev }),
      'classification_conflict'
    );
    const liveEv = clone(ev);
    liveEv.provider_metrics = liveMetrics({ impressions_range: '1-2' });
    liveEv.metrics_kind = 'provider_reported';
    throwsHonesty(
      () => assertEvidenceHonesty({ mode: 'fixture', evidence: liveEv }),
      'classification_conflict'
    );
    throwsHonesty(
      () => assertPageHonesty({
        mode: 'live',
        page: { competitors: [], evidence: [ev], continuation_state: { honesty_class: 'fixture' } },
      }),
      'classification_conflict'
    );
  });

  test(`${name} persistPage refuses untagged fixture evidence before INSERT`, async () => {
    const page = clone(loadJson(file));
    for (const ev of page.evidence) ev.provider_metrics = stripHonesty(ev.provider_metrics);
    page.continuation_state = {};
    await assert.rejects(
      () => persistPage(refuseWritePool(), page, { tenantId: 9, runId: 'run-x', mode: 'fixture' }),
      (err) => isHonestyFail(err, 'missing_classification')
    );
  });

  test(`${name} persistPage refuses live mode with fixture classification before INSERT`, async () => {
    const page = clone(loadJson(file));
    await assert.rejects(
      () => persistPage(refuseWritePool(), page, { tenantId: 9, runId: 'run-x', mode: 'live' }),
      (err) => isHonestyFail(err, 'classification_conflict')
    );
  });

  test(`${name} insertEvidenceItem refuses missing honesty tags before INSERT`, async () => {
    const ev = clone(loadJson(file).evidence[0]);
    ev.provider_metrics = stripHonesty(ev.provider_metrics);
    await assert.rejects(
      () => insertEvidenceItem(refuseWritePool(), ev, { tenantId: ev.tenant_id, mode: 'fixture' }),
      (err) => isHonestyFail(err, 'missing_classification')
    );
  });

  test(`${name} insertEvidenceItem refuses fixture metrics labelled provider_reported`, async () => {
    const ev = clone(loadJson(file).evidence[0]);
    ev.metrics_kind = 'provider_reported';
    await assert.rejects(
      () => insertEvidenceItem(refuseWritePool(), ev, { tenantId: ev.tenant_id, mode: 'fixture' }),
      (err) => isHonestyFail(err, 'classification_conflict')
    );
  });
}

test('pagination fixture evidence is estimated + mock, not provider_reported', () => {
  const pages = loadJson('connector-pagination.v1.json').pages;
  const withEvidence = pages.filter((p) => (p.evidence || []).length);
  assert.ok(withEvidence.length >= 1);
  for (const page of withEvidence) {
    for (const ev of page.evidence) {
      assert.strictEqual(ev.metrics_kind, 'estimated');
      assert.strictEqual(ev.provider_metrics.source, 'mock');
      assert.strictEqual(ev.provider_metrics._fabricated, true);
      assert.strictEqual(ev.provider_metrics._estimated, true);
    }
    assert.strictEqual(page.continuation_state.honesty_class, 'fixture');
    assertPageHonesty({ mode: 'fixture', page });
  }
});

test('bindPage stamps fixture classification from ctx.mode for Meta, Google and TikTok', () => {
  for (const [name, file] of PLATFORMS) {
    const raw = clone(loadJson(file));
    for (const ev of raw.evidence) ev.provider_metrics = stripHonesty(ev.provider_metrics);
    raw.continuation_state = {};
    const bound = bindPage(raw, baseBindReq({
      connector_id: raw.connector_id,
      research_run_id: `run-${name}-bind`,
    }), { mode: 'fixture' });
    assert.ok(bound.evidence.length >= 1, name);
    for (const ev of bound.evidence) {
      assert.strictEqual(ev.provider_metrics.source, 'mock', name);
      assert.strictEqual(ev.provider_metrics._fabricated, true, name);
      assert.strictEqual(ev.provider_metrics._estimated, true, name);
      assert.strictEqual(ev.metrics_kind, 'estimated', name);
    }
    assert.strictEqual(bound.continuation_state.honesty_class, 'fixture', name);
    assert.equal(Object.prototype.hasOwnProperty.call(bound.continuation_state, 'source'), false, name);
  }
});

test('bindPage live mode rejects fixture-tagged evidence', () => {
  const raw = clone(loadJson('meta.v1.json'));
  assert.throws(
    () => bindPage(raw, baseBindReq({ connector_id: 'meta_research' }), { mode: 'live' }),
    (err) => isHonestyFail(err, 'classification_conflict')
  );
});

test('simulated/demo/synthetic/test modes require fake source and fabrication markers', () => {
  const ev = clone(loadJson('google.v1.json').evidence[0]);
  for (const mode of ['simulated', 'demo', 'synthetic', 'test']) {
    assertEvidenceHonesty({ mode, evidence: ev });
    const liveEv = clone(ev);
    liveEv.provider_metrics = liveMetrics();
    liveEv.metrics_kind = 'provider_reported';
    throwsHonesty(() => assertEvidenceHonesty({ mode, evidence: liveEv }), 'classification_conflict');
  }
});

test('live mode accepts explicit live/provider source without fabrication markers', () => {
  const ev = clone(loadJson('tiktok.v1.json').evidence[0]);
  ev.provider_metrics = liveMetrics({ like_count_band: '10K+' });
  ev.metrics_kind = 'provider_reported';
  assertEvidenceHonesty({ mode: 'live', evidence: ev });
  ev.provider_metrics = { source: 'provider' };
  assertEvidenceHonesty({ mode: 'provider', evidence: ev });
});

test('nonLiveHonestyMetrics is a FAKE_SOURCES mock stamp', () => {
  const tagged = nonLiveHonestyMetrics({ impressions_range: '100K-500K' });
  assert.strictEqual(tagged.source, 'mock');
  assert.strictEqual(tagged._fabricated, true);
  assert.strictEqual(tagged._estimated, true);
  assert.strictEqual(tagged.impressions_range, '100K-500K');
});

test('stampPageHonesty in fixture mode forces estimated metrics_kind', () => {
  const page = stampPageHonesty({
    evidence: [{
      metrics_kind: 'provider_reported',
      provider_metrics: { impressions_range: '1' },
    }],
    continuation_state: {},
  }, 'fixture');
  assert.strictEqual(page.evidence[0].metrics_kind, 'estimated');
  assert.strictEqual(page.evidence[0].provider_metrics.source, 'mock');
  assert.strictEqual(page.evidence[0].provider_metrics._fabricated, true);
});

const HAS_DB = db.hasDb();
const SUFFIX = `aorh-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`.slice(0, 128);
}

if (!HAS_DB) {
  test('advertising-orchestrator research honesty persist skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantId = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    tenantId = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORH ${SUFFIX}`, `aorh-${SUFFIX}`]
    )).rows[0].id;
    await ensureResearchLimits(p, tenantId, { records: 10000, bytes: 104857600 });
  });

  after(async () => {
    if (!tenantId) return;
    await db.getPool().query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  });

  async function seedHost(p) {
    const wfId = nid('wf');
    await p.query(`INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`, [wfId, tenantId, wfId]);
    const approvalId = (await p.query(
      `INSERT INTO orchestrator_approvals
         (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
       VALUES ($1,$2,'research_execution',$3,'approved',1,$4::jsonb)
       RETURNING id`,
      [tenantId, wfId, nid('hash'), JSON.stringify(['meta', 'google', 'tiktok'])]
    )).rows[0].id;
    const runId = nid('run');
    await p.query(
      `INSERT INTO orchestrator_research_runs
         (id, tenant_id, workflow_id, approval_id, approval_object_version,
          requested_platforms, idempotency_key, state, research_brief, search_parameters)
       VALUES ($1,$2,$3,$4,1,$5::text[],$6,'pending','','{}')`,
      [runId, tenantId, wfId, approvalId, ['meta', 'google', 'tiktok'], nid('idemp')]
    );
    return { wfId, approvalId, runId };
  }

  for (const [name, file] of PLATFORMS) {
    test(`${name} persisted fixture evidence stores source/_fabricated in provider_metrics`, async () => {
      const p = db.getPool();
      const host = await seedHost(p);
      const page = clone(loadJson(file));
      const compIn = clone(page.competitors[0]);
      compIn.id = nid('comp');
      compIn.tenant_id = tenantId;
      compIn.research_run_id = host.runId;
      const evIn = clone(page.evidence[0]);
      evIn.id = nid('ev');
      evIn.tenant_id = tenantId;
      evIn.research_run_id = host.runId;
      evIn.competitor_id = compIn.id;
      const comp = await insertCompetitor(p, compIn, { tenantId });
      const row = await insertEvidenceItem(p, evIn, { tenantId, mode: 'fixture' });
      assert.strictEqual(comp.platform, name);
      assert.strictEqual(row.provider_metrics.source, 'mock');
      assert.strictEqual(row.provider_metrics._fabricated, true);
      assert.strictEqual(row.provider_metrics._estimated, true);
      assert.strictEqual(row.metrics_kind, 'estimated');
      const stored = (await p.query(
        `SELECT provider_metrics, metrics_kind FROM orchestrator_research_evidence
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, row.id]
      )).rows[0];
      assert.strictEqual(stored.provider_metrics.source, 'mock');
      assert.strictEqual(stored.provider_metrics._fabricated, true);
      assert.strictEqual(stored.provider_metrics._estimated, true);
      assert.strictEqual(stored.metrics_kind, 'estimated');
      assert.notStrictEqual(stored.metrics_kind, 'provider_reported');
    });
  }
}
