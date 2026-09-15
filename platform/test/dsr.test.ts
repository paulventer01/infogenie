import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant } from "../src/db/tenantContext.js";
import { recordConsent, isReachable } from "../src/modules/consent/service.js";
import { eraseDataSubject } from "../src/modules/dsr/deletion.js";
import { verifyChain } from "../src/modules/audit/service.js";
import { ensureMigrated, closeAll, createAgencyWithClient, insertPerson } from "./helpers.js";

// "A data subject deletion request can be executed end to end." (Phase 0 gate.)

before(ensureMigrated);
after(closeAll);

test("erasure clears PII, drops consent, leaves a suppression tombstone, and audits", async () => {
  const { client } = await createAgencyWithClient();
  const person = await insertPerson(client.id, { email: "erase@a.example", phone: "+27110000001" });
  await withTenant(client.id, (c) =>
    recordConsent(c, { personId: person, channel: "email", purpose: "marketing", state: "granted", source: "form", method: "opt-in" }),
  );

  const report = await eraseDataSubject(client.id, person, { actorType: "system", actorId: "dsr-runner" });
  assert.equal(report.erased, true);
  assert.equal(report.suppressionTombstones, 2, "email + phone tombstoned");
  assert.ok(report.propagation.some((p) => p.store.includes("vector") && p.status === "pending_integration"));

  // PII is gone and the person is erased.
  const row = await withTenant(client.id, async (c) => (await c.query("select email, phone, erased_at from persons where id = $1", [person])).rows[0]);
  assert.equal(row.email, null);
  assert.equal(row.phone, null);
  assert.notEqual(row.erased_at, null);

  // No longer reachable.
  const reach = await withTenant(client.id, (c) => isReachable(c, { personId: person, channel: "email", purpose: "marketing" }));
  assert.equal(reach.reachable, false);

  // The erasure is on the audit rail and the chain still verifies.
  const chain = await verifyChain(client.id);
  assert.equal(chain.ok, true);
  const actions = await withTenant(client.id, async (c) => (await c.query("select action from audit_log")).rows.map((r) => r.action));
  assert.ok(actions.includes("dsr.erase"));
});
