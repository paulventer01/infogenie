import type { ClientWorkspace, ResultsSnapshot } from "./types";
import type { DataMode } from "./types";
import { canShowLiveMetrics, withholdReason } from "./strict-mode";

export type RoiSection = {
  title: string;
  status: "ok" | "empty" | "withheld";
  items: string[];
};

export function buildRoiNarrative(
  client: ClientWorkspace,
  mode: DataMode
): { headline: string; sections: RoiSection[]; summary: string } {
  const a = client.analysis;
  if (!a) {
    return {
      headline: "ROI story unavailable",
      sections: [
        {
          title: "Analysis",
          status: "empty",
          items: ["Run Analyse to build the client-facing ROI narrative."],
        },
      ],
      summary: "No analysis — cannot tie activity to outcomes.",
    };
  }

  const sections: RoiSection[] = [];

  sections.push({
    title: "What we shipped",
    status: client.campaigns.length > 0 || client.drafts.length > 0 ? "ok" : "empty",
    items: [
      ...client.campaigns.map(
        (c) => `Campaign: ${c.name} — ${c.objective} via ${c.channels.join(", ")}`
      ),
      ...client.sequences.map((s) => `Reach: ${s.name} (${s.steps.length} steps)`),
      ...client.drafts.slice(0, 2).map((d) => `Content: ${d.title}`),
    ].slice(0, 5),
  });

  if (sections[0].items.length === 0) {
    sections[0].items = ["No campaigns or content briefed yet this period."];
  }

  if (canShowLiveMetrics(client, mode)) {
    const r = client.results!;
    sections.push({
      title: "Measurable outcomes (Meta / Google)",
      status: "ok",
      items: [
        `ROAS ${r.roas}× on $${r.spend.toLocaleString()} spend`,
        `CAC $${r.cac} · ${r.conversions} conversions`,
        `CTR ${r.ctr}%`,
      ],
    });
  } else {
    sections.push({
      title: "Measurable outcomes",
      status: "withheld",
      items: [withholdReason(client, mode) || "Connect ad platforms for live ROI metrics."],
    });
  }

  sections.push({
    title: "Funnel view",
    status: canShowLiveMetrics(client, mode) ? "ok" : "withheld",
    items: canShowLiveMetrics(client, mode)
      ? [
          `Top of funnel: ${client.results!.conversions * 8} sessions (est. from conversions)`,
          `Mid funnel: ${client.results!.conversions * 2} leads`,
          `Bottom: ${client.results!.conversions} conversions`,
        ]
      : ["Funnel metrics withheld until Meta or Google is connected and synced."],
  });

  sections.push({
    title: "Strategic narrative",
    status: "ok",
    items: [
      a.actions[0] ? `Priority: ${a.actions[0].title}` : "Define priority actions in analysis",
      `Competitive angle: ${a.competitors[0]?.positioning || "Run competitor mapping"}`,
      `Brand proof: ${a.brand.doSay[0] || "Set brand foundation"}`,
    ],
  });

  const summary = canShowLiveMetrics(client, mode)
    ? `${a.brandName}: Activity this period connects to ${client.results!.conversions} conversions at ${client.results!.roas}× ROAS.`
    : `${a.brandName}: Strategic work is on track — connect ad platforms to prove pipeline impact in strict mode.`;

  return {
    headline: `${a.brandName} — activity → outcomes`,
    sections,
    summary,
  };
}

export function buildConnectedResults(client: ClientWorkspace): ResultsSnapshot | null {
  if (!hasConnectedAds(client)) return null;
  const spend = client.campaigns.reduce((sum, c) => sum + c.budgetMonthly, 0) || 2500;
  const conversions = Math.max(8, Math.round(spend / 95));
  const revenue = conversions * 240;
  return {
    spend: Math.round(spend * 0.25),
    conversions,
    roas: Math.round((revenue / (spend * 0.25)) * 100) / 100,
    cac: Math.round((spend * 0.25) / conversions),
    ctr: 2.1,
    note: "Live sync from connected ad platforms (MVP simulated pull).",
    generatedAt: new Date().toISOString(),
    source: "connected",
  };
}

function hasConnectedAds(client: ClientWorkspace): boolean {
  return client.integrations.some(
    (i) =>
      i.status === "connected" &&
      (i.platform.includes("Meta") || i.platform.includes("Google"))
  );
}
