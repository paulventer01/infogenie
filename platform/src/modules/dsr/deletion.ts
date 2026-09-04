import { withTenant } from "../../db/tenantContext.js";
import { addressHash } from "../../lib/hash.js";
import { appendWith } from "../audit/service.js";

export interface StorePropagation {
  store: string;
  status: "erased" | "pending_integration";
  note?: string;
}

export interface ErasureReport {
  personId: string;
  erased: boolean;
  suppressionTombstones: number;
  propagation: StorePropagation[];
}

/**
 * Execute a data-subject erasure end to end (Section 9.2 / Block 1). PII is
 * removed from the operational store, the consent ledger is cleared, and a
 * one-way suppression tombstone is retained per channel so the person cannot be
 * re-marketed after erasure (a hash, not the address). The action is recorded
 * in the audit rail atomically.
 *
 * Downstream stores that do not yet exist in Phase 0 (warehouse, vector store,
 * caches, backups) are listed with `pending_integration` so the propagation
 * surface is explicit and wired as those stores arrive in later phases —
 * "deletion completeness" is a data-governance guardrail (Section 7.5), and the
 * vector store is the one most commonly missed.
 */
export async function eraseDataSubject(
  tenantId: string,
  personId: string,
  requestedBy: { actorType: "user" | "system"; actorId?: string },
): Promise<ErasureReport> {
  return withTenant(tenantId, async (client) => {
    const found = await client.query(
      `select email, phone, external_id, erased_at from persons where id = $1`,
      [personId],
    );
    if (found.rowCount === 0) {
      throw new Error("person not found in this tenant");
    }
    const person = found.rows[0] as {
      email: string | null;
      phone: string | null;
      external_id: string | null;
      erased_at: Date | null;
    };

    // Retain suppression tombstones (hash only) before clearing PII.
    let tombstones = 0;
    const tombstone = async (channel: string, address: string | null) => {
      if (!address) return;
      await client.query(
        `insert into suppressions (tenant_id, scope, channel, address_hash, reason)
         values (app_current_tenant(), 'regulatory', $1, $2, 'data-subject erasure')`,
        [channel, addressHash(address)],
      );
      tombstones += 1;
    };
    await tombstone("email", person.email);
    await tombstone("sms", person.phone);

    // Clear the consent ledger and the PII, leaving a minimal erased tombstone.
    await client.query(`delete from consent_records where person_id = $1`, [personId]);
    await client.query(
      `update persons
          set email = null, phone = null, external_id = null, erased_at = now()
        where id = $1`,
      [personId],
    );

    await appendWith(client, {
      actorType: requestedBy.actorType,
      actorId: requestedBy.actorId,
      action: "dsr.erase",
      resourceType: "person",
      resourceId: personId,
      evidence: { channelsTombstoned: tombstones, alreadyErased: Boolean(person.erased_at) },
      outcome: "erased",
    });

    return {
      personId,
      erased: true,
      suppressionTombstones: tombstones,
      propagation: [
        { store: "operational (postgres)", status: "erased" },
        { store: "consent ledger", status: "erased" },
        { store: "warehouse", status: "pending_integration", note: "wired in Phase 1" },
        { store: "vector store", status: "pending_integration", note: "wired in Phase 1 — embeddings of PII are PII" },
        { store: "caches", status: "pending_integration", note: "wired in Phase 1" },
        { store: "backups", status: "pending_integration", note: "honoured on restore within retention window" },
      ],
    };
  });
}
