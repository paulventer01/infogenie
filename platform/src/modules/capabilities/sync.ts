import type { Pool } from "pg";
import { FEATURE_CATALOG } from "./catalog.js";
import { INTEGRATION_CATALOG } from "../integrations/registry.js";

/**
 * Sync the code-defined catalogs into the database registries. Idempotent
 * upserts, run at migration time — the code catalog is the source of truth
 * (reviewed in change control), the tables are what the runner and RLS-scoped
 * queries consume. Registry rows are never deleted here; retiring a capability
 * is an explicit governance action, not a sync side-effect.
 */
export async function syncCatalogs(pool: Pool): Promise<{ capabilities: number; integrations: number; bindings: number }> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    for (const i of INTEGRATION_CATALOG) {
      await client.query(
        `insert into integrations (key, name, purpose, status, reason, auth_kind)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (key) do update
           set name = excluded.name, purpose = excluded.purpose,
               status = excluded.status, reason = excluded.reason, auth_kind = excluded.auth_kind`,
        [i.key, i.name, i.purpose, i.status, i.reason ?? null, i.authKind ?? "api_key"],
      );
    }

    let bindings = 0;
    for (const f of FEATURE_CATALOG) {
      await client.query(
        `insert into capabilities
           (key, name, domain, archetype, agent_type, requires_context, irreversible, entry_autonomy, autonomy_ceiling, description)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (key) do update
           set name = excluded.name, domain = excluded.domain, archetype = excluded.archetype,
               agent_type = excluded.agent_type, requires_context = excluded.requires_context,
               irreversible = excluded.irreversible, autonomy_ceiling = excluded.autonomy_ceiling,
               description = excluded.description`,
        [f.key, f.name, f.domain, f.archetype, f.agentType, f.requiresContext, f.irreversible, f.entryAutonomy, f.autonomyCeiling, f.description],
      );
      for (const ik of f.integrations) {
        await client.query(
          `insert into capability_integrations (capability_key, integration_key)
           values ($1, $2) on conflict do nothing`,
          [f.key, ik],
        );
        bindings++;
      }
    }

    await client.query("commit");
    return { capabilities: FEATURE_CATALOG.length, integrations: INTEGRATION_CATALOG.length, bindings };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
