// ── Replit Postgres KV store (replaces flat JSON file persistence) ───────────
// Generic schema: a single table `kv_store(key text primary key, value jsonb,
// updated_at timestamptz)`. Lets us migrate every data/*.json blob to Postgres
// without per-file schema design. Atomic, transactional, concurrent-safe.
const { Pool } = require('pg');

let _pool = null;
function _hasDb() { return !!process.env.DATABASE_URL; }

function getPool() {
  if (!_hasDb()) return null;
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5, idleTimeoutMillis: 30000, ssl: { rejectUnauthorized: false }
    });
    _pool.on('error', e => console.error('[db] pool error:', e.message));
  }
  return _pool;
}

let _schemaReady = null;
async function ensureSchema() {
  if (!_hasDb()) return;
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  })();
  return _schemaReady;
}

async function kvGet(key, fallback = null) {
  if (!_hasDb()) return fallback;
  await ensureSchema();
  const r = await getPool().query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}

async function kvSet(key, value) {
  if (!_hasDb()) return false;
  await ensureSchema();
  await getPool().query(`
    INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `, [key, JSON.stringify(value)]);
  return true;
}

module.exports = { hasDb: _hasDb, getPool, ensureSchema, kvGet, kvSet };
