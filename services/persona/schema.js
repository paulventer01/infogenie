const _db = require('../../db');
async function ensurePersonaSchema() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS ai_personas (
      id              SERIAL PRIMARY KEY,
      tenant_id       INT NOT NULL REFERENCES tenants(id),
      name            TEXT NOT NULL,
      niche           TEXT NOT NULL DEFAULT 'lifestyle',
      age_range       TEXT NOT NULL DEFAULT '25-30',
      gender          TEXT NOT NULL DEFAULT 'female',
      appearance_prompt TEXT,
      personality     TEXT,
      content_voice   TEXT,
      posting_style   TEXT,
      brand_deals     JSONB NOT NULL DEFAULT '[]',
      avatar_url      TEXT,
      sample_content  JSONB NOT NULL DEFAULT '[]',
      is_active       BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_ai_personas_tenant ON ai_personas(tenant_id)`);
  console.log('[persona] schema ready');
}
module.exports = { ensurePersonaSchema };
