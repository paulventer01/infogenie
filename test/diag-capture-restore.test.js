'use strict';
// test/diag-capture-restore.test.js — session auth, tenant isolation, and log hygiene
// for /api/diag-capture (analysis snapshot restore).
//
// Locks:
//   A. Unauthenticated GET/POST hit the real auth gate → 401 auth_required.
//   B. Tenant 2 cannot read tenant 1's saved analysis (hermetic in-memory kv).
//   C. Snapshot bodies / analysisData / brandKit never appear in console logs.
//   D. Matrix maps the prefix to dashboard.view; path is not on the public allowlist.
//
// Run: node --test test/diag-capture-restore.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const express = require('express');

const { bootApp, request } = require('./helpers');
const matrix = require('../services/tenants/permission_matrix');

const SECRET = 'TENANT_A_SECRET_ROAS_9_99';
const TENANT_A_URL = 'https://acme-restore.example';
const TENANT_A_SLUG = 'acme-restore.example';

const FORBIDDEN_LOG_TOKENS = [
  'payload',
  'body',
  'analysisData',
  'brandKit',
  'JSON.stringify(payload)',
  'JSON.stringify(body)',
];

function extractAllowlistBody(serverSrc) {
  const m = serverSrc.match(/const _AUTH_PUBLIC_API_PATHS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'server.js must declare _AUTH_PUBLIC_API_PATHS');
  return m[1];
}

function consoleCallArgumentTexts(src) {
  const out = [];
  const re = /console\.(?:log|warn|error)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let inStr = null;
    let esc = false;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (inStr) {
        if (esc) { esc = false; i += 1; continue; }
        if (ch === '\\') { esc = true; i += 1; continue; }
        if (ch === inStr) inStr = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i += 1; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

function tenantAPayload() {
  return {
    url: TENANT_A_URL,
    analysisData: {
      url: TENANT_A_URL,
      secret: SECRET,
      roas: 9.99,
      competitors: [{ name: 'RivalCo', url: 'https://rival-restore.example' }],
    },
    brandKit: { name: 'AcmeBrandKit', primary: '#111111' },
  };
}

async function mountIsolationApp(t) {
  const store = new Map();
  const db = require('../db');
  const orig = { hasDb: db.hasDb, kvGet: db.kvGet, kvSet: db.kvSet };
  db.hasDb = () => true;
  db.kvGet = async (key, fallback) => {
    if (!store.has(key)) return fallback === undefined ? null : fallback;
    return store.get(key);
  };
  db.kvSet = async (key, value) => { store.set(key, value); return true; };

  function tkey(base, tid) { return `${base}:t${tid}`; }
  const register = require('../services/diag_capture/routes');
  const app = express();
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-tenant'];
    if (raw != null && raw !== '') req.tenant = { id: Number(raw) };
    next();
  });
  register(app, {
    _DIAG_CAP_PREFIX: 'diag_capture:',
    _DIAG_LATEST_KEY: 'diag_capture_latest',
    _tkvCtx: {
      resolveTenantId: async (req) => (req.tenant && req.tenant.id != null ? req.tenant.id : null),
    },
    _tkvRead: async (base, tid, fallback) => {
      if (tid == null) return fallback;
      const k = tkey(base, tid);
      return store.has(k) ? store.get(k) : fallback;
    },
    _tkvWrite: async (base, tid, value) => {
      if (tid == null) return false;
      store.set(tkey(base, tid), value);
      return true;
    },
    _tkvScope: {
      listTenantPrefix: async (prefix, tid) => {
        const full = `${prefix}t${tid}:`;
        const out = [];
        for (const [k, v] of store.entries()) {
          if (String(k).startsWith(full)) out.push({ id: String(k).slice(full.length), value: v });
        }
        return out;
      },
    },
    express,
  });

  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(async () => {
    db.hasDb = orig.hasDb;
    db.kvGet = orig.kvGet;
    db.kvSet = orig.kvSet;
    await new Promise((r) => server.close(r));
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function asTenant(tenantId) {
  return { headers: { 'x-test-tenant': String(tenantId) } };
}

async function withCapturedConsole(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const tap = (...args) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4 }))).join(' '));
  };
  console.log = tap;
  console.warn = tap;
  console.error = tap;
  try {
    await fn();
    return lines.join('\n');
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

// ── A. Unauthenticated callers hit the real auth gate ───────────────────────
test('A: unauthenticated GET /api/diag-capture/latest returns 401 auth_required', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());
  const res = await request(app.baseUrl, 'GET', '/api/diag-capture/latest');
  assert.strictEqual(res.status, 401);
  assert.ok(res.json);
  assert.strictEqual(res.json.error, 'auth_required');
});

