// Seed a realistic demo tenant set for the operator console: an agency with two
// clients, an owner login, a Brand Foundation, and a spread of governed actions
// (executed / pending / blocked) produced through the real runner.
import "../test/env-setup.js";
import { migrate } from "../src/migrate.js";
import { closePools } from "../src/db/pool.js";
import { withTenant } from "../src/db/tenantContext.js";
import { createTenant, createUser, addMembership } from "../src/modules/identity/service.js";
import { saveBrandFoundation } from "../src/modules/brand/service.js";
import { runCapability } from "../src/modules/capabilities/runner.js";

async function main() {
  await migrate();

  const agency = await createTenant({ type: "agency", name: "Northwind Agency", slug: "northwind" });
  const acme = await createTenant({ type: "client", name: "Acme Retail", slug: "acme-retail", parentTenantId: agency.id });
  await createTenant({ type: "client", name: "Globex Software", slug: "globex", parentTenantId: agency.id });

  const owner = await createUser({ email: "demo@infogenie.app", password: "demo-pass-1" });
  await addMembership(owner.id, agency.id, "owner");

  await saveBrandFoundation(
    acme.id,
    {
      companyName: "Acme Retail",
      positioning: "The neighbourhood department store, online — considered goods at fair prices.",
      mission: "Make well-made everyday goods affordable for every household.",
      voiceTone: "Warm, plain-spoken, quietly confident. No hype, no exclamation marks.",
      keyMessages: ["Fair prices, honestly explained", "Made to last", "Local service, national range"],
      differentiators: ["90-day no-quibble returns", "Price-match promise", "Same-week delivery"],
      competitors: ["Globex Software", "Initech Stores"],
      prohibitedTerms: ["cheap", "bargain-basement"],
    },
    { actorId: owner.id },
  );

  const actor = { actorType: "user" as const, actorId: owner.id };

  // Executed at A3: promote battle cards, then run.
  await withTenant(acme.id, (c) =>
    c.query(
      `insert into tenant_capability_autonomy (tenant_id, capability_key, level)
       values (app_current_tenant(), 'compete.battle_cards', 3)`,
    ),
  );
  await runCapability(acme.id, {
    capabilityKey: "compete.battle_cards",
    brief: "Battle card for Initech Stores ahead of the Q3 retail season.",
    actor,
    mock: () =>
      "Initech Stores — battle card.\nStrengths: wider grocery range; faster metro delivery; stronger app ratings; larger loyalty base.\nWeaknesses: weaker returns policy (14 days vs our 90); frequent stock-outs on furniture; no price-match; thin regional coverage.\nRecent moves: opened 3 dark stores; cut delivery fees; launched own-label range.\nCounter-plays: lead with the 90-day returns promise; price-match visibly on the top 50 SKUs; target their regional gaps in paid social; bundle same-week delivery on furniture.",
  });

  // Pending at A1: on-brand content generation awaiting approval.
  await runCapability(acme.id, {
    capabilityKey: "create.content_generation",
    brief: "Short social post announcing the winter warehouse sale, keep it understated.",
    vars: { format: "a social post" },
    actor,
    mock: () =>
      "Winter has a way of finding the gaps — in coats, in blankets, in budgets. Our warehouse sale is on now, with fair prices on the things that get you through the season. Made to last, priced to be honest about it.",
  });

  // Blocked: prohibited term.
  await runCapability(acme.id, {
    capabilityKey: "create.content_generation",
    brief: "Punchy post for the clearance aisle.",
    actor,
    mock: () => "Cheap and cheerful finds in every aisle — the bargain hunt starts now.",
  });

  // Blocked: claim language routed to human review.
  await runCapability(acme.id, {
    capabilityKey: "seo.content_brief",
    brief: "Landing page brief for the price-match promise.",
    actor,
    mock: () => "Position Acme as the best retailer in the country with guaranteed savings on every purchase.",
  });

  console.log(JSON.stringify({ login: "demo@infogenie.app / demo-pass-1", acmeTenant: acme.id }));
  await closePools();
}

main().catch((err) => { console.error(err); process.exit(1); });
