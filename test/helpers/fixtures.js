// test/helpers/fixtures.js — Isolated tenant + user fixtures with teardown.
//
// Every helper here is DB-backed and gates on DATABASE_URL via db.hasDb(),
// mirroring the existing real-DB tests (search-pulse-tenant-db, the *-isolation
// suites). When there's no database the helpers are inert and a suite should
// skip — the harness never invents data.
//
// Usage:
//   const fx = makeFixtures();
//   await fx.ensureSchemas();                         // tables + system roles
//   const tA = await fx.seedTenant();                // isolated workspace
//   const tB = await fx.seedTenant();                // 2nd for cross-tenant tests
//   const owner  = await fx.seedUser({ tenantId: tA.id, owner: true });
//   const viewer = await fx.seedUser({ tenantId: tA.id, owner: false });
//   ... drive the app ...
//   await fx.cleanup();                              // removes everything seeded
//
// Cleanup relies on the real schema's ON DELETE CASCADE: deleting a tenant
// removes its tenant_users + tenant-scoped email_tokens; deleting a user
// removes its identities + tokens. user_integrations has no FK to users, so we
// delete those rows explicitly.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const _db          = require('../../db');
const _authSchema  = require('../../services/auth/schema');
const _tenantSchema= require('../../services/tenants/schema');
const _vault       = require('../../services/credentials/vault');

function hasDb() { return _db.hasDb(); }

// Short unique suffix so seeded rows never collide with — or clobber — real
// data, and so parallel/ repeated runs stay isolated.
function uniqueSuffix(tag = 'h') {
  return `${tag}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

async function _systemRoleId(key) {
  const r = await _db.getPool().query(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key=$1 LIMIT 1`, [key]);
  return r.rows[0] ? r.rows[0].id : null;
}

function makeFixtures() {
  const created = { tenantIds: [], userIds: [] };

  // Idempotent schema ensure — creates auth + tenant + credentials tables and
  // seeds the system roles the user fixtures look up by key.
  async function ensureSchemas() {
    if (!hasDb()) return false;
    await _authSchema.ensureAuthSchema();
    await _tenantSchema.ensureTenantSchema();
    await _vault.ensureCredentialsSchema();
    return true;
  }

  // Create an isolated, active workspace. Returns { id, name, slug }.
  async function seedTenant(label) {
    if (!hasDb()) throw new Error('seedTenant: no DATABASE_URL');
    const suffix = uniqueSuffix('t');
    const name = `${label || 'Harness Tenant'} ${suffix}`;
    const slug = `harness-${suffix}`;
    const r = await _db.getPool().query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id, name, slug`,
      [name, slug]);
    created.tenantIds.push(r.rows[0].id);
    return r.rows[0];
  }

  // Create a user and (optionally) bind them to a tenant with a role.
  //   owner:true  → users.is_owner = TRUE  + tenant role 'tenant_owner'
  //   owner:false → users.is_owner = FALSE + tenant role 'client_viewer'
  // Override the tenant role with opts.roleKey. The plaintext password is
  // returned so the caller can log the user in via login().
  async function seedUser(opts = {}) {
    if (!hasDb()) throw new Error('seedUser: no DATABASE_URL');
    const owner = !!opts.owner;
    const password = opts.password || 'harness-pw-12345';
    const suffix = uniqueSuffix('u');
    const email = (opts.email || `harness-${suffix}@example.com`).toLowerCase();
    const name = opts.name || `Harness ${owner ? 'Owner' : 'User'} ${suffix}`;
    const hash = await bcrypt.hash(password, 10); // cost 10 — tests, not prod
    const verified = opts.verified === false ? null : new Date();

    const u = await _db.getPool().query(
      `INSERT INTO users (email, password_hash, name, is_owner, email_verified_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, is_owner`,
      [email, hash, name, owner, verified]);
    const userId = u.rows[0].id;
    created.userIds.push(userId);

    if (opts.tenantId) {
      const roleKey = opts.roleKey || (owner ? 'tenant_owner' : 'client_viewer');
      const roleId = await _systemRoleId(roleKey);
      if (!roleId) throw new Error(`seedUser: system role "${roleKey}" not found — did ensureSchemas() run?`);
      await _db.getPool().query(
        `INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
         VALUES ($1,$2,$3,'active', now())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id=EXCLUDED.role_id, status='active'`,
        [opts.tenantId, userId, roleId]);
    }

    return { id: userId, email, name, password, isOwner: owner, tenantId: opts.tenantId || null };
  }

  // Read the most recent token of a purpose ('verify' | 'reset' | 'invite')
  // straight from email_tokens — the robust path that doesn't depend on mail
  // capture. Returns the token string or null.
  async function latestEmailToken(userId, purpose) {
    if (!hasDb()) return null;
    const r = await _db.getPool().query(
      `SELECT token FROM email_tokens WHERE user_id=$1 AND purpose=$2
       ORDER BY created_at DESC LIMIT 1`, [userId, purpose]);
    return r.rows[0] ? r.rows[0].token : null;
  }

  // Remove everything this fixture set created. Safe to call multiple times.
  async function cleanup() {
    if (!hasDb()) return;
    const p = _db.getPool();
    try {
      if (created.userIds.length) {
        // No FK from user_integrations → users, so clear vault rows first.
        await p.query(`DELETE FROM user_integrations WHERE user_id = ANY($1)`, [created.userIds]).catch(() => {});
        await p.query(`DELETE FROM users WHERE id = ANY($1)`, [created.userIds]);
      }
      if (created.tenantIds.length) {
        await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [created.tenantIds]);
      }
    } finally {
      created.userIds.length = 0;
      created.tenantIds.length = 0;
    }
  }

  return { ensureSchemas, seedTenant, seedUser, latestEmailToken, cleanup, created };
}

module.exports = { makeFixtures, uniqueSuffix };
