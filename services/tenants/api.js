// services/tenants/api.js — Tenant + role read API (Phase 1)
//
// Routes mounted at /api/tenants:
//   GET    /me                    — current user's tenant memberships + active tenant + platform role
//   GET    /active                — current active tenant + role + permission set (granular)
//   POST   /switch  {tenantId}    — switch active tenant (writes to session)
//   POST   /        {name}        — self-serve create a new tenant (caller becomes Tenant Owner)
//   GET    /roles                 — list system roles (read-only catalog)
//   GET    /permissions           — list permission catalog grouped by area (for role-builder UI)
//
// Phase 1 scope: read + self-serve create + switch only.
// User management, custom-role create/edit, platform-admin tenant create — Phase 4.

const express = require('express');
const _db = require('../../db');
const { listPermissions, listByArea, SYSTEM_ROLES } = require('./permissions');
const { _slugFromEmail, _uniqueSlug } = require('./schema');

const router = express.Router();

// ── Local auth guard — every route here needs a logged-in user ──────────────
function _requireUser(req, res) {
  if (req.user) return true;
  res.status(401).json({ ok:false, error:'auth_required' });
  return false;
}

// ── GET /me — high-level membership summary ─────────────────────────────────
router.get('/me', async (req, res) => {
  if (!_requireUser(req, res)) return;
  res.json({
    ok: true,
    user: { id: req.user.id, email: req.user.email, name: req.user.name },
    activeTenantId: req.tenant ? req.tenant.id : null,
    activeTenant:   req.tenant || null,
    activeRole:     req.tenantRole ? { key: req.tenantRole.key, name: req.tenantRole.name } : null,
    platformRole:   req.platformRole ? { key: req.platformRole.key, name: req.platformRole.name } : null,
    memberships:    req.tenantMemberships,
  });
});

// ── GET /active — current tenant with full permission set ──────────────────
router.get('/active', async (req, res) => {
  if (!_requireUser(req, res)) return;
  if (!req.tenant) {
    return res.json({ ok:true, tenant:null, role:null, permissions:[] });
  }
  res.json({
    ok: true,
    tenant: req.tenant,
    role:   req.tenantRole,
    platformRole: req.platformRole,
    permissions: Array.from(req.permissions || []),
  });
});

// ── POST /switch — change the active tenant for this session ───────────────
router.post('/switch', async (req, res) => {
  if (!_requireUser(req, res)) return;
  const tenantId = Number(req.body && req.body.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return res.status(400).json({ ok:false, error:'bad_tenant_id' });
  }
  // Verify membership before pinning
  const member = (req.tenantMemberships || []).find(m => m.tenantId === tenantId);
  if (!member) {
    return res.status(403).json({ ok:false, error:'not_a_member' });
  }
  req.session.activeTenantId = tenantId;
  res.json({ ok:true, activeTenantId: tenantId, tenant: { id: tenantId, name: member.tenantName, slug: member.slug } });
});

// ── POST / — self-serve create a new tenant ────────────────────────────────
// User becomes Tenant Owner of the new tenant. Configured per-user decision:
// self-serve is allowed by default (Platform Owners may also create tenants
// for other users via /api/admin in Phase 4).
router.post('/', async (req, res) => {
  if (!_requireUser(req, res)) return;
  if (!_db.hasDb()) return res.status(503).json({ ok:false, error:'db_unavailable' });

  const rawName = String((req.body && req.body.name) || '').trim();
  if (!rawName || rawName.length < 2 || rawName.length > 120) {
    return res.status(400).json({ ok:false, error:'bad_name', hint:'2-120 characters' });
  }

  try {
    const p = _db.getPool();

    // Slug derives from name; fall back to email if name produces nothing safe
    const baseSlug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
                     || _slugFromEmail(req.user.email);
    const slug = await _uniqueSlug(p, baseSlug);

    // Tenant Owner system role id
    const roleQ = await p.query(`SELECT id FROM roles WHERE tenant_id IS NULL AND key='tenant_owner' LIMIT 1`);
    if (!roleQ.rows[0]) return res.status(500).json({ ok:false, error:'tenant_owner_role_missing' });
    const ownerRoleId = roleQ.rows[0].id;

    const t = await p.query(`
      INSERT INTO tenants (name, slug, status, created_by_user_id)
      VALUES ($1, $2, 'active', $3)
      RETURNING id, name, slug, status, created_at
    `, [rawName, slug, req.user.id]);
    const tenant = t.rows[0];

    await p.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
      VALUES ($1, $2, $3, 'active', now())
    `, [tenant.id, req.user.id, ownerRoleId]);

    // Pin the new tenant as the active one so the user lands inside it
    req.session.activeTenantId = tenant.id;

    res.json({ ok:true, tenant });
  } catch (e) {
    console.error('[tenants] create error:', e.message);
    res.status(500).json({ ok:false, error:'create_failed', message: e.message });
  }
});

// ── GET /roles — system role catalog ───────────────────────────────────────
router.get('/roles', async (req, res) => {
  if (!_requireUser(req, res)) return;
  res.json({
    ok: true,
    roles: SYSTEM_ROLES.map(r => ({
      key: r.key, scope: r.scope, name: r.name, description: r.description,
      permissionCount: r.permissions.length,
      permissions: r.permissions,
    })),
  });
});

// ── GET /permissions — full permission catalog grouped by area ─────────────
// Used by the custom role builder UI (Phase 4) to render the checkbox matrix.
router.get('/permissions', async (req, res) => {
  if (!_requireUser(req, res)) return;
  res.json({
    ok: true,
    all: listPermissions(),
    byArea: listByArea(),
  });
});

module.exports = router;
