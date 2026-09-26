const _db = require('../../db');
const { PRESET_CATALOG } = require('./presets');

const _mem = new Map(); // tid -> servers[]
let _seq = 1;
let _schemaReady = false;

function _resolveAuthFromPreset(preset, body = {}) {
  if (body.auth_header) return String(body.auth_header);
  if (body.api_key && preset?.authHeaderName) {
    return `${preset.authHeaderName}:${body.api_key}`;
  }
  const envName = preset?.authEnv;
  if (!envName) return body.auth_header || null;
  let token = '';
  try {
    const pk = require('../credentials/platform_keys');
    token = pk.resolvePlatformKey(envName) || process.env[envName] || '';
  } catch {
    token = process.env[envName] || '';
  }
  if (!token) return null;
  const headerName = preset.authHeaderName || 'Authorization';
  if (headerName.toLowerCase() === 'authorization') return `Bearer ${token}`;
  return `${headerName}:${token}`;
}

function _hasAuthEnv(preset) {
  if (!preset?.authEnv) return false;
  try {
    const pk = require('../credentials/platform_keys');
    if (pk.resolvePlatformKey(preset.authEnv)) return true;
  } catch { /* ignore */ }
  return !!process.env[preset.authEnv];
}

async function ensureSchema() {
  if (!_db.hasDb() || _schemaReady) return;
  const pool = _db.getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_client_servers (
      id          SERIAL PRIMARY KEY,
      tenant_id   INTEGER NOT NULL,
      name        TEXT NOT NULL,
      category    TEXT DEFAULT 'community',
      transport   TEXT NOT NULL DEFAULT 'rest',
      builtin     TEXT,
      base_url    TEXT,
      api_key     TEXT,
      auth_header TEXT,
      enabled     BOOLEAN DEFAULT TRUE,
      loopback    BOOLEAN DEFAULT FALSE,
      meta        JSONB DEFAULT '{}',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mcp_client_tid ON mcp_client_servers(tenant_id)
  `);
  _schemaReady = true;
}

function _rowOut(r) {
  if (!r) return r;
  const key = r.api_key || '';
  const meta = typeof r.meta === 'string' ? (() => { try { return JSON.parse(r.meta); } catch { return {}; } })() : (r.meta || {});
  return {
    ...r,
    meta,
    api_key: undefined,
    auth_header: r.auth_header ? '[set]' : undefined,
    has_api_key: !!key || !!r.auth_header,
    api_key_preview: key ? key.slice(0, 4) + '…' + key.slice(-4) : '',
  };
}

function _memList(tid) {
  if (!_mem.has(tid)) _mem.set(tid, []);
  return _mem.get(tid);
}

async function listServers(tid) {
  await ensureSchema();
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT * FROM mcp_client_servers WHERE tenant_id=$1 ORDER BY enabled DESC, id ASC`,
        [tid],
      );
      return r.rows.map(_rowOut);
    } catch (_) {}
  }
  return _memList(tid).map(_rowOut);
}

async function getServerRaw(tid, id) {
  await ensureSchema();
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT * FROM mcp_client_servers WHERE tenant_id=$1 AND id=$2`,
        [tid, id],
      );
      return r.rows[0] || null;
    } catch (_) {}
  }
  return _memList(tid).find((s) => String(s.id) === String(id)) || null;
}

async function getServer(tid, id) {
  const raw = await getServerRaw(tid, id);
  return raw ? _rowOut(raw) : null;
}

async function addServer(tid, body = {}) {
  await ensureSchema();
  const preset = body.preset_id ? PRESET_CATALOG.find((p) => p.id === body.preset_id) : null;
  const auth_header = _resolveAuthFromPreset(preset, body);
  if (preset?.authEnv && !auth_header && !body.api_key) {
    const err = new Error(`${preset.authEnv} not configured — save it in Manage → Platform APIs first`);
    err.code = 'auth_missing';
    throw err;
  }
  const row = {
    name: String(body.name || preset?.name || 'MCP Server').slice(0, 120),
    category: String(body.category || preset?.category || 'community').slice(0, 40),
    transport: String(body.transport || preset?.transport || 'rest'),
    builtin: body.builtin || preset?.builtin || null,
    base_url: body.base_url != null ? String(body.base_url) : (preset?.base_url || ''),
    api_key: body.api_key ? String(body.api_key) : null,
    auth_header,
    enabled: body.enabled !== false,
    loopback: !!(body.loopback || preset?.loopback),
    meta: { ...(body.meta || {}), preset_id: body.preset_id || preset?.id || null },
  };

  if (_db.hasDb()) {
    const r = await _db.getPool().query(
      `INSERT INTO mcp_client_servers
        (tenant_id,name,category,transport,builtin,base_url,api_key,auth_header,enabled,loopback,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
      [
        tid, row.name, row.category, row.transport, row.builtin, row.base_url,
        row.api_key, row.auth_header, row.enabled, row.loopback, JSON.stringify(row.meta),
      ],
    );
    return _rowOut(r.rows[0]);
  }

  const full = {
    id: _seq++,
    tenant_id: tid,
    ...row,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  _memList(tid).push(full);
  return _rowOut(full);
}

