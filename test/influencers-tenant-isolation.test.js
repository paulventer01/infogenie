// test/influencers-tenant-isolation.test.js — runtime per-workspace isolation
// for the multi-query handlers in services/influencers/api.js (Task #74).
//
// The static read-audit guard (test/tenant-read-audit.test.js) is lenient at the
// FUNCTION level: once a handler resolves a tenant anywhere, ALL of its SQL is
// trusted. So a single forgotten `tenant_id` filter on ONE query inside an
// otherwise tenant-aware handler would NOT be flagged statically. These runtime
// tests close that gap for the influencers module by seeding two workspaces and
// asserting one can never read or mutate the other's rows end to end.
//
// To actually CATCH a dropped filter, the in-memory fake pool applies a WHERE
// condition only when the executed SQL text contains it. If a future edit drops
// `AND tenant_id=$N` from any single statement, the other tenant's rows leak and
// the assertion below fails — which is the whole point. No Postgres/network is
// needed; tenant resolution reads an `x-test-tid` header.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// ── In-memory tables ─────────────────────────────────────────────────────────
const tables = { influencers: [], influencer_outreach: [] };
const seq = { influencers: 0, influencer_outreach: 0 };

// Apply every `col=$n` equality present in the WHERE text. A filter that the SQL
// omits (e.g. a dropped tenant_id) is simply not applied → cross-tenant rows
// match → the isolation assertion fails. Loose (string) compare tolerates the
// number/string mismatch between numeric columns and path/header params.
function whereText(s) {
  const m = s.match(/\bWHERE\b (.*?)(?:\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|\bRETURNING\b|$)/i);
  return m ? m[1] : '';
}
function rowMatches(where, params, row) {
  const re = /(\w+)\s*=\s*\$(\d+)/g;
  let m;
  while ((m = re.exec(where))) {
    const col = m[1];
    const val = params[parseInt(m[2], 10) - 1];
    if (String(row[col]) !== String(val)) return false;
  }
  return true;
}

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // ── influencers stats aggregate (GET /) ──
  if (/^SELECT status, COUNT\(\*\)::int AS c, COALESCE\(SUM\(deal_value\),0\) AS v FROM influencers/i.test(s)) {
    const where = whereText(s);
    const rows = tables.influencers.filter(r => rowMatches(where, params, r));
    const byStatus = {};
    for (const r of rows) {
      byStatus[r.status] = byStatus[r.status] || { status: r.status, c: 0, v: 0 };
      byStatus[r.status].c += 1;
      byStatus[r.status].v += Number(r.deal_value || 0);
    }
    return { rows: Object.values(byStatus) };
  }

  // ── plain SELECTs ──
  if (/^SELECT /i.test(s)) {
    const t = (s.match(/FROM (\w+)/i) || [])[1];
    const where = whereText(s);
    const rows = (tables[t] || []).filter(r => rowMatches(where, params, r));
    return { rows: rows.map(r => ({ ...r })) };
  }

  // ── INSERT influencer_outreach ──
  if (/^INSERT INTO influencer_outreach/i.test(s)) {
    const [tenant_id, influencer_id, kind, subject, body, direction, created_by] = params;
    const row = { id: ++seq.influencer_outreach, tenant_id, influencer_id, kind, subject, body, direction, created_by, created_at: new Date() };
    tables.influencer_outreach.push(row);
    return { rows: [{ ...row }] };
  }

  // ── UPDATE influencers (e.g. last_contacted bump from outreach) ──
  if (/^UPDATE influencers SET/i.test(s)) {
    const where = whereText(s);
    let n = 0;
    for (const r of tables.influencers) {
      if (rowMatches(where, params, r)) { r.last_contacted_at = new Date(); r.updated_at = new Date(); n++; }
    }
    return { rows: [], rowCount: n };
  }

  // ── DELETE ──
  if (/^DELETE FROM (\w+)/i.test(s)) {
    const t = s.match(/DELETE FROM (\w+)/i)[1];
    const where = whereText(s);
    const before = tables[t].length;
    tables[t] = tables[t].filter(r => !rowMatches(where, params, r));
    return { rows: [], rowCount: before - tables[t].length };
  }

  throw new Error('unexpected SQL in fake pool: ' + s);
}

