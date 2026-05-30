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
const { SYSTEM_ROLES } = require('../tenants/permissions');
const _dataMode = require('./data_mode');
const _issues = require('./issues');

const router = express.Router();

function _err(res, code, msg) { return res.status(code).json({ ok: false, error: msg }); }

// ── Gate: platform owner OR platform admin only ─────────────────────────────
function _isPlatformAdmin(req) {
  if (!req.user) return false;
  if (req.user.isOwner === true) return true;
  const k = req.platformRole && req.platformRole.key;
  return k === 'platform_owner' || k === 'platform_admin';
}
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

// ── Workspace membership management ─────────────────────────────────────────
// List the users in a workspace with their assigned role.
router.get('/workspaces/:id/members', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return _err(res, 400, 'bad_id');
  try {
    const r = await _db.getPool().query(`
      SELECT tu.user_id, u.email, u.name, tu.status, tu.joined_at,
             r.key AS role_key, r.name AS role_name
        FROM tenant_users tu
        JOIN users u ON u.id = tu.user_id
        LEFT JOIN roles r ON r.id = tu.role_id
       WHERE tu.tenant_id = $1
       ORDER BY tu.joined_at ASC`, [id]);
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
    const role = await p.query(`SELECT id, scope FROM roles WHERE tenant_id IS NULL AND key=$1 LIMIT 1`, [roleKey]);
    if (!role.rows[0] || role.rows[0].scope !== 'tenant') return _err(res, 400, 'bad_role');
    const ux = await p.query('SELECT 1 FROM users WHERE id=$1', [userId]);
    if (!ux.rows[0]) return _err(res, 404, 'user_not_found');
    const tx = await p.query(`SELECT 1 FROM tenants WHERE id=$1 AND status<>'deleted'`, [id]);
    if (!tx.rows[0]) return _err(res, 404, 'workspace_not_found');
    await p.query(`
      INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
      VALUES ($1,$2,$3,'active',now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id=EXCLUDED.role_id, status='active'`,
      [id, userId, role.rows[0].id]);
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
    const role = await p.query(`SELECT id, scope FROM roles WHERE tenant_id IS NULL AND key=$1 LIMIT 1`, [roleKey]);
    if (!role.rows[0] || role.rows[0].scope !== 'tenant') return _err(res, 400, 'bad_role');
    const r = await p.query(`UPDATE tenant_users SET role_id=$3 WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id`,
      [id, userId, role.rows[0].id]);
    if (!r.rows[0]) return _err(res, 404, 'not_a_member');
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// Remove a user from a workspace.
router.delete('/workspaces/:id/members/:userId', async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(id) || !Number.isInteger(userId)) return _err(res, 400, 'bad_id');
  try {
    const r = await _db.getPool().query(`DELETE FROM tenant_users WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id`, [id, userId]);
    if (!r.rows[0]) return _err(res, 404, 'not_a_member');
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
    const ux = await p.query('SELECT is_owner FROM users WHERE id=$1', [uid]);
    if (!ux.rows[0]) return _err(res, 404, 'user_not_found');
    if (ux.rows[0].is_owner) return _err(res, 400, 'cannot_change_owner');
    if (roleKey === null) {
      await p.query('DELETE FROM platform_users WHERE user_id=$1', [uid]);
      return res.json({ ok: true, platformRole: null });
    }
    if (roleKey !== 'platform_admin') return _err(res, 400, 'only_platform_admin_grantable');
    const role = await p.query(`SELECT id FROM roles WHERE tenant_id IS NULL AND key='platform_admin' LIMIT 1`);
    if (!role.rows[0]) return _err(res, 400, 'role_not_found');
    await p.query(`INSERT INTO platform_users (user_id, role_id, granted_by, granted_at)
      VALUES ($1,$2,$3,now())
      ON CONFLICT (user_id) DO UPDATE SET role_id=EXCLUDED.role_id`, [uid, role.rows[0].id, req.user.id]);
    res.json({ ok: true, platformRole: 'platform_admin' });
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

module.exports = router;
