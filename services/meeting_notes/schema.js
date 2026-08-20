const _db = require('../../db');
const { logger } = require('../infra/logger');

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
  (transcript_excerpt IS NOT NULL)
  OR (summary IS NOT NULL AND summary <> '{}'::jsonb)
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

function _cryptoTripleState(ciphertext, iv, tag) {
  const present = [ciphertext != null, iv != null, tag != null].filter(Boolean).length;
  if (present === 3) return 'complete';
  if (present === 0) return 'missing';
  return 'partial';
}

// JSONB '{}' only. Arrays, primitives, JSON null, and keyed objects all need encrypt.
function _isEmptyJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

const SAMPLE_IDS_LIMIT = 50;

// Post-backfill residual check. JSONB `'null'` and SQL NULL contacts are
// compliant (no PII) — they stay selected by NEEDS_BACKFILL_SQL as no-ops
// so the stall-guard can skip them, but they must not fail verification.
const NONCOMPLIANT_SQL = `
  (transcript_excerpt IS NOT NULL)
  OR (summary IS NOT NULL AND summary <> '{}'::jsonb)
  OR (generated_by IS NOT NULL AND generated_by LIKE '%@%')
  OR (
    CASE
      WHEN contact IS NULL THEN false
      WHEN jsonb_typeof(contact) = 'null' THEN false
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
  OR (
    ((excerpt_ciphertext IS NULL)::int + (excerpt_iv IS NULL)::int + (excerpt_tag IS NULL)::int)
    BETWEEN 1 AND 2
  )
  OR (
    ((summary_ciphertext IS NULL)::int + (summary_iv IS NULL)::int + (summary_tag IS NULL)::int)
    BETWEEN 1 AND 2
  )
`;

const VERIFY_REASON_KEYS = [
  'plaintext_excerpt',
  'plaintext_summary',
  'email_generated_by',
  'contact_non_object',
  'contact_extra_keys',
  'contact_non_string',
  'contact_too_long',
  'partial_excerpt_crypto',
  'partial_summary_crypto',
];

function _safeRowRef(row, fallbackTenantId) {
  const tenantId = Number(row && row.tenant_id != null ? row.tenant_id : fallbackTenantId);
  const id = Number(row && row.id);
  return {
    tenant_id: Number.isFinite(tenantId) ? tenantId : null,
    id: Number.isFinite(id) ? id : null,
  };
}

function _isProduction() {
  return process.env.NODE_ENV === 'production';
}

async function _loadMeetingNotesTenantIds(p, { onlyPending = false } = {}) {
  // Load both catalogs (tenants + meeting_notes_runs) so orphan tenant_id
  // values on meeting_notes_runs are not missed. Backfill only walks ids that
  // still match NEEDS_BACKFILL_SQL; verification walks every distinct
  // tenant_id on meeting_notes_runs (including orphans), never an unscoped
  // dump of PII.
  const runFilter = onlyPending ? `WHERE ${NEEDS_BACKFILL_SQL}` : '';
  const [fromTenants, fromRuns] = await Promise.all([
    p.query(`SELECT id FROM tenants ORDER BY id`),
    p.query(`
      SELECT DISTINCT tenant_id AS id
        FROM meeting_notes_runs
       ${runFilter}
       ORDER BY 1
    `),
  ]);
  const knownTenants = new Set(fromTenants.rows.map((row) => Number(row.id)).filter(Number.isFinite));
  const existing = [];
  const orphans = [];
  const seen = new Set();
  for (const row of fromRuns.rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    if (knownTenants.has(id)) existing.push(id);
    else orphans.push(id);
  }
  return existing.concat(orphans);
}

