// test/email-broadcast-tenant-isolation.test.js — runtime per-workspace isolation
// for the multi-query handlers in services/email_broadcast/api.js (Task #74).
//
// Companion to test/tenant-read-audit.test.js, whose function-level leniency
// trusts ALL statements inside a handler that resolves a tenant anywhere. The
// recipients and stats handlers each run TWO tenant-scoped queries with NO
// parent-ownership pre-check, so a single dropped `tenant_id` filter on either
// would silently leak another workspace's recipient list / status breakdown.
// These tests seed two workspaces and assert cross-tenant reads are impossible,
// end to end through the real Express router.
//
// The in-memory fake pool applies a WHERE condition only when the SQL text
// contains it, so dropping `AND tenant_id=$N` from any single query makes the
// other tenant's rows leak and fails the assertion. No Postgres/network needed.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const tables = { email_broadcasts: [], email_broadcast_recipients: [] };

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

  // ── recipients status breakdown (GET /broadcasts/:id/stats) ──
  if (/^SELECT status, COUNT\(\*\) AS cnt FROM email_broadcast_recipients/i.test(s)) {
    const where = whereText(s);
    const rows = tables.email_broadcast_recipients.filter(r => rowMatches(where, params, r));
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    return { rows: Object.entries(byStatus).map(([status, cnt]) => ({ status, cnt: String(cnt) })) };
  }

  // ── recipients count (GET /broadcasts/:id/recipients) ──
  if (/^SELECT COUNT\(\*\) AS total FROM email_broadcast_recipients/i.test(s)) {
    const where = whereText(s);
    const n = tables.email_broadcast_recipients.filter(r => rowMatches(where, params, r)).length;
    return { rows: [{ total: String(n) }] };
  }

  // ── plain SELECTs ──
  if (/^SELECT /i.test(s)) {
    const t = (s.match(/FROM (\w+)/i) || [])[1];
    const where = whereText(s);
    const rows = (tables[t] || []).filter(r => rowMatches(where, params, r));
    return { rows: rows.map(r => ({ ...r })) };
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

const broadcast = require('../services/email_broadcast/api');

let server, PORT;
before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/email-broadcast', broadcast);
  await new Promise(r => { server = app.listen(0, () => { PORT = server.address().port; r(); }); });
});
after(() => { if (server) server.close(); });

beforeEach(() => {
  tables.email_broadcasts = [
    { id: 10, tenant_id: 2, name: 'A blast', subject: 'A', status: 'sent', recipient_count: 2, sent_count: 2, open_count: 1, click_count: 0, bounce_count: 0, complaint_count: 0, unsubscribe_count: 0, created_at: new Date() },
    { id: 20, tenant_id: 3, name: 'B blast', subject: 'B', status: 'sent', recipient_count: 1, sent_count: 1, open_count: 0, click_count: 0, bounce_count: 0, complaint_count: 0, unsubscribe_count: 0, created_at: new Date() },
  ];
  tables.email_broadcast_recipients = [
    { id: 100, tenant_id: 2, broadcast_id: 10, email: 'a1@x.com', name: 'A1', status: 'opened', created_at: new Date() },
    { id: 101, tenant_id: 2, broadcast_id: 10, email: 'a2@x.com', name: 'A2', status: 'sent', created_at: new Date() },
    { id: 200, tenant_id: 3, broadcast_id: 20, email: 'b1@x.com', name: 'B1', status: 'sent', created_at: new Date() },
  ];
});

function req(method, path, { tid } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (tid != null) headers['x-test-tid'] = String(tid);
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }));
    });
    r.on('error', reject);
    r.end();
  });
}

// ── GET /broadcasts : list is scoped ─────────────────────────────────────────
test('GET /broadcasts returns only the caller workspace\'s broadcasts', async () => {
  const a = await req('GET', '/api/email-broadcast/broadcasts', { tid: 2 });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.json.broadcasts.length, 1);
  assert.strictEqual(a.json.broadcasts[0].id, 10);
});

// ── GET /broadcasts/:id/recipients : list AND count both scoped ──────────────
test('recipients of another workspace\'s broadcast are never exposed', async () => {
  // Tenant 2 asks for tenant 3's broadcast (id 20). Both the list query and the
  // count query must filter tenant_id — if either dropped it, B1 would leak.
  const cross = await req('GET', '/api/email-broadcast/broadcasts/20/recipients', { tid: 2 });
  assert.strictEqual(cross.status, 200);
  assert.strictEqual(cross.json.recipients.length, 0, 'no cross-tenant recipients leak');
  assert.strictEqual(cross.json.total, 0, 'count query is tenant-scoped too');

  // Sanity: tenant 2 sees its own broadcast's recipients.
  const own = await req('GET', '/api/email-broadcast/broadcasts/10/recipients', { tid: 2 });
  assert.strictEqual(own.json.recipients.length, 2);
  assert.strictEqual(own.json.total, 2);
});

// ── GET /broadcasts/:id/stats : broadcast select + breakdown both scoped ─────
test('stats of another workspace\'s broadcast are never exposed', async () => {
  const cross = await req('GET', '/api/email-broadcast/broadcasts/20/stats', { tid: 2 });
  assert.strictEqual(cross.status, 404, 'tenant 2 cannot read tenant 3\'s broadcast stats');

  const own = await req('GET', '/api/email-broadcast/broadcasts/10/stats', { tid: 2 });
  assert.strictEqual(own.status, 200);
  // The breakdown (second query) must only count tenant 2's recipients.
  assert.strictEqual(own.json.by_status.opened, 1);
  assert.strictEqual(own.json.by_status.sent, 1);
  const totalCounted = Object.values(own.json.by_status).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalCounted, 2, 'breakdown never counts tenant 3\'s recipient');
});
