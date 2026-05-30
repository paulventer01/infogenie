// services/tenants/schema.js — Multi-tenancy foundation (Phase 1)
//
// Creates four tables that form the SaaS skeleton:
//   tenants          — one row per workspace (a company / agency client)
//   roles            — system + custom roles (tenant_id NULL = system role)
//   tenant_users     — many-to-many: which users belong to which tenants + role
//   platform_users   — which users hold platform-wide roles (cross-tenant)
//
// On every boot:
//   1. Ensure the tables exist.
//   2. Upsert the 8 system roles from permissions.js (so role definitions stay
//      in sync with the catalog when we add new permissions).
//   3. Backfill: every existing user who has no tenant gets a personal tenant
//      created and is made its Tenant Owner. The first owner (is_owner=TRUE)
//      additionally gets the Platform Owner role.
//
// Important: This is additive only. No existing tables are modified, no
// existing queries are rewritten. Behaviour of the rest of the app does not
// change until Phase 2.

const _db = require('../../db');
const { SYSTEM_ROLES } = require('./permissions');

async function ensureTenantSchema() {
  if (!_db.hasDb()) {
    console.warn('[tenants] disabled — DATABASE_URL not set');
    return;
  }
  const p = _db.getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id                   SERIAL PRIMARY KEY,
      name                 TEXT NOT NULL,
      slug                 TEXT NOT NULL UNIQUE,
      status               TEXT NOT NULL DEFAULT 'active',
      created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status IN ('active','suspended','deleted'))
    );
    CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants (status);

    CREATE TABLE IF NOT EXISTS roles (
      id           SERIAL PRIMARY KEY,
      tenant_id    INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      key          TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      scope        TEXT NOT NULL DEFAULT 'tenant',
      is_system    BOOLEAN NOT NULL DEFAULT FALSE,
      permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (scope IN ('platform','tenant'))
    );
    -- System roles: unique by key, tenant_id IS NULL
    CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_idx
      ON roles (key) WHERE tenant_id IS NULL;
    -- Custom tenant roles: unique by (tenant_id, key)
    CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_key_idx
      ON roles (tenant_id, key) WHERE tenant_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS tenant_users (
      tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id            INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      role_id            INTEGER NOT NULL REFERENCES roles(id)   ON DELETE RESTRICT,
      status             TEXT NOT NULL DEFAULT 'active',
      invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      invited_at         TIMESTAMPTZ,
      joined_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, user_id),
      CHECK (status IN ('active','invited','suspended'))
    );
    CREATE INDEX IF NOT EXISTS tenant_users_user_idx ON tenant_users (user_id);

    CREATE TABLE IF NOT EXISTS platform_users (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- 'invite' tokens (in email_tokens) are bound to the specific workspace the
    -- invite is for, so preview/accept/cancel act on a single invite (not all
    -- of a user's). Added here because it references tenants(id), which the auth
    -- schema (which owns email_tokens) creates before tenants exists.
    ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS email_tokens_tenant_idx ON email_tokens (tenant_id);
  `);

  await _seedSystemRoles(p);
  await _backfillExistingUsers(p);

  console.log('[tenants] schema ready (tenants, roles, tenant_users, platform_users)');
}

// ── Seed / upsert system roles ──────────────────────────────────────────────
// Re-runs on every boot. If a system role's permissions list grows because
// we added new permission keys, the role row is updated in place. We never
// touch custom tenant roles (tenant_id IS NOT NULL).
async function _seedSystemRoles(p) {
  for (const r of SYSTEM_ROLES) {
    await p.query(`
      INSERT INTO roles (tenant_id, key, name, description, scope, is_system, permissions)
      VALUES (NULL, $1, $2, $3, $4, TRUE, $5::jsonb)
      ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        scope       = EXCLUDED.scope,
        permissions = EXCLUDED.permissions,
        updated_at  = now()
    `, [r.key, r.name, r.description, r.scope, JSON.stringify(r.permissions)]);
  }
}

// ── Backfill: existing users → personal tenants ─────────────────────────────
// For every user who is not yet a member of any tenant:
//   • Create one tenant named "<email-local-part>'s Workspace"
//   • Add the user as Tenant Owner
//
// Plus a separate repair pass that ensures every users.is_owner=TRUE user
// holds the Platform Owner role (independent of orphan status — fixes drift
// from any prior partial run).
//
// Race-safe + crash-safe:
//   • Each user's backfill runs inside its own transaction.
//   • A 64-bit Postgres advisory_xact_lock keyed off user_id prevents two
//     concurrent boot processes (or two restarts overlapping) from creating
//     duplicate tenants for the same user.
//   • Orphan check is re-done INSIDE the locked transaction, so if another
//     process won the race we just exit early instead of inserting again.
//   • If the transaction aborts midway (e.g. membership insert fails) the
//     tenant insert is rolled back too — no orphan tenant rows.
async function _backfillExistingUsers(p) {
  const ownerRole    = await _getSystemRoleId(p, 'tenant_owner');
  const platformRole = await _getSystemRoleId(p, 'platform_owner');
  if (!ownerRole || !platformRole) {
    console.warn('[tenants] backfill skipped — system roles not found');
    return;
  }

  // ── Pass 1: orphan users → personal tenant + Tenant Owner membership ────
  const orphans = await p.query(`
    SELECT u.id, u.email, u.name, u.is_owner
      FROM users u
      LEFT JOIN tenant_users tu ON tu.user_id = u.id
     WHERE tu.user_id IS NULL
  `);

  for (const u of orphans.rows) {
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      // Advisory lock scoped to this transaction — released on COMMIT/ROLLBACK.
      // Uses user_id directly as the lock key (bigint).
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [u.id]);

      // Re-check orphan status inside the lock — another process may have
      // backfilled this user between our SELECT above and acquiring the lock.
      const recheck = await client.query(
        `SELECT 1 FROM tenant_users WHERE user_id = $1 LIMIT 1`, [u.id]
      );
      if (recheck.rowCount > 0) {
        await client.query('COMMIT');
        continue;
      }

      const slug = await _uniqueSlugTx(client, _slugFromEmail(u.email));
      const name = (u.name && u.name.trim())
        ? `${u.name.trim()}'s Workspace`
        : `${_emailLocal(u.email)}'s Workspace`;

      const t = await client.query(`
        INSERT INTO tenants (name, slug, status, created_by_user_id)
        VALUES ($1, $2, 'active', $3)
        RETURNING id
      `, [name, slug, u.id]);
      const tenantId = t.rows[0].id;

      await client.query(`
        INSERT INTO tenant_users (tenant_id, user_id, role_id, status, joined_at)
        VALUES ($1, $2, $3, 'active', now())
        ON CONFLICT DO NOTHING
      `, [tenantId, u.id, ownerRole]);

      await client.query('COMMIT');
      console.log(`[tenants] backfilled user ${u.email} → tenant "${slug}" (id=${tenantId})`);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error(`[tenants] backfill failed for user ${u.email}:`, e.message);
    } finally {
      client.release();
    }
  }

  // ── Pass 2: ensure every is_owner=TRUE user holds Platform Owner ────────
  // Runs as a single set-based statement — idempotent and self-healing for
  // any drift from prior partial boots.
  try {
    const r = await p.query(`
      INSERT INTO platform_users (user_id, role_id)
      SELECT u.id, $1
        FROM users u
       WHERE u.is_owner = TRUE
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id
    `, [platformRole]);
    if (r.rowCount > 0) {
      console.log(`[tenants] platform_owner role granted to ${r.rowCount} owner user(s)`);
    }
  } catch (e) {
    console.error('[tenants] platform owner repair failed:', e.message);
  }
}

async function _getSystemRoleId(p, key) {
  const r = await p.query(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1 LIMIT 1`,
    [key]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

function _emailLocal(email) {
  return String(email || '').split('@')[0].replace(/[^a-z0-9_-]/gi, '') || 'user';
}

function _slugFromEmail(email) {
  return _emailLocal(email).toLowerCase().slice(0, 40) || 'workspace';
}

async function _uniqueSlug(p, base) {
  let slug = base;
  let i = 0;
  // Try the bare slug first, then -2, -3, ... up to 20 tries
  while (i < 20) {
    const r = await p.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
    if (r.rowCount === 0) return slug;
    i++;
    slug = `${base}-${i + 1}`;
  }
  // Fallback: append random suffix
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

// Transactional version — accepts an already-checked-out pg client so the
// slug uniqueness check participates in the caller's BEGIN/COMMIT.
async function _uniqueSlugTx(client, base) {
  let slug = base;
  let i = 0;
  while (i < 20) {
    const r = await client.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
    if (r.rowCount === 0) return slug;
    i++;
    slug = `${base}-${i + 1}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  ensureTenantSchema,
  _uniqueSlug,
  _slugFromEmail,
};
