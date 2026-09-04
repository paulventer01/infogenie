import type { PoolClient } from "pg";
import { appPool } from "./pool.js";

/**
 * Run `work` inside a transaction with the tenant context established for the
 * whole transaction. Every RLS policy reads `app.current_tenant`, so all data
 * access inside the callback is automatically scoped to `tenantId` — and a
 * missing/blank tenant id resolves to "no rows" rather than leaking everything.
 *
 * `set_config(..., true)` sets the value LOCAL to the transaction, so it is
 * cleared automatically on commit/rollback and cannot bleed across pooled
 * connections.
 */
export async function withTenant<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_tenant', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
