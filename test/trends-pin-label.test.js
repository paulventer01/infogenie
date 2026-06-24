// test/trends-pin-label.test.js — pin label-only PATCH coverage
//
// Exercises the `labelOnly` branch of PATCH /api/trends/history/:id/pin:
//   • 200 — updates pin_label without changing pinned state
//   • 400 — rejects when called on an unpinned scan
//   • 404 — rejects when the row doesn't exist
//
// The DB is replaced with an in-memory fake so no Postgres is needed.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// ── In-memory DB fake ────────────────────────────────────────────────────────
// Rows: id → { pinned, pin_label }
const ROWS = {
  1: { pinned: true,  pin_label: null },   // pinned scan   (label editable)
  2: { pinned: false, pin_label: null },   // unpinned scan (label edit forbidden)
};
let lastLabelUpdate = null;   // captured by tests

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // Row existence check: SELECT id, pinned FROM trend_runs WHERE id=$1 AND tenant_id=$2
  if (/SELECT id, pinned FROM trend_runs/.test(s)) {
    const id = Number(params[0]);
    const row = ROWS[id];
    if (!row) return { rows: [] };
    return { rows: [{ id, pinned: row.pinned }] };
  }

  // label-only UPDATE: UPDATE trend_runs SET pin_label=$1 WHERE id=$2 AND tenant_id=$3
  if (/UPDATE trend_runs SET pin_label=\$1/.test(s)) {
    const [label, id] = params;
    const row = ROWS[Number(id)];
    if (row) {
      lastLabelUpdate = { id: Number(id), pin_label: label };
      row.pin_label = label;
    }
    return { rows: [] };
  }

  // toggle UPDATE (not exercised here, but keep the fake quiet)
  if (/UPDATE trend_runs SET pinned=/.test(s)) {
    return { rows: [] };
  }

  return { rows: [] };
}

// Inject fakes BEFORE requiring the routes so the module cache picks them up.
const db = require('../db');
db.hasDb  = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async () => 1;

// ── Server setup ─────────────────────────────────────────────────────────────
let server, PORT;

before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  // Stub a logged-in user so any auth middleware that might read req.user is safe.
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'owner@example.com', isOwner: true };
    next();
  });
  app.use('/api/trends', require('../services/trends/api'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1', port: PORT, path: route, method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('labelOnly:true on a pinned scan returns 200 and updates pin_label without changing pinned', async () => {
  lastLabelUpdate = null;
  // Reset row 1 to known state
  ROWS[1].pinned = true;
  ROWS[1].pin_label = null;

  const res = await request('PATCH', '/api/trends/history/1/pin', { labelOnly: true, label: 'Q2 Campaign' });

  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.id, 1);
  assert.strictEqual(res.body.pinned, true,        'pinned must remain true after a label-only edit');
  assert.strictEqual(res.body.pin_label, 'Q2 Campaign', 'pin_label must reflect the submitted label');

  // Confirm the UPDATE actually fired with the right values.
  assert.ok(lastLabelUpdate, 'UPDATE was executed');
  assert.strictEqual(lastLabelUpdate.id, 1);
  assert.strictEqual(lastLabelUpdate.pin_label, 'Q2 Campaign');
});

test('labelOnly:true on an unpinned scan returns 400', async () => {
  const res = await request('PATCH', '/api/trends/history/2/pin', { labelOnly: true, label: 'Should fail' });

  assert.strictEqual(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.ok, false);
  assert.ok(
    /not pinned/i.test(res.body.error || ''),
    `error message should mention "not pinned", got: ${res.body.error}`,
  );
});

test('labelOnly:true with a non-existent id returns 404', async () => {
  const res = await request('PATCH', '/api/trends/history/9999/pin', { labelOnly: true, label: 'Ghost' });

  assert.strictEqual(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.ok, false);
});
