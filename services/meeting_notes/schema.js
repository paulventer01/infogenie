const _db = require('../../db');

async function ensureMeetingNotesSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS meeting_notes_runs (
      id                 SERIAL PRIMARY KEY,
      tenant_id          INT NOT NULL REFERENCES tenants(id),
      contact            JSONB NOT NULL DEFAULT '{}',
      summary            JSONB NOT NULL DEFAULT '{}',
      transcript_excerpt TEXT,
      transcript_sha256  TEXT,
      source             TEXT NOT NULL DEFAULT 'ai',
      generated_by       TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS contact JSONB NOT NULL DEFAULT '{}'`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS transcript_excerpt TEXT`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS transcript_sha256 TEXT`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai'`).catch(() => {});
  await p.query(`ALTER TABLE meeting_notes_runs ADD COLUMN IF NOT EXISTS generated_by TEXT`).catch(() => {});
  await p.query(`CREATE INDEX IF NOT EXISTS idx_meeting_notes_tenant ON meeting_notes_runs(tenant_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_meeting_notes_tenant_created ON meeting_notes_runs(tenant_id, created_at DESC)`);
  console.log('[meeting-notes] schema ready');
}

module.exports = { ensureMeetingNotesSchema };
