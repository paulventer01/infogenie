// test/employee-advocacy-tenant-isolation.test.js — runtime per-workspace
// isolation for services/employee_advocacy/api.js (Task #74).
//
// Companion to test/tenant-read-audit.test.js, whose function-level leniency
// trusts ALL statements inside a tenant-aware handler. The PUBLIC share page
// (GET /public/:shareKey) is the residual-gap risk here: it has no session, so
// it resolves the share key first and then must scope the posts query to THAT
// key's tenant_id. If the posts query forgot the filter, the public page would
// expose every workspace's advocacy posts. These tests seed two workspaces and
// assert the public page, the authenticated list, and the share stats can never
// cross workspace boundaries — end to end through the real Express router.
//
// The in-memory fake pool applies a WHERE condition only when the SQL contains
// it, so dropping `tenant_id` from any single query leaks and fails a test.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const tables = { advocacy_posts: [], advocacy_share_keys: [], advocacy_shares: [] };

function whereText(s) {
  const m = s.match(/\bWHERE\b (.*?)(?:\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|\bRETURNING\b|$)/i);
  return m ? m[1] : '';
}
function rowMatches(where, params, row) {
  // $n equality (incl. tenant_id), string-literal equality, boolean literal.
  let m;
  const reParam = /(\w+)\s*=\s*\$(\d+)/g;
  while ((m = reParam.exec(where))) {
    if (String(row[m[1]]) !== String(params[parseInt(m[2], 10) - 1])) return false;
  }
  const reLit = /(\w+)\s*=\s*'([^']*)'/g;
  while ((m = reLit.exec(where))) {
    if (String(row[m[1]]) !== m[2]) return false;
  }
  const reBool = /(\w+)\s*=\s*(TRUE|FALSE)/gi;
  while ((m = reBool.exec(where))) {
    if (Boolean(row[m[1]]) !== (m[2].toUpperCase() === 'TRUE')) return false;
  }
  return true;
}

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // ── share-count aggregate (GET /stats) ──
  if (/^SELECT post_id, platform, COUNT\(\*\) as shares FROM advocacy_shares/i.test(s)) {
    const where = whereText(s);
    const rows = tables.advocacy_shares.filter(r => rowMatches(where, params, r));
    const groups = {};
    for (const r of rows) {
      const k = `${r.post_id}\u0000${r.platform}`;
      groups[k] = groups[k] || { post_id: r.post_id, platform: r.platform, shares: 0 };
      groups[k].shares += 1;
    }
    return { rows: Object.values(groups).map(g => ({ ...g, shares: String(g.shares) })) };
  }

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

const advocacy = require('../services/employee_advocacy/api');

let server, PORT;
before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/advocacy', advocacy);
  await new Promise(r => { server = app.listen(0, () => { PORT = server.address().port; r(); }); });
});
after(() => { if (server) server.close(); });

beforeEach(() => {
  tables.advocacy_posts = [
    { id: 1, tenant_id: 2, title: 'A post', body: 'a', status: 'active', created_at: new Date() },
    { id: 2, tenant_id: 3, title: 'B post', body: 'b', status: 'active', created_at: new Date() },
  ];
  tables.advocacy_share_keys = [
    { id: 1, tenant_id: 2, share_key: 'KEYA', label: 'A link', active: true, created_at: new Date() },
    { id: 2, tenant_id: 3, share_key: 'KEYB', label: 'B link', active: true, created_at: new Date() },
  ];
  tables.advocacy_shares = [
    { id: 1, tenant_id: 2, share_key: 'KEYA', platform: 'linkedin', post_id: 1 },
    { id: 2, tenant_id: 3, share_key: 'KEYB', platform: 'twitter', post_id: 2 },
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

// ── GET /posts : authenticated list is scoped ────────────────────────────────
test('GET /posts returns only the caller workspace\'s posts', async () => {
  const a = await req('GET', '/api/advocacy/posts', { tid: 2 });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.json.posts.length, 1);
  assert.strictEqual(a.json.posts[0].title, 'A post');
});

// ── GET /public/:shareKey : key lookup + posts must inherit the key's tenant ─
test('public share page never exposes another workspace\'s posts', async () => {
  // KEYA belongs to tenant 2; the public page must return ONLY tenant 2's active
  // posts even though tenant 3 also has active posts. This is the residual-gap
  // case: the posts query is scoped to the resolved key's tenant_id, not a
  // session, so a dropped filter would broadcast every workspace's posts.
  const r = await req('GET', '/api/advocacy/public/KEYA');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.valid, true);
  assert.strictEqual(r.json.posts.length, 1, 'only the key owner\'s posts are shown');
  assert.strictEqual(r.json.posts[0].title, 'A post');
  assert.ok(!r.json.posts.some(p => p.title === 'B post'), 'tenant 3\'s post never leaks');
});

test('unknown share key yields no posts', async () => {
  const r = await req('GET', '/api/advocacy/public/NOPE');
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.json.valid, false);
});

// ── GET /stats : share aggregate is scoped ───────────────────────────────────
test('GET /stats aggregates only the caller workspace\'s shares', async () => {
  const a = await req('GET', '/api/advocacy/stats', { tid: 2 });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.json.stats.length, 1, 'tenant 2 sees only its own share row');
  assert.strictEqual(a.json.stats[0].post_id, 1);

  const b = await req('GET', '/api/advocacy/stats', { tid: 3 });
  assert.strictEqual(b.json.stats.length, 1);
  assert.strictEqual(b.json.stats[0].post_id, 2);
});
