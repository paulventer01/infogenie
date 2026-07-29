import { randomUUID } from "node:crypto";
import type {
  AgencyAccount,
  Analysis,
  ClientWorkspace,
  ReportSection,
  ResultsSnapshot,
  WeeklyReport,
} from "./types";
import type { DataMode } from "./types";
import { canShowLiveMetrics, getDataMode, hasConnectedAds } from "./strict-mode";

export function formatWhiteLabelExport(agency: AgencyAccount, narrative: string): string {
  const wl = agency.whiteLabel;
  const footer = wl.footerText || `Prepared by ${wl.agencyName}`;
  return `${wl.agencyName.toUpperCase()}
${"─".repeat(40)}
${footer}
${"─".repeat(40)}

${narrative}

${"─".repeat(40)}
${wl.agencyName} · Confidential
`;
}

export function gatherReportSections(
  client: ClientWorkspace,
  mode: DataMode
): ReportSection[] {
  const sections: ReportSection[] = [];

  if (!client.analysis) {
    sections.push({
      id: "executive",
      title: "Executive summary",
      status: "empty",
      body: "No analysis run — run Analyse to populate this section.",
    });
    return sections;
  }

  const a = client.analysis;
  sections.push({
    id: "executive",
    title: "Executive summary",
    status: "ok",
    body: a.summary,
  });

  if (canShowLiveMetrics(client, mode)) {
    const r = client.results!;
    sections.push({
      id: "performance",
      title: "Performance (live)",
      status: "ok",
      body: `Spend $${r.spend.toLocaleString()} · ROAS ${r.roas}× · CAC $${r.cac} · ${r.conversions} conversions · CTR ${r.ctr}%`,
    });
  } else if (mode === "demo" && client.results) {
    const r = client.results;
    sections.push({
      id: "performance",
      title: "Performance (demo scaffold)",
      status: "ok",
      body: `Spend $${r.spend.toLocaleString()} · ROAS ${r.roas}× · CAC $${r.cac} · ${r.conversions} conversions\n(Demo mode — not live platform data.)`,
    });
  } else {
    const reason = !hasConnectedAds(client)
      ? "Meta or Google Ads not connected."
      : "No live sync yet — connect credentials and pull data.";
    sections.push({
      id: "performance",
      title: "Performance",
      status: "withheld",
      body: `Data withheld in strict mode. ${reason}`,
    });
  }

  const activity =
    client.campaigns.length > 0
      ? client.campaigns
          .map((c) => `• ${c.name} (${c.channels.join(", ")}) — $${c.budgetMonthly}/mo`)
          .join("\n")
      : "No campaigns briefed this period.";
  sections.push({
    id: "activity",
    title: "Activity → outcomes",
    status: client.campaigns.length > 0 ? "ok" : "empty",
    body: activity,
  });

  sections.push({
    id: "competitors",
    title: "Competitor watch",
    status: a.competitors.length > 0 ? "ok" : "empty",
    body:
      a.competitors.length > 0
        ? a.competitors.map((c) => `• ${c.name}: ${c.positioning}`).join("\n")
        : "No competitors mapped.",
  });

  const organic = client.integrations.find((i) => i.platform.includes("GA4"));
  if (organic?.status === "connected") {
    sections.push({
      id: "organic",
      title: "Organic (GA4)",
      status: "empty",
      body: "GA4 connected — organic section populates after first sync (Phase 2).",
    });
  } else {
    sections.push({
      id: "organic",
      title: "Organic (GA4 / GSC)",
      status: "withheld",
      body: "Organic reporting withheld — GA4/GSC not connected.",
    });
  }

  sections.push({
    id: "next-week",
    title: "Focus next week",
    status: a.actions.length > 0 ? "ok" : "empty",
    body: a.actions.map((act, i) => `${i + 1}. ${act.title} — ${act.why}`).join("\n"),
  });

  return sections;
}

export function sectionsToNarrative(
  client: ClientWorkspace,
  sections: ReportSection[],
  agency: AgencyAccount
): string {
  const a = client.analysis!;
  const header = `Weekly marketing brief — ${a.brandName}\n${a.domain} · ${a.industry}\n`;
  const body = sections
    .map((s) => {
      const tag =
        s.status === "withheld"
          ? "[WITHHELD]"
          : s.status === "empty"
            ? "[EMPTY]"
            : "";
      return `${s.title}${tag ? ` ${tag}` : ""}\n${s.body}`;
    })
    .join("\n\n");
  return formatWhiteLabelExport(agency, `${header}\n${body}`);
}

export function buildWeeklyNarrative(
  analysis: Analysis,
  results: ResultsSnapshot | null,
  mode: DataMode = "strict"
): string {
  const perf = results
    ? mode === "demo" || results.source === "connected"
      ? `Spend $${results.spend.toLocaleString()} · ROAS ${results.roas}× · CAC $${results.cac} · ${results.conversions} conversions`
      : "Live metrics withheld — connect ad platforms."
    : "Connect ad platforms for live metrics — section withheld in strict mode.";

  return `Weekly marketing brief — ${analysis.brandName}
${analysis.domain} · ${analysis.industry}

Executive summary
${analysis.summary}

Performance snapshot
${perf}
${results?.source === "illustrative" ? "(Demo scaffold — not live platform data.)" : ""}

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

export function generateWeeklyReport(
  client: ClientWorkspace,
  agency: AgencyAccount
): WeeklyReport | null {
  if (!client.analysis) return null;
  const mode = getDataMode(agency);
  const sections = gatherReportSections(client, mode);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    narrative: sectionsToNarrative(client, sections, agency),
    generatedAt: now,
    updatedAt: now,
    status: "draft",
  };
}

export function generateAllClientReports(agency: AgencyAccount): AgencyAccount {
  const mode = getDataMode(agency);
  const clients = agency.clients.map((client) => {
    if (!client.analysis) return client;
    const sections = gatherReportSections(client, mode);
    const now = new Date().toISOString();
    const report: WeeklyReport = {
      id: randomUUID(),
      narrative: sectionsToNarrative(client, sections, agency),
      generatedAt: now,
      updatedAt: now,
      status: "draft",
    };
    return { ...client, weeklyReport: report };
  });
  return { ...agency, clients };
}

export function buildInstaReportSummary(analysis: Analysis, agency?: AgencyAccount): string {
  const body = `${analysis.brandName} audit — ${analysis.domain}

Market position
${analysis.summary}

Competitive landscape (${analysis.competitors.length} mapped)
${analysis.competitors.map((c) => `• ${c.name} — ${c.strength} / gap: ${c.weakness}`).join("\n")}

Quick wins
${analysis.actions.map((a, i) => `${i + 1}. ${a.title} (${a.channel})`).join("\n")}

Ad angles spotted
${analysis.ads.map((a) => `• ${a.platform}: ${a.angle} — "${a.headline}"`).join("\n")}
`;
  return agency ? formatWhiteLabelExport(agency, body) : body;
}
