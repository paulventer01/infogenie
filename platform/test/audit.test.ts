import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant } from "../src/db/tenantContext.js";
import { append, verifyChain } from "../src/modules/audit/service.js";
import { ensureMigrated, closeAll, createAgencyWithClient } from "./helpers.js";

// "Every consequential action type has an audit record"; the rail is
// append-only and tamper-evident (Block 10, Section 8).

before(ensureMigrated);
after(closeAll);

test("audit entries form a verifiable per-tenant hash chain", async () => {
  const { client } = await createAgencyWithClient();
  await append(client.id, { actorType: "user", actorId: "u1", action: "session.create" });
  await append(client.id, { actorType: "agent", actorId: "seo-agent", action: "consent.reachability_check" });
  await append(client.id, { actorType: "system", action: "dsr.erase", outcome: "erased" });

  const result = await verifyChain(client.id);
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
});

test("audit_log rejects UPDATE and DELETE (append-only)", async () => {
  const { client } = await createAgencyWithClient();
  await append(client.id, { actorType: "user", action: "x" });

  // The app role has UPDATE/DELETE revoked (permission denied, checked before
  // the trigger); the immutability trigger is the defence-in-depth layer for
  // any role that does hold the privilege. Either is an acceptable rejection.
  await assert.rejects(
    () => withTenant(client.id, (c) => c.query("update audit_log set outcome = 'tampered'")),
    /append-only|permission denied/,
  );
  await assert.rejects(
    () => withTenant(client.id, (c) => c.query("delete from audit_log")),
    /append-only|permission denied/,
  );
});

test("tampering is detectable — a forged field breaks the chain", async () => {
  const { client } = await createAgencyWithClient();
  await append(client.id, { actorType: "user", action: "a" });
  await append(client.id, { actorType: "user", action: "b" });

  // Force a field change past the immutability trigger, as a privileged actor
  // would have to, to prove the hash chain still catches it.
  const { adminPool } = await import("../src/db/pool.js");
  await adminPool.query("alter table audit_log disable trigger audit_no_mutate");
  await adminPool.query(
    "update audit_log set outcome = 'forged' where seq = (select min(seq) from audit_log where tenant_id = $1)",
    [client.id],
  );
  await adminPool.query("alter table audit_log enable trigger audit_no_mutate");

  const result = await verifyChain(client.id);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /hash/);
});

test("audit records are tenant-isolated", async () => {
  const a = await createAgencyWithClient();
  const b = await createAgencyWithClient();
  await append(a.client.id, { actorType: "user", action: "a-only" });

  const seenByB = await withTenant(b.client.id, async (c) =>
    (await c.query("select count(*)::int as n from audit_log")).rows[0].n,
  );
  assert.equal(seenByB, 0);
});
