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
//     excerpt, its sha256, generated_by, tenant_id and cipher columns never
//     reach a client;
//   • plaintext transcript_excerpt is never persisted; sha256 still is;
//   • a dummy/missing OpenAI key returns 400 without touching the network;
//   • a database failure surfaces as a generic 500, not raw Postgres text.

// Vault key must be in place before api.js → vault.js caches CREDENTIAL_ENCRYPTION_KEY.
require('./helpers/env');

process.env.MULTITENANT_ENFORCEMENT = 'on';
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'sk-test-meeting-notes';
delete process.env.OPENAI_API_KEY;

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const https = require('https');
const { EventEmitter } = require('events');
const express = require('express');

const PUBLIC_NOTE_KEYS = ['contact', 'created_at', 'id', 'source', 'summary'];
const FORBIDDEN_NOTE_KEYS = [
  'excerpt', 'transcript_excerpt', 'transcript_sha256', 'tenant_id', 'generated_by',
  'iv', 'tag', 'ciphertext',
  'excerpt_ciphertext', 'excerpt_iv', 'excerpt_tag',
  'summary_ciphertext', 'summary_iv', 'summary_tag',
  'excerpt_expires_at', 'transcript_purged_at',
];

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
  const call = { hostname: opts.hostname, path: opts.path, body: '' };
  httpsCalls.push(call);
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.write = (chunk) => { call.body += chunk == null ? '' : String(chunk); };
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

