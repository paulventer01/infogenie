import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant } from "../src/db/tenantContext.js";
import {
  recordConsent,
  withdrawConsent,
  isReachable,
  addTenantSuppression,
  addGlobalSuppression,
} from "../src/modules/consent/service.js";
import { ensureMigrated, closeAll, createAgencyWithClient, insertPerson } from "./helpers.js";

// Consent is per person, per channel, per purpose, with provenance; withdrawal
// is honoured immediately; suppression is hierarchical; reachability is resolved
// at send time (Section 9.3).

before(ensureMigrated);
after(closeAll);

test("consent is scoped per channel and per purpose", async () => {
  const { client } = await createAgencyWithClient();
  const person = await insertPerson(client.id, { email: "p@a.example", phone: "+27110000000" });

  await withTenant(client.id, (c) =>
    recordConsent(c, {
      personId: person,
      channel: "email",
      purpose: "marketing",
      state: "granted",
      source: "signup-form",
      method: "double-opt-in",
      noticeVersion: "v1",
      proof: { ip: "203.0.113.4" },
    }),
  );

  const emailMarketing = await withTenant(client.id, (c) => isReachable(c, { personId: person, channel: "email", purpose: "marketing" }));
  const smsMarketing = await withTenant(client.id, (c) => isReachable(c, { personId: person, channel: "sms", purpose: "marketing" }));
  const emailTxn = await withTenant(client.id, (c) => isReachable(c, { personId: person, channel: "email", purpose: "transactional" }));

  assert.equal(emailMarketing.reachable, true);
  assert.equal(smsMarketing.reachable, false, "consent to email marketing is not consent to SMS");
  assert.equal(emailTxn.reachable, false, "consent to marketing is not consent to a different purpose");
});

test("withdrawal is honoured immediately", async () => {
  const { client } = await createAgencyWithClient();
  const person = await insertPerson(client.id, { email: "p@a.example" });

  await withTenant(client.id, (c) =>
    recordConsent(c, { personId: person, channel: "email", purpose: "marketing", state: "granted", source: "form", method: "opt-in" }),
  );
  assert.equal((await withTenant(client.id, (c) => isReachable(c, { personId: person, channel: "email", purpose: "marketing" }))).reachable, true);

  await withTenant(client.id, (c) => withdrawConsent(c, { personId: person, channel: "email", purpose: "marketing", source: "unsubscribe" }));
  assert.equal((await withTenant(client.id, (c) => isReachable(c, { personId: person, channel: "email", purpose: "marketing" }))).reachable, false);
});

test("tenant and global suppression both block reachability", async () => {
  const a = await createAgencyWithClient();
  const person = await insertPerson(a.client.id, { email: "sup@a.example" });
  await withTenant(a.client.id, (c) =>
    recordConsent(c, { personId: person, channel: "email", purpose: "marketing", state: "granted", source: "form", method: "opt-in" }),
  );

  // Tenant suppression.
  await withTenant(a.client.id, (c) => addTenantSuppression(c, { scope: "tenant", channel: "email", address: "sup@a.example", reason: "manual" }));
  assert.equal((await withTenant(a.client.id, (c) => isReachable(c, { personId: person, channel: "email", purpose: "marketing" }))).reachable, false);

  // Global suppression blocks a different tenant's contact with the same address.
  const b = await createAgencyWithClient();
  const personB = await insertPerson(b.client.id, { email: "sup@a.example" });
  await withTenant(b.client.id, (c) =>
    recordConsent(c, { personId: personB, channel: "email", purpose: "marketing", state: "granted", source: "form", method: "opt-in" }),
  );
  await withTenant(b.client.id, (c) => addGlobalSuppression(c, { channel: "email", address: "sup@a.example", reason: "global unsubscribe" }));
  assert.equal((await withTenant(b.client.id, (c) => isReachable(c, { personId: personB, channel: "email", purpose: "marketing" }))).reachable, false);
});
