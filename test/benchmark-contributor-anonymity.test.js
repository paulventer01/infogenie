// test/benchmark-contributor-anonymity.test.js — the k-anonymity floor on
// benchmark_aggregates must count contributing WORKSPACES, not submission rows.
//
// benchmark_aggregates is GLOBAL by design and that classification is right: it
// is the anonymised cross-customer network. The control that makes "anonymised"
// true is the K = 5 floor in services/benchmarks/api.js, gated on
// contributor_count (COUNT(DISTINCT tenant_id)) across /compare, /leaderboard,
// strategic_intelligence's benchmark read, and the publish/delete decision.
//
// The regression this exists to prevent: an earlier revision gated on
// sample_count, which is COUNT(*) over benchmark_submissions. Because POST
// /submit is a plain INSERT with no ON CONFLICT and benchmark_submissions has no
// unique key on (tenant_id, vertical, region, company_size, metric_key), that
// counter counts ROWS — so one workspace reached the floor alone. Five
// submissions of the same metric (a monthly re-submission, not an attack)
// published p25 = median = p75 = that workspace's own private value, which every
// other workspace read back labelled as a five-sample network benchmark. Four
// rows from one workspace plus one submission from anybody else did the same. No
// value of K fixes that; only counting workspaces does.
//
// Three properties, none covered by test/benchmark-k-anonymity.test.js (which
// seeds five DISTINCT tenants with one submission each and therefore cannot see
// this):
//
//   1. STATIC  — the publish decision is made on a distinct-tenant count.
//   2. RUNTIME — a bucket whose rows all belong to one workspace is not
//                readable by another workspace, at any row count.
//   3. RUNTIME — one outside submission cannot tip a suppressed bucket over the
//                floor, because that bucket still has two contributors.
//
// This file adds assertions. It does not modify or relax any existing audit.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
require('./helpers/env');

