import type {
  AgencyAccount,
  AgencyAlert,
  Analysis,
} from "./types";

export type Recommendation = {
  id: string;
  clientId: string;
  clientName: string;
  priority: "P0" | "P1" | "P2";
  action: string;
  why: string;
  source: "anomaly" | "analysis" | "connector" | "approval" | "capacity";
  href: string;
};

function priorityFromSeverity(sev: AgencyAlert["severity"]): Recommendation["priority"] {
  if (sev === "critical") return "P0";
  if (sev === "high") return "P1";
  return "P2";
}

export function buildRecommendations(agency: AgencyAccount): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const client of agency.clients) {
    for (const alert of client.alerts || []) {
      if (alert.status !== "open") continue;
      if (alert.category === "anomaly") {
        recs.push({
          id: `rec-${alert.id}`,
          clientId: client.id,
          clientName: client.name,
          priority: priorityFromSeverity(alert.severity),
          action: alert.title.includes("CPA")
            ? "Pause bottom-quartile ad sets and refresh creative this week"
            : alert.title.includes("Spend")
              ? "Cap daily budgets and reallocate to winners"
              : "Audit landing + creative fatigue within 24h",
          why: alert.detail,
          source: "anomaly",
          href: "/connectors",
        });
      } else if (alert.category === "integration") {
        recs.push({
          id: `rec-${alert.id}`,
          clientId: client.id,
          clientName: client.name,
          priority: "P1",
          action: `Reconnect ${alert.title.replace(" connection broken", "")}`,
          why: "Broken connectors mean reports and anomaly alerts go dark — trust dies fast.",
          source: "connector",
          href: "/connectors",
        });
      } else if (alert.category === "approval") {
        recs.push({
          id: `rec-${alert.id}`,
          clientId: client.id,
          clientName: client.name,
          priority: "P2",
          action: "Chase pending client approvals today",
          why: alert.detail,
          source: "approval",
          href: "/approvals",
        });
      }
    }

    if (client.analysis) {
      for (const [idx, action] of client.analysis.actions.slice(0, 2).entries()) {
        recs.push({
          id: `rec-analysis-${client.id}-${idx}`,
          clientId: client.id,
          clientName: client.name,
          priority: idx === 0 ? "P1" : "P2",
          action: action.title,
          why: `${action.why} (${action.channel}, effort ${action.effort})`,
          source: "analysis",
          href: "/campaigns",
        });
      }
    }

    const hist = client.metricHistory || [];
    if (hist.length >= 2) {
      const [curr, prev] = hist;
      if (curr.roas < prev.roas * 0.85) {
        recs.push({
          id: `rec-roas-${client.id}-${curr.id}`,
          clientId: client.id,
          clientName: client.name,
          priority: "P0",
          action: "Shift spend to higher-ROAS channel this week",
          why: `ROAS fell ${prev.roas}× → ${curr.roas}× between syncs.`,
          source: "anomaly",
          href: "/results",
        });
      }
    }
  }

  // Capacity draining clients
  for (const client of agency.clients) {
    const hours = agency.assignments
      .filter((a) => a.clientId === client.id)
      .reduce((s, a) => s + a.hoursThisWeek, 0);
    const labor = agency.assignments
      .filter((a) => a.clientId === client.id)
      .reduce((s, a) => {
        const m = agency.team.find((t) => t.id === a.memberId);
        return s + a.hoursThisWeek * (m?.hourlyCost || 0);
      }, 0);
    const monthlyLabor = labor * 4.3;
    const retainer = client.retainerMonthly || 0;
    if (retainer > 0 && monthlyLabor / retainer > 0.8) {
      recs.push({
        id: `rec-margin-${client.id}`,
        clientId: client.id,
        clientName: client.name,
        priority: "P1",
        action: "Renegotiate scope or raise retainer",
        why: `Labor ≈ $${Math.round(monthlyLabor)} vs $${retainer} retainer — margin under pressure (${hours}h this week).`,
        source: "capacity",
        href: "/capacity",
      });
    }
  }

  const rank = { P0: 0, P1: 1, P2: 2 };
  const byId = new Map<string, Recommendation>();
  for (const r of recs) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export function brandVoiceCheck(
  body: string,
  brand: Analysis["brand"]
): { ok: boolean; hits: string[]; score: number } {
  const lower = body.toLowerCase();
  const hits = brand.dontSay.filter((phrase) => lower.includes(phrase.toLowerCase()));
  const doHits = brand.doSay.filter((phrase) => lower.includes(phrase.toLowerCase())).length;
  const score = Math.max(0, Math.min(100, 70 + doHits * 10 - hits.length * 25));
  return { ok: hits.length === 0, hits, score };
}
