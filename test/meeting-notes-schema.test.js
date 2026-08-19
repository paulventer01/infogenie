// test/meeting-notes-schema.test.js — meeting_notes_runs DDL + tenant_id NOT NULL guard
//
// Gated on DATABASE_URL like tenant-schema-audit. Self-contained: runs
// ensureMeetingNotesSchema() so it does not depend on server.js BOOT_TASKS wiring.

const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureMeetingNotesSchema } = require('../services/meeting_notes/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — meeting-notes schema test skipped';

const CRYPTO_BYTEA = [
  'excerpt_ciphertext',
  'excerpt_iv',
  'excerpt_tag',
  'summary_ciphertext',
  'summary_iv',
  'summary_tag',
];
const CRYPTO_TIMESTAMPTZ = ['excerpt_expires_at', 'transcript_purged_at'];

async function loadMeetingNotesColumns() {
  const p = db.getPool();
  const rows = (await p.query(
    `SELECT column_name, udt_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='meeting_notes_runs'`
  )).rows;
  return new Map(rows.map((r) => [r.column_name, r]));
}

test('meeting_notes_runs exists with NOT NULL tenant_id after ensure', { skip }, async () => {
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const tables = (await p.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='meeting_notes_runs'`
  )).rows;
  assert.strictEqual(tables.length, 1, 'meeting_notes_runs table must exist');

  const col = (await p.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='meeting_notes_runs' AND column_name='tenant_id'`
  )).rows[0];
  assert.ok(col, 'tenant_id column must exist');
  assert.strictEqual(col.is_nullable, 'NO', 'tenant_id must be NOT NULL');
});

test('meeting_notes_runs ciphertext/TTL columns, CHECKs, and TTL index exist', { skip }, async () => {
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const cols = await loadMeetingNotesColumns();

  for (const name of CRYPTO_BYTEA) {
    const col = cols.get(name);
    assert.ok(col, `${name} column must exist`);
    assert.strictEqual(col.udt_name, 'bytea', `${name} must be bytea`);
  }
  for (const name of CRYPTO_TIMESTAMPTZ) {
    const col = cols.get(name);
    assert.ok(col, `${name} column must exist`);
    assert.strictEqual(col.udt_name, 'timestamptz', `${name} must be timestamptz`);
  }

  const tenant = cols.get('tenant_id');
  assert.ok(tenant, 'tenant_id column must exist');
  assert.strictEqual(tenant.is_nullable, 'NO', 'tenant_id must remain NOT NULL');

  const excerpt = cols.get('transcript_excerpt');
  assert.ok(excerpt, 'transcript_excerpt column must still exist');
  assert.strictEqual(excerpt.udt_name, 'text', 'transcript_excerpt must remain TEXT');

  const summary = cols.get('summary');
  assert.ok(summary, 'summary column must still exist');
  assert.strictEqual(summary.udt_name, 'jsonb', 'summary must remain JSONB');

  const checks = (await p.query(
    `SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema='public' AND table_name='meeting_notes_runs'
        AND constraint_type='CHECK'
        AND constraint_name = ANY($1)`
    , [[
      'meeting_notes_runs_excerpt_crypto_check',
      'meeting_notes_runs_summary_crypto_check',
    ]]
  )).rows.map((r) => r.constraint_name).sort();
  assert.deepStrictEqual(checks, [
    'meeting_notes_runs_excerpt_crypto_check',
    'meeting_notes_runs_summary_crypto_check',
  ], 'both crypto CHECK constraints must exist');

  const idx = (await p.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename='meeting_notes_runs'
        AND indexname='idx_meeting_notes_excerpt_ttl'`
  )).rows;
  assert.strictEqual(idx.length, 1, 'idx_meeting_notes_excerpt_ttl must exist');
});
