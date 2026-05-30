// services/admin/audit.js — Membership & role-change audit log (Task 21)
//
// recordAudit() is the single entry point the Admin Portal calls whenever a
// membership or platform-role mutation happens (add/remove a member, change a
// workspace role, grant/revoke platform admin, send/cancel an invite). It writes
// one append-only row to admin_audit_log capturing actor, target, workspace,
// old/new role and a timestamp. Best-effort: it never throws into callers, so a
// logging failure can't break the actual mutation.
//
// Platform-role changes have no natural workspace, so (like issues) they are
// attributed to the default tenant to satisfy the multitenant NOT NULL rule;
// their workspace_id stays NULL.

const _db = require('../../db');

function _s(v, n) { return v == null ? null : String(v).slice(0, n); }

// Record an audit entry. Returns { ok, id } or { ok:false, reason }.
// opts: { action, actorUserId, actorEmail, targetUserId, targetEmail,
//         tenantId, workspaceId, workspaceName, oldRole, newRole, detail, context }
async function recordAudit(opts = {}) {
  try {
    if (!_db.hasDb()) return { ok: false, reason: 'no_db' };

    let tenantId = Number.isInteger(opts.tenantId) ? opts.tenantId : null;
    if (!tenantId) {
      // Platform-level change (e.g. platform-role grant) — attribute to the
      // default tenant so the row stays valid (tenant_id NOT NULL).
      try { tenantId = await require('../tenants/context').getCronTenantId(); } catch (_) {}
    }
    if (!tenantId) return { ok: false, reason: 'no_tenant' };

    const action = _s(opts.action || 'unknown', 80);
    let context = {};
    try { context = opts.context && typeof opts.context === 'object' ? opts.context : {}; } catch (_) {}

    const r = await _db.getPool().query(`
      INSERT INTO admin_audit_log
        (tenant_id, action, actor_user_id, actor_email, target_user_id,
         target_email, workspace_id, workspace_name, old_role, new_role,
         detail, context)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id`,
      [
        tenantId, action,
        Number.isInteger(opts.actorUserId) ? opts.actorUserId : null,
        _s(opts.actorEmail, 240),
        Number.isInteger(opts.targetUserId) ? opts.targetUserId : null,
        _s(opts.targetEmail, 240),
        Number.isInteger(opts.workspaceId) ? opts.workspaceId : null,
        _s(opts.workspaceName, 240),
        _s(opts.oldRole, 120),
        _s(opts.newRole, 120),
        _s(opts.detail, 2000),
        JSON.stringify(context),
      ]);
    return { ok: true, id: r.rows[0] && r.rows[0].id };
  } catch (e) {
    console.warn('[admin/audit] recordAudit failed:', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { recordAudit };
