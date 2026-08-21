import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FEATURE_CATALOG } from "../src/modules/capabilities/catalog.js";
import { INTEGRATION_CATALOG } from "../src/modules/integrations/registry.js";
import { ENGINES } from "../src/modules/capabilities/archetypes.js";
import { adminPool } from "../src/db/pool.js";
import { withTenant } from "../src/db/tenantContext.js";
import { saveBrandFoundation } from "../src/modules/brand/service.js";
import { runCapability } from "../src/modules/capabilities/runner.js";
import { ensureMigrated, closeAll, createAgencyWithClient } from "./helpers.js";

// The full feature surface: catalog integrity (Appendix A discipline in code)
// and a real governed run through every archetype and every domain.

before(ensureMigrated);
after(closeAll);

test("catalog integrity — every feature satisfies the registration rules", () => {
  assert.ok(FEATURE_CATALOG.length >= 120, `expected the full catalog, got ${FEATURE_CATALOG.length}`);

  const domains = new Set(["compete", "grow", "reach", "manage", "analyse", "monitor", "create", "seo"]);
  const integrationKeys = new Set(INTEGRATION_CATALOG.map((i) => i.key));
  const seenKeys = new Set<string>();

  for (const f of FEATURE_CATALOG) {
    assert.ok(!seenKeys.has(f.key), `duplicate key ${f.key}`);
    seenKeys.add(f.key);
    assert.ok(domains.has(f.domain), `${f.key}: unknown domain ${f.domain}`);
    assert.ok(f.archetype in ENGINES, `${f.key}: no engine for archetype ${f.archetype}`);
    assert.ok(f.description.length > 20, `${f.key}: description too thin to govern`);
    // §7.2 — irreversible actions never exceed A2, without exception.
    if (f.irreversible) {
      assert.ok(f.autonomyCeiling <= 2, `${f.key}: irreversible but ceiling A${f.autonomyCeiling}`);
    }
    for (const ik of f.integrations) {
      assert.ok(integrationKeys.has(ik), `${f.key}: unknown integration ${ik}`);
    }
  }
});

test("registry sync — the database registry matches the code catalog", async () => {
  const caps = await adminPool.query("select count(*)::int as n from capabilities");
  assert.ok(caps.rows[0].n >= FEATURE_CATALOG.length, "capabilities table missing catalog rows");
  const ints = await adminPool.query("select count(*)::int as n from integrations");
  assert.equal(ints.rows[0].n, INTEGRATION_CATALOG.length);
  const noCeilingViolation = await adminPool.query(
    "select count(*)::int as n from capabilities where irreversible and autonomy_ceiling > 2",
  );
  assert.equal(noCeilingViolation.rows[0].n, 0, "an irreversible capability exceeds A2 in the registry");
});

test("every archetype and every domain runs governed end to end", async () => {
  const { client } = await createAgencyWithClient();
  await saveBrandFoundation(
    client.id,
    { companyName: "Archetype Test Co", voiceTone: "plain", prohibitedTerms: ["forbiddenword"] },
    { actorId: "test" },
  );

  // One representative per archetype (as present in the catalog) + per domain.
  const picks = new Map<string, string>();
  for (const f of FEATURE_CATALOG) {
    if (![...picks.values()].includes(f.archetype)) picks.set(f.key, f.archetype);
  }
  for (const f of FEATURE_CATALOG) {
    if (![...picks.keys()].some((k) => FEATURE_CATALOG.find((x) => x.key === k)!.domain === f.domain)) {
      picks.set(f.key, f.archetype);
    }
  }

  for (const key of picks.keys()) {
    const result = await runCapability(client.id, {
      capabilityKey: key,
      brief: `Exercise ${key} against the current market position.`,
      actor: { actorType: "user", actorId: "test" },
    });
    assert.ok(["pending_approval", "executed"].includes(result.status), `${key} unexpectedly ${result.status}: ${result.gate.reason}`);
    assert.ok(result.output && result.output.length > 40, `${key}: output too thin`);
    assert.equal(result.brandVersion, 1, `${key}: not grounded in brand v1`);
  }

  // And the actions + audit rows exist for all of them.
  const n = picks.size;
  const actions = await withTenant(client.id, async (c) =>
    (await c.query("select count(*)::int as n from actions")).rows[0].n,
  );
  assert.ok(actions >= n, `expected ≥${n} actions, got ${actions}`);
});

test("evidence-bound capability includes provider evidence and stays gated", async () => {
  const { client } = await createAgencyWithClient();
  await saveBrandFoundation(client.id, { companyName: "Evidence Co", prohibitedTerms: [] }, { actorId: "test" });

  // SERP tracker is bound to DataForSEO in the catalog.
  const serp = FEATURE_CATALOG.find((f) => f.key === "compete.serp_position_tracker");
  assert.ok(serp && serp.integrations.includes("dataforseo"), "SERP tracker should bind DataForSEO");

  const result = await runCapability(client.id, {
    capabilityKey: "compete.serp_position_tracker",
    brief: "Track our primary keyword cluster.",
    actor: { actorType: "user", actorId: "test" },
  });
  assert.notEqual(result.status, "blocked", result.gate.reason);
  assert.match(result.output ?? "", /simulated|evidence/i, "mock evidence should be visibly labelled");
});

test("an irreversible catalog feature queues even at maximum configured autonomy", async () => {
  const { client } = await createAgencyWithClient();
  await saveBrandFoundation(client.id, { companyName: "Cap Co", prohibitedTerms: [] }, { actorId: "test" });

  const irreversible = FEATURE_CATALOG.find((f) => f.irreversible)!;
  // Try to configure A4 — the ceiling and the gate must still hold it at ≤A2.
  await withTenant(client.id, (c) =>
    c.query(
      `insert into tenant_capability_autonomy (tenant_id, capability_key, level)
       values (app_current_tenant(), $1, 4)`,
      [irreversible.key],
    ),
  );
  const result = await runCapability(client.id, {
    capabilityKey: irreversible.key,
    brief: "Push this to the outside world immediately.",
    actor: { actorType: "user", actorId: "test" },
  });
  assert.notEqual(result.status, "executed", `${irreversible.key} auto-executed despite irreversibility`);
});
