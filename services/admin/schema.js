// services/admin/schema.js — Admin Portal schema (Task 10)
//
// Creates the tenant-scoped `clients` entity, the code-driven `issues` table
// (admin inbox + dedupe), a tenant-level data-mode default column, and seeds
// the platform-level data-mode default into kv_store.
//
// Data-mode values everywhere: 'inherit' | 'demo' | 'strict'.
//   • client.data_mode      — per-client override (default 'inherit')
//   • tenants.data_mode_default — tenant default (default 'inherit')
//   • kv_store[admin:data_mode_default] — platform default (seeded 'strict')
// Resolution falls through client → tenant → platform; final fallback 'strict'.

const _db = require('../../db');

const PLATFORM_DEFAULT_KEY = 'admin:data_mode_default';
const NOTIFY_RECIPIENTS_KEY = 'admin:issue_notify_recipients';

async function ensureAdminSchema() {
  if (!_db.hasDb()) { console.log('[admin] skipped — no DATABASE_URL'); return; }
  const p = _db.getPool();

  // ── clients (tenant-scoped per multitenant rules: tenant_id NOT NULL) ──────
  await p.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id                 SERIAL PRIMARY KEY,
      tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name               TEXT NOT NULL,
      slug               TEXT,
      website            TEXT,
      status             TEXT NOT NULL DEFAULT 'active',
      data_mode          TEXT NOT NULL DEFAULT 'inherit',
      created_by_user_id INTEGER,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status IN ('active','archived')),
      CHECK (data_mode IN ('inherit','demo','strict'))
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_tenant_slug ON clients(tenant_id, slug) WHERE slug IS NOT NULL`);

  // ── issues (tenant-scoped; client optional) ───────────────────────────────
  // Open issues are deduped per (tenant_id, dedupe_key) via a partial unique
  // index — a repeat of the same problem bumps occurrence_count instead of
  // inserting a new row, which also rate-limits the email alerts.
  await p.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id               SERIAL PRIMARY KEY,
      tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      dedupe_key       TEXT NOT NULL,
      severity         TEXT NOT NULL DEFAULT 'warning',
      status           TEXT NOT NULL DEFAULT 'open',
      source           TEXT NOT NULL,
      code             TEXT,
      title            TEXT NOT NULL,
      detail           TEXT,
      context          JSONB NOT NULL DEFAULT '{}'::jsonb,
      route            TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      acknowledged_at  TIMESTAMPTZ,
      acknowledged_by  INTEGER,
      resolved_at      TIMESTAMPTZ,
      resolved_by      INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (severity IN ('info','warning','error','critical')),
      CHECK (status IN ('open','acknowledged','resolved'))
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_issues_tenant_status ON issues(tenant_id, status)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_issues_last_seen ON issues(last_seen_at DESC)`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_issues_open_dedupe ON issues(tenant_id, dedupe_key) WHERE status='open'`);

  // ── audit log (who changed roles & memberships) ───────────────────────────
  // Append-only record of every membership / platform-role mutation made in the
  // Admin Portal, for accountability & support. Tenant-scoped (tenant_id NOT
  // NULL per multitenant rules); platform-role changes attribute to the default
  // tenant (like issues). Actor/target emails are denormalized snapshots so the
  // log stays readable even after a user row is later cleaned up.
  await p.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id              SERIAL PRIMARY KEY,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      action          TEXT NOT NULL,
      actor_user_id   INTEGER,
      actor_email     TEXT,
      target_user_id  INTEGER,
      target_email    TEXT,
      workspace_id    INTEGER,
      workspace_name  TEXT,
      old_role        TEXT,
      new_role        TEXT,
      detail          TEXT,
      context         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON admin_audit_log(tenant_id, created_at DESC)`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_log(target_user_id)`);

  // ── tenant-level data-mode default ────────────────────────────────────────
  await p.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS data_mode_default TEXT NOT NULL DEFAULT 'inherit'`);

  // ── platform-level default → strict (honest by default) ───────────────────
  const existing = await _db.kvGet(PLATFORM_DEFAULT_KEY, null);
  if (existing == null) await _db.kvSet(PLATFORM_DEFAULT_KEY, 'strict');

  console.log('[admin] schema ready');
}

module.exports = { ensureAdminSchema, PLATFORM_DEFAULT_KEY, NOTIFY_RECIPIENTS_KEY };