const db = require('../db');
db.hasDb = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && req.headers['x-test-tid'];
  return h ? parseInt(h, 10) : null;
};

const influencers = require('../services/influencers/api');

let server, PORT;
before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/influencers', influencers);
  await new Promise(r => { server = app.listen(0, () => { PORT = server.address().port; r(); }); });
});
after(() => { if (server) server.close(); });

beforeEach(() => {
  tables.influencers = [
    { id: 1, tenant_id: 2, handle: 'alpha', platform: 'instagram', name: 'Alpha', niche: 'fitness', followers: 1000, deal_value: 100, status: 'active', last_contacted_at: null },
    { id: 2, tenant_id: 3, handle: 'beta', platform: 'tiktok', name: 'Beta', niche: 'beauty', followers: 5000, deal_value: 999, status: 'prospect', last_contacted_at: null },
  ];
  tables.influencer_outreach = [
    { id: 1, tenant_id: 2, influencer_id: 1, kind: 'note', subject: 'A note', body: 'hi', direction: 'outbound', created_at: new Date() },
    { id: 2, tenant_id: 3, influencer_id: 2, kind: 'note', subject: 'B note', body: 'yo', direction: 'outbound', created_at: new Date() },
  ];
  seq.influencer_outreach = 2;
});

function req(method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── GET / : list AND stats must both stay tenant-scoped ──────────────────────
test('GET / returns only the caller workspace\'s influencers and stats', async () => {
  const a = await req('GET', '/api/influencers/', { tid: 2 });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.json.influencers.length, 1, 'tenant 2 sees only its own influencer');
  assert.strictEqual(a.json.influencers[0].handle, 'alpha');
  // The SECOND query (stats aggregate) is the residual-gap risk: if its
  // tenant_id filter were dropped it would sum tenant 3's deal_value too.
  const totalV = a.json.stats.reduce((sum, r) => sum + Number(r.v), 0);
  assert.strictEqual(totalV, 100, 'stats aggregate never includes tenant 3\'s deal_value');

  const b = await req('GET', '/api/influencers/', { tid: 3 });
  assert.strictEqual(b.json.influencers.length, 1);
  assert.strictEqual(b.json.influencers[0].handle, 'beta');
});

// ── GET /:id : influencer + its outreach must both be scoped ─────────────────
test('GET /:id never returns another workspace\'s influencer', async () => {
  const own = await req('GET', '/api/influencers/1', { tid: 2 });
  assert.strictEqual(own.status, 200);
  assert.strictEqual(own.json.influencer.handle, 'alpha');

  const cross = await req('GET', '/api/influencers/1', { tid: 3 });
  assert.strictEqual(cross.status, 404, 'tenant 3 cannot read tenant 2\'s influencer by id');
});

// ── POST /:id/outreach : the UPDATE influencers must stay scoped ─────────────
test('POST /:id/outreach cannot bump another workspace\'s influencer', async () => {
  // Tenant 3 logs outreach against tenant 2's influencer id (1). The INSERT is
  // tenant 3's own row, but the UPDATE influencers ... WHERE id AND tenant_id
  // must NOT touch tenant 2's record.
  const r = await req('POST', '/api/influencers/1/outreach', { tid: 3, body: { kind: 'note', body: 'sneaky' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.outreach.tenant_id, 3, 'outreach row belongs to the caller tenant');

  const victim = tables.influencers.find(i => i.id === 1);
  assert.strictEqual(victim.last_contacted_at, null, 'tenant 2\'s influencer was not mutated by tenant 3');
});

// ── DELETE /:id/outreach/:oid : scoped delete ────────────────────────────────
test('DELETE outreach cannot remove another workspace\'s outreach row', async () => {
  // Tenant 3 attempts to delete tenant 2's outreach (id 1, influencer 1).
  const r = await req('DELETE', '/api/influencers/1/outreach/1', { tid: 3 });
  assert.strictEqual(r.status, 200);
  assert.ok(tables.influencer_outreach.some(o => o.id === 1), 'tenant 2\'s outreach row survived');
});
