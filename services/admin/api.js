// services/admin/api.js — Admin Portal API (Task 10)
//
// Mounted at /api/admin BEFORE the owner gate (like /api/auth and /api/tenants)
// and self-gated to platform owners/admins. Surfaces:
//   GET    /me                       — caller's admin capabilities
//   GET    /workspaces               — all tenants (+ data_mode_default, counts)
//   POST   /workspaces               — create a tenant
//   PATCH  /workspaces/:id           — rename / status / data_mode_default
//   GET    /users                    — all platform users + memberships
//   GET    /roles                    — system role catalog
//   GET    /clients                  — clients (optionally filtered by tenant)
//   POST   /clients                  — create a client
//   PATCH  /clients/:id              — rename / status / data_mode
//   DELETE /clients/:id              — archive a client
//   GET    /data-mode                — platform default + resolver preview
//   PUT    /data-mode                — set platform default (demo|strict)
//   GET    /issues                   — issue inbox (filter by status)
//   PATCH  /issues/:id               — acknowledge / resolve / reopen
//   POST   /issues/test              — raise a synthetic issue (verify alerts)

const express = require('express');
const _db = require('../../db');
const { SYSTEM_ROLES, listByArea, listPermissions } = require('../tenants/permissions');
const { COMPONENT_MATRIX } = require('../tenants/permission_matrix');
const _dataMode = require('./data_mode');
const _issues = require('./issues');
const _audit = require('./audit');
const _platformKeys = require('../credentials/platform_keys');
const _permEnforce = require('../tenants/permission_enforce');

const router = express.Router();

function _err(res, code, msg) { return res.status(code).json({ ok: false, error: msg }); }

// ── Gate: platform owner OR platform admin only ─────────────────────────────
// Single source of truth for "is this principal a platform admin?" lives in
// services/tenants/permission_enforce — the same helper the global matrix
// enforcer and bypass logic use, so there is ONE enforcement model.
const _isPlatformAdmin = _permEnforce.isPlatformAdmin;
router.use((req, res, next) => {
  if (!req.user) return _err(res, 401, 'auth_required');
  if (!_isPlatformAdmin(req)) return _err(res, 403, 'admin_only');
  if (!_db.hasDb()) return _err(res, 503, 'db_unavailable');
  next();
});

function _slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// ── GET /me ─────────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  res.json({
    ok: true,
    user: { id: req.user.id, email: req.user.email, name: req.user.name, isOwner: !!req.user.isOwner },
    platformRole: req.platformRole ? { key: req.platformRole.key, name: req.platformRole.name } : (req.user.isOwner ? { key: 'platform_owner', name: 'Owner' } : null),
  });
});

