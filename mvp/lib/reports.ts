import { randomUUID } from "node:crypto";
import type { Analysis, ClientWorkspace, ResultsSnapshot, WeeklyReport } from "./types";

export function buildWeeklyNarrative(
  analysis: Analysis,
  results: ResultsSnapshot | null
): string {
  const r = results;
  const perf = r
    ? `Spend $${r.spend.toLocaleString()} · ROAS ${r.roas}× · CAC $${r.cac} · ${r.conversions} conversions`
    : "Connect ad platforms for live metrics — narrative below uses analysis scaffold.";

  return `Weekly marketing brief — ${analysis.brandName}
${analysis.domain} · ${analysis.industry}

Executive summary
${analysis.summary}

Performance snapshot
${perf}
${r?.source === "illustrative" ? "(Illustrative until integrations are connected — not live platform data.)" : ""}

What moved this week
- Competitor watch: ${analysis.competitors[0]?.name || "Category leader"} continues ${analysis.competitors[0]?.positioning?.toLowerCase() || "category positioning"}
- Top keyword opportunity: ${analysis.keywords[0]?.keyword || "comparison terms"}
- Creative angle to test: ${analysis.ads[0]?.angle || "proof-led switching"}

Recommended focus next week
1. ${analysis.actions[0]?.title || "Ship comparison landing page"} — ${analysis.actions[0]?.why || "capture high-intent demand"}
2. ${analysis.actions[1]?.title || "Refresh Meta creatives"} — ${analysis.actions[1]?.channel || "Paid social"}
3. ${analysis.actions[2]?.title || "Protect SERP comparisons"} — SEO + paid reinforcement

Competitor notes
${analysis.competitors
  .slice(0, 3)
  .map((c) => `• ${c.name}: ${c.positioning}`)
  .join("\n")}

Brand voice reminder
${analysis.brand.voice}
Do say: ${analysis.brand.doSay.join(" · ")}
`;
}

export function generateWeeklyReport(client: ClientWorkspace): WeeklyReport | null {
  if (!client.analysis) return null;
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    narrative: buildWeeklyNarrative(client.analysis, client.results),
    generatedAt: now,
    updatedAt: now,
    status: "draft",
  };
}

export function buildInstaReportSummary(analysis: Analysis): string {
  return `${analysis.brandName} audit — ${analysis.domain}

Market position
${analysis.summary}

Competitive landscape (${analysis.competitors.length} mapped)
${analysis.competitors.map((c) => `• ${c.name} — ${c.strength} / gap: ${c.weakness}`).join("\n")}

Quick wins
${analysis.actions.map((a, i) => `${i + 1}. ${a.title} (${a.channel})`).join("\n")}

Ad angles spotted
${analysis.ads.map((a) => `• ${a.platform}: ${a.angle} — "${a.headline}"`).join("\n")}
`;
}
