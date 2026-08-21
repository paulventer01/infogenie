import pg from "pg";
import { config } from "../config/env.js";

const { Pool } = pg;

/**
 * Two pools, deliberately distinct:
 *
 * - `appPool` connects as the least-privilege `infogenie_app` role. RLS is
 *   enforced against it, so every tenant-scoped query is isolated at the
 *   database. This is the ONLY pool the request path may use.
 *
 * - `adminPool` connects as a privileged role and is used solely for migrations
 *   and platform bootstrap. It bypasses RLS, so it must never serve a request.
 */
export const appPool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export const adminPool = new Pool({ connectionString: config.adminDatabaseUrl, max: 4 });

export async function closePools(): Promise<void> {
  await Promise.allSettled([appPool.end(), adminPool.end()]);
}
