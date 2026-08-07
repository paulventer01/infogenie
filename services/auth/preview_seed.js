// Dev/preview bootstrap — ensures the shared demo account always exists.
// Safe to run on every boot: idempotent upsert of user, workspace, and roles.
'use strict';

const bcrypt = require('bcryptjs');
const _db = require('../../db');

const PREVIEW_EMAIL = 'demo@infogenie.local';
const PREVIEW_PASSWORD = 'preview123';
const PREVIEW_NAME = 'Preview Demo';
const PREVIEW_WORKSPACE = "Preview Demo's Workspace";

async function ensurePreviewUser() {
  if (process.env.NODE_ENV === 'production') return;
  if (!_db.hasDb()) return;

  const p = _db.getPool();
  const hash = await bcrypt.hash(PREVIEW_PASSWORD, 12);

  let userId;
  const existing = await p.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1', [PREVIEW_EMAIL]);
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await p.query(
      `UPDATE users
          SET password_hash=$1,
              email_verified_at=COALESCE(email_verified_at, now()),
              is_owner=true,
              name=COALESCE(NULLIF(name, ''), $2)
        WHERE id=$3`,
      [hash, PREVIEW_NAME, userId],
    );
  } else {
    const created = await p.query(
      `INSERT INTO users (email, password_hash, name, is_owner, email_verified_at)
       VALUES ($1, $2, $3, true, now())
       RETURNING id`,
      [PREVIEW_EMAIL.toLowerCase(), hash, PREVIEW_NAME],
    );
    userId = created.rows[0].id;
  }

  await p.query(
    `INSERT INTO platform_users (user_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.key='platform_owner' AND r.tenant_id IS NULL
     ON CONFLICT DO NOTHING`,
    [userId],
  );

  const ownerRole = await p.query(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key='tenant_owner' LIMIT 1`,
  );
  const ownerRoleId = ownerRole.rows[0] && ownerRole.rows[0].id;
  if (!ownerRoleId) return;

  let tenantId;
  const membership = await p.query(
    `SELECT tu.tenant_id
       FROM tenant_users tu
       JOIN tenants t ON t.id = tu.tenant_id
      WHERE tu.user_id=$1 AND tu.status='active' AND t.status='active'
      ORDER BY tu.tenant_id ASC
      LIMIT 1`,
    [userId],
  );
  if (membership.rows[0]) {
    tenantId = membership.rows[0].tenant_id;
  } else {
    const slug = 'preview-demo-workspace';
    const tenant = await p.query(
      `INSERT INTO tenants (name, slug, status, created_by_user_id)
       VALUES ($1, $2, 'active', $3)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [PREVIEW_WORKSPACE, slug, userId],
    );
    tenantId = tenant.rows[0].id;
    await p.query(
      `INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT DO NOTHING`,
      [tenantId, userId, ownerRoleId],
    );
  }

  console.log('[auth/preview] demo account ready:', PREVIEW_EMAIL, '(workspace #' + tenantId + ')');
}

module.exports = { ensurePreviewUser, PREVIEW_EMAIL, PREVIEW_PASSWORD };
