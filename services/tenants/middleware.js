// services/tenants/middleware.js — Tenant context loader (Phase 1: non-enforcing)
//
// Runs after services/auth `loadUserFromSession`. If req.user is set, this
// middleware attaches:
//   req.tenant            — { id, name, slug, status } of the user's active tenant
//   req.tenantRole        — { id, key, name, permissions[] } for that tenant
//   req.platformRole      — same shape if the user holds a platform-scope role, else null
//   req.permissions       — Set<string> of all permission keys the user holds
//   req.tenantMemberships — full list of { tenantId, tenantName, slug, roleKey, roleName }
//                           so the UI can render a tenant switcher
//   req.can(permKey)      — helper returning boolean
//
// Active tenant resolution:
//   1. req.session.activeTenantId  (set when user clicks "switch tenant")
//   2. fallback: the user's first active membership (lowest tenant_id)
//   3. if that session value points to a tenant the user no longer belongs to,
//      we fall back to (2) and clear the bad session value.
//
// IMPORTANT — Phase 1 only:
//   This middleware ATTACHES context. It does NOT enforce anything. No existing
//   route is gated. Enforcement (requirePermission, requireTenant) ships in
//   Phase 3 once every route filters its DB queries by tenant_id (Phase 2).

const _db = require('../../db');

async function loadTenantContext(req, _res, next) {
  // No user → nothing to attach. (Public routes, API-key callers, etc.)
  req.tenant            = null;
  req.tenantRole        = null;
  req.platformRole      = null;
  req.permissions       = new Set();
  req.tenantMemberships = [];
  req.can = (_k) => false;

  if (!req.user || !_db.hasDb()) return next();

  try {
    const p = _db.getPool();

    // ── All tenant memberships for this user ─────────────────────────────
    const memQ = await p.query(`
      SELECT t.id          AS tenant_id,
             t.name        AS tenant_name,
             t.slug        AS tenant_slug,
             t.status      AS tenant_status,
             r.id          AS role_id,
             r.key         AS role_key,
             r.name        AS role_name,
             r.permissions AS role_permissions,
             tu.status     AS member_status
        FROM tenant_users tu
        JOIN tenants t ON t.id = tu.tenant_id
        JOIN roles   r ON r.id = tu.role_id
       WHERE tu.user_id = $1
         AND tu.status  = 'active'
         AND t.status   = 'active'
       ORDER BY t.id ASC
    `, [req.user.id]);

    req.tenantMemberships = memQ.rows.map(m => ({
      tenantId:   m.tenant_id,
      tenantName: m.tenant_name,
      slug:       m.tenant_slug,
      roleKey:    m.role_key,
      roleName:   m.role_name,
    }));

    // ── Platform-scope role (if any) ─────────────────────────────────────
    const platQ = await p.query(`
      SELECT r.id, r.key, r.name, r.permissions
        FROM platform_users pu
        JOIN roles r ON r.id = pu.role_id
       WHERE pu.user_id = $1
       LIMIT 1
    `, [req.user.id]);
    if (platQ.rows[0]) {
      const r = platQ.rows[0];
      req.platformRole = {
        id: r.id, key: r.key, name: r.name,
        permissions: Array.isArray(r.permissions) ? r.permissions : [],
      };
      for (const k of req.platformRole.permissions) req.permissions.add(k);
    }

    // ── Resolve the active tenant ────────────────────────────────────────
    let activeId = req.session && req.session.activeTenantId;
    let active   = memQ.rows.find(m => m.tenant_id === activeId);
    if (!active && memQ.rows.length) {
      // No valid session-pinned tenant — default to the user's first one.
      active = memQ.rows[0];
      if (req.session && activeId && activeId !== active.tenant_id) {
        // Clear stale pin so the cookie reflects reality.
        req.session.activeTenantId = active.tenant_id;
      }
    }

    if (active) {
      req.tenant = {
        id:     active.tenant_id,
        name:   active.tenant_name,
        slug:   active.tenant_slug,
        status: active.tenant_status,
      };
      req.tenantRole = {
        id:          active.role_id,
        key:         active.role_key,
        name:        active.role_name,
        permissions: Array.isArray(active.role_permissions) ? active.role_permissions : [],
      };
      for (const k of req.tenantRole.permissions) req.permissions.add(k);
    }

    // ── Permission helper ────────────────────────────────────────────────
    req.can = (key) => req.permissions.has(key);

    // Expose on req.user for convenience (frontend reads /api/auth/me which
    // calls _publicUser — Phase 1 leaves _publicUser untouched, but the new
    // /api/tenants/me endpoint will surface this richer view).
  } catch (e) {
    // Never block on tenant context errors — log and move on. Phase 1 is
    // non-enforcing, so missing context just means the user proceeds without
    // tenant data, exactly as before.
    console.error('[tenants] loadTenantContext error:', e.message);
  }

  next();
}

module.exports = { loadTenantContext };
