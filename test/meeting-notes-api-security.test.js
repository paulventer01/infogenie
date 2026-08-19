// test/meeting-notes-api-security.test.js — route-level security guards for
// services/meeting_notes/api.js.
//
// Sibling to test/meeting-notes-tenant-isolation.test.js (which exercises the SQL
// against a real Postgres). This one drives the Express router itself with
// MULTITENANT_ENFORCEMENT='on', an in-memory fake pool and a stubbed https layer,
// so it needs neither DATABASE_URL nor an OpenAI key and runs anywhere. It locks
// the properties a future edit could silently regress:
//
//   • every route resolves a tenant, and no tenant → 400 before any SQL runs
//     (resolveTenantId is called WITHOUT allowFallback, so 'on' yields null);
//   • the INSERT carries the resolved tenant_id;
//   • /history and /:id only ever return rows of the requesting tenant;
//   • /:id returns id/contact/summary/source/created_at only — the transcript
//     excerpt, its sha256, generated_by and tenant_id never reach a client;
//   • only a ~500-char excerpt + sha256 are persisted, never the full transcript;
//   • a dummy/missing OpenAI key returns 400 without touching the network;
//   • a database failure surfaces as a generic 500, not raw Postgres text.

process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'sk-test-meeting-notes';
delete process.env.OPENAI_API_KEY;

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const https = require('https');
const { EventEmitter } = require('events');
const express = require('express');

// ── Stub the outbound OpenAI call ────────────────────────────────────────────
// api.js calls require('https').request(opts, cb) at request time, so replacing
// the property after require still takes effect.
const AI_SUMMARY = {
  summary: 'Prospect has budget and a Q3 timeline.',
  key_points: ['budget approved'],
  bant: { budget: { score: 8, evidence: 'said budget is approved' } },
  overall_score: 71,
  deal_stage: 'qualification',
};
const httpsCalls = [];
https.request = function (opts, cb) {
  httpsCalls.push({ hostname: opts.hostname, path: opts.path });
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.write = () => {};
  req.destroy = () => {};
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    cb(res);
    res.emit('data', JSON.stringify({
      choices: [{ message: { content: JSON.stringify(AI_SUMMARY) } }],
    }));
    res.emit('end');
  };
  return req;
};

// ── In-memory fake of meeting_notes_runs ─────────────────────────────────────
const rows = [];
let seq = 0;
const sqlLog = [];
let failNextQuery = null; // set to an Error to simulate a Postgres failure

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  sqlLog.push(s);
  if (failNextQuery) { const e = failNextQuery; failNextQuery = null; throw e; }

  if (/^INSERT INTO meeting_notes_runs/.test(s)) {
    const [tenantId, contact, summary, excerpt, sha, source, generatedBy] = params;
    const row = {
      id: ++seq, tenant_id: tenantId,
      contact: JSON.parse(contact), summary: JSON.parse(summary),
      transcript_excerpt: excerpt, transcript_sha256: sha,
      source, generated_by: generatedBy,
      created_at: new Date(Date.now() + seq),
    };
    rows.push(row);
    return { rows: [{ id: row.id }] };
  }

  // Honour the statement's column list, so widening it back to SELECT * shows up
  // in the response body rather than being hidden by the fake.
  const cols = (/^SELECT (.+?) FROM meeting_notes_runs/.exec(s) || [, '*'])[1]
    .split(',').map(c => c.trim());
  const project = r => {
    if (cols.includes('*')) return { ...r };
    return Object.fromEntries(cols.map(c => [c, r[c]]));
  };

  if (/FROM meeting_notes_runs WHERE id=\$1 AND tenant_id=\$2/.test(s)) {
    const [id, tenantId] = params;
    const hit = rows.filter(r => r.id === id && r.tenant_id === tenantId);
    return { rows: hit.map(project) };
  }
  if (/FROM meeting_notes_runs WHERE tenant_id=\$1/.test(s)) {
    const [tenantId] = params;
    return {
      rows: rows.filter(r => r.tenant_id === tenantId)
        .sort((a, b) => b.created_at - a.created_at).slice(0, 30).map(project),
    };
  }
  // Deliberately served unscoped: if a future edit drops the tenant_id filter,
  // the read succeeds here and the cross-tenant assertions below fail, instead of
  // the fake masking the leak with an "unexpected SQL" throw.
  if (/FROM meeting_notes_runs WHERE id=\$1/.test(s)) {
    const [id] = params;
    return { rows: rows.filter(r => r.id === id).map(project) };
  }
  if (/FROM meeting_notes_runs(?! WHERE)/.test(s)) {
    return { rows: rows.map(project) };
  }
  throw new Error('unexpected SQL in fake pool: ' + s);
}

const db = require('../db');
db.hasDb = () => true;
db.getPool = () => ({ query: async (sql, params) => fakeQuery(sql, params) });

const router = require('../services/meeting_notes/api');

// ── Bare app: the router plus a stand-in for loadTenantContext ───────────────
let currentTenant = null; // null → no req.tenant, as for an unscoped principal
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (currentTenant) req.tenant = { id: currentTenant };
  req.session = { userId: 42 };
  next();
});
app.use('/api/meeting-notes', router);

