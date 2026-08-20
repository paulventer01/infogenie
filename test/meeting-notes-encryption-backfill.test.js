// test/meeting-notes-encryption-backfill.test.js — plaintext → ciphertext backfill
//
// ./helpers/env MUST load before the vault so CREDENTIAL_ENCRYPTION_KEY is cached.
// Live Postgres (skip if !hasDb()). Short fixtures only; TAP does not dump transcripts.

require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../db');
const vault = require('../services/credentials/vault');
const {
  ensureMeetingNotesSchema,
  backfillMeetingNotesEncryption,
  verifyMeetingNotesEncryption,
  NEEDS_BACKFILL_SQL,
  NONCOMPLIANT_SQL,
} = require('../services/meeting_notes/schema');
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

    const verified = await verifyMeetingNotesEncryption();
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.noncompliant, 0);

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.excerpts, 0, 'second pass must encrypt 0 excerpts');
    assert.strictEqual(again.summaries, 0, 'second pass must encrypt 0 summaries');
    assert.strictEqual(again.generatedBy, 0, 'second pass must scrub 0 generated_by');
    assert.strictEqual(again.contacts, 0, 'second pass must update 0 contacts');
    const still = (await p.query(
      `SELECT transcript_excerpt, generated_by, summary, contact,
              excerpt_ciphertext, summary_ciphertext
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantA]
    )).rows[0];
    assert.strictEqual(still.transcript_excerpt, null);
    assert.strictEqual(still.generated_by, null);
    assert.deepStrictEqual(still.summary, {});
    assert.deepStrictEqual(still.contact, {});
    assert.ok(Buffer.isBuffer(still.excerpt_ciphertext) && still.excerpt_ciphertext.equals(row.excerpt_ciphertext));
    assert.ok(Buffer.isBuffer(still.summary_ciphertext) && still.summary_ciphertext.equals(row.summary_ciphertext));
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

test('backfill encrypts scalar and JSON-null summaries, leaving no plaintext', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-scal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN scal ${suffix}`, `mn-scal-${suffix}`]
  )).rows[0].id;

  // Every JSONB shape a legacy summary can hold that is not an object.
  const SHAPES = ['"mn-scal-secret"', '42', 'true', 'null'];
  try {
    for (const raw of SHAPES) {
      await p.query(
        `INSERT INTO meeting_notes_runs (tenant_id, summary, source) VALUES ($1,$2::jsonb,'ai')`,
        [tenantId, raw]
      );
    }

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.summaries >= SHAPES.length, 'every non-object summary shape must encrypt');

    const after = (await p.query(
      `SELECT summary, summary_ciphertext, summary_iv, summary_tag
         FROM meeting_notes_runs WHERE tenant_id=$1 ORDER BY id`,
      [tenantId]
    )).rows;
    assert.strictEqual(after.length, SHAPES.length);
    after.forEach((row, i) => {
      assert.deepStrictEqual(row.summary, {}, `${SHAPES[i]} must not stay in the summary column`);
      assert.ok(Buffer.isBuffer(row.summary_ciphertext) && row.summary_ciphertext.length > 0);
      const plain = vault.decryptString(
        row.summary_ciphertext, row.summary_iv, row.summary_tag, aadFor(tenantId)
      );
      assert.strictEqual(plain, SHAPES[i], 'ciphertext must round-trip to the original JSON text');
    });

    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM meeting_notes_runs
        WHERE tenant_id=$1 AND summary_ciphertext IS NULL AND summary <> '{}'::jsonb`,
      [tenantId]
    )).rows[0].n;
    assert.strictEqual(leftover, 0, 'no non-object summary may survive as plaintext');

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.summaries, 0, 'a second pass must not re-encrypt');
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('backfill collapses a scalar or array contact to {} without aborting the run', { skip }, async () => {
  // A non-object `contact` also guards the backfill SELECT predicate itself:
  // `contact - ARRAY[...]` raises "cannot delete from scalar" if it is ever
  // evaluated ahead of the jsonb_typeof arm, which would abort the run for
  // EVERY tenant and leave plaintext behind.
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-nonobj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN nonobj ${suffix}`, `mn-nonobj-${suffix}`]
  )).rows[0].id;

  try {
    const scalarId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'"mn-nonobj-pii@example.test"'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;
    const arrayId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'["mn-nonobj-phone", {"email":"a@b.c"}]'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;
    // Same tenant, real pending work: proves the run reached it rather than
    // aborting on the non-object rows above.
    const excerptId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai') RETURNING id`,
      [tenantId, EXCERPT]
    )).rows[0].id;

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.contacts >= 2, 'both non-object contacts must be rewritten');

    const rows = (await p.query(
      `SELECT id, contact, transcript_excerpt, excerpt_ciphertext
         FROM meeting_notes_runs WHERE tenant_id=$1 ORDER BY id`,
      [tenantId]
    )).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.deepStrictEqual(byId.get(scalarId).contact, {}, 'a scalar contact must collapse to {}');
    assert.deepStrictEqual(byId.get(arrayId).contact, {}, 'an array contact must collapse to {}');
    const serialized = JSON.stringify(rows);
    assert.ok(!serialized.includes('mn-nonobj-pii@example.test'), 'scalar contact PII must be gone from the row');
    assert.ok(!serialized.includes('mn-nonobj-phone'), 'array contact PII must be gone from the row');
    assert.ok(!serialized.includes('a@b.c'), 'nested array contact PII must be gone from the row');

    assert.strictEqual(byId.get(excerptId).transcript_excerpt, null, 'the run must still reach later pending rows');
    assert.ok(Buffer.isBuffer(byId.get(excerptId).excerpt_ciphertext));

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.contacts, 0, 'a second pass must update 0 contacts');
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('CASE contact predicate selects scalar/array JSONB without cannot-delete-from-scalar', { skip }, async () => {
  // Postgres does not short-circuit OR. Evaluating `contact - ARRAY[...]` on a
  // scalar/array JSONB raises "cannot delete from scalar" during the batch
  // SELECT, which is outside the per-row catch. The production predicate uses
  // sequential CASE so `- ARRAY` runs only after jsonb_typeof = 'object'.
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');
  assert.ok(NEEDS_BACKFILL_SQL.includes('CASE'), 'contact arm must be CASE, not OR of jsonb operators');
  assert.ok(
    /WHEN jsonb_typeof\(contact\) IS DISTINCT FROM 'object' THEN true[\s\S]*WHEN \(contact - ARRAY/.test(NEEDS_BACKFILL_SQL),
    '`- ARRAY` must appear only in a WHEN after typeof=object'
  );
  assert.ok(NONCOMPLIANT_SQL.includes('CASE'), 'verification contact arm must be CASE');
  assert.ok(
    /WHEN jsonb_typeof\(contact\) = 'null' THEN false[\s\S]*WHEN jsonb_typeof\(contact\) IS DISTINCT FROM 'object' THEN true[\s\S]*WHEN \(contact - ARRAY/.test(NONCOMPLIANT_SQL),
    'verification must treat JSONB null as compliant and apply `- ARRAY` only after typeof=object'
  );

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN case ${suffix}`, `mn-case-${suffix}`]
  )).rows[0].id;

  try {
    const scalarId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'1'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;
    const arrayId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'[1]'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;
    const stringId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'"x"'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;
    const objectId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,$2::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId, JSON.stringify({ name: 'Ada', company: 'Co', role: 'Op', email: 'ada@example.test' })]
    )).rows[0].id;

    const caseIds = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1
          AND (${NEEDS_BACKFILL_SQL})
        ORDER BY id`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.deepStrictEqual(
      caseIds.sort((a, b) => a - b),
      [scalarId, arrayId, stringId, objectId].sort((a, b) => a - b),
      'CASE predicate must select all four fixtures without raising'
    );

    let result;
    try {
      result = await backfillMeetingNotesEncryption();
    } catch (err) {
      assert.fail(`backfillMeetingNotesEncryption must not throw on scalar/array contact: ${err && err.message}`);
    }
    assert.ok(result && result.ok === true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.contacts >= 4, 'scalar, array, string, and extra-key object contacts must scrub');

    const rows = (await p.query(
      `SELECT id, contact FROM meeting_notes_runs WHERE tenant_id=$1`,
      [tenantId]
    )).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.deepStrictEqual(byId.get(scalarId).contact, {}, 'JSONB number contact must collapse to {}');
    assert.deepStrictEqual(byId.get(arrayId).contact, {}, 'JSONB array contact must collapse to {}');
    assert.deepStrictEqual(byId.get(stringId).contact, {}, 'JSONB string contact must collapse to {}');
    assert.deepStrictEqual(byId.get(objectId).contact, { name: 'Ada', company: 'Co', role: 'Op' });
    assert.ok(!Object.prototype.hasOwnProperty.call(byId.get(objectId).contact, 'email'));
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('a full batch the scrubber leaves unchanged does not stall the boot task', { skip, timeout: 30000 }, async () => {
  // A JSONB `null` contact is selected by the backfill predicate but is a no-op
  // for the scrubber (it holds no PII). Without the skipped-id guard, a batch of
  // BACKFILL_BATCH such rows is re-selected forever and the boot task never
  // returns, so every later BOOT_TASKS schema-ensure stops running too.
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-noop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN noop ${suffix}`, `mn-noop-${suffix}`]
  )).rows[0].id;

  const NOOP_ROWS = 101; // > BACKFILL_BATCH, so the loop must run more than once
  try {
    const values = [];
    for (let i = 0; i < NOOP_ROWS; i++) values.push(`($1,'null'::jsonb,'{}'::jsonb,'ai')`);
    await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source) VALUES ${values.join(',')}`,
      [tenantId]
    );
    // Inserted last, so it sorts past the first full batch of no-ops.
    const excerptId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai') RETURNING id`,
      [tenantId, EXCERPT]
    )).rows[0].id;

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true, 'the backfill must return rather than loop');
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');

    const row = (await p.query(
      `SELECT transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [excerptId, tenantId]
    )).rows[0];
    assert.strictEqual(row.transcript_excerpt, null, 'pending work behind the no-op batch must still be done');
    assert.ok(Buffer.isBuffer(row.excerpt_ciphertext) && row.excerpt_ciphertext.length > 0);
    assert.strictEqual(
      vault.decryptString(row.excerpt_ciphertext, row.excerpt_iv, row.excerpt_tag, aadFor(tenantId)),
      EXCERPT
    );

    // Documented residual: a JSONB null contact is left as-is rather than
    // spending a write. If that ever changes, this assertion and
    // docs/security-guardrails.md move together.
    const stillNull = (await p.query(
      `SELECT COUNT(*)::int AS n FROM meeting_notes_runs
        WHERE tenant_id=$1 AND jsonb_typeof(contact)='null'`,
      [tenantId]
    )).rows[0].n;
    assert.strictEqual(stillNull, NOOP_ROWS);

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true, 'a repeat pass over the same no-op rows must also terminate');
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('a poisoned tenant does not abort a second tenant, and each UPDATE stays tenant-scoped', { skip }, async () => {
  // Blast radius of the predicate hazard. `_loadBackfillTenantIds` runs
  // NEEDS_BACKFILL_SQL with no tenant filter and the batch SELECT throw is not
  // caught by the per-row handler, so one tenant holding a non-object `contact`
  // aborts the whole boot task and every other tenant keeps its plaintext.
  // Lower tenant id is walked first, so the poisoned tenant is reached first.
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-blast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mk = async (label, slug) => (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [label, slug]
  )).rows[0].id;
  const poisoned = await mk(`MN blast P ${suffix}`, `mn-blast-p-${suffix}`);
  const clean = await mk(`MN blast C ${suffix}`, `mn-blast-c-${suffix}`);
  assert.ok(poisoned < clean, 'poisoned tenant must sort first so it is walked first');

  const CLEAN_EXCERPT = 'mn-blast-excerpt';
  const CLEAN_SUMMARY = { note: 'mn-blast-summary' };
  try {
    // Every non-object JSONB shape `contact` can hold.
    for (const raw of ['1', '["mn-blast-arr-pii"]', '"mn-blast-str-pii"', 'true', 'null']) {
      await p.query(
        `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
         VALUES ($1,$2::jsonb,'{}'::jsonb,'ai')`,
        [poisoned, raw]
      );
    }

    const cleanId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source, generated_by)
       VALUES ($1,$2::jsonb,$3::jsonb,$4,'ai',$5) RETURNING id`,
      [
        clean,
        JSON.stringify({ name: 'Grace', company: 'Compilers', role: 'Lead', email: 'mn-blast-clean@example.test' }),
        JSON.stringify(CLEAN_SUMMARY),
        CLEAN_EXCERPT,
        'ops-mn-blast@example.test',
      ]
    )).rows[0].id;

    const result = await backfillMeetingNotesEncryption();
    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');

    // The second tenant's plaintext must actually have been processed.
    const cleanRow = (await p.query(
      `SELECT tenant_id, contact, summary, transcript_excerpt, generated_by,
              excerpt_ciphertext, excerpt_iv, excerpt_tag,
              summary_ciphertext, summary_iv, summary_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [cleanId, clean]
    )).rows[0];
    assert.ok(cleanRow, 'the second tenant row must survive the run');
    assert.strictEqual(cleanRow.tenant_id, clean, 'backfill must not move a row between tenants');
    assert.strictEqual(cleanRow.transcript_excerpt, null, 'poisoned tenant must not leave later plaintext behind');
    assert.strictEqual(cleanRow.generated_by, null, 'email generated_by must still be scrubbed');
    assert.deepStrictEqual(cleanRow.summary, {});
    assert.deepStrictEqual(cleanRow.contact, { name: 'Grace', company: 'Compilers', role: 'Lead' });
    assert.strictEqual(
      vault.decryptString(cleanRow.excerpt_ciphertext, cleanRow.excerpt_iv, cleanRow.excerpt_tag, aadFor(clean)),
      CLEAN_EXCERPT
    );
    assert.deepStrictEqual(
      JSON.parse(vault.decryptString(cleanRow.summary_ciphertext, cleanRow.summary_iv, cleanRow.summary_tag, aadFor(clean))),
      CLEAN_SUMMARY
    );
    // AAD binds the ciphertext to its own tenant, so the poisoned tenant cannot read it.
    assert.throws(() => vault.decryptString(
      cleanRow.excerpt_ciphertext, cleanRow.excerpt_iv, cleanRow.excerpt_tag, aadFor(poisoned)
    ));
    assert.throws(() => vault.decryptString(
      cleanRow.summary_ciphertext, cleanRow.summary_iv, cleanRow.summary_tag, aadFor(poisoned)
    ));

    const poisonedRows = (await p.query(
      `SELECT id, tenant_id, contact, summary, transcript_excerpt, generated_by,
              excerpt_ciphertext, summary_ciphertext
         FROM meeting_notes_runs WHERE tenant_id=$1 ORDER BY id`,
      [poisoned]
    )).rows;
    assert.strictEqual(poisonedRows.length, 5, 'the tenant-scoped UPDATE must not delete or reassign rows');
    for (const row of poisonedRows) {
      assert.strictEqual(row.tenant_id, poisoned);
      assert.ok(
        row.contact === null || Object.keys(row.contact).length === 0,
        'every non-object contact must end as {} or JSONB null'
      );
    }
    // Nothing from the other tenant may have been written into these rows.
    const poisonedBlob = JSON.stringify(poisonedRows);
    for (const leak of ['mn-blast-arr-pii', 'mn-blast-str-pii', 'mn-blast-clean@example.test', CLEAN_EXCERPT, 'mn-blast-summary', 'Grace']) {
      assert.ok(!poisonedBlob.includes(leak), `poisoned tenant rows must not hold ${leak}`);
    }

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true, 'a repeat pass must still terminate');
  } finally {
    const ids = [poisoned, clean].filter(Boolean);
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id = ANY($1)`, [ids]);
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  }
});