function parseJsonMaybe(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function fakeQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  sqlLog.push(s);
  if (failNextQuery) { const e = failNextQuery; failNextQuery = null; throw e; }

  if (/^INSERT INTO meeting_notes_runs/.test(s)) {
    const colMatch = s.match(/^INSERT INTO meeting_notes_runs \(([^)]+)\)/);
    const cols = (colMatch ? colMatch[1] : '').split(',').map(c => c.trim()).filter(Boolean);
    const valuesMatch = s.match(/VALUES \((.+)\) RETURNING/i) || s.match(/VALUES \((.+)\)\s*$/i);
    const placeholders = valuesMatch
      ? valuesMatch[1].split(',').map(x => x.trim())
      : cols.map((_, i) => `$${i + 1}`);
    const row = {
      id: ++seq,
      created_at: new Date(Date.now() + seq),
      transcript_excerpt: null,
      excerpt_ciphertext: null,
      excerpt_iv: null,
      excerpt_tag: null,
      summary_ciphertext: null,
      summary_iv: null,
      summary_tag: null,
      excerpt_expires_at: null,
      transcript_purged_at: null,
    };
    cols.forEach((c, i) => {
      const ph = placeholders[i] || '';
      const m = /^\$(\d+)$/.exec(ph);
      if (!m) return;
      let v = params[Number(m[1]) - 1];
      if (c === 'contact' || c === 'summary') v = parseJsonMaybe(v);
      row[c] = v;
    });
    rows.push(row);
    return { rows: [{ id: row.id }] };
  }

  if (/^UPDATE meeting_notes_runs/.test(s)) {
    const tenantId = params[0];
    const now = new Date();
    let n = 0;
    for (const row of rows) {
      if (row.tenant_id !== tenantId) continue;
      if (row.excerpt_expires_at == null) continue;
      if (!(new Date(row.excerpt_expires_at) < now)) continue;
      if (row.transcript_excerpt == null && row.excerpt_ciphertext == null) continue;
      row.transcript_excerpt = null;
      row.excerpt_ciphertext = null;
      row.excerpt_iv = null;
      row.excerpt_tag = null;
      row.transcript_purged_at = row.transcript_purged_at || now;
      n++;
    }
    return { rows: [], rowCount: n };
  }

  if (/SELECT DISTINCT tenant_id FROM meeting_notes_runs/.test(s)) {
    const ids = [...new Set(rows.map(r => r.tenant_id))].sort((a, b) => a - b);
    return { rows: ids.map(tenant_id => ({ tenant_id })) };
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

const intervalCalls = [];
const origSetInterval = global.setInterval;
global.setInterval = function (...args) {
  intervalCalls.push(args[1]);
  return origSetInterval.apply(this, args);
};
let router;
try {
  router = require('../services/meeting_notes/api');
} finally {
  global.setInterval = origSetInterval;
}

const vault = require('../services/credentials/vault');

// ── Bare app: the router plus a stand-in for loadTenantContext ───────────────
let currentTenant = null; // null → no req.tenant, as for an unscoped principal
let sessionEmail = undefined;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (currentTenant) req.tenant = { id: currentTenant };
  req.session = { userId: 42 };
  if (sessionEmail !== undefined) req.session.email = sessionEmail;
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

function stringifyValue(v) {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function assertPublicNote(note) {
  assert.deepStrictEqual(Object.keys(note).sort(), PUBLIC_NOTE_KEYS);
  for (const k of FORBIDDEN_NOTE_KEYS) {
    assert.ok(!(k in note), `${k} must not appear on the client note`);
  }
}

// Trimmed to match the handler, which hashes the trimmed body value.
const TRANSCRIPT =
  'Sales: thanks for the time today. Jane: we have budget approved for Q3 and I sign off on tooling. '.repeat(12).trim();

beforeEach(() => {
  rows.length = 0; seq = 0;
  sqlLog.length = 0; httpsCalls.length = 0;
  failNextQuery = null;
  currentTenant = 1;
  sessionEmail = undefined;
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
  assert.strictEqual(r.json.ok, true);
  assert.deepStrictEqual(r.json.summary, AI_SUMMARY, 'POST /summarize returns the live AI object, not a DB round-trip');
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
  assertPublicNote(r.json.note);
  assert.deepStrictEqual(r.json.note.summary, AI_SUMMARY, 'decrypt-on-read must restore the AI summary');
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
  assertPublicNote(r.json.notes[0]);
  assert.deepStrictEqual(r.json.notes[0].summary, AI_SUMMARY, 'history decrypt-on-read must restore the AI summary');
});

// ── Transcript retention / encrypt-on-write ──────────────────────────────────

test('without a vault key, JSONB summary is persisted and transcript_excerpt stays null', async () => {
  const origHasKey = vault.hasKey;
  vault.hasKey = () => false;
  try {
    await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  } finally {
    vault.hasKey = origHasKey;
  }
  const row = rows[0];
  assert.ok(row.transcript_excerpt == null || row.transcript_excerpt === '', 'dev path must never write plaintext transcript_excerpt');
  assert.deepStrictEqual(row.summary, AI_SUMMARY);
  assert.ok(!row.excerpt_ciphertext, 'dev path must not invent excerpt ciphertext');
  const hist = await call('GET', '/api/meeting-notes/history');
  assert.deepStrictEqual(hist.json.notes[0].summary, AI_SUMMARY);
});

test('plaintext transcript_excerpt is not persisted; sha256 and excerpt ciphertext are', async () => {
  assert.ok(TRANSCRIPT.length > 500, 'fixture must exceed the excerpt cap');
  assert.ok(vault.hasKey(), 'test env must provide a vault key so encrypt-on-write runs');
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  const row = rows[0];
  assert.ok(row.transcript_excerpt == null || row.transcript_excerpt === '', 'transcript_excerpt must be null/empty');
  assert.strictEqual(
    row.transcript_sha256,
    crypto.createHash('sha256').update(TRANSCRIPT).digest('hex')
  );
  assert.ok(row.excerpt_ciphertext, 'excerpt_ciphertext must be present when a vault key exists');
  assert.ok(Buffer.isBuffer(row.excerpt_ciphertext) || row.excerpt_ciphertext instanceof Uint8Array);
  for (const [k, v] of Object.entries(row)) {
    const s = stringifyValue(v);
    assert.ok(s !== TRANSCRIPT, `column ${k} must not hold the full transcript`);
    assert.ok(!s.includes(TRANSCRIPT), `column ${k} (stringified) must not hold the full transcript`);
  }
});

test('generated_by is the session userId even when session.email is set', async () => {
  sessionEmail = 'owner@example.com';
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.strictEqual(rows[0].generated_by, '42');
  assert.notStrictEqual(rows[0].generated_by, sessionEmail);
});

const PII_CONTACT = {
  name: 'Jane Doe',
  company: 'Acme',
  role: 'VP Sales',
  email: 'jane@example.com',
  phone: '+1-555-0100',
  notes: 'do not store this',
};
const CONTACT_PII_VALUES = ['jane@example.com', '+1-555-0100', 'do not store this'];

test('contact extra keys are stripped on persist', async () => {
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT, contact: PII_CONTACT });
  assert.deepStrictEqual(rows[0].contact, { name: 'Jane Doe', company: 'Acme', role: 'VP Sales' });
});