const db = require('../db');
const { rethrowDeadlock } = require('./helpers/scratch_db');
const { ensureAuthSchema } = require('../services/auth/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureBenchmarksSchema } = require('../services/benchmarks/schema');
const tenantCtx = require('../services/tenants/context');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — contributor anonymity skipped';

const SUFFIX = `contrib-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const VERTICAL = `contrib-${SUFFIX}`;
const REGION = 'North America';
const SIZE = '11-50';
const METRIC = 'cpa';
// The value a single workspace must never publish to the network.
const PRIVATE_VALUE = 12.34;

const savedOpenAi = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const savedOpenaiKey = process.env.OPENAI_API_KEY;
const originalResolve = tenantCtx.resolveTenantId;
const originalFetch = global.fetch;

async function blockExternalFetch(input) {
  const url = typeof input === 'string' ? input : input && input.url;
  throw new Error(`External fetch blocked by benchmark anonymity test: ${url || 'unknown URL'}`);
}

const tenants = [];
let server = null;
let PORT = 0;

function req(method, urlPath, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const submit = (tid, value) => req('POST', '/api/benchmarks/submit', {
  tid,
  body: { vertical: VERTICAL, region: REGION, company_size: SIZE, metrics: { [METRIC]: value } },
});

async function bucket() {
  const r = await db.getPool().query(
    `SELECT sample_count, p25, median, p75 FROM benchmark_aggregates
      WHERE vertical=$1 AND region IS NOT DISTINCT FROM $2
        AND company_size IS NOT DISTINCT FROM $3 AND metric_key=$4`,
    [VERTICAL, REGION, SIZE, METRIC]);
  return r.rows[0] || null;
}

before(async () => {
  global.fetch = blockExternalFetch;
  if (!HAS_DB) return;
  // Keep the AI branch of /compare on its offline fallback — this test is about
  // what the SQL publishes, not about model output.
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'dummy-key';
  process.env.OPENAI_API_KEY = 'dummy-key';

  await ensureAuthSchema();
  await ensureTenantSchema();
  await ensureBenchmarksSchema();

  tenantCtx.resolveTenantId = async (reqObj) => {
    const h = reqObj && reqObj.headers && reqObj.headers['x-test-tid'];
    if (h == null || h === '') return null;
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n : null;
  };

  const p = db.getPool();
  for (const label of ['a', 'z']) {
    const row = await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`Contrib ${label} ${SUFFIX}`, `contrib-${label}-${SUFFIX}`]);
    tenants.push(row.rows[0].id);
  }

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/benchmarks', require('../services/benchmarks/api'));
  await new Promise(r => { server = app.listen(0, '127.0.0.1', () => { PORT = server.address().port; r(); }); });
});

after(async () => {
  tenantCtx.resolveTenantId = originalResolve;
  global.fetch = originalFetch;
  if (savedOpenAi === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = savedOpenAi;
  if (savedOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenaiKey;

  if (server) await new Promise(r => server.close(r));
  if (!HAS_DB) return;
  const p = db.getPool();
  // Best-effort teardown when setup failed partway (missing tables). Deadlock
  // (40P01) / serialization failure (40001) always fail — do not swallow them.
  await p.query(`DELETE FROM benchmark_aggregates WHERE vertical=$1`, [VERTICAL]).catch(rethrowDeadlock);
  const ids = tenants.filter(Boolean);
  if (!ids.length) return;
  await p.query(`DELETE FROM benchmark_submissions WHERE tenant_id = ANY($1)`, [ids]).catch(rethrowDeadlock);
  await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]).catch(rethrowDeadlock);
});

// ── 1. The publish decision must be made on a distinct-tenant count ─────────
// Static, so it runs in the no-DB gate alongside the rest of the fast suite.
// Deliberately tolerant about HOW the count is expressed: COUNT(DISTINCT
// tenant_id) in the rebuild, or a stored contributor_count column that the read
// paths filter on. It only refuses a floor applied to a bare row count.
test('the benchmark publish floor is computed over distinct tenants', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'benchmarks', 'api.js'), 'utf8');

  const distinctTenants = /COUNT\s*\(\s*DISTINCT\s+tenant_id\s*\)/i.test(src);
  const contributorCount = /\bcontributor_count\b/.test(src);
  assert.ok(distinctTenants || contributorCount,
    'services/benchmarks/api.js gates publication on sample_count, which ' +
    '_rebuildAggregates computes as COUNT(*) over benchmark_submissions. POST ' +
    '/submit is a plain INSERT with no ON CONFLICT and benchmark_submissions has ' +
    'no unique key on (tenant_id, vertical, region, company_size, metric_key), so ' +
    'that counter counts ROWS: one workspace submitting the same metric K times ' +
    'publishes its own exact value as a K-sample "network benchmark", and one ' +
    'submission from any other workspace forces publication of a bucket that is ' +
    'otherwise a single workspace. Gate on the number of distinct contributing ' +
    'tenants instead — COUNT(DISTINCT tenant_id) in _rebuildAggregates, stored ' +
    'as what the read paths filter on (a contributor_count column is fine; do ' +
    'not silently redefine sample_count, which is returned to clients). ' +
    'Percentiles should likewise be computed over one value per workspace. ' +
    'Raising K does not help while the counter is COUNT(*).');
});

// ── 2. A single-workspace bucket must never be readable by another workspace ─
test('a bucket contributed by one workspace is not published to another', { skip }, async () => {
  const [tenantA, tenantZ] = tenants;
  const p = db.getPool();

  // One workspace, five submissions of the same metric — a monthly refresh.
  for (let i = 0; i < 5; i++) {
    const r = await submit(tenantA, PRIVATE_VALUE);
    assert.strictEqual(r.status, 200, r.text);
  }

  const composition = await p.query(
    `SELECT COUNT(*)::int rows, COUNT(DISTINCT tenant_id)::int workspaces
       FROM benchmark_submissions
      WHERE vertical=$1 AND region IS NOT DISTINCT FROM $2
        AND company_size IS NOT DISTINCT FROM $3 AND metric_key=$4`,
    [VERTICAL, REGION, SIZE, METRIC]);
  assert.strictEqual(composition.rows[0].rows, 5, 'fixture: five submission rows');
  assert.strictEqual(composition.rows[0].workspaces, 1, 'fixture: all from one workspace');

  const published = await bucket();
  assert.strictEqual(published, null,
    `A bucket whose every row belongs to one workspace was published as ` +
    `${published && JSON.stringify(published)}. Its percentiles ARE that ` +
    `workspace's private metric, so publishing it discloses the value to the ` +
    `whole network under an "anonymised" label. Suppress on distinct contributing ` +
    `tenants, not on the submission row count.`);

  // And it must not be reachable through either read path.
  const compare = await req('POST', '/api/benchmarks/compare', {
    tid: tenantZ,
    body: { vertical: VERTICAL, region: REGION, company_size: SIZE, your_metrics: { [METRIC]: 99 } },
  });
  assert.strictEqual(compare.status, 200, compare.text);
  const seen = compare.json && compare.json.benchmarks && compare.json.benchmarks[METRIC];
  assert.ok(!seen,
    `/compare disclosed a single-workspace bucket to an unrelated workspace: ` +
    `${JSON.stringify(seen)} — median equals the contributor's private value.`);

  const board = await req('GET', '/api/benchmarks/leaderboard', { tid: tenantZ });
  assert.strictEqual(board.status, 200, board.text);
  const onBoard = (board.json && board.json.leaderboard || [])
    .some(r => r.vertical === VERTICAL && r.metric_key === METRIC);
  assert.strictEqual(onBoard, false,
    '/leaderboard listed a bucket contributed by a single workspace.');
});

// ── 3. One outside submission must not unmask a suppressed bucket ────────────
test('one outside submission does not unmask a suppressed bucket', { skip }, async () => {
  const [tenantA, tenantZ] = tenants;
  const p = db.getPool();
  await p.query(`DELETE FROM benchmark_submissions WHERE vertical=$1`, [VERTICAL]);
  await p.query(`DELETE FROM benchmark_aggregates WHERE vertical=$1`, [VERTICAL]);

  // Four rows from one workspace — correctly suppressed today.
  for (let i = 0; i < 4; i++) await submit(tenantA, PRIVATE_VALUE);
  assert.strictEqual(await bucket(), null, 'fixture: four rows must stay suppressed');

  // A single submission from anyone else must not tip it over the floor, because
  // the bucket still has only two contributing workspaces.
  const r = await submit(tenantZ, 1000);
  assert.strictEqual(r.status, 200, r.text);

  const forced = await bucket();
  assert.strictEqual(forced, null,
    `One submission from a second workspace published a bucket of two ` +
    `contributors as ${forced && JSON.stringify(forced)}. With four of the five ` +
    `rows belonging to one workspace, p25/median disclose that workspace's ` +
    `value — so any workspace can unmask a suppressed bucket for the price of a ` +
    `single submission. The floor must count contributing tenants (2 here), not ` +
    `rows (5 here).`);
});
