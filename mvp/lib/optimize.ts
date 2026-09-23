import { randomUUID } from "node:crypto";
import type { ClientWorkspace, OptimizationSuggestion } from "./types";

export function generateOptimizations(client: ClientWorkspace): OptimizationSuggestion[] {
  const now = new Date().toISOString();
  const suggestions: OptimizationSuggestion[] = [];
  const latest = client.metricHistory?.[0];
  const prev = client.metricHistory?.[1];
  const campaigns = client.campaigns || [];

  if (latest && prev && latest.cac > prev.cac * 1.25) {
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: latest.platforms[0] || "Meta Ads",
      action: "decrease_budget",
      title: "Cut spend 20% on underperforming ad sets",
      why: `CAC rose $${prev.cac} → $${latest.cac}. Cap weak sets before Friday.`,
      deltaPct: -20,
      status: "proposed",
      createdAt: now,
    });
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: latest.platforms[0] || "Meta Ads",
      action: "lower_bid",
      title: "Lower target CPA bid 15%",
      why: "Bid pressure likely inflating auction costs — test a lower ceiling for 48h.",
      deltaPct: -15,
      status: "proposed",
      createdAt: now,
    });
  }

  if (latest && prev && latest.roas > prev.roas * 1.15) {
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: latest.platforms.find((p) => p.includes("Google") || p.includes("Meta")) || "Google Ads",
      action: "increase_budget",
      title: "Increase budget 25% on winning channel",
      why: `ROAS improved ${prev.roas}× → ${latest.roas}×. Scale before competitors catch the angle.`,
      deltaPct: 25,
      status: "proposed",
      createdAt: now,
    });
  }

  if (latest && prev && latest.conversions < prev.conversions * 0.7) {
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: "Meta Ads",
      action: "pause",
      title: "Pause bottom-quartile creatives",
      why: `Conversions dropped ${prev.conversions} → ${latest.conversions}. Stop fatigue bleed.`,
      deltaPct: -100,
      status: "proposed",
      createdAt: now,
    });
  }

  // Always seed at least one constructive suggestion from campaigns
  if (suggestions.length === 0 && campaigns[0]) {
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: campaigns[0].channels[0] || "Meta Ads",
      action: "raise_bid",
      title: `Raise bids 10% on ${campaigns[0].name}`,
      why: "Impression share likely capped — modest bid lift to reclaim auction position.",
      deltaPct: 10,
      status: "proposed",
      createdAt: now,
    });
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: campaigns[0].channels[0] || "Google Ads",
      action: "increase_budget",
      title: "Reallocate 15% budget to top ROAS channel",
      why: "AI recommendation from latest sync — shift from lagging to winning channel.",
      deltaPct: 15,
      status: "proposed",
      createdAt: now,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: randomUUID(),
      clientId: client.id,
      channel: "Google Ads",
      action: "decrease_budget",
      title: "Hold daily budgets flat pending sync",
      why: "No metric history yet — connect & sync ads, then regenerate optimizations.",
      deltaPct: 0,
      status: "proposed",
      createdAt: now,
    });
  }

  return suggestions.slice(0, 6);
}

export function applyOptimization(
  client: ClientWorkspace,
  suggestionId: string
): ClientWorkspace {
  const opt = (client.optimizations || []).find((o) => o.id === suggestionId);
  if (!opt || opt.status !== "proposed") return client;

  const campaigns = client.campaigns.map((c, idx) => {
    if (idx !== 0) return c;
    const factor = 1 + opt.deltaPct / 100;
    if (opt.action === "pause") {
      return { ...c, status: "draft" as const, name: `${c.name} (paused by AI)` };
    }
    if (opt.action === "increase_budget" || opt.action === "decrease_budget") {
      return {
        ...c,
        budgetMonthly: Math.max(500, Math.round(c.budgetMonthly * Math.max(factor, 0.5))),
      };
    }
    return c;
  });

  return {
    ...client,
    campaigns,
    optimizations: (client.optimizations || []).map((o) =>
      o.id === suggestionId ? { ...o, status: "applied" as const } : o
    ),
  };
}
