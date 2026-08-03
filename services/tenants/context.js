// services/tenants/context.js — Tenant resolution helpers (Phase 2)
//
// Centralises the rules for "which tenant does this operation belong to?".
//
// Two callers:
//   • Express routes: tenant comes from req.tenant (set by middleware).
//   • Background jobs / crons / module-level helpers: no req exists — they
//     fall back to the platform-default tenant (the first active tenant
//     owned by an is_owner=TRUE user). Cached after first lookup.
//
// Feature flag (process.env.MULTITENANT_ENFORCEMENT):
//   'off'     — Phase 1 behaviour. Reads return everything; writes still set
//               tenant_id where the helper is used, but missing tenant_id is
//               not an error. Default during Phase 2 rollout.
//   'shadow'  — Like 'off' for reads (return everything) but logs a warning
//               whenever a route runs without a resolvable tenant. Use this
//               while wiring up routes to spot gaps before flipping enforcement.
//   'on'      — Reads MUST filter by tenant_id; writes MUST include it.
//               Helpers that can't resolve a tenant throw. This is the final
//               state once every route is wired and verified.
//
// Behaviour is purposely conservative: enforcement defaults to 'off' so this
// commit cannot break the running app for existing users.

const _db = require('../../db');
const { multitenantMode } = require('../security/prod_defaults');

// Evaluated once at module load. Production default is 'on' when unset.
const MODE = multitenantMode();
function mode() { return MODE; }
function isOff()     { return MODE === 'off'; }
function isShadow()  { return MODE === 'shadow'; }
function isOn()      { return MODE === 'on'; }

// ── Default-tenant cache ────────────────────────────────────────────────────
// "Default tenant" = the tenant whose owner was the first platform owner.
// All pre-multi-tenancy data was backfilled to this tenant in Phase 1, so it
// is the safe fallback for any code path that doesn't yet have a req context.
let _defaultTenantIdCache = null;
let _defaultTenantLookupAt = 0;
const _CACHE_TTL_MS = 60_000; // 1 minute — short so a deletion/repair propagates fast

async function getDefaultTenantId() {
  if (!_db.hasDb()) return null;
  const now = Date.now();
  if (_defaultTenantIdCache && (now - _defaultTenantLookupAt) < _CACHE_TTL_MS) {
    return _defaultTenantIdCache;
  }
  try {
    const p = _db.getPool();
    // Prefer: tenant created by an is_owner=TRUE user.
    let r = await p.query(`
      SELECT t.id
        FROM tenants t
        JOIN users   u ON u.id = t.created_by_user_id
       WHERE t.status = 'active' AND u.is_owner = TRUE
       ORDER BY t.id ASC LIMIT 1
    `);
    // Fallback: any active tenant (lowest id).
    if (!r.rows[0]) {
      r = await p.query(`SELECT id FROM tenants WHERE status='active' ORDER BY id ASC LIMIT 1`);
    }
    if (r.rows[0]) {
      _defaultTenantIdCache = r.rows[0].id;
      _defaultTenantLookupAt = now;
      return _defaultTenantIdCache;
    }
  } catch (e) {
    console.error('[tenants] getDefaultTenantId failed:', e.message);
  }
  return null;
}

function clearDefaultTenantCache() {
  _defaultTenantIdCache = null;
  _defaultTenantLookupAt = 0;
}

// ── Resolve the tenant id for a given request ───────────────────────────────
// Used by route handlers in this form:
//   const tenantId = await resolveTenantId(req);
//   if (tenantId == null) return res.status(400).json({ ok:false, error:'no_tenant' });
//
// Behaviour:
//   • req.tenant.id wins.
//   • If absent (api-key caller, cron, etc.) → fall back to default tenant
//     UNLESS enforcement is 'on' (then return null and the caller 4xx's).
//   • 'shadow' mode logs a warning but still falls back so the app keeps working.
async function resolveTenantId(req, opts = {}) {
  const ctxLabel = opts.label || (req && req.path) || 'unknown';
  if (req && req.tenant && req.tenant.id) return req.tenant.id;

  if (isOn() && !opts.allowFallback) {
    return null;
  }
  if (isShadow()) {
    console.warn(`[tenants] no req.tenant for "${ctxLabel}" — using default tenant fallback`);
  }
  return await getDefaultTenantId();
}

// Strict variant for crons / background jobs that EXPLICITLY want the default
// platform tenant (never a request's). Always returns the cached default.
async function getCronTenantId() {
  return await getDefaultTenantId();
}

// All active tenant ids — for background jobs that must run once PER workspace
// (e.g. the officer auto-report / auto-meeting schedulers). Returns [] if the
// DB is down. Not cached (cheap, and crons tick infrequently).
async function listActiveTenantIds() {
  if (!_db.hasDb()) return [];
  try {
    const r = await _db.getPool().query(`SELECT id FROM tenants WHERE status='active' ORDER BY id ASC`);
    return r.rows.map(row => row.id);
  } catch (e) {
    console.error('[tenants] listActiveTenantIds failed:', e.message);
    return [];
  }
}

// ── Express helper: 4xx if no tenant resolvable in 'on' mode ───────────────
// Use inside a route as:
//   const tenantId = await requireTenant(req, res); if (!tenantId) return;
async function requireTenant(req, res, opts = {}) {
  const tid = await resolveTenantId(req, opts);
  if (tid) return tid;
  res.status(400).json({ ok:false, error:'no_tenant',
    hint:'No active tenant for this session. Create or switch to a tenant via /api/tenants.' });
  return null;
}

module.exports = {
  mode, isOff, isShadow, isOn,
  resolveTenantId,
  requireTenant,
  getDefaultTenantId,
  getCronTenantId,
  listActiveTenantIds,
  clearDefaultTenantCache,
};
