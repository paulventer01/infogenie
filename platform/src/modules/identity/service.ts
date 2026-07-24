import { appPool } from "../../db/pool.js";
import { hashPassword } from "../../lib/hash.js";
import { randomToken, tokenHash } from "../../lib/hash.js";

export type TenantType = "agency" | "client";
export type RoleKey = "owner" | "admin" | "operator" | "analyst" | "support" | "guardrail";

export interface Tenant {
  id: string;
  type: TenantType;
  parentTenantId: string | null;
  name: string;
  slug: string;
}

export async function createTenant(input: {
  type: TenantType;
  name: string;
  slug: string;
  parentTenantId?: string;
}): Promise<Tenant> {
  const { rows } = await appPool.query(
    `insert into tenants (type, parent_tenant_id, name, slug)
     values ($1, $2, $3, $4)
     returning id, type, parent_tenant_id, name, slug`,
    [input.type, input.parentTenantId ?? null, input.name, input.slug],
  );
  const r = rows[0];
  return { id: r.id, type: r.type, parentTenantId: r.parent_tenant_id, name: r.name, slug: r.slug };
}

export async function createUser(input: {
  email: string;
  password?: string;
  isSupport?: boolean;
}): Promise<{ id: string; email: string }> {
  const { rows } = await appPool.query(
    `insert into users (email, password_hash, is_support)
     values ($1, $2, $3)
     returning id, email`,
    [input.email, input.password ? hashPassword(input.password) : null, input.isSupport ?? false],
  );
  return rows[0];
}

export async function addMembership(userId: string, tenantId: string, roleKey: RoleKey): Promise<void> {
  await appPool.query(
    `insert into memberships (user_id, tenant_id, role_key) values ($1, $2, $3)
     on conflict (user_id, tenant_id) do update set role_key = excluded.role_key`,
    [userId, tenantId, roleKey],
  );
}

/** Create a session and return the plaintext token (only its hash is stored). */
export async function createSession(userId: string, ttlMinutes = 60): Promise<string> {
  const token = randomToken();
  await appPool.query(
    `insert into sessions (user_id, token_hash, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, tokenHash(token), String(ttlMinutes)],
  );
  return token;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
}

/** Resolve a session token to its user, applying rolling expiry. */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const { rows } = await appPool.query(
    `update sessions
        set last_seen_at = now()
      where token_hash = $1 and revoked_at is null and expires_at > now()
      returning id, user_id, active_tenant_id`,
    [tokenHash(token)],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { sessionId: r.id, userId: r.user_id, activeTenantId: r.active_tenant_id };
}
