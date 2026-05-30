// services/admin/data_mode.js — Effective data-mode resolver (Task 10)
//
// One place that answers: "for this request/client, should fabricated data be
// shown as a badged DEMO, or replaced with an honest 'data unavailable'?"
//
// Resolution order (first concrete 'demo'|'strict' wins):
//   1. client.data_mode        (when a client context is present)
//   2. tenants.data_mode_default
//   3. kv_store[admin:data_mode_default]  (platform default, seeded 'strict')
//   4. hard fallback 'strict'
//
// Identical in dev and prod — never gated on NODE_ENV.

const _db = require('../../db');
const { PLATFORM_DEFAULT_KEY } = require('./schema');

const VALID = new Set(['demo', 'strict']);
const VALID_SETTING = new Set(['inherit', 'demo', 'strict']);

function _norm(v) { return VALID.has(v) ? v : null; }

async function getPlatformDefault() {
  const v = await _db.kvGet(PLATFORM_DEFAULT_KEY, 'strict');
  return _norm(v) || 'strict';
}

async function setPlatformDefault(mode) {
  if (!VALID.has(mode)) throw new Error('platform default must be demo or strict');
  await _db.kvSet(PLATFORM_DEFAULT_KEY, mode);
  return mode;
}

async function getTenantDefault(tenantId) {
  if (!_db.hasDb() || !tenantId) return 'inherit';
  const r = await _db.getPool().query('SELECT data_mode_default FROM tenants WHERE id=$1', [tenantId]);
  const v = r.rows[0] && r.rows[0].data_mode_default;
  return VALID_SETTING.has(v) ? v : 'inherit';
}

async function setTenantDefault(tenantId, mode) {
  if (!VALID_SETTING.has(mode)) throw new Error('tenant default must be inherit, demo or strict');
  await _db.getPool().query('UPDATE tenants SET data_mode_default=$2, updated_at=now() WHERE id=$1', [tenantId, mode]);
  return mode;
}

async function getClientMode(clientId) {
  if (!_db.hasDb() || !clientId) return null;
  const r = await _db.getPool().query('SELECT data_mode, tenant_id FROM clients WHERE id=$1', [clientId]);
  if (!r.rows[0]) return null;
  return { mode: r.rows[0].data_mode, tenantId: r.rows[0].tenant_id };
}

// Resolve the effective mode ('demo' | 'strict') given an optional client and
// tenant. Returns { mode, source } where source explains which level decided.
async function resolveDataMode({ clientId = null, tenantId = null } = {}) {
  try {
    if (clientId) {
      const c = await getClientMode(clientId);
      // Tenant-scope guard: only honor a client-level override when the client
      // provably belongs to the request's resolved tenant. `clientId` can arrive
      // from an untrusted query/header (see clientIdFromReq), so trusting it
      // without this check would let any authenticated caller flip strict/demo
      // using another tenant's client id — a cross-tenant policy bypass.
      // When the tenant is unknown or mismatched, ignore the client entirely and
      // fall through to tenant/platform resolution.
      if (c && tenantId && c.tenantId === tenantId) {
        if (_norm(c.mode)) return { mode: c.mode, source: 'client' };
        // inherit → fall through to this (already-matching) tenant
      }
    }
    if (tenantId) {
      const td = await getTenantDefault(tenantId);
      if (_norm(td)) return { mode: td, source: 'tenant' };
    }
    const pd = await getPlatformDefault();
    return { mode: pd, source: 'platform' };
  } catch (e) {
    // Never let resolution failure leak fabricated data — fail to strict.
    console.warn('[admin/data_mode] resolve failed, defaulting strict:', e.message);
    return { mode: 'strict', source: 'fallback' };
  }
}

// Pull the client context off a request, if any. Optional and best-effort —
// most requests have no client, so resolution falls to tenant/platform.
function clientIdFromReq(req) {
  const raw = (req.query && (req.query.clientId || req.query.client_id))
    || (req.headers && req.headers['x-ig-client']);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = {
  resolveDataMode,
  getPlatformDefault, setPlatformDefault,
  getTenantDefault, setTenantDefault,
  getClientMode,
  clientIdFromReq,
  VALID, VALID_SETTING,
};