async function _loadBackfillTenantIds(p) {
  return _loadMeetingNotesTenantIds(p, { onlyPending: true });
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

  const excerptPlain = row.transcript_excerpt != null;
  const excerptState = _cryptoTripleState(row.excerpt_ciphertext, row.excerpt_iv, row.excerpt_tag);
  const summaryPlain = !_isEmptyJsonObject(row.summary);
  const summaryState = _cryptoTripleState(row.summary_ciphertext, row.summary_iv, row.summary_tag);
  const needsScrub = typeof row.generated_by === 'string' && row.generated_by.includes('@');
  const needsContact = _contactNeedsScrub(row.contact);

  let excerpts = 0;
  let summaries = 0;

  if (excerptPlain && excerptState === 'missing') {
    const { ciphertext, iv, tag } = vault.encryptString(row.transcript_excerpt, aad);
    if (vault.decryptString(ciphertext, iv, tag, aad) !== row.transcript_excerpt) {
      throw new Error('excerpt verify mismatch');
    }
    bump('excerpt_ciphertext', ciphertext);
    bump('excerpt_iv', iv);
    bump('excerpt_tag', tag);
    sets.push('transcript_excerpt=NULL');
    sets.push(`excerpt_expires_at = COALESCE(excerpt_expires_at, created_at + interval '30 days')`);
    excerpts = 1;
  } else if (excerptPlain && excerptState === 'complete') {
    // Dual-state: complete triple already on disk. Drop leftover plaintext only.
    sets.push('transcript_excerpt=NULL');
    excerpts = 1;
  }

  if (summaryPlain && summaryState === 'missing') {
    const serialized = JSON.stringify(row.summary);
    const { ciphertext, iv, tag } = vault.encryptString(serialized, aad);
    const roundTrip = vault.decryptString(ciphertext, iv, tag, aad);
    if (roundTrip !== serialized) throw new Error('summary verify mismatch');
    JSON.parse(roundTrip);
    bump('summary_ciphertext', ciphertext);
    bump('summary_iv', iv);
    bump('summary_tag', tag);
    sets.push(`summary='{}'::jsonb`);
    summaries = 1;
  } else if (summaryPlain && summaryState === 'complete') {
    sets.push(`summary='{}'::jsonb`);
    summaries = 1;
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
    excerpts,
    summaries,
    generatedBy: needsScrub ? 1 : 0,
    contacts: needsContact ? 1 : 0,
  };
}

function _recordRowFailure(failedRows, skippedIds, row, tenantId) {
  const ref = _safeRowRef(row, tenantId);
  if (Number.isFinite(ref.id)) skippedIds.push(ref.id);
  failedRows.push(ref);
  logger.warn('meeting_notes_backfill_row_failed', { tenant_id: ref.tenant_id, id: ref.id });
  console.warn(`[meeting-notes] backfill row failed tenant=${ref.tenant_id} id=${ref.id}`);
}

function _failClosed(payload) {
  logger.error('meeting_notes_backfill_failed', {
    failed: payload.failed,
    noncompliant: payload.noncompliant,
    byReason: payload.byReason,
    failedIds: payload.failedIds,
    sampleIds: payload.sampleIds,
    skipped: payload.skipped || undefined,
  });
  console.error(
    `[meeting-notes] backfill failed: ${payload.failed} row errors, ${payload.noncompliant} non-compliant remaining`
  );
  if (_isProduction()) {
    throw new Error(
      `[meeting-notes] encryption backfill failed closed (${payload.failed} row errors, ${payload.noncompliant} non-compliant)`
    );
  }
  return payload;
}