test('backfill logs row counts only — never contact PII, excerpt text, or key material', { skip }, async () => {
  // The backfill runs on the boot path, so its output lands in production logs.
  // It handles transcript excerpts, summaries, contact email/phone and operator
  // emails; none of that may be echoed, and neither may the vault key.
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN log ${suffix}`, `mn-log-${suffix}`]
  )).rows[0].id;

  const SECRETS = [
    'mn-log-excerpt-body',
    'mn-log-summary-body',
    'mn-log-contact@example.test',
    'mn-log-phone-5551212',
    'mn-log-operator@example.test',
    'mn-log-free-text-note',
  ];
  const captured = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  try {
    await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source, generated_by)
       VALUES ($1,$2::jsonb,$3::jsonb,$4,'ai',$5)`,
      [
        tenantId,
        JSON.stringify({
          name: 'Ada',
          email: 'mn-log-contact@example.test',
          phone: 'mn-log-phone-5551212',
          notes: 'mn-log-free-text-note',
        }),
        JSON.stringify({ body: 'mn-log-summary-body' }),
        'mn-log-excerpt-body',
        'mn-log-operator@example.test',
      ]
    );
    // A scalar contact so the "skipped a row" / non-object paths log too.
    await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'"mn-log-contact@example.test"'::jsonb,'{}'::jsonb,'ai')`,
      [tenantId]
    );

    const grab = (...args) => { captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
    let result;
    try {
      result = await backfillMeetingNotesEncryption();
    } finally {
      console.log = original.log; console.warn = original.warn;
      console.error = original.error; console.info = original.info;
    }
    assert.strictEqual(result.ok, true);
    assert.ok(captured.length, 'the backfill must still emit its summary line');
    const logged = captured.join('\n');
    assert.ok(
      logged.includes('meeting_notes_backfill_verify') || /verify noncompliant=/.test(logged),
      'backfill must emit a verification log line'
    );
    assert.ok(
      logged.includes('meeting_notes_backfill_complete') || /backfill encrypted /.test(logged),
      'backfill must emit a completion summary'
    );
    for (const secret of SECRETS) {
      assert.ok(!logged.includes(secret), `backfill logs must not contain ${secret}`);
    }
    assert.ok(
      !logged.includes(process.env.CREDENTIAL_ENCRYPTION_KEY),
      'backfill logs must not contain the vault key'
    );
    // Ciphertext/IV/tag bytes must not be echoed either.
    const row = (await p.query(
      `SELECT excerpt_ciphertext, summary_ciphertext FROM meeting_notes_runs
        WHERE tenant_id=$1 AND excerpt_ciphertext IS NOT NULL`,
      [tenantId]
    )).rows[0];
    assert.ok(row, 'the PII fixture must have encrypted');
    for (const buf of [row.excerpt_ciphertext, row.summary_ciphertext]) {
      if (!buf) continue;
      assert.ok(!logged.includes(buf.toString('base64')), 'backfill logs must not contain ciphertext');
      assert.ok(!logged.includes(buf.toString('hex')), 'backfill logs must not contain ciphertext');
    }
  } finally {
    console.log = original.log; console.warn = original.warn;
    console.error = original.error; console.info = original.info;
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

test('a failed encrypt row cannot yield false-success and does not abort a second tenant', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mk = async (label, slug) => (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [label, slug]
  )).rows[0].id;
  const poisoned = await mk(`MN fail P ${suffix}`, `mn-fail-p-${suffix}`);
  const clean = await mk(`MN fail C ${suffix}`, `mn-fail-c-${suffix}`);
  assert.ok(poisoned < clean, 'poisoned tenant must sort first so it is walked first');

  const POISON_EXCERPT = 'mn-fail-poison-excerpt';
  const CLEAN_EXCERPT = 'mn-fail-clean-excerpt';
  const origEncrypt = vault.encryptString;
  const prevEnv = process.env.NODE_ENV;
  const captured = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const grab = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  try {
    const poisonId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai') RETURNING id`,
      [poisoned, POISON_EXCERPT]
    )).rows[0].id;
    const cleanId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai') RETURNING id`,
      [clean, CLEAN_EXCERPT]
    )).rows[0].id;

    if (prevEnv === 'production') process.env.NODE_ENV = 'test';
    vault.encryptString = function (plaintext, aad) {
      if (plaintext === POISON_EXCERPT) throw new Error('forced encrypt failure');
      return origEncrypt.call(this, plaintext, aad);
    };
    console.log = grab; console.warn = grab; console.error = grab; console.info = grab;

    let result;
    try {
      result = await backfillMeetingNotesEncryption();
    } finally {
      console.log = original.log; console.warn = original.warn;
      console.error = original.error; console.info = original.info;
      vault.encryptString = origEncrypt;
    }

    assert.strictEqual(result.ok, false, 'encrypt failure must not report success');
    assert.ok(result.failed >= 1, 'failed encrypt row must be counted');
    assert.ok(
      (result.failedIds || []).some((ref) => ref.tenant_id === poisoned && ref.id === poisonId),
      'failedIds must include the poisoned row as tenant_id/id only'
    );
    assert.ok(result.noncompliant >= 1, 'verification must still see leftover plaintext');
    assert.ok((result.byReason && result.byReason.plaintext_excerpt) >= 1);

    const poisonRow = (await p.query(
      `SELECT transcript_excerpt, excerpt_ciphertext
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [poisonId, poisoned]
    )).rows[0];
    assert.strictEqual(poisonRow.transcript_excerpt, POISON_EXCERPT, 'failed row must keep plaintext');
    assert.strictEqual(poisonRow.excerpt_ciphertext, null);

    const cleanRow = (await p.query(
      `SELECT transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [cleanId, clean]
    )).rows[0];
    assert.strictEqual(cleanRow.transcript_excerpt, null, 'second tenant must still be encrypted');
    assert.ok(Buffer.isBuffer(cleanRow.excerpt_ciphertext) && cleanRow.excerpt_ciphertext.length > 0);
    assert.strictEqual(
      vault.decryptString(cleanRow.excerpt_ciphertext, cleanRow.excerpt_iv, cleanRow.excerpt_tag, aadFor(clean)),
      CLEAN_EXCERPT
    );

    const logged = captured.join('\n');
    assert.ok(logged.includes(`id=${poisonId}`), 'failure logs must include the row id');
    assert.ok(
      logged.includes('meeting_notes_backfill_row_failed') || /backfill row failed/.test(logged),
      'failure logs must name the row-failed event'
    );
    assert.ok(!logged.includes(POISON_EXCERPT), 'failure logs must not contain excerpt plaintext');
    assert.ok(!logged.includes(CLEAN_EXCERPT), 'failure logs must not contain the other tenant excerpt');
    assert.ok(
      !logged.includes(process.env.CREDENTIAL_ENCRYPTION_KEY),
      'failure logs must not contain the vault key'
    );
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    vault.encryptString = origEncrypt;
    console.log = original.log; console.warn = original.warn;
    console.error = original.error; console.info = original.info;
    const ids = [poisoned, clean].filter(Boolean);
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id = ANY($1)`, [ids]);
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  }
});

test('production backfill throws when leftover plaintext remains', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN prod ${suffix}`, `mn-prod-${suffix}`]
  )).rows[0].id;

  const LEFTOVER = 'mn-prod-leftover-excerpt';
  const origEncrypt = vault.encryptString;
  const prevEnv = process.env.NODE_ENV;
  try {
    await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai')`,
      [tenantId, LEFTOVER]
    );

    const before = await verifyMeetingNotesEncryption();
    assert.strictEqual(before.ok, false);
    assert.ok(before.noncompliant >= 1);
    assert.ok((before.byReason && before.byReason.plaintext_excerpt) >= 1);

    vault.encryptString = () => { throw new Error('encrypt stubbed off'); };
    process.env.NODE_ENV = 'production';

    let threw = false;
    try {
      await backfillMeetingNotesEncryption();
    } catch (err) {
      threw = true;
      assert.ok(err instanceof Error);
      assert.match(String(err.message), /failed closed/i);
      assert.ok(!String(err.message).includes(LEFTOVER), 'throw message must not include excerpt text');
      assert.ok(
        !String(err.message).includes(process.env.CREDENTIAL_ENCRYPTION_KEY || ''),
        'throw message must not include the vault key'
      );
    }
    assert.ok(threw, 'production backfill must throw while leftover plaintext remains');

    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM meeting_notes_runs
        WHERE tenant_id=$1 AND transcript_excerpt IS NOT NULL`,
      [tenantId]
    )).rows[0].n;
    assert.ok(leftover >= 1, 'plaintext must still be present after the failed production run');
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    vault.encryptString = origEncrypt;
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('verification detects leftover PII shapes and partial crypto without dumping values', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN ver ${suffix}`, `mn-ver-${suffix}`]
  )).rows[0].id;

  const restoreExcerptCheck = async () => {
    try {
      await p.query(`
        ALTER TABLE meeting_notes_runs
          ADD CONSTRAINT meeting_notes_runs_excerpt_crypto_check
          CHECK (
            (excerpt_ciphertext IS NULL AND excerpt_iv IS NULL AND excerpt_tag IS NULL)
            OR
            (excerpt_ciphertext IS NOT NULL AND excerpt_iv IS NOT NULL AND excerpt_tag IS NOT NULL)
          )
      `);
    } catch (_e) { /* already present */ }
  };
  const restoreSummaryCheck = async () => {
    try {
      await p.query(`
        ALTER TABLE meeting_notes_runs
          ADD CONSTRAINT meeting_notes_runs_summary_crypto_check
          CHECK (
            (summary_ciphertext IS NULL AND summary_iv IS NULL AND summary_tag IS NULL)
            OR
            (summary_ciphertext IS NOT NULL AND summary_iv IS NOT NULL AND summary_tag IS NOT NULL)
          )
      `);
    } catch (_e) { /* already present */ }
  };

  try {
    const excerptId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, transcript_excerpt, source)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai') RETURNING id`,
      [tenantId, 'mn-ver-excerpt']
    )).rows[0].id;
    const summaryId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'{}'::jsonb,$2::jsonb,'ai') RETURNING id`,
      [tenantId, JSON.stringify({ body: 'mn-ver-summary' })]
    )).rows[0].id;
    const emailId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source, generated_by)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,'ai',$2) RETURNING id`,
      [tenantId, 'ops-mn-ver@example.test']
    )).rows[0].id;
    const extraId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,$2::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId, JSON.stringify({ name: 'Ada', email: 'mn-ver-extra@example.test' })]
    )).rows[0].id;
    const nonStringId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,$2::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId, JSON.stringify({ name: { nested: true } })]
    )).rows[0].id;
    const longId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,$2::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId, JSON.stringify({ company: 'y'.repeat(201) })]
    )).rows[0].id;
    const scalarId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'"mn-ver-scalar"'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;
    const jsonNullId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source)
       VALUES ($1,'null'::jsonb,'{}'::jsonb,'ai') RETURNING id`,
      [tenantId]
    )).rows[0].id;

    await p.query(`ALTER TABLE meeting_notes_runs DROP CONSTRAINT IF EXISTS meeting_notes_runs_excerpt_crypto_check`);
    await p.query(`ALTER TABLE meeting_notes_runs DROP CONSTRAINT IF EXISTS meeting_notes_runs_summary_crypto_check`);
    const partialExcerptId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source, excerpt_ciphertext)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,'ai', decode('00','hex')) RETURNING id`,
      [tenantId]
    )).rows[0].id;
    const partialSummaryId = (await p.query(
      `INSERT INTO meeting_notes_runs (tenant_id, contact, summary, source, summary_ciphertext)
       VALUES ($1,'{}'::jsonb,'{}'::jsonb,'ai', decode('00','hex')) RETURNING id`,
      [tenantId]
    )).rows[0].id;

    const verified = await verifyMeetingNotesEncryption();
    assert.strictEqual(verified.ok, false);
    assert.ok(verified.noncompliant >= 8, 'every leftover shape except JSONB null must count');
    assert.ok(verified.byReason.plaintext_excerpt >= 1);
    assert.ok(verified.byReason.plaintext_summary >= 1);
    assert.ok(verified.byReason.email_generated_by >= 1);
    assert.ok(verified.byReason.contact_extra_keys >= 1);
    assert.ok(verified.byReason.contact_non_string >= 1);
    assert.ok(verified.byReason.contact_too_long >= 1);
    assert.ok(verified.byReason.contact_non_object >= 1);
    assert.ok(verified.byReason.partial_excerpt_crypto >= 1);
    assert.ok(verified.byReason.partial_summary_crypto >= 1);

    const sampleSet = new Set((verified.sampleIds || []).map((s) => s.id));
    for (const id of [excerptId, summaryId, emailId, extraId, nonStringId, longId, scalarId, partialExcerptId, partialSummaryId]) {
      assert.ok(
        sampleSet.has(id) || verified.noncompliant > (verified.sampleIds || []).length,
        `sampleIds should include ${id} or be capped while still counting it`
      );
    }
    for (const ref of verified.sampleIds || []) {
      assert.ok(ref.tenant_id != null && ref.id != null, 'sampleIds must be tenant_id/id only');
      assert.deepStrictEqual(Object.keys(ref).sort(), ['id', 'tenant_id']);
    }
    assert.ok(
      !(verified.sampleIds || []).some((s) => s.id === jsonNullId),
      'JSONB null contact must remain compliant'
    );

    const localIds = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NONCOMPLIANT_SQL})
        ORDER BY id`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(!localIds.includes(jsonNullId), 'JSONB null contact must not match NONCOMPLIANT_SQL');
    for (const id of [excerptId, summaryId, emailId, extraId, nonStringId, longId, scalarId, partialExcerptId, partialSummaryId]) {
      assert.ok(localIds.includes(id), `tenant-scoped NONCOMPLIANT_SQL must select id=${id}`);
    }

    const serialized = JSON.stringify(verified);
    assert.ok(!serialized.includes('mn-ver-excerpt'));
    assert.ok(!serialized.includes('mn-ver-summary'));
    assert.ok(!serialized.includes('ops-mn-ver@example.test'));
    assert.ok(!serialized.includes('mn-ver-extra@example.test'));
    assert.ok(!serialized.includes('mn-ver-scalar'));
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await restoreExcerptCheck();
    await restoreSummaryCheck();
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('backfill clears leftover plaintext beside a complete ciphertext triple without re-encrypting', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-dual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN dual ${suffix}`, `mn-dual-${suffix}`]
  )).rows[0].id;

  const DUAL_EXCERPT = 'mn-dual-excerpt-body';
  const DUAL_SUMMARY = { body: 'mn-dual-summary-body' };
  const aad = aadFor(tenantId);
  const excerptEnc = vault.encryptString(DUAL_EXCERPT, aad);
  const summaryEnc = vault.encryptString(JSON.stringify(DUAL_SUMMARY), aad);

  const captured = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const grab = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  try {
    const excerptId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, transcript_excerpt, source,
         excerpt_ciphertext, excerpt_iv, excerpt_tag
       ) VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai',$3,$4,$5) RETURNING id`,
      [tenantId, DUAL_EXCERPT, excerptEnc.ciphertext, excerptEnc.iv, excerptEnc.tag]
    )).rows[0].id;
    const summaryId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, source,
         summary_ciphertext, summary_iv, summary_tag
       ) VALUES ($1,'{}'::jsonb,$2::jsonb,'ai',$3,$4,$5) RETURNING id`,
      [tenantId, JSON.stringify(DUAL_SUMMARY), summaryEnc.ciphertext, summaryEnc.iv, summaryEnc.tag]
    )).rows[0].id;

    const before = await verifyMeetingNotesEncryption();
    assert.strictEqual(before.ok, false, 'dual-state leftover plaintext must fail verification before heal');
    assert.ok(before.noncompliant >= 2);
    assert.ok((before.byReason && before.byReason.plaintext_excerpt) >= 1);
    assert.ok((before.byReason && before.byReason.plaintext_summary) >= 1);

    const selected = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NEEDS_BACKFILL_SQL})
        ORDER BY id`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(selected.includes(excerptId), 'NEEDS_BACKFILL_SQL must select dual-state excerpt');
    assert.ok(selected.includes(summaryId), 'NEEDS_BACKFILL_SQL must select dual-state summary');

    console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
    let result;
    try {
      result = await backfillMeetingNotesEncryption();
    } finally {
      console.log = original.log; console.warn = original.warn;
      console.error = original.error; console.info = original.info;
    }

    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.excerpts >= 1, 'dual-state excerpt plaintext must be cleared');
    assert.ok(result.summaries >= 1, 'dual-state summary plaintext must be cleared');

    const excerptRow = (await p.query(
      `SELECT transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [excerptId, tenantId]
    )).rows[0];
    assert.strictEqual(excerptRow.transcript_excerpt, null);
    assert.ok(Buffer.isBuffer(excerptRow.excerpt_ciphertext) && excerptRow.excerpt_ciphertext.equals(excerptEnc.ciphertext));
    assert.ok(Buffer.isBuffer(excerptRow.excerpt_iv) && excerptRow.excerpt_iv.equals(excerptEnc.iv));
    assert.ok(Buffer.isBuffer(excerptRow.excerpt_tag) && excerptRow.excerpt_tag.equals(excerptEnc.tag));
    assert.strictEqual(
      vault.decryptString(excerptRow.excerpt_ciphertext, excerptRow.excerpt_iv, excerptRow.excerpt_tag, aad),
      DUAL_EXCERPT
    );

    const summaryRow = (await p.query(
      `SELECT summary, summary_ciphertext, summary_iv, summary_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [summaryId, tenantId]
    )).rows[0];
    assert.deepStrictEqual(summaryRow.summary, {});
    assert.ok(Buffer.isBuffer(summaryRow.summary_ciphertext) && summaryRow.summary_ciphertext.equals(summaryEnc.ciphertext));
    assert.ok(Buffer.isBuffer(summaryRow.summary_iv) && summaryRow.summary_iv.equals(summaryEnc.iv));
    assert.ok(Buffer.isBuffer(summaryRow.summary_tag) && summaryRow.summary_tag.equals(summaryEnc.tag));
    assert.deepStrictEqual(
      JSON.parse(vault.decryptString(summaryRow.summary_ciphertext, summaryRow.summary_iv, summaryRow.summary_tag, aad)),
      DUAL_SUMMARY
    );

    const verified = await verifyMeetingNotesEncryption();
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.noncompliant, 0);

    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.excerpts, 0, 'second pass must not re-clear excerpts');
    assert.strictEqual(again.summaries, 0, 'second pass must not re-clear summaries');
    assert.strictEqual(again.generatedBy, 0);
    assert.strictEqual(again.contacts, 0);

    const stillExcerpt = (await p.query(
      `SELECT excerpt_ciphertext, excerpt_iv, excerpt_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [excerptId, tenantId]
    )).rows[0];
    assert.ok(stillExcerpt.excerpt_ciphertext.equals(excerptEnc.ciphertext));
    assert.ok(stillExcerpt.excerpt_iv.equals(excerptEnc.iv));
    assert.ok(stillExcerpt.excerpt_tag.equals(excerptEnc.tag));

    const logged = captured.join('\n');
    assert.ok(!logged.includes(DUAL_EXCERPT), 'heal logs must not contain leftover excerpt plaintext');
    assert.ok(!logged.includes('mn-dual-summary-body'), 'heal logs must not contain leftover summary plaintext');
    assert.ok(
      !logged.includes(process.env.CREDENTIAL_ENCRYPTION_KEY),
      'heal logs must not contain the vault key'
    );
    assert.ok(!logged.includes(excerptEnc.ciphertext.toString('base64')));
    assert.ok(!logged.includes(summaryEnc.ciphertext.toString('base64')));
  } finally {
    console.log = original.log; console.warn = original.warn;
    console.error = original.error; console.info = original.info;
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

function _ttlMatchesCreatedPlus30(row) {
  if (row.ttl_matches === true) return true;
  const expectedMs = new Date(row.expected_expires).getTime();
  const actualMs = new Date(row.excerpt_expires_at).getTime();
  return Number.isFinite(expectedMs) && Number.isFinite(actualMs) && actualMs === expectedMs;
}

test('backfill assigns excerpt TTL on dual-state and encrypted-only complete triples without re-encrypting', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-ttl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN ttl ${suffix}`, `mn-ttl-${suffix}`]
  )).rows[0].id;

  const DUAL_EXCERPT = 'mn-ttl-dual-excerpt-body';
  const ENC_ONLY_EXCERPT = 'mn-ttl-enconly-excerpt-body';
  const SUMMARY = { body: 'mn-ttl-summary-keep' };
  const CONTACT = { name: 'Ada', company: 'Co', role: 'Op' };
  const SOURCE = 'ai';
  const aad = aadFor(tenantId);
  const dualEnc = vault.encryptString(DUAL_EXCERPT, aad);
  const encOnly = vault.encryptString(ENC_ONLY_EXCERPT, aad);
  const summaryEnc = vault.encryptString(JSON.stringify(SUMMARY), aad);

  const captured = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const grab = (...args) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  try {
    const dualId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, transcript_excerpt, source,
         excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
         summary_ciphertext, summary_iv, summary_tag
       ) VALUES ($1,$2::jsonb,'{}'::jsonb,$3,$4,$5,$6,$7,NULL,$8,$9,$10)
       RETURNING id, tenant_id, source, created_at, contact`,
      [
        tenantId, JSON.stringify(CONTACT), DUAL_EXCERPT, SOURCE,
        dualEnc.ciphertext, dualEnc.iv, dualEnc.tag,
        summaryEnc.ciphertext, summaryEnc.iv, summaryEnc.tag,
      ]
    )).rows[0];
    const encOnlyId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, transcript_excerpt, source,
         excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
         summary_ciphertext, summary_iv, summary_tag
       ) VALUES ($1,$2::jsonb,'{}'::jsonb,NULL,$3,$4,$5,$6,NULL,$7,$8,$9)
       RETURNING id, tenant_id, source, created_at, contact`,
      [
        tenantId, JSON.stringify(CONTACT), SOURCE,
        encOnly.ciphertext, encOnly.iv, encOnly.tag,
        summaryEnc.ciphertext, summaryEnc.iv, summaryEnc.tag,
      ]
    )).rows[0];
    const plainOnlyId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, transcript_excerpt, source
       ) VALUES ($1,'{}'::jsonb,'{}'::jsonb,$2,'ai') RETURNING id`,
      [tenantId, 'mn-ttl-plain-only-excerpt']
    )).rows[0].id;

    const before = await verifyMeetingNotesEncryption();
    assert.strictEqual(before.ok, false, 'missing excerpt TTL must fail verification before heal');
    assert.ok((before.byReason && before.byReason.missing_excerpt_ttl) >= 1);
    assert.ok((before.byReason && before.byReason.plaintext_excerpt) >= 1);

    const selected = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NEEDS_BACKFILL_SQL})
        ORDER BY id`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(selected.includes(dualId.id), 'NEEDS_BACKFILL_SQL must select dual-state complete triple');
    assert.ok(selected.includes(encOnlyId.id), 'NEEDS_BACKFILL_SQL must select encrypted-only complete triple with NULL TTL');
    assert.ok(selected.includes(plainOnlyId), 'plaintext-only NULL TTL is selected via transcript_excerpt');

    const noncompliantIds = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NONCOMPLIANT_SQL})
        ORDER BY id`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(noncompliantIds.includes(dualId.id));
    assert.ok(noncompliantIds.includes(encOnlyId.id));
    assert.ok(noncompliantIds.includes(plainOnlyId));

    console.log = grab; console.warn = grab; console.error = grab; console.info = grab;
    let result;
    try {
      result = await backfillMeetingNotesEncryption();
    } finally {
      console.log = original.log; console.warn = original.warn;
      console.error = original.error; console.info = original.info;
    }

    assert.strictEqual(result.ok, true);
    assert.ok(!result.skipped, 'backfill should not skip when db and key are present');
    assert.ok(result.excerpts >= 3, 'dual-state, encrypted-only TTL, and plaintext-only must count');
    assert.ok((result.ttls || 0) >= 2, 'TTL repairs must be counted so they are not a no-op hang');

    const afterSql = `
      SELECT id, tenant_id, source, created_at, contact, transcript_excerpt,
             excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
             summary, summary_ciphertext, summary_iv, summary_tag,
             created_at + interval '30 days' AS expected_expires,
             (excerpt_expires_at = created_at + interval '30 days') AS ttl_matches
        FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`;

    const dualRow = (await p.query(afterSql, [dualId.id, tenantId])).rows[0];
    assert.ok(dualRow, 'dual-state row must not be deleted');
    assert.strictEqual(dualRow.tenant_id, dualId.tenant_id);
    assert.strictEqual(dualRow.source, SOURCE);
    assert.strictEqual(new Date(dualRow.created_at).getTime(), new Date(dualId.created_at).getTime());
    assert.deepStrictEqual(dualRow.contact, CONTACT);
    assert.strictEqual(dualRow.transcript_excerpt, null);
    assert.ok(Buffer.isBuffer(dualRow.excerpt_ciphertext) && dualRow.excerpt_ciphertext.equals(dualEnc.ciphertext));
    assert.ok(Buffer.isBuffer(dualRow.excerpt_iv) && dualRow.excerpt_iv.equals(dualEnc.iv));
    assert.ok(Buffer.isBuffer(dualRow.excerpt_tag) && dualRow.excerpt_tag.equals(dualEnc.tag));
    assert.ok(_ttlMatchesCreatedPlus30(dualRow), 'dual-state TTL must be created_at + 30 days');
    assert.deepStrictEqual(dualRow.summary, {});
    assert.ok(Buffer.isBuffer(dualRow.summary_ciphertext) && dualRow.summary_ciphertext.equals(summaryEnc.ciphertext));
    assert.ok(Buffer.isBuffer(dualRow.summary_iv) && dualRow.summary_iv.equals(summaryEnc.iv));
    assert.ok(Buffer.isBuffer(dualRow.summary_tag) && dualRow.summary_tag.equals(summaryEnc.tag));

    const encRow = (await p.query(afterSql, [encOnlyId.id, tenantId])).rows[0];
    assert.ok(encRow, 'encrypted-only row must not be deleted');
    assert.strictEqual(encRow.tenant_id, encOnlyId.tenant_id);
    assert.strictEqual(encRow.source, SOURCE);
    assert.strictEqual(new Date(encRow.created_at).getTime(), new Date(encOnlyId.created_at).getTime());
    assert.deepStrictEqual(encRow.contact, CONTACT);
    assert.strictEqual(encRow.transcript_excerpt, null);
    assert.ok(Buffer.isBuffer(encRow.excerpt_ciphertext) && encRow.excerpt_ciphertext.equals(encOnly.ciphertext));
    assert.ok(Buffer.isBuffer(encRow.excerpt_iv) && encRow.excerpt_iv.equals(encOnly.iv));
    assert.ok(Buffer.isBuffer(encRow.excerpt_tag) && encRow.excerpt_tag.equals(encOnly.tag));
    assert.ok(_ttlMatchesCreatedPlus30(encRow), 'encrypted-only TTL must be created_at + 30 days');
    assert.deepStrictEqual(encRow.summary, {});
    assert.ok(Buffer.isBuffer(encRow.summary_ciphertext) && encRow.summary_ciphertext.equals(summaryEnc.ciphertext));
    assert.ok(Buffer.isBuffer(encRow.summary_iv) && encRow.summary_iv.equals(summaryEnc.iv));
    assert.ok(Buffer.isBuffer(encRow.summary_tag) && encRow.summary_tag.equals(summaryEnc.tag));

    const afterVerify = await verifyMeetingNotesEncryption();
    const leftoverTtl = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NONCOMPLIANT_SQL})`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(!leftoverTtl.includes(dualId.id), 'repaired dual-state row must leave NONCOMPLIANT_SQL');
    assert.ok(!leftoverTtl.includes(encOnlyId.id), 'repaired encrypted-only row must leave NONCOMPLIANT_SQL');
    assert.ok(!leftoverTtl.includes(plainOnlyId), 'plaintext-only encrypt path must leave NONCOMPLIANT_SQL');
    assert.strictEqual(afterVerify.ok, true);
    assert.strictEqual(afterVerify.noncompliant, 0);

    const dualExpiry = dualRow.excerpt_expires_at;
    const encExpiry = encRow.excerpt_expires_at;
    const again = await backfillMeetingNotesEncryption();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.excerpts, 0, 'second pass must not mutate excerpts');
    assert.strictEqual(again.ttls || 0, 0, 'second pass must not re-assign TTLs');
    assert.strictEqual(again.summaries, 0);
    assert.strictEqual(again.generatedBy, 0);
    assert.strictEqual(again.contacts, 0);

    const stillDual = (await p.query(afterSql, [dualId.id, tenantId])).rows[0];
    const stillEnc = (await p.query(afterSql, [encOnlyId.id, tenantId])).rows[0];
    assert.strictEqual(new Date(stillDual.excerpt_expires_at).getTime(), new Date(dualExpiry).getTime());
    assert.strictEqual(new Date(stillEnc.excerpt_expires_at).getTime(), new Date(encExpiry).getTime());
    assert.ok(stillDual.excerpt_ciphertext.equals(dualEnc.ciphertext));
    assert.ok(stillDual.excerpt_iv.equals(dualEnc.iv));
    assert.ok(stillDual.excerpt_tag.equals(dualEnc.tag));
    assert.ok(stillEnc.excerpt_ciphertext.equals(encOnly.ciphertext));
    assert.ok(stillEnc.excerpt_iv.equals(encOnly.iv));
    assert.ok(stillEnc.excerpt_tag.equals(encOnly.tag));

    const logged = captured.join('\n');
    for (const secret of [DUAL_EXCERPT, ENC_ONLY_EXCERPT, 'mn-ttl-plain-only-excerpt', 'mn-ttl-summary-keep']) {
      assert.ok(!logged.includes(secret), `TTL heal logs must not contain ${secret}`);
    }
    assert.ok(!logged.includes(process.env.CREDENTIAL_ENCRYPTION_KEY), 'TTL heal logs must not contain the vault key');
    for (const buf of [dualEnc.ciphertext, dualEnc.iv, dualEnc.tag, encOnly.ciphertext, encOnly.iv, encOnly.tag, summaryEnc.ciphertext]) {
      assert.ok(!logged.includes(buf.toString('base64')), 'TTL heal logs must not contain ciphertext/iv/tag');
      assert.ok(!logged.includes(buf.toString('hex')), 'TTL heal logs must not contain ciphertext/iv/tag hex');
    }
  } finally {
    console.log = original.log; console.warn = original.warn;
    console.error = original.error; console.info = original.info;
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('production backfill throws on missing-TTL leftover that cannot be healed', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');
  assert.ok(NONCOMPLIANT_SQL.includes('excerpt_iv'), 'verification SQL must mention excerpt_iv');
  assert.ok(NONCOMPLIANT_SQL.includes('excerpt_tag'), 'verification SQL must mention excerpt_tag');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const p = db.getPool();
  const suffix = `mn-ttlprod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN ttlprod ${suffix}`, `mn-ttlprod-${suffix}`]
  )).rows[0].id;

  const restoreExcerptCheck = async () => {
    try {
      await p.query(`
        ALTER TABLE meeting_notes_runs
          ADD CONSTRAINT meeting_notes_runs_excerpt_crypto_check
          CHECK (
            (excerpt_ciphertext IS NULL AND excerpt_iv IS NULL AND excerpt_tag IS NULL)
            OR
            (excerpt_ciphertext IS NOT NULL AND excerpt_iv IS NOT NULL AND excerpt_tag IS NOT NULL)
          )
      `);
    } catch (_e) { /* already present */ }
  };

  const prevEnv = process.env.NODE_ENV;
  try {
    await p.query(`ALTER TABLE meeting_notes_runs DROP CONSTRAINT IF EXISTS meeting_notes_runs_excerpt_crypto_check`);
    const partialId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, transcript_excerpt, source,
         excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at
       ) VALUES ($1,'{}'::jsonb,'{}'::jsonb,NULL,'ai', decode('ab','hex'), NULL, NULL, NULL)
       RETURNING id`,
      [tenantId]
    )).rows[0].id;

    const selected = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NEEDS_BACKFILL_SQL})`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(
      !selected.includes(partialId),
      'NEEDS_BACKFILL_SQL must not select a partial triple for TTL repair'
    );

    const before = await verifyMeetingNotesEncryption();
    assert.strictEqual(before.ok, false);
    assert.ok((before.byReason && before.byReason.missing_excerpt_ttl) >= 1);
    assert.ok((before.byReason && before.byReason.partial_excerpt_crypto) >= 1);

    const localNoncompliant = (await p.query(
      `SELECT id FROM meeting_notes_runs
        WHERE tenant_id=$1 AND (${NONCOMPLIANT_SQL})`,
      [tenantId]
    )).rows.map((r) => r.id);
    assert.ok(localNoncompliant.includes(partialId), 'partial+NULL TTL must match NONCOMPLIANT_SQL');

    process.env.NODE_ENV = 'production';
    let threw = false;
    try {
      await backfillMeetingNotesEncryption();
    } catch (err) {
      threw = true;
      assert.ok(err instanceof Error);
      assert.match(String(err.message), /failed closed/i);
      assert.ok(!String(err.message).includes('ab'), 'throw message must not include ciphertext hex');
      assert.ok(
        !String(err.message).includes(process.env.CREDENTIAL_ENCRYPTION_KEY || ''),
        'throw message must not include the vault key'
      );
    }
    assert.ok(threw, 'production backfill must throw while a missing-TTL leftover remains');

    const leftover = (await p.query(
      `SELECT excerpt_ciphertext IS NOT NULL AS has_ct, excerpt_expires_at
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [partialId, tenantId]
    )).rows[0];
    assert.strictEqual(leftover.has_ct, true, 'unhealable partial leftover must remain');
    assert.strictEqual(leftover.excerpt_expires_at, null);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await restoreExcerptCheck();
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

test('sweeper purges excerpt after backfill assigns past-due TTL from old created_at', { skip }, async () => {
  assert.ok(vault.hasKey(), 'CREDENTIAL_ENCRYPTION_KEY must be set for backfill');

  await ensureTenantSchema();
  await ensureMeetingNotesSchema();

  const { sweepExpiredExcerpts } = require('../services/meeting_notes/api');
  const p = db.getPool();
  const suffix = `mn-ttlsweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = (await p.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
    [`MN ttlsweep ${suffix}`, `mn-ttlsweep-${suffix}`]
  )).rows[0].id;

  const EXCERPT = 'mn-ttl-sweep-excerpt-body';
  const SUMMARY = { body: 'mn-ttl-sweep-summary-keep' };
  const aad = aadFor(tenantId);
  const excerptEnc = vault.encryptString(EXCERPT, aad);
  const summaryEnc = vault.encryptString(JSON.stringify(SUMMARY), aad);

  try {
    const noteId = (await p.query(
      `INSERT INTO meeting_notes_runs (
         tenant_id, contact, summary, transcript_excerpt, source, created_at,
         excerpt_ciphertext, excerpt_iv, excerpt_tag, excerpt_expires_at,
         summary_ciphertext, summary_iv, summary_tag
       ) VALUES (
         $1,'{}'::jsonb,'{}'::jsonb,NULL,'ai', now() - interval '31 days',
         $2,$3,$4,NULL,$5,$6,$7
       ) RETURNING id`,
      [
        tenantId,
        excerptEnc.ciphertext, excerptEnc.iv, excerptEnc.tag,
        summaryEnc.ciphertext, summaryEnc.iv, summaryEnc.tag,
      ]
    )).rows[0].id;

    const healed = await backfillMeetingNotesEncryption();
    assert.strictEqual(healed.ok, true);
    assert.ok((healed.ttls || healed.excerpts) >= 1);

    const afterHeal = (await p.query(
      `SELECT excerpt_expires_at, created_at + interval '30 days' AS expected_expires,
              (excerpt_expires_at = created_at + interval '30 days') AS ttl_matches,
              excerpt_ciphertext, transcript_excerpt
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.ok(_ttlMatchesCreatedPlus30(afterHeal));
    assert.ok(afterHeal.excerpt_expires_at && new Date(afterHeal.excerpt_expires_at) < new Date(), 'assigned TTL must already be in the past');
    assert.strictEqual(afterHeal.transcript_excerpt, null);

    const swept = await sweepExpiredExcerpts();
    assert.ok(swept && swept.ok === true);
    assert.ok(swept.purged >= 1);

    const row = (await p.query(
      `SELECT id, tenant_id, transcript_excerpt, excerpt_ciphertext, excerpt_iv, excerpt_tag,
              transcript_purged_at, summary_ciphertext, summary_iv, summary_tag
         FROM meeting_notes_runs WHERE id=$1 AND tenant_id=$2`,
      [noteId, tenantId]
    )).rows[0];
    assert.ok(row, 'sweeper must not delete the history row');
    assert.strictEqual(row.tenant_id, tenantId);
    assert.strictEqual(row.transcript_excerpt, null);
    assert.strictEqual(row.excerpt_ciphertext, null);
    assert.strictEqual(row.excerpt_iv, null);
    assert.strictEqual(row.excerpt_tag, null);
    assert.ok(row.transcript_purged_at, 'transcript_purged_at must be set after sweep');
    assert.ok(Buffer.isBuffer(row.summary_ciphertext) && row.summary_ciphertext.equals(summaryEnc.ciphertext));
    assert.ok(Buffer.isBuffer(row.summary_iv) && row.summary_iv.equals(summaryEnc.iv));
    assert.ok(Buffer.isBuffer(row.summary_tag) && row.summary_tag.equals(summaryEnc.tag));
  } finally {
    await p.query(`DELETE FROM meeting_notes_runs WHERE tenant_id=$1`, [tenantId]);
    await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  }
});

