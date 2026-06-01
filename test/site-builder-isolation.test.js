// test/site-builder-isolation.test.js — Site Builder per-workspace isolation (Task #49)
//
// Landing pages are keyed by a GLOBAL public slug (`lp:<slug>`) but each page
// blob carries `tenant_id`. Verifies one workspace cannot overwrite another's
// slug — including via the AI generate path — and that the boot backfill assigns
// legacy tenant-less pages to the default tenant. The DB is an in-memory Map and
// tenant resolution reads an `x-test-tid` header, so no Postgres is needed.

const { test, beforeEach, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const store = new Map();

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  // Legacy backfill: assign tenant_id to any tenant-less lp:* row.
  if (/UPDATE kv_store SET value = jsonb_set/.test(s) && /tenant_id/.test(s)) {
    let n = 0;
    for (const [k, v] of store) {
      if (k.startsWith('lp:') && v && v.tenant_id == null) { v.tenant_id = params[0]; n++; }
    }
    return { rows: [], rowCount: n };
  }
  // GET /pages listing scoped to a tenant.
  if (/SELECT key, value FROM kv_store WHERE key LIKE 'lp:%'/.test(s)) {
    const tid = params[0];
    const rows = [...store.entries()]
      .filter(([k, v]) => k.startsWith('lp:') && v && v.tenant_id === tid)
      .map(([k, v]) => ({ key: k, value: v }));
    return { rows };
  }
  return { rows: [] };
}

const db = require('../db');
db.hasDb = () => true;
db.kvGet = async (key, fallback = null) => (store.has(key) ? store.get(key) : fallback);
db.kvSet = async (key, value) => { store.set(key, value); };
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

const tenantCtx = require('../services/tenants/context');
tenantCtx.getDefaultTenantId = async () => 2;
// Resolve tenant from a test header so each request can act as a chosen workspace.
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && req.headers['x-test-tid'];
  return h ? parseInt(h, 10) : null;
};

const siteBuilder = require('../services/site_builder/api');

let server, PORT;

before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/site-builder', siteBuilder);
  await new Promise(r => { server = app.listen(0, () => { PORT = server.address().port; r(); }); });
});

after(() => { if (server) server.close(); });

beforeEach(() => { store.clear(); });

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

test('a workspace cannot overwrite another workspace\'s slug via POST /page/:slug', async () => {
  const a = await req('POST', '/api/site-builder/page/promo', { tid: 2, body: { title: 'A page' } });
  assert.strictEqual(a.status, 200);
  assert.strictEqual(store.get('lp:promo').tenant_id, 2);

  const b = await req('POST', '/api/site-builder/page/promo', { tid: 3, body: { title: 'Hijacked' } });
  assert.strictEqual(b.status, 409);
  // Original owner's page is untouched.
  assert.strictEqual(store.get('lp:promo').title, 'A page');
  assert.strictEqual(store.get('lp:promo').tenant_id, 2);
});

test('a workspace cannot overwrite another workspace\'s slug via POST /ai-generate', async () => {
  await req('POST', '/api/site-builder/page/promo', { tid: 2, body: { title: 'A page' } });

  const b = await req('POST', '/api/site-builder/ai-generate', {
    tid: 3, body: { brand: 'B', valueProp: 'V', slug: 'promo' },
  });
  assert.strictEqual(b.status, 409);
  assert.strictEqual(b.json.error, 'slug already in use');
  // Original owner's page is untouched.
  assert.strictEqual(store.get('lp:promo').title, 'A page');
  assert.strictEqual(store.get('lp:promo').tenant_id, 2);
});

test('GET /page/:slug never leaks another workspace\'s page', async () => {
  await req('POST', '/api/site-builder/page/promo', { tid: 2, body: { title: 'A page' } });
  const seenByOwner = await req('GET', '/api/site-builder/page/promo', { tid: 2 });
  const seenByOther = await req('GET', '/api/site-builder/page/promo', { tid: 3 });
  assert.strictEqual(seenByOwner.status, 200);
  assert.strictEqual(seenByOther.status, 404);
});

test('boot backfill assigns legacy tenant-less lp:* pages to the default tenant', async () => {
  store.set('lp:legacy', { title: 'Old page', blocks: [] }); // no tenant_id
  store.set('lp:owned', { title: 'Already owned', tenant_id: 5 });

  await siteBuilder._migrateLpTenants();

  assert.strictEqual(store.get('lp:legacy').tenant_id, 2); // default tenant
  assert.strictEqual(store.get('lp:owned').tenant_id, 5);  // untouched
});