async function updateServer(tid, id, patch = {}) {
  const cur = await getServer(tid, id);
  if (!cur) return null;
  // Need raw for keys — re-fetch mem with secrets
  let raw = cur;
  if (!_db.hasDb()) {
    raw = _memList(tid).find((s) => String(s.id) === String(id));
  } else {
    const r = await _db.getPool().query(`SELECT * FROM mcp_client_servers WHERE tenant_id=$1 AND id=$2`, [tid, id]);
    raw = r.rows[0];
  }
  if (!raw) return null;

  const next = {
    ...raw,
    name: patch.name != null ? String(patch.name).slice(0, 120) : raw.name,
    enabled: patch.enabled != null ? !!patch.enabled : raw.enabled,
    base_url: patch.base_url != null ? String(patch.base_url) : raw.base_url,
    api_key: patch.api_key != null && patch.api_key !== '' ? String(patch.api_key) : raw.api_key,
    auth_header: patch.auth_header != null ? String(patch.auth_header) : raw.auth_header,
    updated_at: new Date().toISOString(),
  };

  if (_db.hasDb()) {
    const r = await _db.getPool().query(
      `UPDATE mcp_client_servers SET
         name=$1, enabled=$2, base_url=$3, api_key=$4, auth_header=$5, updated_at=NOW()
       WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [next.name, next.enabled, next.base_url, next.api_key, next.auth_header, id, tid],
    );
    return _rowOut(r.rows[0]);
  }
  Object.assign(raw, next);
  return _rowOut(raw);
}

async function deleteServer(tid, id) {
  if (_db.hasDb()) {
    const r = await _db.getPool().query(
      `DELETE FROM mcp_client_servers WHERE tenant_id=$1 AND id=$2`,
      [tid, id],
    );
    return r.rowCount > 0;
  }
  const list = _memList(tid);
  const i = list.findIndex((s) => String(s.id) === String(id));
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

async function seedDefaults(tid) {
  const existing = await listServers(tid);
  const created = existing.length ? [...existing] : [];
  if (!existing.length) {
    for (const p of PRESET_CATALOG.filter((x) => x.transport === 'builtin' || x.loopback)) {
      created.push(await addServer(tid, { preset_id: p.id }));
    }
  }
  // Auto-connect keyed remote presets (e.g. Mangools) when the platform key is present.
  const havePreset = new Set(
    (await listServers(tid)).map((s) => (s.meta && s.meta.preset_id) || null).filter(Boolean),
  );
  // meta may be stripped in _rowOut — re-read raw names/base_url as fallback
  const names = new Set((await listServers(tid)).map((s) => String(s.name || '').toLowerCase()));
  for (const p of PRESET_CATALOG.filter((x) => x.autoSeedWhenKeyed)) {
    if (havePreset.has(p.id) || names.has(String(p.name).toLowerCase())) continue;
    if (!_hasAuthEnv(p)) continue;
    try {
      created.push(await addServer(tid, { preset_id: p.id }));
    } catch (e) {
      console.warn('[mcp-client] auto-seed', p.id, e.message);
    }
  }
  return listServers(tid);
}

function _resetMem() {
  _mem.clear();
  _seq = 1;
}

module.exports = {
  ensureSchema,
  listServers,
  getServer,
  getServerRaw,
  addServer,
  updateServer,
  deleteServer,
  seedDefaults,
  _resetMem,
  PRESET_CATALOG,
};
