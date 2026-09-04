// Migration runner. Applies SQL files in db/migrations in filename order,
// tracked in schema_migrations, using the privileged admin connection. Idempotent.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adminPool } from "./db/pool.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

// Advisory-lock key so concurrent processes (e.g. parallel test files) apply
// migrations one at a time; late arrivals then simply find them applied.
const MIGRATION_LOCK = 727274;

export async function migrate(): Promise<string[]> {
  const lock = await adminPool.connect();
  try {
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);

    await lock.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await lock.query("select filename from schema_migrations")).rows.map((r) => r.filename),
    );

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      try {
        await lock.query("begin");
        await lock.query(sql);
        await lock.query("insert into schema_migrations (filename) values ($1)", [file]);
        await lock.query("commit");
        ran.push(file);
      } catch (err) {
        await lock.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }

    // Sync the code-defined catalogs (features + integrations) into the DB
    // registries — idempotent, and inside the advisory lock.
    const { syncCatalogs } = await import("./modules/capabilities/sync.js");
    await syncCatalogs(adminPool);

    return ran;
  } finally {
    await lock.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    lock.release();
  }
}

// Run directly: `tsx src/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "No pending migrations.");
      return adminPool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
