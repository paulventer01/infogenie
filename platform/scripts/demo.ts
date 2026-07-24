// End-to-end Phase 0 demonstration. Drives the real services against the live
// database and emits a JSON record of what actually happened, for the preview.
import "../test/env-setup.js";
import { migrate } from "../src/migrate.js";
import { appPool, closePools } from "../src/db/pool.js";
import { withTenant } from "../src/db/tenantContext.js";
import { createTenant, createUser, addMembership } from "../src/modules/identity/service.js";
import { resolveTenantAccess, grantJitAccess } from "../src/modules/identity/rbac.js";
import {
  recordConsent,
  withdrawConsent,
  isReachable,
  addTenantSuppression,
  addGlobalSuppression,
} from "../src/modules/consent/service.js";
import { append, verifyChain } from "../src/modules/audit/service.js";
import { eraseDataSubject } from "../src/modules/dsr/deletion.js";

async function insertPerson(tenantId: string, email: string, phone?: string) {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `insert into persons (tenant_id, email, phone) values (app_current_tenant(), $1, $2) returning id`,
      [email, phone ?? null],
    );
    return rows[0].id as string;
  });
}

async function main() {
  await migrate();
  const out: Record<string, unknown> = {};

  // 1. Tenancy — an agency with two clients.
  const agency = await createTenant({ type: "agency", name: "Northwind Agency", slug: "northwind" });
  const acme = await createTenant({ type: "client", name: "Acme Retail", slug: "acme", parentTenantId: agency.id });
  const globex = await createTenant({ type: "client", name: "Globex", slug: "globex", parentTenantId: agency.id });
  out.tenants = { agency: agency.name, clients: [acme.name, globex.name] };

  // 2. Identity — an agency operator, and a support user with NO standing access.
  const operator = await createUser({ email: "op@northwind.example", password: "x" });
  await addMembership(operator.id, agency.id, "operator");
  const support = await createUser({ email: "support@infogenie.example", isSupport: true });

  const opToAcme = await resolveTenantAccess(operator.id, acme.id);
  const supToAcmeBefore = await resolveTenantAccess(support.id, acme.id);
  await grantJitAccess({ userId: support.id, tenantId: acme.id, reason: "ticket #4821 — investigate delivery issue", ttlMinutes: 60 });
  const supToAcmeAfter = await resolveTenantAccess(support.id, acme.id);
  out.access = {
    operatorEntersClient: { allowed: opToAcme.allowed, via: opToAcme.via },
    supportBeforeJit: { allowed: supToAcmeBefore.allowed, via: supToAcmeBefore.via },
    supportAfterJit: { allowed: supToAcmeAfter.allowed, via: supToAcmeAfter.via },
  };

  // 3. Consent — per person / channel / purpose, resolved at send time.
  const alice = await insertPerson(acme.id, "alice@shopper.example", "+27110001111");
  await withTenant(acme.id, (c) =>
    recordConsent(c, { personId: alice, channel: "email", purpose: "marketing", state: "granted", source: "signup", method: "double-opt-in", noticeVersion: "v2", proof: { ip: "203.0.113.9" } }),
  );
  const emailOk = await withTenant(acme.id, (c) => isReachable(c, { personId: alice, channel: "email", purpose: "marketing" }));
  const smsNo = await withTenant(acme.id, (c) => isReachable(c, { personId: alice, channel: "sms", purpose: "marketing" }));
  await withTenant(acme.id, (c) => withdrawConsent(c, { personId: alice, channel: "email", purpose: "marketing", source: "unsubscribe-link" }));
  const emailAfterWithdraw = await withTenant(acme.id, (c) => isReachable(c, { personId: alice, channel: "email", purpose: "marketing" }));
  out.consent = {
    emailMarketing: emailOk,
    smsMarketing: smsNo,
    emailAfterWithdrawal: emailAfterWithdraw,
  };

  // 4. Suppression — global do-not-contact blocks a DIFFERENT tenant.
  const bob = await insertPerson(globex.id, "bob@shared.example");
  await withTenant(globex.id, (c) => recordConsent(c, { personId: bob, channel: "email", purpose: "marketing", state: "granted", source: "form", method: "opt-in" }));
  const bobBefore = await withTenant(globex.id, (c) => isReachable(c, { personId: bob, channel: "email", purpose: "marketing" }));
  // A global unsubscribe captured anywhere on the platform:
  await withTenant(acme.id, (c) => addGlobalSuppression(c, { channel: "email", address: "bob@shared.example", reason: "global unsubscribe" }));
  const bobAfter = await withTenant(globex.id, (c) => isReachable(c, { personId: bob, channel: "email", purpose: "marketing" }));
  out.suppression = { beforeGlobalUnsub: bobBefore, afterGlobalUnsub: bobAfter };

  // 5. Isolation — from Acme's context, try to read Globex's rows explicitly.
  const leaked = await withTenant(acme.id, async (c) =>
    (await c.query("select count(*)::int as n from persons where tenant_id = $1", [globex.id])).rows[0].n,
  );
  const noContext = (await appPool.query("select count(*)::int as n from persons")).rows[0].n;
  out.isolation = { rowsLeakedFromAcmeToGlobex: leaked, rowsVisibleWithNoTenantContext: noContext };

  // 6. Audit — a few consequential actions, then verify the tamper-evident chain.
  await append(acme.id, { actorType: "user", actorId: operator.id, action: "session.create", outcome: "ok" });
  await append(acme.id, { actorType: "agent", actorId: "seo-content", action: "consent.reachability_check", evidence: { channel: "email" }, outcome: "not_reachable" });
  const chain = await verifyChain(acme.id);
  let mutationRejected = "";
  try {
    await withTenant(acme.id, (c) => c.query("update audit_log set outcome = 'tampered'"));
  } catch (e) {
    mutationRejected = (e as Error).message.split("\n")[0]!;
  }
  const sample = await withTenant(acme.id, async (c) =>
    (await c.query("select seq, action, substr(hash,1,16) as hash16, substr(prev_hash,1,16) as prev16 from audit_log order by seq")).rows,
  );
  out.audit = { chainVerified: chain.ok, entryCount: chain.count, mutationRejected, entries: sample };

  // 7. DSR — erase Alice end to end.
  const erasure = await eraseDataSubject(acme.id, alice, { actorType: "system", actorId: "dsr-runner" });
  const aliceRow = await withTenant(acme.id, async (c) =>
    (await c.query("select email, phone, erased_at from persons where id = $1", [alice])).rows[0],
  );
  const reachAfterErase = await withTenant(acme.id, (c) => isReachable(c, { personId: alice, channel: "email", purpose: "marketing" }));
  out.dsr = {
    tombstones: erasure.suppressionTombstones,
    piiAfter: { email: aliceRow.email, phone: aliceRow.phone, erased: aliceRow.erased_at !== null },
    reachableAfter: reachAfterErase.reachable,
    propagation: erasure.propagation,
  };

  console.log(JSON.stringify(out, null, 2));
  await closePools();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