test('A: unauthenticated POST /api/diag-capture returns 401 auth_required', async (t) => {
  const app = await bootApp();
  t.after(() => app.close());
  const res = await request(app.baseUrl, 'POST', '/api/diag-capture', {
    body: { url: 'https://example.com', analysisData: { note: 'unauth' } },
  });
  assert.strictEqual(res.status, 401);
  assert.ok(res.json);
  assert.strictEqual(res.json.error, 'auth_required');
});

// ── B + C (runtime). Tenant isolation + log hygiene ─────────────────────────
test('B/C: tenant 2 cannot read tenant 1 capture; save logs omit snapshot body', async (t) => {
  const { baseUrl } = await mountIsolationApp(t);

  const logs = await withCapturedConsole(async () => {
    const saved = await request(baseUrl, 'POST', '/api/diag-capture', {
      ...asTenant(1),
      body: tenantAPayload(),
    });
    assert.strictEqual(saved.status, 200, saved.text);
    assert.strictEqual(saved.json.ok, true);
    assert.strictEqual(saved.json.domain, TENANT_A_SLUG);
  });
  assert.equal(logs.includes(SECRET), false, `save logs must not contain snapshot secret: ${logs}`);
  assert.equal(logs.includes('RivalCo'), false, 'save logs must not contain competitor names');
  assert.equal(logs.includes('AcmeBrandKit'), false, 'save logs must not contain brandKit');

  const ownLatest = await request(baseUrl, 'GET', '/api/diag-capture/latest', asTenant(1));
  assert.strictEqual(ownLatest.status, 200, 'tenant 1 can read its own latest capture');
  assert.strictEqual(ownLatest.json.ok, true);
  assert.ok(String(ownLatest.text).includes(SECRET), 'tenant 1 payload should round-trip');

  const t2Latest = await request(baseUrl, 'GET', '/api/diag-capture/latest', asTenant(2));
  assert.notStrictEqual(t2Latest.status, 200, 'tenant 2 latest must not be a successful tenant-1 payload');
  assert.equal(String(t2Latest.text).includes(SECRET), false, 'tenant 2 latest must not leak tenant 1 secret');
  assert.strictEqual(t2Latest.status, 404);
  assert.ok(t2Latest.json);
  assert.strictEqual(t2Latest.json.ok, false);

  const t2BySlug = await request(baseUrl, 'GET', `/api/diag-capture/${TENANT_A_SLUG}`, asTenant(2));
  assert.equal(String(t2BySlug.text).includes(SECRET), false, 'tenant 2 GET-by-slug must not leak tenant 1 secret');
  assert.notStrictEqual(t2BySlug.status, 200);
  assert.strictEqual(t2BySlug.status, 404);
  assert.ok(t2BySlug.json);
  assert.strictEqual(t2BySlug.json.ok, false);
});

// ── C. Source-audit: console arguments never mention snapshot fields ────────
test('C: diag_capture routes console arguments omit snapshot bodies', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'diag_capture', 'routes.js'), 'utf8');
  const args = consoleCallArgumentTexts(src);
  assert.ok(args.length >= 1, 'expected at least one console call to audit');
  for (const text of args) {
    for (const token of FORBIDDEN_LOG_TOKENS) {
      assert.equal(
        text.includes(token),
        false,
        `console argument must not contain ${token}: ${text}`
      );
    }
  }
});

// ── D. Matrix + public allowlist ────────────────────────────────────────────
test('D: /api/diag-capture maps to dashboard.view and is not a public API path', () => {
  const getLatest = matrix.requiredPermissionForRequest('/api/diag-capture/latest', 'GET');
  assert.strictEqual(getLatest.matched, true);
  assert.strictEqual(getLatest.permission, 'dashboard.view');

  const post = matrix.requiredPermissionForRequest('/api/diag-capture', 'POST');
  assert.strictEqual(post.matched, true);
  assert.strictEqual(post.permission, 'dashboard.view');

  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const allow = extractAllowlistBody(serverSrc);
  assert.equal(
    /\/\^\\\/api\\\/diag-capture\//.test(allow) || allow.includes('/api/diag-capture'),
    false,
    '_AUTH_PUBLIC_API_PATHS must not list /^\\/api\\/diag-capture/'
  );
});
