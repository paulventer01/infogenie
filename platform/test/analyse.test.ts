import "./env-setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant } from "../src/db/tenantContext.js";
import { saveBrandFoundation } from "../src/modules/brand/service.js";
import { runCapability } from "../src/modules/capabilities/runner.js";
import { analyseMarket, identifyMarket, battlePlanText } from "../src/modules/analyse/marketAnalysis.js";
import { fetchEvidence, parseRssTitles } from "../src/modules/integrations/hub.js";
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

test("an arbitrary business website lands in its real industry via domain keywords", () => {
  const cases: Array<[string, string]> = [
    ["joesplumbing.co.za", "Home services & trades"],
    ["suretrade.co.za", "Retail trading & investing platforms"],
    ["cityhealthclinic.com", "Healthcare & wellness"],
    ["fastcourier.co.za", "Logistics & courier"],
    ["smithattorneys.co.za", "Legal services"],
    ["brightgym.com", "Fitness & gyms"],
  ];
  for (const [site, industry] of cases) {
    const map = analyseMarket({ website: site });
    assert.equal(map.industry, industry, `${site} should map to ${industry}, got ${map.industry}`);
    assert.ok(map.competitors.length >= 5, `${site}: full competitive set`);
    assert.ok(map.competitors.every((c) => c.domain !== site), `${site}: subject excluded`);
  }
});

test("identifyMarket through the gateway (mock path) equals the deterministic map and is metered", async () => {
  const { client } = await createAgencyWithClient();
  const viaGateway = await identifyMarket(client.id, { website: "joesplumbing.co.za", region: "South Africa" });
  const direct = analyseMarket({ website: "joesplumbing.co.za", region: "South Africa" });
  assert.equal(viaGateway.industry, direct.industry);
  assert.deepEqual(viaGateway.competitors.map((c) => c.name), direct.competitors.map((c) => c.name));
  const metered = await withTenant(client.id, async (c) =>
    c.query("select count(*)::int as n from model_calls where purpose = 'market identification'"),
  );
  assert.ok(metered.rows[0].n >= 1, "identification call is metered through the gateway");
});

test("unknown sector falls back to a generic same-industry set", () => {
  const map = analyseMarket({ sector: "artisanal cheese wholesale" });
  assert.ok(map.competitors.length >= 5);
  assert.ok(map.competitors.every((c) => c.positioning.includes("artisanal cheese wholesale")));
});

test("BlueAlpha maps as a same-industry competitor for AI marketing platforms", () => {
  const map = analyseMarket({ website: "bluealpha.ai" });
  assert.equal(map.industry, "AI marketing & measurement platforms");
  assert.ok(!map.competitors.some((c) => c.domain === "bluealpha.ai"), "subject excluded");
  const infogenieView = analyseMarket({ sector: "agentic marketing intelligence" });
  assert.ok(infogenieView.competitors.some((c) => c.name === "BlueAlpha"), "BlueAlpha appears in InfoGenie's own competitive set");
});

test("BlueAlpha incrementality evidence grounds spend capabilities through the governed run", async () => {
  const { client } = await createAgencyWithClient();
  await saveBrandFoundation(client.id, { companyName: "Acme Retail" }, { actorId: "test-user" });
  const result = await runCapability(client.id, {
    capabilityKey: "grow.iroas_incrementality_module",
    brief: "Measure the true incremental ROAS of our summer prospecting campaign.",
    actor,
  });
  assert.notEqual(result.status, "blocked");
  assert.match(result.output ?? "", /incremental/i, "output reasons about incrementality");
  const audit = await withTenant(client.id, async (c) =>
    c.query("select evidence from audit_log where action like 'grow.iroas_incrementality_module%'"),
  );
  assert.ok(audit.rowCount! >= 1, "governed run audited");
});

test("no-cost providers: RSS parsing is robust and evidence falls back to mock offline", async () => {
  const rss = `<rss><channel><title>feed</title><item><title><![CDATA[First story]]></title></item><item><title>Second &amp; third</title></item></rss>`;
  assert.deepEqual(parseRssTitles(rss, 5), ["First story", "Second & third"]);
  // EVIDENCE_LIVE=0 (env-setup): a capability bound to live no-cost providers
  // still gets deterministic, clearly-labelled mock evidence.
  const { client } = await createAgencyWithClient();
  const blocks = await withTenant(client.id, (c) => fetchEvidence(c, "compete.market_analysis", "acme.example"));
  const providers = blocks.map((b) => b.provider).sort();
  assert.deepEqual(providers, ["news_api", "web_fetch", "wikipedia"]);
  assert.ok(blocks.every((b) => b.mode === "mock"), "offline evidence is mock, never a hung network call");
});

test("live no-cost adapters produce live evidence end to end (stubbed network)", async () => {
  const realFetch = globalThis.fetch;
  const canned = (body: string) => Promise.resolve(new Response(body, { status: 200 }));
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes("news.google.com")) return canned("<rss><item><title>Acme expands</title></item><item><title>Rival raises prices</title></item></rss>");
    if (u.includes("wikipedia.org/w/api.php")) return canned(JSON.stringify(["acme", ["Acme Corp"], [], []]));
    if (u.includes("wikipedia.org/api/rest_v1")) return canned(JSON.stringify({ extract: "Acme Corp is a retailer." }));
    if (u.includes("acme.example")) return canned("<html><head><title>Acme — quality goods</title><meta name=\"description\" content=\"Acme sells durable goods.\"></head></html>");
    if (u.includes("frankfurter")) return canned(JSON.stringify({ date: "2026-07-27", rates: { ZAR: 17.9, EUR: 0.9, GBP: 0.78 } }));
    return Promise.reject(new Error(`unexpected url ${u}`));
  }) as typeof fetch;
  process.env.EVIDENCE_LIVE = "1";
  try {
    const { client } = await createAgencyWithClient();
    const blocks = await withTenant(client.id, (c) => fetchEvidence(c, "compete.market_analysis", "acme.example"));
    const byProvider = new Map(blocks.map((b) => [b.provider, b]));
    assert.equal(byProvider.get("web_fetch")?.mode, "live");
    assert.match(byProvider.get("web_fetch")?.text ?? "", /Acme — quality goods/);
    assert.equal(byProvider.get("wikipedia")?.mode, "live");
    assert.match(byProvider.get("wikipedia")?.text ?? "", /Acme Corp is a retailer/);
    assert.equal(byProvider.get("news_api")?.mode, "live");
    assert.match(byProvider.get("news_api")?.text ?? "", /Acme expands · Rival raises prices/);
  } finally {
    process.env.EVIDENCE_LIVE = "0";
    globalThis.fetch = realFetch;
  }
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
