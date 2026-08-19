// test/meeting-notes-tenant-isolation.test.js — real-DB tenant isolation for meeting_notes_runs
//
// Seeds two workspaces and asserts tenant B cannot read tenant A's persisted notes
// via tenant-filtered SQL (the same WHERE tenant_id=$N guards used by GET /history
// and GET /:id). Gated on DATABASE_URL; no live OpenAI.

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const { ensureMeetingNotesSchema } = require('../services/meeting_notes/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — meeting-notes tenant isolation test skipped';

const SUFFIX = `mn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let tenantA = null;
let tenantB = null;
let noteIdA = null;

before(async () => {
  if (!HAS_DB) return;
  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const mk = async (label, slug) => (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [label, slug]
  )).rows[0].id;
  tenantA = await mk(`MN A ${SUFFIX}`, `mn-a-${SUFFIX}`);
  tenantB = await mk(`MN B ${SUFFIX}`, `mn-b-${SUFFIX}`);

  const summary = { summary: `exec summary ${SUFFIX}`, overall_score: 72 };
  const contact = { name: `Contact ${SUFFIX}` };
  const ins = await p.query(
    `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [tenantA, JSON.stringify(contact), JSON.stringify(summary), 'excerpt', `sha-${SUFFIX}`, 'ai', 'test-seed']
  );
  noteIdA = ins.rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  const p = db.getPool();
  const ids = [tenantA, tenantB].filter(Boolean);
  if (ids.length) {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id = ANY($1)`, [ids]);
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  }
});

test('tenant B history query does not return tenant A notes', { skip }, async () => {
  const p = db.getPool();
  const rows = (await p.query(
    `SELECT id, contact, summary, source, created_at FROM meeting_notes_runs
     WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [tenantB]
  )).rows;
  assert.strictEqual(rows.length, 0, 'tenant B must not see tenant A history rows');
});

test('GET-style id+tenant query for tenant B with tenant A id returns 0 rows', { skip }, async () => {
  const p = db.getPool();
  const rows = (await p.query(
    `SELECT id, contact, summary, source, created_at FROM meeting_notes_runs
     WHERE id=$1 AND tenant_id=$2`,
    [noteIdA, tenantB]
  )).rows;
  assert.strictEqual(rows.length, 0, 'tenant B must not fetch tenant A note by id');
});

test('tenant A can read its own seeded note', { skip }, async () => {
  const p = db.getPool();
  const rows = (await p.query(
    `SELECT id, contact, summary, source, created_at FROM meeting_notes_runs
     WHERE id=$1 AND tenant_id=$2`,
    [noteIdA, tenantA]
  )).rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].summary.summary, `exec summary ${SUFFIX}`);
  // GET /:id serves this projection — the excerpt and hash stay server-side.
  assert.ok(!('transcript_excerpt' in rows[0]));
  assert.ok(!('transcript_sha256' in rows[0]));
});