async function verifyMeetingNotesEncryption() {
  if (!_db.hasDb()) {
    return { ok: true, skipped: 'no_db', noncompliant: 0, byReason: {}, sampleIds: [] };
  }
  const p = _db.getPool();
  const tenantIds = await _loadMeetingNotesTenantIds(p, { onlyPending: false });
  const byReason = {};
  const sampleIds = [];
  let noncompliant = 0;

  const bump = (reason, n) => {
    const count = Number(n) || 0;
    if (count <= 0) return;
    byReason[reason] = (byReason[reason] || 0) + count;
  };

  for (const tenantId of tenantIds) {
    try {
      const counts = await p.query(
        `
        SELECT
          COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE plaintext_excerpt)::int AS plaintext_excerpt,
          COUNT(*) FILTER (WHERE plaintext_summary)::int AS plaintext_summary,
          COUNT(*) FILTER (WHERE email_generated_by)::int AS email_generated_by,
          COUNT(*) FILTER (WHERE contact_non_object)::int AS contact_non_object,
          COUNT(*) FILTER (WHERE contact_extra_keys)::int AS contact_extra_keys,
          COUNT(*) FILTER (WHERE contact_non_string)::int AS contact_non_string,
          COUNT(*) FILTER (WHERE contact_too_long)::int AS contact_too_long,
          COUNT(*) FILTER (WHERE partial_excerpt_crypto)::int AS partial_excerpt_crypto,
          COUNT(*) FILTER (WHERE partial_summary_crypto)::int AS partial_summary_crypto
        FROM (
          SELECT
            (transcript_excerpt IS NOT NULL) AS plaintext_excerpt,
            (summary IS NOT NULL AND summary <> '{}'::jsonb) AS plaintext_summary,
            (generated_by IS NOT NULL AND generated_by LIKE '%@%') AS email_generated_by,
            CASE
              WHEN contact IS NULL THEN false
              WHEN jsonb_typeof(contact) = 'null' THEN false
              WHEN jsonb_typeof(contact) IS DISTINCT FROM 'object' THEN true
              ELSE false
            END AS contact_non_object,
            CASE
              WHEN contact IS NULL OR jsonb_typeof(contact) IS DISTINCT FROM 'object' THEN false
              WHEN (contact - ARRAY['name','company','role']::text[]) <> '{}'::jsonb THEN true
              ELSE false
            END AS contact_extra_keys,
            CASE
              WHEN contact IS NULL OR jsonb_typeof(contact) IS DISTINCT FROM 'object' THEN false
              WHEN contact ? 'name' AND jsonb_typeof(contact->'name') IS DISTINCT FROM 'string' THEN true
              WHEN contact ? 'company' AND jsonb_typeof(contact->'company') IS DISTINCT FROM 'string' THEN true
              WHEN contact ? 'role' AND jsonb_typeof(contact->'role') IS DISTINCT FROM 'string' THEN true
              ELSE false
            END AS contact_non_string,
            CASE
              WHEN contact IS NULL OR jsonb_typeof(contact) IS DISTINCT FROM 'object' THEN false
              WHEN length(COALESCE(contact->>'name','')) > 200 THEN true
              WHEN length(COALESCE(contact->>'company','')) > 200 THEN true
              WHEN length(COALESCE(contact->>'role','')) > 200 THEN true
              ELSE false
            END AS contact_too_long,
            (
              ((excerpt_ciphertext IS NULL)::int + (excerpt_iv IS NULL)::int + (excerpt_tag IS NULL)::int)
              BETWEEN 1 AND 2
            ) AS partial_excerpt_crypto,
            (
              ((summary_ciphertext IS NULL)::int + (summary_iv IS NULL)::int + (summary_tag IS NULL)::int)
              BETWEEN 1 AND 2
            ) AS partial_summary_crypto
          FROM meeting_notes_runs
         WHERE tenant_id=$1
           AND (${NONCOMPLIANT_SQL})
        ) flags
        `,
        [tenantId]
      );
      const row = counts.rows[0] || {};
      const n = Number(row.n) || 0;
      if (!n) continue;
      noncompliant += n;
      for (const reason of VERIFY_REASON_KEYS) bump(reason, row[reason]);

      if (sampleIds.length < SAMPLE_IDS_LIMIT) {
        const remaining = SAMPLE_IDS_LIMIT - sampleIds.length;
        const samples = await p.query(
          `SELECT id, tenant_id
             FROM meeting_notes_runs
            WHERE tenant_id=$1
              AND (${NONCOMPLIANT_SQL})
            ORDER BY id
            LIMIT $2`,
          [tenantId, remaining]
        );
        for (const sample of samples.rows) {
          sampleIds.push(_safeRowRef(sample, tenantId));
        }
      }
    } catch (_e) {
      logger.warn('meeting_notes_backfill_verify_query_failed', { tenant_id: tenantId });
      console.warn(`[meeting-notes] verify query failed tenant=${tenantId}`);
      bump('verify_query', 1);
      noncompliant += 1;
    }
  }

  const result = { ok: noncompliant === 0, noncompliant, byReason, sampleIds };
  logger.info('meeting_notes_backfill_verify', {
    ok: result.ok,
    noncompliant,
    byReason,
    sampleIds,
  });
  console.log(`[meeting-notes] verify noncompliant=${noncompliant}`);
  return result;
}