// ── PII minimisation before the provider call ────────────────────────────────

test('the OpenAI prompt carries only whitelisted contact keys', async () => {
  // The transcript body is deliberately NOT asserted here: sending up to 12k
  // characters unredacted is the documented current behaviour, and redaction is
  // a follow-up AI/LLM PR (docs/security-guardrails.md). What must hold now is
  // that contact PII the caller supplied never reaches the provider.
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT, contact: PII_CONTACT });
  assert.strictEqual(httpsCalls.length, 1);
  assert.strictEqual(httpsCalls[0].hostname, 'api.openai.com');
  const sent = httpsCalls[0].body;
  assert.ok(sent, 'the stub must have captured the request body');
  for (const value of CONTACT_PII_VALUES) {
    assert.ok(!sent.includes(value), `${value} must not be sent to the provider`);
  }
  assert.ok(sent.includes('Jane Doe'), 'the whitelisted contact context is still sent');
  assert.ok(sent.includes('Acme'));
  assert.ok(sent.includes('VP Sales'));
});

test('an all-PII contact sends no contact context block at all', async () => {
  await call('POST', '/api/meeting-notes/summarize', {
    transcript: TRANSCRIPT,
    contact: { email: 'jane@example.com', phone: '+1-555-0100' },
  });
  const sent = httpsCalls[0].body;
  assert.ok(!sent.includes('Contact context'), 'an empty whitelist must omit the contact line');
  for (const value of CONTACT_PII_VALUES.slice(0, 2)) {
    assert.ok(!sent.includes(value));
  }
});

test('the session identity is never sent to the provider', async () => {
  sessionEmail = 'owner@example.com';
  await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.ok(!httpsCalls[0].body.includes(sessionEmail));
  assert.ok(!httpsCalls[0].body.includes('"42"'));
});

test('legacy contact PII stored before the whitelist is narrowed on read', async () => {
  // Rows written by the pre-whitelist persist path hold the raw request contact.
  rows.push({
    id: ++seq, tenant_id: 1, contact: { ...PII_CONTACT }, summary: { legacy: true },
    source: 'ai', created_at: new Date(),
    transcript_excerpt: null, transcript_sha256: 'sha-legacy', generated_by: null,
    excerpt_ciphertext: null, excerpt_iv: null, excerpt_tag: null,
    summary_ciphertext: null, summary_iv: null, summary_tag: null,
    excerpt_expires_at: null, transcript_purged_at: null,
  });

  for (const path of ['/api/meeting-notes/history', `/api/meeting-notes/${seq}`]) {
    const r = await call('GET', path);
    assert.strictEqual(r.status, 200, path);
    const note = r.json.note || r.json.notes[0];
    assertPublicNote(note);
    assert.deepStrictEqual(note.contact, { name: 'Jane Doe', company: 'Acme', role: 'VP Sales' }, path);
    const body = JSON.stringify(r.json);
    for (const value of CONTACT_PII_VALUES) {
      assert.ok(!body.includes(value), `${value} must not be served from ${path}`);
    }
  }
});

// ── AAD binding: a row lifted into another tenant fails closed ───────────────

