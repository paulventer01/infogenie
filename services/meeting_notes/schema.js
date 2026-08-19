const _db = require('../../db');

async function ensureMeetingNotesSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS meeting_notes_runs (
      id                   SERIAL PRIMARY KEY,
      tenant_id            INT NOT NULL REFERENCES tenants(id),
      contact              JSONB NOT NULL DEFAULT '{}',
      summary              JSONB NOT NULL DEFAULT '{}',
      transcript_excerpt   TEXT,
      transcript_sha256    TEXT,
      source               TEXT NOT NULL DEFAULT 'ai',
      generated_by         TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      excerpt_ciphertext   BYTEA,
      excerpt_iv           BYTEA,
      excerpt_tag          BYTEA,
      excerpt_expires_at   TIMESTAMPTZ,
      summary_ciphertext   BYTEA,
      summary_iv           BYTEA,
      summary_tag          BYTEA,
      transcript_purged_at TIMESTAMPTZ,
      CONSTRAINT meeting_notes_runs_excerpt_crypto_check CHECK (
        (excerpt_ciphertext IS NULL AND excerpt_iv IS NULL AND excerpt_tag IS NULL)
        OR
        (excerpt_ciphertext IS NOT NULL AND excerpt_iv IS NOT NULL AND excerpt_tag IS NOT NULL)
      ),
      CONSTRAINT meeting_notes_runs_summary_crypto_check CHECK (
        (summary_ciphertext IS NULL AND summary_iv IS NULL AND summary_tag IS NULL)
        OR
        (summary_ciphertext IS NOT NULL AND summary_iv IS NOT NULL AND summary_tag IS NOT NULL)
      )
    )
  `);
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS contact JSONB NOT NULL DEFAULT '{}'`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS transcript_excerpt TEXT`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS transcript_sha256 TEXT`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai'`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS generated_by TEXT`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS excerpt_ciphertext BYTEA`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS excerpt_iv BYTEA`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS excerpt_tag BYTEA`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS excerpt_expires_at TIMESTAMPTZ`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS summary_ciphertext BYTEA`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS summary_iv BYTEA`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS summary_tag BYTEA`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS transcript_purged_at TIMESTAMPTZ`).catch(() => {});
  // Idempotent CHECK backfill (vault.js pattern). try/catch so older DBs
  // missing columns or rejecting ADD do not fail boot.
  try {
    await p.query(`
      ALTER TABLE meeting_notes_runs
        DROP CONSTRAINT IF EXISTS meeting_notes_runs_excerpt_crypto_check;
      ALTER TABLE meeting_notes_runs
        ADD CONSTRAINT meeting_notes_runs_excerpt_crypto_check
        CHECK (
          (excerpt_ciphertext IS NULL AND excerpt_iv IS NULL AND excerpt_tag IS NULL)
          OR
          (excerpt_ciphertext IS NOT NULL AND excerpt_iv IS NOT NULL AND excerpt_tag IS NOT NULL)
        );
    `);
  } catch (_e) { /* ignore — table will be created with constraint on fresh installs */ }
  try {
    await p.query(`
      ALTER TABLE meeting_notes_runs
        DROP CONSTRAINT IF EXISTS meeting_notes_runs_summary_crypto_check;
      ALTER TABLE meeting_notes_runs
        ADD CONSTRAINT meeting_notes_runs_summary_crypto_check
        CHECK (
          (summary_ciphertext IS NULL AND summary_iv IS NULL AND summary_tag IS NULL)
          OR
          (summary_ciphertext IS NOT NULL AND summary_iv IS NOT NULL AND summary_tag IS NOT NULL)
        );
    `);
  } catch (_e) { /* ignore — table will be created with constraint on fresh installs */ }
  await p.query(`CREATE INDEX IF NOT EXISTS idx_meeting_notes_tenant ON meeting_notes_runs(tenant_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_meeting_notes_tenant_created ON meeting_notes_runs(tenant_id, created_at DESC)`);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_meeting_notes_excerpt_ttl
      ON meeting_notes_runs (tenant_id, excerpt_expires_at)
      WHERE excerpt_expires_at IS NOT NULL
        AND (excerpt_ciphertext IS NOT NULL OR transcript_excerpt IS NOT NULL)
  `);
  console.log('[meeting-notes] schema ready');
}

const BACKFILL_BATCH = 100;
const CONTACT_KEYS = ['name', 'company', 'role'];
const CONTACT_MAX = 200;
// Contact arm is CASE, not OR. Postgres does not guarantee OR short-circuit;
// `contact - ARRAY[...]` on scalar/array JSONB raises "cannot delete from scalar"
// during `_loadBackfillTenantIds` / batch SELECT (outside the per-row catch)
// and aborts the whole boot backfill. CASE WHEN is sequential, so `- ARRAY`
// runs only after jsonb_typeof = 'object' has been established.
const NEEDS_BACKFILL_SQL = `
  (transcript_excerpt IS NOT NULL AND excerpt_ciphertext IS NULL)
  OR (summary IS NOT NULL AND summary <> '{}'::jsonb AND summary_ciphertext IS NULL)
  OR (generated_by IS NOT NULL AND generated_by LIKE '%@%')
  OR (
    CASE
      WHEN contact IS NULL THEN false
      WHEN jsonb_typeof(contact) IS DISTINCT FROM 'object' THEN true
      WHEN (contact - ARRAY['name','company','role']::text[]) <> '{}'::jsonb THEN true
      WHEN contact ? 'name' AND jsonb_typeof(contact->'name') IS DISTINCT FROM 'string' THEN true
      WHEN contact ? 'company' AND jsonb_typeof(contact->'company') IS DISTINCT FROM 'string' THEN true
      WHEN contact ? 'role' AND jsonb_typeof(contact->'role') IS DISTINCT FROM 'string' THEN true
      WHEN length(COALESCE(contact->>'name','')) > 200 THEN true
      WHEN length(COALESCE(contact->>'company','')) > 200 THEN true
      WHEN length(COALESCE(contact->>'role','')) > 200 THEN true
      ELSE false
    END
  )
