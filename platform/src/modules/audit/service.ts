import type { PoolClient } from "pg";
import { withTenant } from "../../db/tenantContext.js";

export type ActorType = "user" | "agent" | "system";

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  evidence?: Record<string, unknown>;
  approval?: Record<string, unknown>;
  outcome?: string;
}

const INSERT = `
  insert into audit_log
    (tenant_id, actor_type, actor_id, action, resource_type, resource_id, evidence, approval, outcome)
  values (app_current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)
  returning id, seq, hash, prev_hash
`;

/** Append an audit record using an existing tenant-scoped transaction, so the
 * audit write is atomic with the action it records. */
export async function appendWith(client: PoolClient, entry: AuditEntry) {
  const { rows } = await client.query(INSERT, [
    entry.actorType,
    entry.actorId ?? null,
    entry.action,
    entry.resourceType ?? null,
    entry.resourceId ?? null,
    JSON.stringify(entry.evidence ?? {}),
    JSON.stringify(entry.approval ?? {}),
    entry.outcome ?? null,
  ]);
  return rows[0] as { id: string; seq: string; hash: string; prev_hash: string | null };
}

/** Append an audit record in its own tenant transaction. */
export async function append(tenantId: string, entry: AuditEntry) {
  return withTenant(tenantId, (client) => appendWith(client, entry));
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  brokenAtSeq?: string;
  reason?: string;
}

/**
 * Verify the per-tenant hash chain. Postgres recomputes each row's hash from
 * its stored fields (delegating the exact text formatting to the database), and
 * we confirm every recomputed hash matches the stored hash and that each row's
 * prev_hash links to the previous row. Any tampering — an altered field, a
 * removed row — breaks one of these and is reported.
 */
export async function verifyChain(tenantId: string): Promise<ChainVerification> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(`
      select seq, hash, prev_hash,
        encode(digest(concat_ws('|',
          coalesce(prev_hash, ''),
          coalesce(tenant_id::text, ''),
          occurred_at::text,
          actor_type,
          coalesce(actor_id, ''),
          action,
          coalesce(resource_type, ''),
          coalesce(resource_id, ''),
          coalesce(evidence::text, '{}'),
          coalesce(approval::text, '{}'),
          coalesce(outcome, '')
        ), 'sha256'), 'hex') as recomputed
      from audit_log
      order by seq asc
    `);

    let prev: string | null = null;
    for (const row of rows as Array<{ seq: string; hash: string; prev_hash: string | null; recomputed: string }>) {
      if (row.recomputed !== row.hash) {
        return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: "row content does not match its hash" };
      }
      if (row.prev_hash !== prev) {
        return { ok: false, count: rows.length, brokenAtSeq: row.seq, reason: "hash chain is not contiguous" };
      }
      prev = row.hash;
    }
    return { ok: true, count: rows.length };
  });
}