test('summary ciphertext does not decrypt under another tenant\'s AAD', async () => {
  currentTenant = 1;
  const created = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  const id = created.json.id;
  assert.ok(rows[0].summary_ciphertext, 'encrypt-on-write must have run');

  // Simulate the row being moved (or a tenant_id being rewritten) without
  // re-encryption: the GCM AAD no longer matches.
  rows[0].tenant_id = 2;
  currentTenant = 2;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  let r;
  try {
    r = await call('GET', `/api/meeting-notes/${id}`);
  } finally {
    console.warn = originalWarn;
  }

  assert.strictEqual(r.status, 200);
  assertPublicNote(r.json.note);
  assert.deepStrictEqual(r.json.note.summary, {}, 'wrong-tenant AAD must fail closed, not decrypt');
  const body = JSON.stringify(r.json);
  assert.ok(!body.includes(AI_SUMMARY.summary), 'no plaintext summary may cross the AAD boundary');
  assert.ok(!body.includes('budget approved'));
  assert.deepStrictEqual(warnings, ['[meeting-notes] decrypt failed'], 'the decrypt failure log carries no detail');
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

test('a database failure does not write raw Postgres detail to process logs', async () => {
  const secret = 'qa-sensitive-row-detail-from-postgres';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    failNextQuery = new Error(secret);
    const r = await call('GET', '/api/meeting-notes/history');
    assert.strictEqual(r.status, 500);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(
    !warnings.join('\n').includes(secret),
    'raw Postgres errors may contain row details and must not be written to logs'
  );
});

test('a persist failure still returns the summary and does not leak detail', async () => {
  failNextQuery = new Error('duplicate key value violates unique constraint');
  const r = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.id, null, 'no id when the row could not be written');
  assert.deepStrictEqual(r.json.summary, AI_SUMMARY, 'POST summary is the live AI object, not from DB');
  assert.ok(!JSON.stringify(r.json).includes('duplicate key'));
});

test('a persist failure does not write raw Postgres detail to process logs', async () => {
  // Sibling of the /history log-hygiene case above. The INSERT parameters carry
  // ciphertext and hashes, so a pg error raised on that statement must still
  // not reach the process log.
  const secret = 'detail: Key (transcript_excerpt)=(Jane: we have budget approved)';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    failNextQuery = new Error(secret);
    const r = await call('POST', '/api/meeting-notes/summarize', { transcript: TRANSCRIPT });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.id, null);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(
    !warnings.join('\n').includes(secret),
    'the persist catch must not interpolate the pg error, which can echo row values'
  );
  assert.ok(
    !warnings.join('\n').includes('transcript_excerpt'),
    'no column or row detail from the failed INSERT may reach the log'
  );
});

// ── Sweeper + require-time interval ──────────────────────────────────────────

test('requiring api.js starts no sweeper interval when background is disabled', () => {
  assert.strictEqual(require('../services/runtime_flags').backgroundEnabled(), false);
  assert.deepStrictEqual(intervalCalls, [], 'setInterval must not run at require time in tests');
});

test('sweepExpiredExcerpts UPDATEs per tenant and never DELETEs', async () => {
  const expired = new Date(Date.now() - 60 * 1000);
  const future = new Date(Date.now() + 86400000);
  rows.push({
    id: ++seq, tenant_id: 1, transcript_excerpt: 'old-plain',
    excerpt_ciphertext: Buffer.from('ct-a'), excerpt_iv: Buffer.from('iv'), excerpt_tag: Buffer.from('tg'),
    excerpt_expires_at: expired, transcript_purged_at: null, created_at: new Date(),
  });
  rows.push({
    id: ++seq, tenant_id: 2, transcript_excerpt: null,
    excerpt_ciphertext: Buffer.from('ct-b'), excerpt_iv: Buffer.from('iv'), excerpt_tag: Buffer.from('tg'),
    excerpt_expires_at: expired, transcript_purged_at: null, created_at: new Date(),
  });
  rows.push({
    id: ++seq, tenant_id: 1, transcript_excerpt: null,
    excerpt_ciphertext: Buffer.from('ct-keep'), excerpt_iv: Buffer.from('iv'), excerpt_tag: Buffer.from('tg'),
    excerpt_expires_at: future, transcript_purged_at: null, created_at: new Date(),
  });

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    await router.sweepExpiredExcerpts();
  } finally {
    console.log = origLog;
  }

  assert.ok(!sqlLog.some(s => /DELETE\s+FROM\s+meeting_notes_runs/i.test(s)), 'sweeper must never DELETE rows');
  const updates = sqlLog.filter(s => /^UPDATE meeting_notes_runs/.test(s));
  assert.ok(updates.length >= 2, 'sweeper must UPDATE per tenant, not one unscoped statement');
  for (const u of updates) {
    assert.match(u, /WHERE tenant_id=\$1/);
    assert.ok(!/RETURNING/i.test(u), 'sweeper must not RETURNING excerpt text');
  }
  assert.strictEqual(rows[0].transcript_excerpt, null);
  assert.strictEqual(rows[0].excerpt_ciphertext, null);
  assert.ok(rows[0].transcript_purged_at);
  assert.strictEqual(rows[1].excerpt_ciphertext, null);
  assert.ok(Buffer.compare(Buffer.from('ct-keep'), rows[2].excerpt_ciphertext) === 0, 'unexpired excerpt ciphertext must remain');
  assert.ok(logs.some(l => /^\[meeting-notes\] swept \d+ expired excerpts$/.test(l)));
});
