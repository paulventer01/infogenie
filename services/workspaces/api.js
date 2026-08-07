// services/workspaces/api.js — Workspaces & Team panel API
//
// Mounted at /api/workspaces. Tenant-scoped (any signed-in member), unlike
// /api/admin/workspaces which is platform-admin only.
//
//   GET /  — { ok, workspaces, members, audit } for the caller's memberships

const express = require('express');
const _db = require('../../db');

const router = express.Router();

function _err(res, code, msg) {
  return res.status(code).json({ ok: false, error: msg });
}

router.get('/', async (req, res) => {
  if (!req.user) return _err(res, 401, 'auth_required');
  if (!_db.hasDb()) return _err(res, 503, 'db_unavailable');

  try {
    const p = _db.getPool();
    const memberships = Array.isArray(req.tenantMemberships) ? req.tenantMemberships : [];
    const activeId = req.tenant ? req.tenant.id : (memberships[0] && memberships[0].tenantId) || null;

    const workspaces = memberships.map((m) => ({
      id: String(m.tenantId),
      name: m.tenantName || m.name || 'Workspace',
      active: m.tenantId === activeId,
      members: undefined,
      campaigns: 0,
      plan: m.roleName || m.roleKey || '',
      color: m.tenantId === activeId ? '#0F766E' : '#64748B',
    }));

    // Enrich member counts when we have DB access
    if (workspaces.length) {
      const ids = workspaces.map((w) => Number(w.id)).filter((n) => Number.isInteger(n));
      if (ids.length) {
        const counts = await p.query(
          `SELECT tenant_id, COUNT(*)::int AS n
             FROM tenant_users
            WHERE tenant_id = ANY($1::int[]) AND status = 'active'
            GROUP BY tenant_id`,
          [ids],
        );
        const byId = Object.fromEntries(counts.rows.map((r) => [String(r.tenant_id), r.n]));
        for (const w of workspaces) w.members = byId[w.id] || 0;
      }
    }

    let members = [];
    if (Number.isInteger(activeId)) {
      const mr = await p.query(
        `SELECT u.name, u.email, COALESCE(r.name, r.key, 'Member') AS role,
                COALESCE(tu.joined_at, tu.invited_at)::text AS "lastActive",
                false AS twofa
           FROM tenant_users tu
           JOIN users u ON u.id = tu.user_id
           LEFT JOIN roles r ON r.id = tu.role_id
          WHERE tu.tenant_id = $1 AND tu.status = 'active'
          ORDER BY tu.joined_at ASC NULLS LAST`,
        [activeId],
      );
      members = mr.rows.map((row) => ({
        name: row.name || row.email,
        email: row.email,
        role: row.role,
        lastActive: row.lastActive || undefined,
        twofa: !!row.twofa,
      }));
    }

    let audit = [];
    try {
      const ar = await p.query(
        `SELECT a.actor_email AS "user",
                COALESCE(a.new_role, a.old_role, '') AS role,
                a.action,
                a.created_at::text AS "when",
                COALESCE(a.workspace_name, t.name, '') AS workspace
           FROM admin_audit_log a
           LEFT JOIN tenants t ON t.id = a.tenant_id
          WHERE ($1::int IS NULL OR a.tenant_id = $1 OR a.tenant_id IS NULL)
          ORDER BY a.created_at DESC
          LIMIT 40`,
        [Number.isInteger(activeId) ? activeId : null],
      );
      audit = ar.rows.map((row) => ({
        user: row.user || 'system',
        role: row.role || '',
        action: row.action || '',
        when: row.when || undefined,
        workspace: row.workspace || undefined,
      }));
    } catch (_) {
      // audit table may not exist in older DBs — panel still works
      audit = [];
    }

    res.json({ ok: true, workspaces, members, audit });
  } catch (e) {
    console.error('[workspaces]', e.message);
    _err(res, 500, e.message || 'workspaces_failed');
  }
});

module.exports = router;
