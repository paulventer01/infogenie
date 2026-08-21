// test/benchmark-k-anonymity.test.js — network percentiles stay GLOBAL but
// buckets with sample_count < 5 must not publish a workspace's exact metric.
//
// Gated on DATABASE_URL. Tenant identity is taken from x-test-tid →
// resolveTenantId; request bodies that spoof tenant_id are ignored.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/infogenie';
require('./helpers/env');

const db = require('../db');
const { hasDb } = require('./helpers');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { ensureBenchmarksSchema } = require('../services/benchmarks/schema');
const tenantCtx = require('../services/tenants/context');

const HAS_DB = hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — benchmark k-anonymity skipped';

const SUFFIX = `kanon-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const VERTICAL = `kanon-${SUFFIX}`;
const VERTICAL_DROP = `kanon-drop-${SUFFIX}`;
const REGION = 'North America';
const SIZE = '11-50';
const METRIC = 'cpa';

const savedOpenAi = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const savedOpenaiKey = process.env.OPENAI_API_KEY;
const originalResolve = tenantCtx.resolveTenantId;
const originalFetch = global.fetch;

async function blockExternalFetch(input) {
  const url = typeof input === 'string' ? input : input && input.url;
  throw new Error(`External fetch blocked by benchmark k-anonymity test: ${url || 'unknown URL'}`);
}

const tenants = [];
let server = null;
let PORT = 0;

function req(method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
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

async function submit(tid, value) {
  return req('POST', '/api/benchmarks/submit', {
    tid,
    body: {
      vertical: VERTICAL,
      region: REGION,
      company_size: SIZE,
      tenant_id: 999999, // spoof — must be ignored
      metrics: { [METRIC]: value },
    },
  });
}

function hasMetric(benchmarks) {
  return Boolean(benchmarks && benchmarks[METRIC]);
}

before(async () => {
  global.fetch = blockExternalFetch;
  if (!HAS_DB) return;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  await ensureTenantSchema();
  await ensureBenchmarksSchema();

  tenantCtx.resolveTenantId = async (reqObj) => {
    const h = reqObj && reqObj.headers && reqObj.headers['x-test-tid'];
    if (h == null || h === '') return null;
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n : null;
  };

  const p = db.getPool();
  for (let i = 0; i < 5; i++) {
    const label = String.fromCharCode(65 + i);
    const row = await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`K-anon ${label} ${SUFFIX}`, `kanon-${label.toLowerCase()}-${SUFFIX}`]
    );
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
  const ids = tenants.filter(Boolean);
  const { rethrowDeadlock } = require('./helpers/scratch_db');
  // Best-effort teardown when setup failed partway (missing tables). Deadlock
  // (40P01) / serialization failure (40001) always fail — do not swallow them.
  await p.query(
    `DELETE FROM benchmark_aggregates
      WHERE vertical = ANY($1) AND region IS NOT DISTINCT FROM $2
        AND company_size IS NOT DISTINCT FROM $3 AND metric_key=$4`,
    [[VERTICAL, VERTICAL_DROP], REGION, SIZE, METRIC]
  ).catch(rethrowDeadlock);
  if (ids.length) {
    await p.query(`DELETE FROM benchmark_submissions WHERE tenant_id = ANY($1)`, [ids]).catch(rethrowDeadlock);
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]).catch(rethrowDeadlock);
  }
});

test('compare and leaderboard suppress buckets with sample_count < 5', { skip }, async () => {
  const [tenantA, tenantB, tenantC, tenantD, tenantE] = tenants;

  const a = await submit(tenantA, 42);
  assert.strictEqual(a.status, 200, a.text);
  const b = await submit(tenantB, 58);
  assert.strictEqual(b.status, 200, b.text);

  const p = db.getPool();
  const small = (await p.query(
    `SELECT sample_count FROM benchmark_aggregates
      WHERE vertical=$1 AND region IS NOT DISTINCT FROM $2
        AND company_size IS NOT DISTINCT FROM $3 AND metric_key=$4`,
    [VERTICAL, REGION, SIZE, METRIC]
  )).rows;
  assert.strictEqual(small.length, 0, 'sample_count=2 must not UPSERT a published bucket');

  const compareSmall = await req('POST', '/api/benchmarks/compare', {
    tid: tenantA,
    body: { vertical: VERTICAL, region: REGION, company_size: SIZE, your_metrics: { [METRIC]: 42 } },
  });
  assert.strictEqual(compareSmall.status, 200, compareSmall.text);
  assert.strictEqual(hasMetric(compareSmall.json.benchmarks), false,
    'compare must omit a metric whose network bucket is below k=5');

  const boardSmall = await req('GET', '/api/benchmarks/leaderboard');
  assert.strictEqual(boardSmall.status, 200, boardSmall.text);
  const leaked = (boardSmall.json.leaderboard || []).some(r =>
    r.vertical === VERTICAL && r.metric_key === METRIC
  );
  assert.strictEqual(leaked, false, 'leaderboard must omit buckets with sample_count < 5');

  const rest = await Promise.all([
    submit(tenantC, 51),
    submit(tenantD, 47),
    submit(tenantE, 63),
  ]);
  for (const r of rest) assert.strictEqual(r.status, 200, r.text);

  const published = (await p.query(
    `SELECT sample_count FROM benchmark_aggregates
      WHERE vertical=$1 AND region IS NOT DISTINCT FROM $2
        AND company_size IS NOT DISTINCT FROM $3 AND metric_key=$4`,
    [VERTICAL, REGION, SIZE, METRIC]
  )).rows[0];
  assert.ok(published, 'bucket may appear after 5 distinct submissions');
  assert.ok(Number(published.sample_count) >= 5);

  const compareOk = await req('POST', '/api/benchmarks/compare', {
    tid: tenantA,
    body: { vertical: VERTICAL, region: REGION, company_size: SIZE, your_metrics: { [METRIC]: 42 } },
  });
  assert.strictEqual(compareOk.status, 200, compareOk.text);
  assert.ok(hasMetric(compareOk.json.benchmarks), 'compare may return the metric once sample_count >= 5');
  assert.ok(Number(compareOk.json.benchmarks[METRIC].sample_count) >= 5);

  const boardOk = await req('GET', '/api/benchmarks/leaderboard');
  assert.strictEqual(boardOk.status, 200, boardOk.text);
  assert.ok((boardOk.json.leaderboard || []).some(r =>
    r.vertical === VERTICAL && r.metric_key === METRIC && Number(r.sample_count) >= 5
  ), 'leaderboard may include the bucket once sample_count >= 5');
});

test('previously published bucket is deleted when sample_count falls below 5', { skip }, async () => {
  const [tenantA, tenantB] = tenants;
  const p = db.getPool();
  await p.query(
    `INSERT INTO benchmark_aggregates(vertical,region,company_size,metric_key,p25,median,p75,sample_count,updated_at)
     VALUES($1,$2,$3,$4,10,20,30,9,NOW())
     ON CONFLICT(vertical,region,company_size,metric_key)
     DO UPDATE SET sample_count=9, updated_at=NOW()`,
    [VERTICAL_DROP, REGION, SIZE, METRIC]
  );

  const a = await req('POST', '/api/benchmarks/submit', {
    tid: tenantA,
    body: {
      vertical: VERTICAL_DROP,
      region: REGION,
      company_size: SIZE,
      metrics: { [METRIC]: 12 },
    },
  });
  assert.strictEqual(a.status, 200, a.text);
  const b = await req('POST', '/api/benchmarks/submit', {
    tid: tenantB,
    body: {
      vertical: VERTICAL_DROP,
      region: REGION,
      company_size: SIZE,
      metrics: { [METRIC]: 18 },
    },
  });
  assert.strictEqual(b.status, 200, b.text);

  const leftover = (await p.query(
    `SELECT sample_count FROM benchmark_aggregates
      WHERE vertical=$1 AND region IS NOT DISTINCT FROM $2
        AND company_size IS NOT DISTINCT FROM $3 AND metric_key=$4`,
    [VERTICAL_DROP, REGION, SIZE, METRIC]
  )).rows;
  assert.strictEqual(leftover.length, 0, 'bucket must be DELETEd when sample_count falls below 5');

  const compare = await req('POST', '/api/benchmarks/compare', {
    tid: tenantA,
    body: { vertical: VERTICAL_DROP, region: REGION, company_size: SIZE },
  });
  assert.strictEqual(compare.status, 200, compare.text);
  assert.strictEqual(hasMetric(compare.json.benchmarks), false);
});
