import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { appPool } from "../src/db/pool.js";
import { withTenant } from "../src/db/tenantContext.js";
import { ensureMigrated, closeAll, createAgencyWithClient, insertPerson } from "./helpers.js";

// The central Phase 0 gate: "Cross-tenant read attempts fail at the database
// layer, demonstrated by test." (Section 6 · Phase 0 gate; Section 13.)

before(ensureMigrated);
after(closeAll);

test("a tenant sees only its own rows", async () => {
  const a = await createAgencyWithClient();
  const b = await createAgencyWithClient();
  await insertPerson(a.client.id, { email: "alice@a.example" });
  await insertPerson(b.client.id, { email: "bob@b.example" });

  const seenByA = await withTenant(a.client.id, async (c) => (await c.query("select email from persons")).rows);
  assert.equal(seenByA.length, 1);
  assert.equal(seenByA[0].email, "alice@a.example");
});

test("explicit cross-tenant WHERE returns nothing (RLS overrides the predicate)", async () => {
  const a = await createAgencyWithClient();
  const b = await createAgencyWithClient();
  await insertPerson(b.client.id, { email: "bob@b.example" });

  const leaked = await withTenant(a.client.id, async (c) =>
    (await c.query("select count(*)::int as n from persons where tenant_id = $1", [b.client.id])).rows[0].n,
  );
  assert.equal(leaked, 0);
});

test("no tenant context returns no rows (fails safe, not open)", async () => {
  const a = await createAgencyWithClient();
  await insertPerson(a.client.id, { email: "alice@a.example" });

  // A raw app-pool query with no tenant context set.
  const { rows } = await appPool.query("select count(*)::int as n from persons");
  assert.equal(rows[0].n, 0);
});

test("cross-tenant INSERT is blocked by the WITH CHECK policy", async () => {
  const a = await createAgencyWithClient();
  const b = await createAgencyWithClient();

  await assert.rejects(
    () =>
      withTenant(a.client.id, (c) =>
        c.query("insert into persons (tenant_id, email) values ($1, $2)", [b.client.id, "evil@x.example"]),
      ),
    /row-level security/,
  );
});
