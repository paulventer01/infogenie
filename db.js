// ── Replit Postgres KV store (replaces flat JSON file persistence) ───────────
// Generic schema: a single table `kv_store(key text primary key, value jsonb,
// updated_at timestamptz)`. Lets us migrate every data/*.json blob to Postgres
// without per-file schema design. Atomic, transactional, concurrent-safe.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

// One-shot migration: copy each existing data/*.json blob into kv_store under
// the key `file:<basename>`. Idempotent — does nothing if the key already
// exists in DB. Safe to call on every boot.
async function migrateJsonFilesIfNeeded(dataDir = path.join(__dirname, 'data')) {
  if (!_hasDb()) return { skipped: true, reason: 'no DATABASE_URL' };
  await ensureSchema();
  const files = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))
    : [];
  const report = { migrated: [], skipped: [], errored: [] };
  for (const f of files) {
    const key = `file:${f}`;
    try {
      const existing = await kvGet(key, undefined);
      if (existing !== undefined && existing !== null) { report.skipped.push(f); continue; }
      const raw = fs.readFileSync(path.join(dataDir, f), 'utf8').trim();
      if (!raw) { report.skipped.push(f); continue; }
      await kvSet(key, JSON.parse(raw));
      report.migrated.push(f);
    } catch (e) { report.errored.push({ file: f, error: e.message }); }
  }
  return report;
}

// Lightweight wrapper: tries DB first, falls back to filesystem. Used by the
// shim helpers so existing routes continue to work even when DB is offline.
async function readJsonFileOrDb(filePath) {
  const base = path.basename(filePath);
  if (_hasDb()) {
    const v = await kvGet(`file:${base}`, undefined);
    if (v !== undefined && v !== null) return v;
  }
  if (fs.existsSync(filePath)) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
  }
  return null;
}

async function writeJsonFileOrDb(filePath, value) {
  const base = path.basename(filePath);
  if (_hasDb()) { try { await kvSet(`file:${base}`, value); } catch (e) { console.error('[db] kvSet failed:', e.message); } }
  // Also mirror to disk so legacy sync read paths still work and we keep a
  // local backup. Atomic via tmp+rename.
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (e) { console.error('[db] file mirror failed:', e.message); }
}

module.exports = { hasDb: _hasDb, getPool, ensureSchema, kvGet, kvSet,
                   migrateJsonFilesIfNeeded, readJsonFileOrDb, writeJsonFileOrDb };
