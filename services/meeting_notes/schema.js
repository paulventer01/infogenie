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

module.exports = { ensureMeetingNotesSchema };
