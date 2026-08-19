// test/meeting-notes-encryption-backfill.test.js — plaintext → ciphertext backfill
//
// ./helpers/env MUST load before the vault so CREDENTIAL_ENCRYPTION_KEY is cached.
// Live Postgres (skip if !hasDb()). Short fixtures only; TAP does not dump transcripts.

require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const vault = require('../services/credentials/vault');
const { ensureMeetingNotesSchema, backfillMeetingNotesEncryption } = require('../services/meeting_notes/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');

const HAS_DB = db.hasDb();
const skip = HAS_DB ? false : 'no DATABASE_URL — meeting-notes encryption backfill skipped';

const EXCERPT = 'mn-fx-ex';
const SUMMARY = { k: 'v' };

function aadFor(tenantId) {
  return `meeting_notes_runs:tenant:${tenantId}`;
}

test('backfill encrypts plaintext excerpt/summary, scrubs generated_by, and binds AAD to tenant', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-bf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mk = async (label, slug) => (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [label, slug]
  )).rows[0].id;
  const tenantA = await mk(`MN bf A ${suffix}`, `mn-bf-a-${suffix}`);
  const tenantB = await mk(`MN bf B ${suffix}`, `mn-bf-b-${suffix}`);

  let noteId;
  try {
    const ins = await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, transcript_sha256, source, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantA, '{}', JSON.stringify(SUMMARY), EXCERPT, `sha-${suffix}`, 'ai', 'ops@example.test']
    );
    noteId = ins.rows[0].id;

    await ensureMeetingNotesSchema();
    const before = (await p.query(
      `SELECT transcript_excerpt, excerpt_ciphertext, summary_ciphertext, generated_by
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantA]
    )).rows[0];
    assert.strictEqual((before.transcript_excerpt || '').length, EXCERPT.length);
    assert.strictEqual(before.excerpt_ciphertext, null, 'ensureMeetingNotesSchema must not encrypt');
    assert.strictEqual(before.summary_ciphertext, null, 'ensureMeetingNotesSchema must not encrypt summary');
    assert.ok(before.generated_by, 'ensureMeetingNotesSchema must not scrub generated_by');

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.excerpts >= 1, 'at least the seeded excerpt should encrypt');
    assert.ok(result.summaries >= 1, 'at least the seeded summary should encrypt');
    assert.ok(result.generatedBy >= 1, 'at least the seeded generated_by should scrub');

    const row = (await p.query(
      `SELECT tenant_id, transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
              summary, summary_ciphertext, summary_iv, summary_tag, generated_by
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantA]
    )).rows[0];
    assert.ok(row, 'backfilled row must still exist');
    assert.strictEqual(row.tenant_id, tenantA);
    assert.strictEqual(row.transcript_excerpt, null);
    assert.ok(Buffer.isBuffer(row.excerpt_ciphertext) && row.excerpt_ciphertext.length > 0);
    assert.ok(Buffer.isBuffer(row.excerpt_iv) && row.excerpt_iv.length > 0);
    assert.ok(Buffer.isBuffer(row.excerpt_tag) && row.excerpt_tag.length > 0);
    assert.ok(row.excerpt_expires_at, 'excerpt_expires_at should be set from created_at + 30 days');

    assert.deepStrictEqual(row.summary, {});
    assert.ok(Buffer.isBuffer(row.summary_ciphertext) && row.summary_ciphertext.length > 0);
    assert.ok(Buffer.isBuffer(row.summary_iv) && row.summary_iv.length > 0);
    assert.ok(Buffer.isBuffer(row.summary_tag) && row.summary_tag.length > 0);
    assert.strictEqual(row.generated_by, null);

    const plainExcerpt = vault.decryptString(row.excerpt_ciphertext, row.excerpt_iv, row.excerpt_tag, aadFor(tenantA));
    assert.strictEqual(plainExcerpt.length, EXCERPT.length);
    assert.strictEqual(plainExcerpt, EXCERPT);

    const plainSummary = JSON.parse(
      vault.decryptString(row.summary_ciphertext, row.summary_iv, row.summary_tag, aadFor(tenantA))
    );
    assert.deepStrictEqual(plainSummary, SUMMARY);

    assert.throws(() => vault.decryptString(row.excerpt_ciphertext, row.excerpt_iv, row.excerpt_tag, aadFor(tenantB)));
    assert.throws(() => vault.decryptString(row.summary_ciphertext, row.summary_iv, row.summary_tag, aadFor(tenantB)));

    const tenantCol = (await p.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='meeting_notes_runs' AND column_name='tenant_id'`
    )).rows[0];
    assert.ok(tenantCol);
    assert.strictEqual(tenantCol.is_nullable, 'NO', 'tenant_id must remain NOT NULL after backfill');

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    const still = (await p.query(
      `SELECT transcript_excerpt, generated_by, summary
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantA]
    )).rows[0];
    assert.strictEqual(still.transcript_excerpt, null);
    assert.strictEqual(still.generated_by, null);
    assert.deepStrictEqual(still.summary, {});
  } finally {
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) {
      await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id = ANY($1)`, [ids]);
      await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    }
  }
});