const server = app.listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(base() + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

// Trimmed to match the handler, which hashes the trimmed body value.
const TRANSCRIPT =
  'Sales: thanks for the time today. Jane: we have budget approved for Q3 and I sign off on tooling. '.repeat(12).trim();

beforeEach(() => {
  rows.length = 0; seq = 0;
  sqlLog.length = 0; httpsCalls.length = 0;
  failNextQuery = null;
  currentTenant = 1;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'sk-test-meeting-notes';
});

// ── Tenant resolution ────────────────────────────────────────────────────────

test('MULTITENANT_ENFORCEMENT=on: every route 400s with no_tenant and runs no SQL', async () => {
  currentTenant = null;
  for (const [method, path, body] of [
    ['POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT }],
    ['GET', '/api/meeting-notes/history', null],
    ['GET', '/api/meeting-notes/7', null],
  ]) {
    const r = await call(method, path, body);
    assert.strictEqual(r.status, 400, `${method} ${path} must refuse an unscoped principal`);
    assert.strictEqual(r.json.error, 'no_tenant');
  }
  assert.deepStrictEqual(sqlLog, [], 'no query may run without a resolved tenant');
});

test('the INSERT carries the resolved tenant_id', async () => {
  currentTenant = 5;
  const r = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].tenant_id, 5);
  assert.match(sqlLog[0], /^INSERT INTO meeting_notes_runs \(tenant_id,/);
});

// ── Cross-tenant reads ───────────────────────────────────────────────────────

test('history never returns another tenant\'s notes', async () => {
  currentTenant = 1;
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  currentTenant = 2;
  const r = await call('GET', '/api/meeting-notes/history');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.notes, [], 'tenant 2 must not see tenant 1 rows');

  currentTenant = 1;
  const own = await call('GET', '/api/meeting-notes/history');
  assert.strictEqual(own.json.notes.length, 1);
});

test('GET /:id cannot cross tenants', async () => {
  currentTenant = 1;
  const created = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  const id = created.json.id;
  assert.ok(id);

  currentTenant = 2;
  const other = await call('GET', `/api/meeting-notes/${id}`);
  assert.strictEqual(other.status, 404);
  assert.strictEqual(other.json.ok, false);
  assert.ok(!other.json.note, 'no note payload may leak to the wrong tenant');

  currentTenant = 1;
  const mine = await call('GET', `/api/meeting-notes/${id}`);
  assert.strictEqual(mine.status, 200);
  assert.strictEqual(mine.json.note.id, id);
});

test('GET /:id ignores a non-numeric id without querying', async () => {
  const r = await call('GET', '/api/meeting-notes/status');
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(sqlLog, []);
});

// ── Response minimisation ────────────────────────────────────────────────────

test('GET /:id withholds transcript excerpt, hash, generated_by and tenant_id', async () => {
  const created = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  const r = await call('GET', `/api/meeting-notes/${created.json.id}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(
    Object.keys(r.json.note).sort(),
    ['contact', 'created_at', 'id', 'source', 'summary'],
    'GET /:id must return only the fields the panel renders'
  );
  const getSql = sqlLog.find(s => /WHERE id=\$1 AND tenant_id=\$2/.test(s));
  assert.ok(getSql, 'the by-id read must be tenant-filtered');
  assert.ok(!/SELECT \*/i.test(getSql), 'the by-id read must not SELECT *');
  const body = JSON.stringify(r.json);
  assert.ok(!body.includes(TRANSCRIPT.slice(0, 60)), 'no transcript content in the response');
  assert.ok(!body.includes(rows[0].transcript_sha256), 'no transcript hash in the response');
});

test('history withholds the same columns', async () => {
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  const r = await call('GET', '/api/meeting-notes/history');
  assert.deepStrictEqual(
    Object.keys(r.json.notes[0]).sort(),
    ['contact', 'created_at', 'id', 'source', 'summary']
  );
});

// ── Transcript retention ─────────────────────────────────────────────────────

test('only a 500-char excerpt plus sha256 is persisted, never the full transcript', async () => {
  assert.ok(TRANSCRIPT.length > 500, 'fixture must exceed the excerpt cap');
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  const row = rows[0];
  assert.strictEqual(row.transcript_excerpt.length, 500);
  assert.strictEqual(row.transcript_excerpt, TRANSCRIPT.slice(0, 500));
  assert.strictEqual(
    row.transcript_sha256,
    crypto.createHash('sha256').update(TRANSCRIPT).digest('hex')
  );
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string') {
      assert.ok(v !== TRANSCRIPT, `column ${k} must not hold the full transcript`);
      assert.ok(v.length <= 500, `column ${k} must not grow with transcript length`);
    }
  }
});

// ── Key gate ─────────────────────────────────────────────────────────────────

test('a dummy OpenAI key returns 400 and makes no network call', async () => {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = '_DUMMY_KEY_FOR_TESTS';
  const r = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /OPENAI_API_KEY/);
  assert.deepStrictEqual(httpsCalls, [], 'a dummy key must not reach the network');
  assert.deepStrictEqual(sqlLog, [], 'nothing is persisted when the key is a dummy');
});

test('a missing OpenAI key returns 400 and makes no network call', async () => {
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const r = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(httpsCalls, []);
});

// ── Error hygiene ────────────────────────────────────────────────────────────

test('a database failure does not leak Postgres detail to the client', async () => {
  const secret = 'relation "meeting_notes_runs" column tenant_id detail: transcript excerpt leaked';
  failNextQuery = new Error(secret);
  const r = await call('GET', '/api/meeting-notes/history');
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.json.error, 'Internal server error');
  assert.ok(!JSON.stringify(r.json).includes('meeting_notes_runs'), 'no schema detail in the body');
  assert.ok(!JSON.stringify(r.json).includes(secret));
});

test('a persist failure still returns the summary and does not leak detail', async () => {
  failNextQuery = new Error('duplicate key value violates unique constraint');
  const r = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.id, null, 'no id when the row could not be written');
  assert.ok(!JSON.stringify(r.json).includes('duplicate key'));
});
