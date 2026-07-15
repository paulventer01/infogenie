// test/digital-twin-tenant-isolation.test.js — tenant isolation + error guards
// for POST /api/digital-twin/compare and GET /api/digital-twin/scenarios/:id/pdf.
//
// Guards:
//  - compare cross-tenant: scenario_ids owned by a different tenant → 404
//  - compare bad count:    fewer than 2 or more than 4 ids → 400
//  - pdf own tenant:       valid id + matching tenant → 200 application/pdf
//  - pdf cross-tenant:     id owned by a different tenant → 404

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http   = require('node:http');

// ── in-memory scenario rows ───────────────────────────────────────────────────
const rows = [
  { id: 1, tenant_id: 2, question: 'What if we double budget?',  scenario_name: 'Double budget',  results: { verdict:'positive', confidence:80, executive_summary:'Good', timeline:[], upsides:[], risks:[], key_metrics_affected:[], recommended_action:'Go', alternative_scenarios:[] }, share_token: null, created_at: new Date() },
  { id: 2, tenant_id: 2, question: 'What if we cut channels?',   scenario_name: 'Cut channels',   results: { verdict:'negative', confidence:55, executive_summary:'Bad',  timeline:[], upsides:[], risks:[], key_metrics_affected:[], recommended_action:'No',  alternative_scenarios:[] }, share_token: null, created_at: new Date() },
  { id: 3, tenant_id: 3, question: 'What if competitor launches?',scenario_name:'Rival launch',   results: { verdict:'mixed',    confidence:70, executive_summary:'Maybe',timeline:[], upsides:[], risks:[], key_metrics_affected:[], recommended_action:'Wait', alternative_scenarios:[] }, share_token: null, created_at: new Date() },
];

// ── fake pool ─────────────────────────────────────────────────────────────────
function fakeQuery(sql, params) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // UPDATE (compare group assignment) — just succeed silently
  if (/^UPDATE digital_twin_scenarios/i.test(s)) {
    return { rows: [] };
  }

  // ad_campaigns / ad_performance_hourly used by _autoContext — no rows needed
  if (/FROM ad_campaigns/i.test(s)) {
    return { rows: [] };
  }

  // SELECT for /compare and /scenarios/:id/pdf
  if (/^SELECT /i.test(s)) {
    const hasTenantFilter = /\btenant_id\s*=\s*\$1\b/.test(s);
    const tenantId = hasTenantFilter ? params[0] : null;

    // WHERE id = $1 AND tenant_id = $2  (pdf route)
    const pdfMatch = /WHERE id\s*=\s*\$(\d+) AND tenant_id\s*=\s*\$(\d+)/i.exec(s);
    if (pdfMatch) {
      const idVal  = parseInt(params[parseInt(pdfMatch[1], 10) - 1], 10);
      const tidVal = parseInt(params[parseInt(pdfMatch[2], 10) - 1], 10);
      return { rows: rows.filter(r => r.id === idVal && r.tenant_id === tidVal) };
    }

    // WHERE tenant_id = $1 AND id = ANY($2)  (compare route)
    if (/tenant_id\s*=\s*\$1.*id\s*=\s*ANY/i.test(s)) {
      const ids = params[1]; // array of int
      return { rows: rows.filter(r => r.tenant_id === params[0] && ids.includes(r.id)) };
    }

    // Catch-all: filter by first param if tenant scoped
    if (hasTenantFilter) {
      return { rows: rows.filter(r => r.tenant_id === tenantId) };
    }

    return { rows: [] };
  }

  // INSERT (simulate) — not exercised in these tests but guard against crash
  if (/^INSERT /i.test(s)) {
    return { rows: [{ id: 99, created_at: new Date() }] };
  }

  return { rows: [] };
}

const db = require('../db');
db.hasDb   = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

// Tenant resolved from x-test-tid header
const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && req.headers['x-test-tid'];
  return h ? parseInt(h, 10) : null;
};

