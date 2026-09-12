import "./env-setup.js";
import { adminPool, appPool } from "../src/db/pool.js";
import { migrate } from "../src/migrate.js";
import { withTenant } from "../src/db/tenantContext.js";
import { createTenant } from "../src/modules/identity/service.js";

let migrated = false;

export async function ensureMigrated(): Promise<void> {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}

/** Reset all tenant data and identity rows between tests (keeps roles). */
export async function resetDb(): Promise<void> {
  await adminPool.query("truncate tenants, users, global_suppressions restart identity cascade");
}

export async function closeAll(): Promise<void> {
  await appPool.end();
  await adminPool.end();
}

let slugCounter = 0;
export async function createAgencyWithClient() {
  const n = slugCounter++;
  const agency = await createTenant({ type: "agency", name: `Agency ${n}`, slug: `agency-${n}-${Date.now()}` });
  const client = await createTenant({
    type: "client",
    name: `Client ${n}`,
    slug: `client-${n}-${Date.now()}`,
    parentTenantId: agency.id,
  });
  return { agency, client };
}

export async function insertPerson(
  tenantId: string,
  fields: { email?: string; phone?: string; externalId?: string },
): Promise<string> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `insert into persons (tenant_id, email, phone, external_id)
       values (app_current_tenant(), $1, $2, $3) returning id`,
      [fields.email ?? null, fields.phone ?? null, fields.externalId ?? null],
    );
    return rows[0].id as string;
  });
}
