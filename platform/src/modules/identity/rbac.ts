import { appPool } from "../../db/pool.js";

/** Does a role carry a permission? Driven by the role_permissions table. */
export async function roleHasPermission(roleKey: string, permission: string): Promise<boolean> {
  const { rowCount } = await appPool.query(
    `select 1 from role_permissions where role_key = $1 and permission = $2`,
    [roleKey, permission],
  );
  return (rowCount ?? 0) > 0;
}

export interface TenantAccess {
  allowed: boolean;
  via: "membership" | "agency-parent" | "jit-grant" | "none";
  roleKey?: string;
}

/**
 * Resolve whether a user may act within a tenant context, and how. Direct
 * membership and agency-parent membership are standing access; support staff
 * have neither and can only reach a tenant through a live JIT grant (Section 8.2
 * / Block 10 — "no standing production data access for support roles").
 */
export async function resolveTenantAccess(userId: string, tenantId: string): Promise<TenantAccess> {
  const direct = await appPool.query(
    `select role_key from memberships where user_id = $1 and tenant_id = $2`,
    [userId, tenantId],
  );
  if ((direct.rowCount ?? 0) > 0) {
    return { allowed: true, via: "membership", roleKey: direct.rows[0].role_key };
  }

  // Agency operator acting within one of the agency's client tenants.
  const viaAgency = await appPool.query(
    `select m.role_key
       from memberships m
       join tenants child on child.parent_tenant_id = m.tenant_id
      where m.user_id = $1 and child.id = $2`,
    [userId, tenantId],
  );
  if ((viaAgency.rowCount ?? 0) > 0) {
    return { allowed: true, via: "agency-parent", roleKey: viaAgency.rows[0].role_key };
  }

  // Just-in-time elevation (time-boxed, audited) — the only path for support.
  const jit = await appPool.query(
    `select 1 from access_grants
      where user_id = $1 and tenant_id = $2 and revoked_at is null and expires_at > now()
      limit 1`,
    [userId, tenantId],
  );
  if ((jit.rowCount ?? 0) > 0) {
    return { allowed: true, via: "jit-grant", roleKey: "support" };
  }

  return { allowed: false, via: "none" };
}

/**
 * Grant a support user time-boxed access to a tenant, with a justification.
 * The grant is recorded here and (by the caller) in the audit rail, and is
 * visible to the tenant.
 */
export async function grantJitAccess(input: {
  userId: string;
  tenantId: string;
  reason: string;
  grantedBy?: string;
  ttlMinutes?: number;
}): Promise<string> {
  const { rows } = await appPool.query(
    `insert into access_grants (user_id, tenant_id, reason, granted_by, expires_at)
     values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
     returning id`,
    [input.userId, input.tenantId, input.reason, input.grantedBy ?? null, String(input.ttlMinutes ?? 60)],
  );
  return rows[0].id;
}
