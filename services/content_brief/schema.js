const _db = require('../../db');

async function ensureContentBriefSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS content_brief_runs (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      keyword         TEXT NOT NULL,
      location_code   INT  NOT NULL DEFAULT 2840,
      brief           JSONB NOT NULL DEFAULT '{}'::jsonb,
      related_kws     JSONB NOT NULL DEFAULT '[]'::jsonb,
      competitor_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
      serp_snapshot   JSONB NOT NULL DEFAULT '[]'::jsonb,
      source          TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_cb_runs_tenant
      ON content_brief_runs(tenant_id, created_at DESC);
  `);
  console.log('[content-brief] schema ready');
}

module.exports = { ensureContentBriefSchema };
