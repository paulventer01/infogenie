// test/meeting-notes-retention.test.js — excerpt TTL sweeper + require-time interval.
// DB-less by default. Optional live Postgres case is skipped without DATABASE_URL.

require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert');

const intervalCalls = [];
const origSetInterval = global.setInterval;
global.setInterval = function (...args) {
  intervalCalls.push(args[1]);
  return origSetInterval.apply(this, args);
};
let api;
try {
  api = require('../services/meeting_notes/api');
} finally {
  global.setInterval = origSetInterval;
}

const db = require('../db');

test('sweepExpiredExcerpts is exported', () => {
  assert.strictEqual(typeof api.sweepExpiredExcerpts, 'function');
});

test('requiring api.js starts no sweeper interval unless backgroundEnabled', () => {
  assert.strictEqual(require('../services/runtime_flags').backgroundEnabled(), false);
  assert.deepStrictEqual(intervalCalls, []);
});

test('sweepExpiredExcerpts is a no-op when hasDb() is false', async () => {
  const orig = db.hasDb;
  db.hasDb = () => false;
  try {
    await api.sweepExpiredExcerpts();
  } finally {
    db.hasDb = orig;
  }
});

const HAS_DB = typeof db.hasDb === 'function' && db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — live excerpt TTL sweep skipped';

test('live sweep NULLs expired excerpt columns and never deletes the row', { skip }, async (t) => {
  const { ensureMeetingNotesSchema } = require('../services/meeting_notes/schema');
  const { ensureTenantSchema } = require('../services/tenants/schema');
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-ttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenant = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN TTL ${suffix}`, `mn-ttl-${suffix}`]
  )).rows[0].id;
  t.after(async () => {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenant]).catch(() => {});
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenant]).catch(() => {});
  });

  const ct = Buffer.from('excerpt-ct');
  const iv = Buffer.from('iv-12bytes!!'); // 12 bytes
  const tag = Buffer.from('tag-16-bytes!!!!'); // 16 bytes
  const ins = await p.query(
    `INSERT INTO meeting_notes_runs
       (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by,
        excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at)
     VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,$3,'ai',NULL,$4,$5,$6, now() - interval '1 day')
     RETURNING id`,
    [tenant, 'plain-excerpt-should-go', 'sha-' + suffix, ct, iv, tag]
  );
  const id = ins.rows[0].id;

  await api.sweepExpiredExcerpts();

  const row = (await p.query(
    `SELECT id, transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag, transcript_purged_at
       FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
    [id, tenant]
  )).rows[0];
  assert.ok(row, 'sweeper must not DELETE the row');
  assert.strictEqual(row.id, id);
  assert.strictEqual(row.transcript_excerpt, null);
  assert.strictEqual(row.excerpt_ciphertext, null);
  assert.strictEqual(row.excerpt_iv, null);
  assert.strictEqual(row.excerpt_tag, null);
  assert.ok(row.transcript_purged_at, 'transcript_purged_at must be set');
});