`;

function _whitelistedContact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of CONTACT_KEYS) {
    if (typeof raw[key] !== 'string') continue;
    const s = raw[key].slice(0, CONTACT_MAX);
    if (s) out[key] = s;
  }
  return out;
}

function _contactNeedsScrub(raw) {
  if (raw == null) return false;
  if (typeof raw !== 'object' || Array.isArray(raw)) return true;
  const allowed = new Set(CONTACT_KEYS);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return true;
  }
  for (const key of CONTACT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    if (typeof raw[key] !== 'string') return true;
    if (raw[key].length > CONTACT_MAX) return true;
  }
  return false;
}

function _meetingNotesAad(tenantId) {
  return `meeting_notes_runs:tenant:${tenantId}`;
}

// JSONB '{}' only. Arrays, primitives, JSON null, and keyed objects all need encrypt.
function _isEmptyJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

async function _loadBackfillTenantIds(p) {
  // Load both catalogs (tenants + rows that still need work) so orphan
  // tenant_id values on meeting_notes_runs are not missed. Only ids that
  // actually have pending rows are returned for the per-tenant UPDATE loop.
  const [fromTenants, fromRuns] = await Promise.all([
    p.query(`SELECT id FROM tenants ORDER BY id`),
    p.query(`
      SELECT DISTINCT tenant_id AS id
        FROM meeting_notes_runs
       WHERE ${NEEDS_BACKFILL_SQL}
       ORDER BY 1
    `),
  ]);
  const knownTenants = new Set(fromTenants.rows.map((row) => Number(row.id)).filter(Number.isFinite));
  const existing = [];
  const orphans = [];
  for (const row of fromRuns.rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id)) continue;
    if (knownTenants.has(id)) existing.push(id);
    else orphans.push(id);
  }
  return existing.concat(orphans);
}

async function _backfillOneRow(p, vault, row) {
  const tenantId = Number(row.tenant_id);
  const id = Number(row.id);
  const aad = _meetingNotesAad(tenantId);
  const sets = [];
  const params = [];
  const bump = (sql, value) => {
    params.push(value);
    sets.push(`${sql}=$${params.length}`);
  };

  const needsExcerpt = row.transcript_excerpt != null && row.excerpt_ciphertext == null;
  const needsSummary = row.summary_ciphertext == null && !_isEmptyJsonObject(row.summary);
  const needsScrub = typeof row.generated_by === 'string' && row.generated_by.includes('@');
  const needsContact = _contactNeedsScrub(row.contact);

  if (needsExcerpt) {
    const { ciphertext, iv, tag } = vault.encryptString(row.transcript_excerpt, aad);
    if (vault.decryptString(ciphertext, iv, tag, aad) !== row.transcript_excerpt) {
      throw new Error('excerpt verify mismatch');
    }
    bump('excerpt_ciphertext', ciphertext);
    bump('excerpt_iv', iv);
    bump('excerpt_tag', tag);
    sets.push('transcript_excerpt=NULL');
    sets.push(`excerpt_expires_at = COALESCE(excerpt_expires_at, created_at + interval '30 days')`);
  }

  if (needsSummary) {
    const serialized = JSON.stringify(row.summary);
    const { ciphertext, iv, tag } = vault.encryptString(serialized, aad);
    const roundTrip = vault.decryptString(ciphertext, iv, tag, aad);
    if (roundTrip !== serialized) throw new Error('summary verify mismatch');
    JSON.parse(roundTrip);
    bump('summary_ciphertext', ciphertext);
    bump('summary_iv', iv);
    bump('summary_tag', tag);
    sets.push(`summary='{}'::jsonb`);
  }

  if (needsScrub) {
    sets.push('generated_by=NULL');
  }

  if (needsContact) {
    params.push(JSON.stringify(_whitelistedContact(row.contact)));
    sets.push(`contact=$${params.length}::jsonb`);
  }

  if (!sets.length) return { excerpts: 0, summaries: 0, generatedBy: 0, contacts: 0 };

  params.push(id);
  const idIdx = params.length;
  params.push(tenantId);
  const tenantIdx = params.length;
  await p.query(
    `UPDATE meeting_notes_runs SET ${sets.join(', ')} WHERE id=$${idIdx} AND tenant_id=$${tenantIdx}`,
    params
  );
  return {
    excerpts: needsExcerpt ? 1 : 0,
    summaries: needsSummary ? 1 : 0,
    generatedBy: needsScrub ? 1 : 0,
    contacts: needsContact ? 1 : 0,
  };
}

async function backfillMeetingNotesEncryption() {
  if (!_db.hasDb()) return { ok: true, skipped: 'no_db' };
  const vault = require('../credentials/vault');
  if (!vault.hasKey()) return { ok: true, skipped: 'no_key' };

  await ensureMeetingNotesSchema();
  const p = _db.getPool();
  const tenantIds = await _loadBackfillTenantIds(p);

  let excerptCount = 0;
  let summaryCount = 0;
  let scrubCount = 0;
  let contactCount = 0;

  for (const tenantId of tenantIds) {
    const skippedIds = [];
    for (;;) {
      const params = [tenantId];
      let skipSql = '';
      if (skippedIds.length) {
        params.push(skippedIds);
        skipSql = ` AND NOT (id = ANY($${params.length}::int[]))`;
      }
      params.push(BACKFILL_BATCH);
      const batch = await p.query(
        `SELECT id, tenant_id, transcript_excerpt, summary, excerpt_ciphertext, summary_ciphertext, created_at, generated_by, contact
           FROM meeting_notes_runs
          WHERE tenant_id=$1
            AND (${NEEDS_BACKFILL_SQL})
            ${skipSql}
          ORDER BY id
          LIMIT $${params.length}`,
        params
      );
      if (!batch.rows.length) break;

      for (const row of batch.rows) {
        try {
          const n = await _backfillOneRow(p, vault, row);
          excerptCount += n.excerpts;
          summaryCount += n.summaries;
          scrubCount += n.generatedBy;
          contactCount += n.contacts;
          // Selected rows must leave the SELECT predicate or be skipped.
          // A no-op on a full batch of ≥100 would otherwise loop forever.
          if (!n.excerpts && !n.summaries && !n.generatedBy && !n.contacts) {
            const sid = Number(row.id);
            if (Number.isFinite(sid)) skippedIds.push(sid);
          }
        } catch (_e) {
          console.warn('[meeting-notes] backfill skipped a row');
          const sid = Number(row.id);
          if (Number.isFinite(sid)) skippedIds.push(sid);
        }
      }

      if (batch.rows.length < BACKFILL_BATCH) break;
    }
  }

  console.log(`[meeting-notes] backfill encrypted ${excerptCount} excerpts, ${summaryCount} summaries, scrubbed ${scrubCount} generated_by, ${contactCount} contacts`);
  return { ok: true, excerpts: excerptCount, summaries: summaryCount, generatedBy: scrubCount, contacts: contactCount };
}

module.exports = { ensureMeetingNotesSchema, backfillMeetingNotesEncryption, NEEDS_BACKFILL_SQL };