const dtRouter = require('../services/digital_twin/api');

let server, PORT;
before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/digital-twin', dtRouter);
  await new Promise(r => { server = app.listen(0, () => { PORT = server.address().port; r(); }); });
});
after(() => { if (server) server.close(); });

// ── helper ────────────────────────────────────────────────────────────────────
function req(method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    if (data) headers['content-length'] = Buffer.byteLength(data);

    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, body: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── POST /compare — bad count ─────────────────────────────────────────────────
test('compare: fewer than 2 scenario_ids returns 400', async () => {
  const r = await req('POST', '/api/digital-twin/compare', {
    tid: 2, body: { scenario_ids: [1] },
  });
  assert.strictEqual(r.status, 400);
  assert.ok(r.json && !r.json.ok, 'ok should be false');
});

test('compare: more than 4 scenario_ids returns 400', async () => {
  const r = await req('POST', '/api/digital-twin/compare', {
    tid: 2, body: { scenario_ids: [1, 2, 3, 4, 5] },
  });
  assert.strictEqual(r.status, 400);
  assert.ok(r.json && !r.json.ok, 'ok should be false');
});

test('compare: exactly 0 scenario_ids returns 400', async () => {
  const r = await req('POST', '/api/digital-twin/compare', {
    tid: 2, body: { scenario_ids: [] },
  });
  assert.strictEqual(r.status, 400);
  assert.ok(r.json && !r.json.ok);
});

// ── POST /compare — cross-tenant ──────────────────────────────────────────────
test('compare: scenario_ids belonging to a different tenant return 404', async () => {
  // ids 1 and 2 belong to tenant 2; requesting as tenant 3
  const r = await req('POST', '/api/digital-twin/compare', {
    tid: 3, body: { scenario_ids: [1, 2] },
  });
  assert.strictEqual(r.status, 404, 'cross-tenant compare must return 404, not leak data');
  assert.ok(r.json && !r.json.ok);
});

test('compare: mixing own and foreign ids leaks nothing', async () => {
  // tenant 2 owns id 1&2; tenant 3 owns id 3. Requesting as tenant 3 with id 3 + id 1.
  // Only id 3 passes the tenant filter → only 1 row returned → 404 (need ≥2).
  const r = await req('POST', '/api/digital-twin/compare', {
    tid: 3, body: { scenario_ids: [1, 3] },
  });
  assert.strictEqual(r.status, 404, 'partial cross-tenant compare must not succeed');
});

// ── POST /compare — own tenant ────────────────────────────────────────────────
test('compare: valid ids from own tenant succeeds', async () => {
  const r = await req('POST', '/api/digital-twin/compare', {
    tid: 2, body: { scenario_ids: [1, 2] },
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json && r.json.ok);
  assert.ok(Array.isArray(r.json.scenarios) && r.json.scenarios.length === 2);
  assert.ok(r.json.winner_id != null);
});

// ── GET /scenarios/:id/pdf — cross-tenant ─────────────────────────────────────
test('pdf: foreign tenant\'s scenario id returns 404', async () => {
  // id 3 belongs to tenant 3; requesting as tenant 2
  const r = await req('GET', '/api/digital-twin/scenarios/3/pdf', { tid: 2 });
  assert.strictEqual(r.status, 404, 'cross-tenant pdf must return 404, not stream data');
});

// ── GET /scenarios/:id/pdf — own tenant ──────────────────────────────────────
test('pdf: own tenant\'s scenario returns Content-Type application/pdf', async () => {
  // id 1 belongs to tenant 2
  const r = await req('GET', '/api/digital-twin/scenarios/1/pdf', { tid: 2 });
  assert.strictEqual(r.status, 200);
  const ct = r.headers['content-type'] || '';
  assert.ok(ct.startsWith('application/pdf'), `expected application/pdf, got: ${ct}`);
  assert.ok(r.body.length > 100, 'PDF body should be non-trivial');
});
