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
      `SELECT transcript_excerpt, generated_by, summary, contact
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantA]
    )).rows[0];
    assert.strictEqual(still.transcript_excerpt, null);
    assert.strictEqual(still.generated_by, null);
    assert.deepStrictEqual(still.summary, {});
    assert.deepStrictEqual(still.contact, {});
  } finally {
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) {
      await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id = ANY($1)`, [ids]);
      await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    }
  }
});

test('backfill whitelists contact JSONB to name/company/role and drops extra keys', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-ct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN ct ${suffix}`, `mn-ct-${suffix}`]
  )).rows[0].id;

  let noteId;
  try {
    const dirtyContact = {
      name: 'Ada',
      company: 'Analytic Engines',
      role: 'Operator',
      email: 'ada-pii@example.test',
      phone: '+10000000000',
      notes: 'drop-this-free-text',
    };
    const ins = await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantId, JSON.stringify(dirtyContact), '{}', 'ai']
    );
    noteId = ins.rows[0].id;

    await ensureMeetingNotesSchema();
    const before = (await p.query(
      `SELECT contact, excerpt_ciphertext, summary_ciphertext, generated_by
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.ok(Object.prototype.hasOwnProperty.call(before.contact, 'email'), 'fixture must store extra contact keys');
    assert.ok(Object.prototype.hasOwnProperty.call(before.contact, 'phone'), 'fixture must store extra contact keys');
    assert.strictEqual(before.excerpt_ciphertext, null, 'ensureMeetingNotesSchema must not rewrite contact via encrypt');
    assert.strictEqual(before.summary_ciphertext, null);
    assert.strictEqual(before.generated_by, null);

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.contacts >= 1, 'at least the seeded contact should scrub');

    const row = (await p.query(
      `SELECT tenant_id, contact
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.ok(row, 'scrubbed row must still exist');
    assert.strictEqual(row.tenant_id, tenantId);
    assert.deepStrictEqual(row.contact, {
      name: 'Ada',
      company: 'Analytic Engines',
      role: 'Operator',
    });
    assert.deepStrictEqual(Object.keys(row.contact).sort(), ['company', 'name', 'role']);
    assert.ok(!Object.prototype.hasOwnProperty.call(row.contact, 'email'));
    assert.ok(!Object.prototype.hasOwnProperty.call(row.contact, 'phone'));
    assert.ok(!Object.prototype.hasOwnProperty.call(row.contact, 'notes'));

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.contacts, 0, 'second pass must update 0 contacts');
    const still = (await p.query(
      `SELECT contact FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.deepStrictEqual(still.contact, {
      name: 'Ada',
      company: 'Analytic Engines',
      role: 'Operator',
    });
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('backfill encrypts a full batch of JSON-array summaries and does not hang', { skip, timeout: 30000 }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-arr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN arr ${suffix}`, `mn-arr-${suffix}`]
  )).rows[0].id;

  const ARRAY_SUMMARY = ['x'];
  const ROW_COUNT = 101;
  try {
    const values = [];
    const params = [tenantId];
    for (let i = 0; i < ROW_COUNT; i++) {
      values.push(`($1,$2::jsonb,'ai')`);
    }
    params.push(JSON.stringify(ARRAY_SUMMARY));
    await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, summary, source) VALUES ${values.join(',')}`,
      params
    );

    const before = await p.query(
      `SELECT COUNT(*)::int AS n FROM meeting_notes_runs
        WHERE tenant_id=$1 AND summary_ciphertext IS NULL AND summary <> '{}'::jsonb`,
      [tenantId]
    );
    assert.strictEqual(before.rows[0].n, ROW_COUNT);

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.summaries >= ROW_COUNT, 'all 101 array summaries should encrypt');

    const after = await p.query(
      `SELECT summary, summary_ciphertext, summary_iv, summary_tag
         FROM meeting_notes_runs WHERE tenant_id=$1 ORDER BY id`,
      [tenantId]
    );
    assert.strictEqual(after.rows.length, ROW_COUNT);
    for (const row of after.rows) {
      assert.deepStrictEqual(row.summary, {});
      assert.ok(Buffer.isBuffer(row.summary_ciphertext) && row.summary_ciphertext.length > 0);
      assert.ok(Buffer.isBuffer(row.summary_iv) && row.summary_iv.length > 0);
      assert.ok(Buffer.isBuffer(row.summary_tag) && row.summary_tag.length > 0);
      const plain = JSON.parse(
        vault.decryptString(row.summary_ciphertext, row.summary_iv, row.summary_tag, aadFor(tenantId))
      );
      assert.deepStrictEqual(plain, ARRAY_SUMMARY);
    }

    const leftover = await p.query(
      `SELECT COUNT(*)::int AS n FROM meeting_notes_runs
        WHERE tenant_id=$1 AND summary_ciphertext IS NULL AND summary <> '{}'::jsonb`,
      [tenantId]
    );
    assert.strictEqual(leftover.rows[0].n, 0, 'array summaries must leave the backfill predicate');

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('backfill drops nested contact fields, extra keys, and slices long strings', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-nest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN nest ${suffix}`, `mn-nest-${suffix}`]
  )).rows[0].id;

  const longCompany = 'x'.repeat(250);
  let noteId;
  try {
    const dirtyContact = {
      name: { nested: true },
      company: longCompany,
      email: 'a@b.c',
    };
    const ins = await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantId, JSON.stringify(dirtyContact), '{}', 'ai']
    );
    noteId = ins.rows[0].id;

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.contacts >= 1, 'nested/long contact must be scrubbed');

    const row = (await p.query(
      `SELECT contact FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.deepStrictEqual(row.contact, { company: longCompany.slice(0, 200) });
    assert.deepStrictEqual(Object.keys(row.contact), ['company']);
    assert.strictEqual(row.contact.company.length, 200);
    assert.ok(!Object.prototype.hasOwnProperty.call(row.contact, 'name'));
    assert.ok(!Object.prototype.hasOwnProperty.call(row.contact, 'email'));

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.contacts, 0, 'second pass must update 0 contacts');
    const still = (await p.query(
      `SELECT contact FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.deepStrictEqual(still.contact, { company: longCompany.slice(0, 200) });
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});