// ── Workspaces (tenants) ────────────────────────────────────────────────────
router.get('/workspaces', async (req, res) => {
  try {
    const r = await _db.getPool().query(`
      SELECT t.id, t.name, t.slug, t.status, t.data_mode_default, t.created_at,
             (SELECT COUNT(*) FROM tenant_users tu WHERE tu.tenant_id=t.id AND tu.status='active') AS member_count,
             (SELECT COUNT(*) FROM clients c WHERE c.tenant_id=t.id AND c.status='active') AS client_count
        FROM tenants t
       WHERE t.status <> 'deleted'
       ORDER BY t.id ASC`);
    res.json({ ok: true, workspaces: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/workspaces', async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (name.length < 2 || name.length > 120) return _err(res, 400, 'bad_name');
  try {
    const p = _db.getPool();
    let slug = _slugify(name) || ('ws-' + Date.now());
    // ensure unique slug
    for (let i = 0; i < 50; i++) {
      const ex = await p.query('SELECT 1 FROM tenants WHERE slug=$1', [i ? `${slug}-${i}` : slug]);
      if (!ex.rows[0]) { if (i) slug = `${slug}-${i}`; break; }
    }
    const roleQ = await p.query(`SELECT id FROM roles WHERE tenant_id IS NULL AND key='tenant_owner' LIMIT 1`);
    const t = await p.query(`
      INSERT INTO tenants (name, slug, status, created_by_user_id)
      VALUES ($1,$2,'active',$3) RETURNING id, name, slug, status, data_mode_default, created_at`,
      [name, slug, req.user.id]);
    const tenant = t.rows[0];
    if (roleQ.rows[0]) {
      await p.query(`INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
        VALUES ($1,$2,$3,'active',now()) ON CONFLICT DO NOTHING`, [tenant.id, req.user.id, roleQ.rows[0].id]);
    }
    res.json({ ok: true, workspace: tenant });
  } catch (e) { _err(res, 500, e.message); }
});

router.patch('/workspaces/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  const sets = [], vals = [];
  const b = req.body || {};
  if (typeof b.name === 'string' && b.name.trim().length >= 2) { vals.push(b.name.trim().slice(0, 120)); sets.push(`name=$${vals.length}`); }
  if (['active', 'suspended'].includes(b.status)) { vals.push(b.status); sets.push(`status=$${vals.length}`); }
  if (_dataMode.VALID_SETTING.has(b.data_mode_default)) { vals.push(b.data_mode_default); sets.push(`data_mode_default=$${vals.length}`); }
  if (!sets.length) return _err(res, 400, 'nothing_to_update');
  vals.push(id);
  try {
    const r = await _db.getPool().query(
      `UPDATE tenants SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING id, name, slug, status, data_mode_default`, vals);
    if (!r.rows[0]) return _err(res, 404, 'not_found');
    res.json({ ok: true, workspace: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Users ───────────────────────────────────────────────────────────────────
router.get('/users', async (_req, res) => {
  try {
    const r = await _db.getPool().query(`
      SELECT u.id, u.email, u.name, u.is_owner, u.created_at,
             pr.key AS platform_role,
             COALESCE(json_agg(json_build_object('tenantId', t.id, 'tenant', t.name, 'role', r.name))
               FILTER (WHERE t.id IS NOT NULL), '[]') AS memberships
        FROM users u
        LEFT JOIN platform_users pu ON pu.user_id = u.id
        LEFT JOIN roles pr ON pr.id = pu.role_id
        LEFT JOIN tenant_users tu ON tu.user_id = u.id AND tu.status='active'
        LEFT JOIN tenants t ON t.id = tu.tenant_id AND t.status='active'
        LEFT JOIN roles r ON r.id = tu.role_id
       GROUP BY u.id, pr.key
       ORDER BY u.id ASC`);
    res.json({ ok: true, users: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/roles', (_req, res) => {
  res.json({ ok: true, roles: SYSTEM_ROLES.map(r => ({ key: r.key, scope: r.scope, name: r.name, description: r.description, permissionCount: r.permissions.length })) });
});

// ── Roles & Permissions matrix (read-only) ──────────────────────────────────
// Surfaces the live permission model so an owner/admin can review, at a glance,
// which system role grants which permission and which app screen requires what.
// Pulled straight from the source of truth (SYSTEM_ROLES, the permission
// catalog, and COMPONENT_MATRIX) — no hardcoded duplicate. View-only; the
// router-level owner/admin gate above already restricts access (non-admins 403).
router.get('/permissions-matrix', (_req, res) => {
  try {
    const roles = SYSTEM_ROLES.map(r => ({
      key: r.key, scope: r.scope, name: r.name, description: r.description,
      permissions: r.permissions.slice(),
    }));
    const byAreaRaw = listByArea();
    const areas = Object.entries(byAreaRaw).map(([area, perms]) => ({
      area,
      permissions: perms.map(p => ({ key: p.key, label: p.label, scope: p.scope, area: p.area })),
    }));
    const labelByKey = Object.fromEntries(listPermissions().map(p => [p.key, p.label]));
    const components = Object.entries(COMPONENT_MATRIX)
      .map(([view, permission]) => ({ view, permission, permissionLabel: labelByKey[permission] || null }))
      .sort((a, b) => a.view.localeCompare(b.view));
    res.json({ ok: true, roles, areas, components });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Roles & permissions matrix CSV export ───────────────────────────────────
// Streams the same live model as GET /permissions-matrix as a downloadable CSV
// for offline access reviews / compliance attachments. Two sections in one file:
//   1) ROLES × PERMISSIONS — one row per permission (grouped by area), one
//      column per system role, "Yes" where the role grants it.
//   2) FEATURE → PERMISSION MAP — one row per app screen and the permission it
//      requires. Same owner/admin gate as the rest of /api/admin applies.
router.get('/permissions-matrix/export', (_req, res) => {
  try {
    const roles = SYSTEM_ROLES.map(r => ({
      key: r.key, scope: r.scope, name: r.name, permissions: new Set(r.permissions || []),
    }));
    const byAreaRaw = listByArea();
    const labelByKey = Object.fromEntries(listPermissions().map(p => [p.key, p.label]));

    const lines = [];
    // Section 1 — roles × permissions grid.
    const gridHeader = ['Area', 'Permission', 'Permission Key', ...roles.map(r => `${r.name} (${r.scope})`)];
    lines.push('Roles × Permissions');
    lines.push(gridHeader.map(_csvCell).join(','));
    for (const [area, perms] of Object.entries(byAreaRaw)) {
      for (const p of perms) {
        const row = [area, p.label, p.key, ...roles.map(r => (r.permissions.has(p.key) ? 'Yes' : ''))];
        lines.push(row.map(_csvCell).join(','));
      }
    }

    // Section 2 — feature → permission map.
    lines.push('');
    lines.push('Feature → Permission Map');
    lines.push(['Screen (data-view)', 'Required Permission', 'Permission Key'].map(_csvCell).join(','));
    const components = Object.entries(COMPONENT_MATRIX)
      .map(([view, permission]) => ({ view, permission, label: labelByKey[permission] || '' }))
      .sort((a, b) => a.view.localeCompare(b.view));
    for (const c of components) {
      lines.push([c.view, c.label || '—', c.permission || '—'].map(_csvCell).join(','));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="permissions-matrix-${stamp}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  } catch (e) { _err(res, 500, e.message); }
});

// ── Workspace membership management ─────────────────────────────────────────
// List the users in a workspace with their assigned role.
router.get('/workspaces/:id/members', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  try {
    const r = await _db.getPool().query(`
      SELECT tu.user_id, u.email, u.name, tu.status, tu.joined_at,
             tu.invited_at, ib.email AS invited_by_email,
             r.key AS role_key, r.name AS role_name
        FROM tenant_users tu
        JOIN users u ON u.id = tu.user_id
        LEFT JOIN roles r ON r.id = tu.role_id
        LEFT JOIN users ib ON ib.id = tu.invited_by_user_id
       WHERE tu.tenant_id = $1
       ORDER BY CASE tu.status WHEN 'active' THEN 0 ELSE 1 END,
                tu.joined_at ASC NULLS LAST, tu.invited_at DESC NULLS LAST`, [id]);
    res.json({ ok: true, members: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// Add a user to a workspace (or change their role) — body { userId, roleKey }.
router.post('/workspaces/:id/members', async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const userId = Number(b.userId);
  const roleKey = String(b.roleKey || '').trim();
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  if (!Number.isInteger(userId)) return _err(res, 400, 'bad_user');
  try {
    const p = _db.getPool();
    const role = await p.query(`SELECT id, name, scope FROM roles WHERE tenant_id IS NULL AND key=$1 LIMIT 1`, [roleKey]);
    if (!role.rows[0] || role.rows[0].scope !== 'tenant') return _err(res, 400, 'bad_role');
    const ux = await p.query('SELECT email FROM users WHERE id=$1', [userId]);
    if (!ux.rows[0]) return _err(res, 404, 'user_not_found');
    const tx = await p.query(`SELECT name FROM tenants WHERE id=$1 AND status<>'deleted'`, [id]);
    if (!tx.rows[0]) return _err(res, 404, 'workspace_not_found');
    // Capture the prior role (if already a member) so the audit shows the change.
    const prior = await p.query(
      `SELECT r.name AS role_name, tu.status FROM tenant_users tu
         LEFT JOIN roles r ON r.id = tu.role_id
        WHERE tu.tenant_id=$1 AND tu.user_id=$2`, [id, userId]);
    const wasMember = !!(prior.rows[0] && prior.rows[0].status === 'active');
    await p.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
      VALUES ($1,$2,$3,'active',now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id=EXCLUDED.role_id, status='active'`,
      [id, userId, role.rows[0].id]);
    await _audit.recordAudit({
      action: wasMember ? 'membership.role_change' : 'membership.add',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: userId, targetEmail: ux.rows[0].email,
      tenantId: id, workspaceId: id, workspaceName: tx.rows[0].name,
      oldRole: prior.rows[0] ? prior.rows[0].role_name : null,
      newRole: role.rows[0].name,
    });
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// Change a member's role — body { roleKey }.
router.patch('/workspaces/:id/members/:userId', async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  const roleKey = String((req.body && req.body.roleKey) || '').trim();
  if (!Number.isInteger(id) || !Number.isInteger(userId)) return _err(res, 400, 'bad_id');
  try {
    const p = _db.getPool();
    const role = await p.query(`SELECT id, name, scope FROM roles WHERE tenant_id IS NULL AND key=$1 LIMIT 1`, [roleKey]);
    if (!role.rows[0] || role.rows[0].scope !== 'tenant') return _err(res, 400, 'bad_role');
    const prior = await p.query(
      `SELECT u.email, r.name AS role_name, t.name AS workspace_name
         FROM tenant_users tu
         JOIN users u ON u.id = tu.user_id
         LEFT JOIN roles r ON r.id = tu.role_id
         LEFT JOIN tenants t ON t.id = tu.tenant_id
        WHERE tu.tenant_id=$1 AND tu.user_id=$2`, [id, userId]);
    const r = await p.query(`UPDATE tenant_users SET role_id=$3 WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id`,
      [id, userId, role.rows[0].id]);
    if (!r.rows[0]) return _err(res, 404, 'not_a_member');
    await _audit.recordAudit({
      action: 'membership.role_change',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: userId, targetEmail: prior.rows[0] ? prior.rows[0].email : null,
      tenantId: id, workspaceId: id, workspaceName: prior.rows[0] ? prior.rows[0].workspace_name : null,
      oldRole: prior.rows[0] ? prior.rows[0].role_name : null,
      newRole: role.rows[0].name,
    });
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// Remove a user from a workspace.
router.delete('/workspaces/:id/members/:userId', async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(id) || !Number.isInteger(userId)) return _err(res, 400, 'bad_id');
  try {
    const p = _db.getPool();
    const prior = await p.query(
      `SELECT u.email, r.name AS role_name, t.name AS workspace_name, tu.status
         FROM tenant_users tu
         JOIN users u ON u.id = tu.user_id
         LEFT JOIN roles r ON r.id = tu.role_id
         LEFT JOIN tenants t ON t.id = tu.tenant_id
        WHERE tu.tenant_id=$1 AND tu.user_id=$2`, [id, userId]);
    const r = await p.query(`DELETE FROM tenant_users WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id`, [id, userId]);
    if (!r.rows[0]) return _err(res, 404, 'not_a_member');
    await _audit.recordAudit({
      action: 'membership.remove',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: userId, targetEmail: prior.rows[0] ? prior.rows[0].email : null,
      tenantId: id, workspaceId: id, workspaceName: prior.rows[0] ? prior.rows[0].workspace_name : null,
      oldRole: prior.rows[0] ? prior.rows[0].role_name : null,
      newRole: null,
      detail: prior.rows[0] && prior.rows[0].status === 'invited' ? 'Removed a pending invite' : null,
    });
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// Grant or revoke a platform role — body { roleKey: 'platform_admin' | null }.
// Owners cannot be demoted here; only platform_admin can be granted (not owner).
router.patch('/users/:id/platform-role', async (req, res) => {
  const uid = Number(req.params.id);
  if (!Number.isInteger(uid)) return _err(res, 400, 'bad_id');
  const raw = req.body && req.body.roleKey;
  const roleKey = (raw == null || raw === '' || raw === 'none') ? null : String(raw);
  try {
    const p = _db.getPool();
    const ux = await p.query('SELECT email, is_owner FROM users WHERE id=$1', [uid]);
    if (!ux.rows[0]) return _err(res, 404, 'user_not_found');
    if (ux.rows[0].is_owner) return _err(res, 400, 'cannot_change_owner');
    // Capture the existing platform role so the audit reflects the change.
    const cur = await p.query(
      `SELECT r.name AS role_name FROM platform_users pu
         LEFT JOIN roles r ON r.id = pu.role_id WHERE pu.user_id=$1`, [uid]);
    const oldRole = cur.rows[0] ? cur.rows[0].role_name : null;
    if (roleKey === null) {
      await p.query('DELETE FROM platform_users WHERE user_id=$1', [uid]);
      await _audit.recordAudit({
        action: 'platform_role.revoke',
        actorUserId: req.user.id, actorEmail: req.user.email,
        targetUserId: uid, targetEmail: ux.rows[0].email,
        oldRole, newRole: null,
      });
      return res.json({ ok: true, platformRole: null });
    }
    if (roleKey !== 'platform_admin') return _err(res, 400, 'only_platform_admin_grantable');
    const role = await p.query(`SELECT id, name FROM roles WHERE tenant_id IS NULL AND key='platform_admin' LIMIT 1`);
    if (!role.rows[0]) return _err(res, 400, 'role_not_found');
    await p.query(`INSERT INTO platform_users (user_id, role_id, granted_by, granted_at)
      VALUES ($1,$2,$3,now())
      ON CONFLICT (user_id) DO UPDATE SET role_id=EXCLUDED.role_id`, [uid, role.rows[0].id, req.user.id]);
    await _audit.recordAudit({
      action: 'platform_role.grant',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: uid, targetEmail: ux.rows[0].email,
      oldRole, newRole: role.rows[0].name,
    });
    res.json({ ok: true, platformRole: 'platform_admin' });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Audit log (who changed roles & memberships) ─────────────────────────────
// Read-only history of membership & platform-role mutations. Gated to platform
// owner/admin by the router-level gate above (both hold `platform.audit.view`).
// Optional filters: ?tenantId= ?action= ?userId= (target). Capped at 200 rows.
router.get('/audit', async (req, res) => {
  try {
    const params = [], where = [];
    const tenantId = Number(req.query.tenantId);
    const userId = Number(req.query.userId);
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    if (Number.isInteger(tenantId)) { params.push(tenantId); where.push(`a.tenant_id=$${params.length}`); }
    if (Number.isInteger(userId)) { params.push(userId); where.push(`a.target_user_id=$${params.length}`); }
    if (action) { params.push(action); where.push(`a.action=$${params.length}`); }
    const r = await _db.getPool().query(`
      SELECT a.id, a.action, a.actor_user_id, a.actor_email, a.target_user_id,
             a.target_email, a.workspace_id, a.workspace_name, a.old_role,
             a.new_role, a.detail, a.created_at,
             t.name AS tenant_name
        FROM admin_audit_log a
        LEFT JOIN tenants t ON t.id = a.tenant_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 200`, params);
    const actions = await _db.getPool().query(
      `SELECT action, COUNT(*)::int AS n FROM admin_audit_log GROUP BY action ORDER BY action`);
    res.json({ ok: true, entries: r.rows, actionCounts: Object.fromEntries(actions.rows.map(x => [x.action, x.n])) });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Audit log CSV export ────────────────────────────────────────────────────
// Streams the FULL filtered history (no 200-row cap) as a downloadable CSV for
// compliance reviews & support investigations. Honors the same optional filters
// as GET /audit: ?tenantId= ?action= ?userId=. Same owner/admin gate applies.
const _csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
router.get('/audit/export', async (req, res) => {
  try {
    const params = [], where = [];
    const tenantId = Number(req.query.tenantId);
    const userId = Number(req.query.userId);
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    if (Number.isInteger(tenantId)) { params.push(tenantId); where.push(`a.tenant_id=$${params.length}`); }
    if (Number.isInteger(userId)) { params.push(userId); where.push(`a.target_user_id=$${params.length}`); }
    if (action) { params.push(action); where.push(`a.action=$${params.length}`); }
    const r = await _db.getPool().query(`
      SELECT a.action, a.actor_email, a.actor_user_id, a.target_email, a.target_user_id,
             a.workspace_name, a.old_role, a.new_role, a.detail, a.created_at,
             t.name AS tenant_name
        FROM admin_audit_log a
        LEFT JOIN tenants t ON t.id = a.tenant_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.created_at DESC, a.id DESC`, params);
    const header = ['when', 'action', 'actor email', 'target email', 'workspace', 'old role', 'new role', 'detail'];
    const lines = [header.map(_csvCell).join(',')];
    for (const e of r.rows) {
      const when = e.created_at ? new Date(e.created_at).toISOString() : '';
      const actor = e.actor_email || (e.actor_user_id ? '#' + e.actor_user_id : '');
      const target = e.target_email || (e.target_user_id ? '#' + e.target_user_id : '');
      const workspace = e.workspace_name || e.tenant_name || 'platform';
      lines.push([when, e.action, actor, target, workspace, e.old_role || '', e.new_role || '', e.detail || '']
        .map(_csvCell).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  } catch (e) { _err(res, 500, e.message); }
});

// ── Team invites (email a teammate to join a workspace) ─────────────────────
const _auth = require('../auth/api');
const INVITE_TTL_MIN = 60 * 24 * 7; // 7 days
const _emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// List all pending (status='invited') memberships across workspaces.
router.get('/invites', async (_req, res) => {
  try {
    const r = await _db.getPool().query(`
      SELECT tu.tenant_id, t.name AS workspace, tu.user_id, u.email, u.name,
             r.key AS role_key, r.name AS role_name,
             tu.invited_at, ib.email AS invited_by_email
        FROM tenant_users tu
        JOIN tenants t ON t.id = tu.tenant_id AND t.status <> 'deleted'
        JOIN users u ON u.id = tu.user_id
        LEFT JOIN roles r ON r.id = tu.role_id
        LEFT JOIN users ib ON ib.id = tu.invited_by_user_id
       WHERE tu.status = 'invited'
       ORDER BY tu.invited_at DESC NULLS LAST`);
    res.json({ ok: true, invites: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

// Send an invite — body { email, tenantId, roleKey }. Creates the user (no
// password) if needed, records a pending membership, and emails an accept link.
router.post('/invites', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const tenantId = Number(b.tenantId);
  const roleKey = String(b.roleKey || '').trim();
  if (!_emailRx.test(email)) return _err(res, 400, 'bad_email');
  if (!Number.isInteger(tenantId)) return _err(res, 400, 'bad_tenant');
  try {
    const p = _db.getPool();
    const role = await p.query(`SELECT id, name, scope FROM roles WHERE tenant_id IS NULL AND key=$1 LIMIT 1`, [roleKey]);
    if (!role.rows[0] || role.rows[0].scope !== 'tenant') return _err(res, 400, 'bad_role');
    const tx = await p.query(`SELECT name FROM tenants WHERE id=$1 AND status='active'`, [tenantId]);
    if (!tx.rows[0]) return _err(res, 404, 'workspace_not_found');

    // Find or create the invitee account (no password until they accept).
    let user = await _auth.findUserByEmail(email);
    if (!user) {
      user = await _auth.createUser({ email, password: null, name: '' });
    } else {
      // Already an active member of this exact workspace? Nothing to do.
      const ex = await p.query(
        `SELECT status FROM tenant_users WHERE tenant_id=$1 AND user_id=$2`, [tenantId, user.id]);
      if (ex.rows[0] && ex.rows[0].status === 'active') return _err(res, 409, 'already_member');
    }

    // Record (or refresh) the pending membership.
    await p.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role_id, status, invited_by_user_id, invited_at)
      VALUES ($1,$2,$3,'invited',$4,now())
      ON CONFLICT (tenant_id, user_id)
        DO UPDATE SET role_id=EXCLUDED.role_id, status='invited',
                      invited_by_user_id=EXCLUDED.invited_by_user_id, invited_at=now()`,
      [tenantId, user.id, role.rows[0].id, req.user.id]);

    // Mint a workspace-bound invite token + email the accept link (best-effort).
    const token = await _auth.createInviteToken(user.id, tenantId, INVITE_TTL_MIN);
    const link = `${_auth.publicBaseUrl(req)}/accept-invite.html?token=${token}`;
    let mailed = false, mailError = null;
    try {
      const tpl = _auth.inviteEmailTemplate({
        inviterName: req.user.name || req.user.email,
        workspaceName: tx.rows[0].name,
        roleName: role.rows[0].name,
        link,
      });
      await _auth.sendMail({ to: email, ...tpl });
      mailed = true;
    } catch (e2) {
      mailError = e2.message;
      console.warn('[admin/invites] email failed:', e2.message);
    }
    await _audit.recordAudit({
      action: 'invite.send',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: user.id, targetEmail: email,
      tenantId, workspaceId: tenantId, workspaceName: tx.rows[0].name,
      oldRole: null, newRole: role.rows[0].name,
      detail: mailed ? null : 'Invite recorded but email not sent',
    });
    res.json({ ok: true, invited: { email, tenantId, userId: user.id }, emailSent: mailed, mailError });
  } catch (e) { _err(res, 500, e.message); }
});

// Cancel a pending invite — removes the invited membership and tidies up the
// orphan account if the invitee never accepted anything else.
router.delete('/invites/:tenantId/:userId', async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(tenantId) || !Number.isInteger(userId)) return _err(res, 400, 'bad_id');
  try {
    const p = _db.getPool();
    const prior = await p.query(
      `SELECT u.email, r.name AS role_name, t.name AS workspace_name
         FROM tenant_users tu
         JOIN users u ON u.id = tu.user_id
         LEFT JOIN roles r ON r.id = tu.role_id
         LEFT JOIN tenants t ON t.id = tu.tenant_id
        WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='invited'`, [tenantId, userId]);
    const del = await p.query(
      `DELETE FROM tenant_users WHERE tenant_id=$1 AND user_id=$2 AND status='invited' RETURNING user_id`,
      [tenantId, userId]);
    if (!del.rows[0]) return _err(res, 404, 'not_a_pending_invite');
    await _audit.recordAudit({
      action: 'invite.cancel',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: userId, targetEmail: prior.rows[0] ? prior.rows[0].email : null,
      tenantId, workspaceId: tenantId, workspaceName: prior.rows[0] ? prior.rows[0].workspace_name : null,
      oldRole: prior.rows[0] ? prior.rows[0].role_name : null, newRole: null,
    });
    // Always revoke the workspace-bound invite token(s) for this exact invite so
    // a cancelled link can never be accepted (or used as a login vector).
    await p.query(
      `DELETE FROM email_tokens WHERE user_id=$1 AND tenant_id=$2 AND purpose='invite' AND consumed_at IS NULL`,
      [userId, tenantId]);
    // Any memberships left for this user?
    const rest = await p.query(`SELECT COUNT(*)::int AS n FROM tenant_users WHERE user_id=$1`, [userId]);
    if (rest.rows[0].n === 0) {
      // Orphan with no password and no linked identities → safe to clean up.
      const u = await p.query(
        `SELECT (password_hash IS NULL) AS no_pw, is_owner,
                (SELECT COUNT(*)::int FROM user_identities ui WHERE ui.user_id=u.id) AS idents
           FROM users u WHERE id=$1`, [userId]);
      if (u.rows[0] && u.rows[0].no_pw && !u.rows[0].is_owner && u.rows[0].idents === 0) {
        await p.query(`DELETE FROM email_tokens WHERE user_id=$1 AND consumed_at IS NULL`, [userId]);
        await p.query(`DELETE FROM users WHERE id=$1`, [userId]);
      }
    }
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// Resend a pending invite — mints a fresh token, invalidates the old one(s),
// and re-emails the same person/workspace/role. No body needed; everything is
// recovered from the existing pending membership.
router.post('/invites/:tenantId/:userId/resend', async (req, res) => {
  const tenantId = Number(req.params.tenantId);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(tenantId) || !Number.isInteger(userId)) return _err(res, 400, 'bad_id');
  try {
    const p = _db.getPool();
    const inv = await p.query(
      `SELECT u.email, u.name, r.name AS role_name, t.name AS workspace_name
         FROM tenant_users tu
         JOIN users u ON u.id = tu.user_id
         JOIN tenants t ON t.id = tu.tenant_id AND t.status = 'active'
         LEFT JOIN roles r ON r.id = tu.role_id
        WHERE tu.tenant_id=$1 AND tu.user_id=$2 AND tu.status='invited'`, [tenantId, userId]);
    if (!inv.rows[0]) return _err(res, 404, 'not_a_pending_invite');
    const row = inv.rows[0];

    // Invalidate any outstanding invite token(s) for this exact invite, then
    // mint a fresh one so the old (lost/expired) link can never be used.
    await p.query(
      `DELETE FROM email_tokens WHERE user_id=$1 AND tenant_id=$2 AND purpose='invite' AND consumed_at IS NULL`,
      [userId, tenantId]);
    const token = await _auth.createInviteToken(userId, tenantId, INVITE_TTL_MIN);
    const link = `${_auth.publicBaseUrl(req)}/accept-invite.html?token=${token}`;

    let mailed = false, mailError = null;
    try {
      const tpl = _auth.inviteEmailTemplate({
        inviterName: req.user.name || req.user.email,
        workspaceName: row.workspace_name,
        roleName: row.role_name,
        link,
      });
      await _auth.sendMail({ to: row.email, ...tpl });
      mailed = true;
    } catch (e2) {
      mailError = e2.message;
      console.warn('[admin/invites] resend email failed:', e2.message);
    }
    // Refresh the invited_at timestamp so the pending list reflects the resend.
    await p.query(
      `UPDATE tenant_users SET invited_by_user_id=$3, invited_at=now()
        WHERE tenant_id=$1 AND user_id=$2 AND status='invited'`,
      [tenantId, userId, req.user.id]);
    await _audit.recordAudit({
      action: 'invite.resend',
      actorUserId: req.user.id, actorEmail: req.user.email,
      targetUserId: userId, targetEmail: row.email,
      tenantId, workspaceId: tenantId, workspaceName: row.workspace_name,
      oldRole: null, newRole: row.role_name,
      detail: mailed ? null : 'Invite re-issued but email not sent',
    });
    res.json({ ok: true, email: row.email, emailSent: mailed, mailError });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Clients (tenant-scoped) ─────────────────────────────────────────────────
router.get('/clients', async (req, res) => {
  try {
    const tid = Number(req.query.tenantId);
    const params = [], where = [`c.status <> 'deleted'`];
    if (Number.isInteger(tid)) { params.push(tid); where.push(`c.tenant_id=$${params.length}`); }
    const r = await _db.getPool().query(`
      SELECT c.id, c.tenant_id, t.name AS tenant_name, c.name, c.slug, c.website,
             c.status, c.data_mode, c.created_at
        FROM clients c JOIN tenants t ON t.id = c.tenant_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.id DESC`, params);
    res.json({ ok: true, clients: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/clients', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const tenantId = Number(b.tenantId);
  if (name.length < 2 || name.length > 120) return _err(res, 400, 'bad_name');
  if (!Number.isInteger(tenantId)) return _err(res, 400, 'bad_tenant');
  const data_mode = _dataMode.VALID_SETTING.has(b.data_mode) ? b.data_mode : 'inherit';
  try {
    const p = _db.getPool();
    const tx = await p.query('SELECT 1 FROM tenants WHERE id=$1 AND status=\'active\'', [tenantId]);
    if (!tx.rows[0]) return _err(res, 400, 'tenant_not_found');
    const slug = _slugify(name) || ('client-' + Date.now());
    const r = await p.query(`
      INSERT INTO clients (tenant_id, name, slug, website, data_mode, created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tenant_id, name, slug, website, status, data_mode, created_at`,
      [tenantId, name, slug, b.website ? String(b.website).slice(0, 240) : null, data_mode, req.user.id]);
    res.json({ ok: true, client: r.rows[0] });
  } catch (e) {
    if (/uq_clients_tenant_slug/.test(e.message)) return _err(res, 409, 'duplicate_name_in_workspace');
    _err(res, 500, e.message);
  }
});

router.patch('/clients/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  const b = req.body || {}, sets = [], vals = [];
  if (typeof b.name === 'string' && b.name.trim().length >= 2) { vals.push(b.name.trim().slice(0, 120)); sets.push(`name=$${vals.length}`); }
  if (typeof b.website === 'string') { vals.push(b.website.slice(0, 240)); sets.push(`website=$${vals.length}`); }
  if (['active', 'archived'].includes(b.status)) { vals.push(b.status); sets.push(`status=$${vals.length}`); }
  if (_dataMode.VALID_SETTING.has(b.data_mode)) { vals.push(b.data_mode); sets.push(`data_mode=$${vals.length}`); }
  if (!sets.length) return _err(res, 400, 'nothing_to_update');
  vals.push(id);
  try {
    const r = await _db.getPool().query(
      `UPDATE clients SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING id, tenant_id, name, slug, website, status, data_mode`, vals);
    if (!r.rows[0]) return _err(res, 404, 'not_found');
    res.json({ ok: true, client: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/clients/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  try {
    const r = await _db.getPool().query(`UPDATE clients SET status='archived', updated_at=now() WHERE id=$1 RETURNING id`, [id]);
    if (!r.rows[0]) return _err(res, 404, 'not_found');
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Data mode (platform default + resolver preview) ─────────────────────────
router.get('/data-mode', async (req, res) => {
  try {
    const platform = await _dataMode.getPlatformDefault();
    let preview = null;
    const clientId = Number(req.query.clientId) || null;
    const tenantId = Number(req.query.tenantId) || null;
    if (clientId || tenantId) preview = await _dataMode.resolveDataMode({ clientId, tenantId });
    res.json({ ok: true, platformDefault: platform, preview });
  } catch (e) { _err(res, 500, e.message); }
});

router.put('/data-mode', async (req, res) => {
  const mode = req.body && req.body.mode;
  if (!_dataMode.VALID.has(mode)) return _err(res, 400, 'mode_must_be_demo_or_strict');
  try {
    await _dataMode.setPlatformDefault(mode);
    res.json({ ok: true, platformDefault: mode });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Issues inbox ────────────────────────────────────────────────────────────
router.get('/issues', async (req, res) => {
  try {
    const status = ['open', 'acknowledged', 'resolved'].includes(req.query.status) ? req.query.status : null;
    const severity = ['critical', 'error', 'warning', 'info'].includes(req.query.severity) ? req.query.severity : null;
    const tenantId = Number(req.query.tenantId);
    const clientId = Number(req.query.clientId);
    const params = [], where = [];
    if (status) { params.push(status); where.push(`i.status=$${params.length}`); }
    if (severity) { params.push(severity); where.push(`i.severity=$${params.length}`); }
    if (Number.isInteger(tenantId)) { params.push(tenantId); where.push(`i.tenant_id=$${params.length}`); }
    if (Number.isInteger(clientId)) { params.push(clientId); where.push(`i.client_id=$${params.length}`); }
    const sql = `
      SELECT i.*, t.name AS tenant_name, c.name AS client_name
        FROM issues i
        LEFT JOIN tenants t ON t.id = i.tenant_id
        LEFT JOIN clients c ON c.id = i.client_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY i.last_seen_at DESC LIMIT 200`;
    const r = await _db.getPool().query(sql, params);
    const counts = await _db.getPool().query(`SELECT status, COUNT(*)::int AS n FROM issues GROUP BY status`);
    const byStatus = Object.fromEntries(counts.rows.map(x => [x.status, x.n]));
    const sevCounts = await _db.getPool().query(`SELECT severity, COUNT(*)::int AS n FROM issues WHERE status='open' GROUP BY severity`);
    const bySeverity = Object.fromEntries(sevCounts.rows.map(x => [x.severity, x.n]));
    res.json({ ok: true, issues: r.rows, counts: byStatus, severityCounts: bySeverity });
  } catch (e) { _err(res, 500, e.message); }
});

router.patch('/issues/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  const action = req.body && req.body.action;
  try {
    let sql;
    if (action === 'acknowledge') sql = `UPDATE issues SET status='acknowledged', acknowledged_at=now(), acknowledged_by=$2 WHERE id=$1 RETURNING *`;
    else if (action === 'resolve') sql = `UPDATE issues SET status='resolved', resolved_at=now(), resolved_by=$2 WHERE id=$1 RETURNING *`;
    else if (action === 'reopen') sql = `UPDATE issues SET status='open', acknowledged_at=NULL, resolved_at=NULL WHERE id=$1 RETURNING *`;
    else return _err(res, 400, 'bad_action');
    const r = await _db.getPool().query(sql, action === 'reopen' ? [id] : [id, req.user.id]);
    if (!r.rows[0]) return _err(res, 404, 'not_found');
    res.json({ ok: true, issue: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/issues/test', async (req, res) => {
  const r = await _issues.raiseIssue({
    severity: 'info',
    source: 'admin-test',
    code: 'manual-test',
    title: 'Test issue from Admin Portal',
    detail: `Raised by ${req.user.email} to verify the issue inbox + email alerts.`,
    context: { manual: true },
    route: '/api/admin/issues/test',
    tenantId: req.tenant ? req.tenant.id : null,
  });
  res.json({ ok: r.ok, result: r });
});

// ── Platform API keys (Task 136) ────────────────────────────────────────────
// Admin-only management of platform-owned keys (LLM providers, intel vendors,
// shared infra). Stored encrypted in platform_api_keys (NOT tenant-scoped) and
// overlaid onto process.env at runtime. Values are never echoed back — only a
// masked preview + configured/source flags.
router.get('/platform-keys', (_req, res) => {
  try {
    res.json({ ok: true, groups: _platformKeys.statusAll() });
  } catch (e) { _err(res, 500, e.message); }
});

router.put('/platform-keys/:key', async (req, res) => {
  const keyName = String(req.params.key || '').trim();
  if (!_platformKeys.isKnownKey(keyName)) return _err(res, 404, 'unknown_key');
  const value = (req.body && typeof req.body.value === 'string') ? req.body.value : '';
  try {
    const r = await _platformKeys.setPlatformKey(keyName, value, req.user && req.user.id);
    // Audit — record WHO changed WHICH key, never the value itself.
    await _audit.recordAudit({
      action: 'platform_key_updated',
      actorUserId: req.user && req.user.id,
      actorEmail: req.user && req.user.email,
      detail: keyName + (r.cleared ? ' (cleared)' : ' (set)'),
    });
    res.json({ ok: true, cleared: !!r.cleared, groups: _platformKeys.statusAll() });
  } catch (e) {
    if (e.code === 'no_master_key') return _err(res, 503, 'encryption_key_missing');
    if (e.code === 'no_db') return _err(res, 503, 'db_unavailable');
    _err(res, 500, e.message);
  }
});

router.post('/platform-keys/:key/test', async (req, res) => {
  const keyName = String(req.params.key || '').trim();
  if (!_platformKeys.isKnownKey(keyName)) return _err(res, 404, 'unknown_key');
  try {
    const r = await _platformKeys.testKey(keyName, req.user && req.user.id);
    res.json({ ok: true, result: r });
  } catch (e) { _err(res, 500, e.message); }
});

// Run every testable platform key's live check and persist each verdict, so the
// health dots refresh in one click instead of testing each key individually.
router.post('/platform-keys/test-all', async (req, res) => {
  try {
    const results = await _platformKeys.testAll(req.user && req.user.id);
    res.json({ ok: true, results, groups: _platformKeys.statusAll() });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;
