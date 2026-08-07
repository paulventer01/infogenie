// services/tenants/permission_enforce.js
// ─────────────────────────────────────────────────────────────────────────────
// Permission ENFORCEMENT — turns the matrix in ./permission_matrix.js into a
// real server-side boundary. Built on the request context that
// ./middleware.js already attaches (`req.permissions`, `req.can()`,
// `req.platformRole`, `req.user.isOwner`).
//
// Rollout flag (process.env.PERMISSION_ENFORCEMENT), mirroring the multitenant
// MULTITENANT_ENFORCEMENT pattern in ./context.js:
//   'off'    — never blocks. Matrix is inert. (Hard kill-switch.)
//   'shadow' — DEFAULT. Logs + counts would-be denials but ALLOWS the request,
//              so gaps/misconfigured grants surface before strict mode.
//   'on'     — strict. A logged-in user lacking the required permission gets a
//              clean 403. This is the goal state once verified against traffic.
//
// To flip on:  set PERMISSION_ENFORCEMENT=on in the deployment environment.
//
// Platform owner / platform admin always bypass — there is ONE definition of
// "is this a platform admin?" here (isPlatformAdmin) and the Admin Portal reuses
// it, so the bespoke check it used to carry is gone.

const matrix = require('./permission_matrix');
const { permissionMode } = require('../security/prod_defaults');

// Evaluated once at module load (tests delete require.cache + set env before require).
// Production default is 'on' when PERMISSION_ENFORCEMENT is unset.
const MODE = permissionMode();
function mode()     { return MODE; }
function isOff()    { return MODE === 'off'; }
function isShadow() { return MODE === 'shadow'; }
function isOn()     { return MODE === 'on'; }

// ── Observability counters (since process start) ────────────────────────────
const _stats = {
  allowed:     0, // had the permission (or bypassed) — request proceeded
  denied:      0, // blocked with 403 (only happens in 'on')
  shadowWould: 0, // would have been blocked, but allowed (off/shadow)
  unmapped:    0, // no matrix group covered the path — allowed + logged as a gap
  byPermission: Object.create(null), // required-key → would-be/actual deny count
};
const _RECENT_CAP = 50;
const _recentDenials = []; // ring buffer of {ts, actor, path, method, required, blocked}

function _recordDenial({ actor, path, method, required, blocked }) {
  _stats.byPermission[required] = (_stats.byPermission[required] || 0) + 1;
  _recentDenials.push({ ts: Date.now(), actor, path, method, required, blocked });
  if (_recentDenials.length > _RECENT_CAP) _recentDenials.shift();
}

// ── Shared identity helpers (single source of truth) ────────────────────────
function isPlatformAdmin(req) {
  if (!req || !req.user) return false;
  if (req.user.isOwner === true) return true;
  const k = req.platformRole && req.platformRole.key;
  return k === 'platform_owner' || k === 'platform_admin';
}

// Does this request's principal hold `key`? Platform admins/owners hold all.
function hasPermission(req, key) {
  if (!key) return true;
  if (isPlatformAdmin(req)) return true;
  return !!(req && typeof req.can === 'function' && req.can(key));
}

function _actorId(req) {
  return (req && req.user && req.user.id) || null;
}

function _deny403(res, required) {
  return res.status(403).json({
    ok: false,
    error: 'forbidden',
    required,
    hint: 'Your role does not grant permission for this action. Ask a workspace admin to update your role.',
  });
}

// ── Per-route guard (for explicit use inside a router) ──────────────────────
//   router.post('/x', requirePermission('grow.optimizer.control'), handler)
function requirePermission(key) {
  return function _requirePermission(req, res, next) {
    if (hasPermission(req, key)) { _stats.allowed++; return next(); }
    const meta = { actor: _actorId(req), path: req.path, method: req.method, required: key };
    if (isOff() || isShadow()) {
      _stats.shadowWould++;
      _recordDenial({ ...meta, blocked: false });
      if (isShadow()) {
        console.warn(`[perm] would deny ${meta.method} ${meta.path} — actor=${meta.actor} needs "${key}" (shadow)`);
      }
      return next();
    }
    _stats.denied++;
    _recordDenial({ ...meta, blocked: true });
    return _deny403(res, key);
  };
}

// ── Global matrix enforcer (mounted once in server.js) ──────────────────────
// Looks the request up in the matrix and enforces the mapped permission. Skips
// anonymous/public traffic (no req.user) — those are gated elsewhere — and skips
// non-/api paths.
function enforceMatrix(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (!req.user) return next();                 // anon: handled by auth gate / public allowlist
  if (isOff()) return next();                   // hard kill-switch
  if (isPlatformAdmin(req)) { _stats.allowed++; return next(); }

  const { matched, permission } = matrix.requiredPermissionForRequest(req.path, req.method);

  if (!matched) {
    // No group covers this path. Allow (conservative) but surface the gap so the
    // matrix can be completed — mirrors multitenant's shadow-gap logging.
    _stats.unmapped++;
    if (isShadow()) console.warn(`[perm] unmapped API path ${req.method} ${req.path} — add it to permission_matrix`);
    return next();
  }

  if (hasPermission(req, permission)) { _stats.allowed++; return next(); }

  const meta = { actor: _actorId(req), path: req.path, method: req.method, required: permission };
  if (isShadow()) {
    _stats.shadowWould++;
    _recordDenial({ ...meta, blocked: false });
    console.warn(`[perm] would deny ${meta.method} ${meta.path} — actor=${meta.actor} needs "${permission}" (shadow)`);
    return next();
  }
  // isOn()
  _stats.denied++;
  _recordDenial({ ...meta, blocked: true });
  return _deny403(res, permission);
}

// ── Snapshot for the owner-only debug endpoint ──────────────────────────────
function snapshot() {
  return {
    mode: MODE,
    stats: {
      allowed:     _stats.allowed,
      denied:      _stats.denied,
      shadowWould: _stats.shadowWould,
      unmapped:    _stats.unmapped,
    },
    byPermission: { ..._stats.byPermission },
    recentDenials: _recentDenials.slice(-20),
    routeGroups:  matrix.ROUTE_GROUPS.length,
    components:   Object.keys(matrix.COMPONENT_MATRIX).length,
  };
}

module.exports = {
  mode, isOff, isShadow, isOn,
  isPlatformAdmin,
  hasPermission,
  requirePermission,
  enforceMatrix,
  snapshot,
};
