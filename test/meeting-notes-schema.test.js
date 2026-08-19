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
