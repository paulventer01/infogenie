import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant } from "../src/db/tenantContext.js";
import { runCapability } from "../src/modules/capabilities/runner.js";
import { analyseMarket, battlePlanText } from "../src/modules/analyse/marketAnalysis.js";
import { ensureMigrated, closeAll, createAgencyWithClient } from "./helpers.js";

// "Analyse Now" — the market-analysis entry flow. The competitor map must be
// deterministic, industry-exact, exclude the subject itself, and the battle
// plan must run through the governed spine like every other capability.

before(ensureMigrated);
after(closeAll);

const actor = { actorType: "user" as const, actorId: "test-user" };

test("market map is deterministic, industry-exact, and excludes the subject", () => {
  const a = analyseMarket({ website: "https://www.etoro.com/invest", region: "Europe" });
  const b = analyseMarket({ website: "etoro.com", region: "Europe" });
  assert.equal(a.industry, "Retail trading & investing platforms");
  assert.deepEqual(a.competitors.map((c) => c.name), b.competitors.map((c) => c.name), "same input, same map");
  assert.ok(a.competitors.length >= 5, "at least five competitors mapped");
  assert.ok(!a.competitors.some((c) => c.domain === "etoro.com"), "subject excluded from its own competitor set");
  for (const c of a.competitors) {
    assert.ok(c.positioning && c.strengths.length && c.weaknesses.length && c.counterMove, `${c.name} fully analysed`);
    assert.ok(["low", "medium", "high", "critical"].includes(c.threat));
  }
});

test("sector-only input maps a market too (either one is enough to begin)", () => {
  const map = analyseMarket({ sector: "travel booking", region: "Global" });
  assert.equal(map.industry, "Travel booking platforms");
  assert.ok(map.competitors.length >= 5);
});

test("unknown sector falls back to a generic same-industry set", () => {
  const map = analyseMarket({ sector: "artisanal cheese wholesale" });
  assert.ok(map.competitors.length >= 5);
  assert.ok(map.competitors.every((c) => c.positioning.includes("artisanal cheese wholesale")));
});

test("the battle plan runs through the governed spine (no brand needed, gated, audited)", async () => {
  const { client } = await createAgencyWithClient();
  const map = analyseMarket({ website: "coursera.org", region: "Global" });
  const result = await runCapability(client.id, {
    capabilityKey: "compete.market_analysis",
    brief: `Map the market for ${map.subject} (${map.industry}, ${map.region}).`,
    actor,
    mock: () => battlePlanText(map),
  });
  // requires_context=false: runs before brand onboarding, still fully governed.
  assert.notEqual(result.status, "blocked");
  assert.ok(result.output?.includes("Udemy") || result.output?.includes("edX"), "battle plan names same-industry competitors");
  const audit = await withTenant(client.id, async (c) =>
    c.query("select action, outcome from audit_log where action like 'compete.market_analysis%'"),
  );
  assert.ok(audit.rowCount! >= 1, "governed run reached the audit rail");
});