async function backfillMeetingNotesEncryption() {
  if (!_db.hasDb()) return { ok: true, skipped: 'no_db' };

  await ensureMeetingNotesSchema();
  const vault = require('../credentials/vault');
  const p = _db.getPool();
  const failedRows = [];
  let excerptCount = 0;
  let summaryCount = 0;
  let scrubCount = 0;
  let contactCount = 0;
  let skipped;

  if (!vault.hasKey()) {
    skipped = 'no_key';
    logger.warn('meeting_notes_backfill_no_key', {});
    console.warn('[meeting-notes] backfill skipped: no_key');
  } else {
    const tenantIds = await _loadBackfillTenantIds(p);
    logger.info('meeting_notes_backfill_start', { tenants: tenantIds.length });

    for (const tenantId of tenantIds) {
      const skippedIds = [];
      let tenantAborted = false;
      for (;;) {
        const params = [tenantId];
        let skipSql = '';
        if (skippedIds.length) {
          params.push(skippedIds);
          skipSql = ` AND NOT (id = ANY($${params.length}::int[]))`;
        }
        params.push(BACKFILL_BATCH);
        let batch;
        try {
          batch = await p.query(
            `SELECT id, tenant_id, transcript_excerpt, summary, created_at, generated_by, contact,
                    excerpt_ciphertext, excerpt_iv, excerpt_tag,
                    summary_ciphertext, summary_iv, summary_tag
               FROM meeting_notes_runs
              WHERE tenant_id=$1
                AND (${NEEDS_BACKFILL_SQL})
                ${skipSql}
              ORDER BY id
              LIMIT $${params.length}`,
            params
          );
        } catch (_e) {
          logger.warn('meeting_notes_backfill_query_failed', { tenant_id: tenantId });
          console.warn(`[meeting-notes] backfill query failed tenant=${tenantId}`);
          failedRows.push({ tenant_id: tenantId, id: null });
          tenantAborted = true;
          break;
        }
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
            _recordRowFailure(failedRows, skippedIds, row, tenantId);
          }
        }

        if (batch.rows.length < BACKFILL_BATCH) break;
      }
      if (tenantAborted) continue;
    }
  }

  let verification;
  try {
    verification = await verifyMeetingNotesEncryption();
  } catch (_e) {
    logger.error('meeting_notes_backfill_verify_failed', {});
    console.error('[meeting-notes] backfill verification query failed');
    verification = { ok: false, noncompliant: 1, byReason: { verify_query: 1 }, sampleIds: [] };
  }

  logger.info('meeting_notes_backfill_complete', {
    excerpts: excerptCount,
    summaries: summaryCount,
    generatedBy: scrubCount,
    contacts: contactCount,
    failed: failedRows.length,
    skipped: skipped || undefined,
  });
  console.log(`[meeting-notes] backfill encrypted ${excerptCount} excerpts, ${summaryCount} summaries, scrubbed ${scrubCount} generated_by, ${contactCount} contacts`);

  const ok = failedRows.length === 0 && verification.noncompliant === 0;
  const payload = {
    ok,
    excerpts: excerptCount,
    summaries: summaryCount,
    generatedBy: scrubCount,
    contacts: contactCount,
    failed: failedRows.length,
    failedIds: failedRows.slice(0, SAMPLE_IDS_LIMIT),
    noncompliant: verification.noncompliant,
    byReason: verification.byReason,
    sampleIds: verification.sampleIds,
  };
  if (skipped) payload.skipped = skipped;
  if (!ok) return _failClosed(payload);
  return payload;
}

module.exports = {
  ensureMeetingNotesSchema,
  backfillMeetingNotesEncryption,
  verifyMeetingNotesEncryption,
  NEEDS_BACKFILL_SQL,
  NONCOMPLIANT_SQL,
};
