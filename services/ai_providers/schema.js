const _db = require('../../db');
const { addTenantIdColumn } = require('../tenants/migration');
const { compatibleCategories } = require('./capabilities');

async function ensureAiProvidersSchema() {
  if (!_db.hasDb()) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      base_url     TEXT NOT NULL,
      api_key      TEXT NOT NULL,
      model        TEXT NOT NULL,
      category     TEXT NOT NULL CHECK (category IN ('writing','analysis','vision','audio')),
      is_default   BOOLEAN NOT NULL DEFAULT FALSE,
      enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_providers_cat_idx ON ai_providers(category, is_default DESC, enabled DESC);

    CREATE TABLE IF NOT EXISTS ai_provider_assignments (
      id           SERIAL PRIMARY KEY,
      provider_id  INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
      tenant_id    INTEGER NOT NULL,
      category     TEXT NOT NULL CHECK (category IN ('writing','analysis','vision','audio')),
      enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      is_default   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider_id, category)
    );
    CREATE INDEX IF NOT EXISTS ai_provider_assign_tenant_cat_idx
      ON ai_provider_assignments(tenant_id, category, enabled DESC, is_default DESC);
  `);
  try { await addTenantIdColumn('ai_providers'); }
  catch (e) { console.error('[ai-providers] addTenantIdColumn:', e.message); }
  try { await addTenantIdColumn('ai_provider_assignments'); }
  catch (e) { console.error('[ai-providers] assignments tenant col:', e.message); }

  await _backfillAssignments(pool);
  console.log('[ai-providers] schema ready');
}

/**
 * Ensure every provider has assignment rows for all compatible categories.
 * Existing home-category row stays the seed; newly added categories default enabled.
 */
async function _backfillAssignments(pool) {
  const providers = await pool.query(
    `SELECT id, tenant_id, name, base_url, model, category, enabled, is_default, notes
       FROM ai_providers`,
  );
  for (const p of providers.rows) {
    if (p.tenant_id == null) continue;
    const cats = compatibleCategories(p);
    // Always include the declared home category even if heuristic misses it
    if (!cats.includes(p.category)) cats.push(p.category);

    for (const cat of cats) {
      const isHome = cat === p.category;
      await pool.query(
        `INSERT INTO ai_provider_assignments (provider_id, tenant_id, category, enabled, is_default)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider_id, category) DO NOTHING`,
        [
          p.id,
          p.tenant_id,
          cat,
          // New cross-category links start enabled so tiles light up immediately
          true,
          isHome ? !!p.is_default : false,
        ],
      );
    }

    // If home category was default, ensure only one default per tenant+category
    if (p.is_default) {
      await pool.query(
        `UPDATE ai_provider_assignments SET is_default=FALSE
         WHERE tenant_id=$1 AND category=$2 AND provider_id<>$3`,
        [p.tenant_id, p.category, p.id],
      );
      await pool.query(
        `UPDATE ai_provider_assignments SET is_default=TRUE, enabled=TRUE
         WHERE provider_id=$1 AND category=$2`,
        [p.id, p.category],
      );
    }
  }
}

/** Expand one provider into all compatible category assignments (enabled). */
async function expandProviderAssignments(pool, providerRow) {
  const cats = compatibleCategories(providerRow);
  if (!cats.includes(providerRow.category)) cats.push(providerRow.category);
  for (const cat of cats) {
    await pool.query(
      `INSERT INTO ai_provider_assignments (provider_id, tenant_id, category, enabled, is_default)
       VALUES ($1,$2,$3,TRUE,FALSE)
       ON CONFLICT (provider_id, category) DO UPDATE SET updated_at=NOW()`,
      [providerRow.id, providerRow.tenant_id, cat],
    );
  }
  return cats;
}

module.exports = { ensureAiProvidersSchema, expandProviderAssignments, _backfillAssignments };
