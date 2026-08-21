import type { PoolClient } from "pg";
import { withTenant } from "../../db/tenantContext.js";
import { addressHash } from "../../lib/hash.js";

export type Channel = "email" | "sms" | "whatsapp" | "push" | "voice";
export type ConsentState = "granted" | "withdrawn";

export interface ConsentInput {
  personId: string;
  channel: Channel;
  purpose: string;
  state: ConsentState;
  source: string;
  method: string;
  noticeVersion?: string;
  proof?: Record<string, unknown>;
}

/** Record a consent event (grant or withdrawal) with full provenance. */
export async function recordConsent(client: PoolClient, input: ConsentInput): Promise<void> {
  await client.query(
    `insert into consent_records
       (tenant_id, person_id, channel, purpose, state, source, method, notice_version, proof)
     values (app_current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.personId,
      input.channel,
      input.purpose,
      input.state,
      input.source,
      input.method,
      input.noticeVersion ?? null,
      JSON.stringify(input.proof ?? {}),
    ],
  );
}

/** Withdrawal is as easy as granting — one record, honoured immediately. */
export async function withdrawConsent(
  client: PoolClient,
  args: { personId: string; channel: Channel; purpose: string; source: string },
): Promise<void> {
  await recordConsent(client, {
    ...args,
    state: "withdrawn",
    method: "withdrawal",
  });
}

export async function addTenantSuppression(
  client: PoolClient,
  args: { scope: "tenant" | "campaign" | "regulatory"; channel: Channel; address: string; campaignId?: string; reason: string },
): Promise<void> {
  await client.query(
    `insert into suppressions (tenant_id, scope, channel, address_hash, campaign_id, reason)
     values (app_current_tenant(), $1, $2, $3, $4, $5)`,
    [args.scope, args.channel, addressHash(args.address), args.campaignId ?? null, args.reason],
  );
}

export async function addGlobalSuppression(
  client: PoolClient,
  args: { channel: Channel; address: string; reason: string },
): Promise<void> {
  await client.query(
    `insert into global_suppressions (address_hash, channel, reason)
     values ($1, $2, $3)
     on conflict (address_hash, channel) do nothing`,
    [addressHash(args.address), args.channel, args.reason],
  );
}

function addressFor(person: { email: string | null; phone: string | null; external_id: string | null }, channel: Channel): string | null {
  if (channel === "email") return person.email;
  if (channel === "push") return person.external_id;
  return person.phone; // sms | whatsapp | voice
}

export interface Reachability {
  reachable: boolean;
  reason: string;
}

/**
 * Resolve reachability AT SEND TIME (Section 9.3): the person exists and is not
 * erased, the latest consent for (channel, purpose) is `granted`, and the
 * address is not on any suppression list — tenant-scoped or platform-global.
 * This single "resolve at send, never at build" rule prevents the most common
 * category of marketing-compliance failure.
 */
export async function isReachable(
  client: PoolClient,
  args: { personId: string; channel: Channel; purpose: string },
): Promise<Reachability> {
  const person = await client.query(
    `select email, phone, external_id, erased_at from persons where id = $1`,
    [args.personId],
  );
  if (person.rowCount === 0) return { reachable: false, reason: "person not found in this tenant" };
  const row = person.rows[0] as { email: string | null; phone: string | null; external_id: string | null; erased_at: Date | null };
  if (row.erased_at) return { reachable: false, reason: "person has been erased" };

  const address = addressFor(row, args.channel);
  if (!address) return { reachable: false, reason: `no ${args.channel} address on file` };

  const consent = await client.query(
    `select state from consent_records
      where person_id = $1 and channel = $2 and purpose = $3
      order by occurred_at desc, id desc limit 1`,
    [args.personId, args.channel, args.purpose],
  );
  if (consent.rowCount === 0) return { reachable: false, reason: "no consent on record" };
  if ((consent.rows[0] as { state: ConsentState }).state !== "granted") {
    return { reachable: false, reason: "consent withdrawn" };
  }

  const hash = addressHash(address);
  const tenantSuppressed = await client.query(
    `select 1 from suppressions where channel = $1 and address_hash = $2 limit 1`,
    [args.channel, hash],
  );
  if (tenantSuppressed.rowCount! > 0) return { reachable: false, reason: "suppressed (tenant/campaign/regulatory)" };

  const globalSuppressed = await client.query(
    `select 1 from global_suppressions where channel = $1 and address_hash = $2 limit 1`,
    [args.channel, hash],
  );
  if (globalSuppressed.rowCount! > 0) return { reachable: false, reason: "suppressed (global do-not-contact)" };

  return { reachable: true, reason: "consented and not suppressed" };
}

/** Convenience wrappers that open their own tenant transaction. */
export const consent = {
  record: (tenantId: string, input: ConsentInput) => withTenant(tenantId, (c) => recordConsent(c, input)),
  withdraw: (tenantId: string, args: { personId: string; channel: Channel; purpose: string; source: string }) =>
    withTenant(tenantId, (c) => withdrawConsent(c, args)),
  reachable: (tenantId: string, args: { personId: string; channel: Channel; purpose: string }) =>
    withTenant(tenantId, (c) => isReachable(c, args)),
};
