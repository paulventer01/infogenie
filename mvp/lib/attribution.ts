import { randomUUID } from "node:crypto";
import type {
  AgencyAccount,
  AttributionModel,
  AttributionTouch,
  ClientWorkspace,
  DataMode,
} from "./types";
import { canShowLiveMetrics } from "./strict-mode";

const CHANNEL_WEIGHTS: { channel: string; first: number; assist: number; last: number }[] = [
  { channel: "Meta Ads", first: 0.28, assist: 0.22, last: 0.18 },
  { channel: "Google Ads", first: 0.22, assist: 0.2, last: 0.32 },
  { channel: "Organic / GA4", first: 0.18, assist: 0.25, last: 0.12 },
  { channel: "Email", first: 0.08, assist: 0.18, last: 0.22 },
  { channel: "LinkedIn Ads", first: 0.12, assist: 0.1, last: 0.1 },
  { channel: "TikTok Ads", first: 0.12, assist: 0.05, last: 0.06 },
];

function activeChannels(client: ClientWorkspace): typeof CHANNEL_WEIGHTS {
  const connected = new Set(
    (client.integrations || [])
      .filter((i) => i.status === "connected")
      .map((i) => i.platform)
  );
  const mapped = CHANNEL_WEIGHTS.filter((c) => {
    if (c.channel === "Organic / GA4") return connected.has("GA4") || connected.size === 0;
    if (c.channel === "Email") return connected.has("Email") || connected.has("HubSpot");
    return [...connected].some((p) => c.channel.includes(p.replace(" Ads", "")) || p === c.channel);
  });
  return mapped.length >= 2 ? mapped : CHANNEL_WEIGHTS.slice(0, 4);
}

export function buildAttribution(
  client: ClientWorkspace,
  mode: DataMode,
  model: AttributionModel["model"] = "multi-touch-linear"
): AttributionModel | null {
  if (!canShowLiveMetrics(client, mode) && !client.results) {
    return null;
  }
  const results = client.results;
  if (!results) return null;

  const channels = activeChannels(client);
  const totalSpend = results.spend;
  const totalRevenue = Math.round(results.spend * results.roas);
  const conversions = results.conversions;

  const raw = channels.map((c) => {
    const share =
      model === "last-click"
        ? c.last
        : model === "first-click"
          ? c.first
          : (c.first + c.assist + c.last) / 3;
    return { ...c, share };
  });
  const sum = raw.reduce((s, r) => s + r.share, 0) || 1;

  const touches: AttributionTouch[] = raw.map((r) => {
    const sharePct = Math.round((r.share / sum) * 1000) / 10;
    const conv = Math.round((conversions * r.share) / sum);
    const revenue = Math.round((totalRevenue * r.share) / sum);
    const role: AttributionTouch["role"] =
      model === "last-click" ? "last" : model === "first-click" ? "first" : "assist";
    // Prefer dominant role by weight
    const dominant =
      r.last >= r.first && r.last >= r.assist
        ? "last"
        : r.first >= r.assist
          ? "first"
          : "assist";
    return {
      channel: r.channel,
      role: model === "multi-touch-linear" ? dominant : role,
      sharePct,
      conversions: conv,
      revenue,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    model,
    touches,
    totalSpend,
    totalRevenue,
    blendedRoas: results.roas,
    note:
      model === "multi-touch-linear"
        ? "Multi-touch linear — credit split across first, assist, and last touch. MVP uses connected-platform weights."
        : `${model} attribution — single-touch credit for renewal conversations.`,
  };
}

export function renewalTalkingPoints(client: ClientWorkspace, attr: AttributionModel): string[] {
  const top = [...attr.touches].sort((a, b) => b.revenue - a.revenue)[0];
  const name = client.analysis?.brandName || client.name;
  return [
    `${name} drove $${attr.totalRevenue.toLocaleString()} attributed revenue on $${attr.totalSpend.toLocaleString()} spend (${attr.blendedRoas}× blended ROAS).`,
    top
      ? `${top.channel} contributed ${top.sharePct}% of attributed revenue (${top.role} touch bias).`
      : "Connect more platforms for channel-level credit.",
    "Use this one-pager in renewal — activity → spend → revenue without ten dashboards.",
  ];
}

/** Hours saved estimate: ~2.5h per client report vs manual decks. */
export function estimateHoursSaved(agency: AgencyAccount): number {
  const reports = agency.clients.filter((c) => c.weeklyReport).length;
  const bulkBonus = reports >= 2 ? reports * 0.5 : 0;
  return Math.round((agency.hoursSavedReporting || 0) + reports * 2.5 + bulkBonus);
}

export function bumpHoursSaved(agency: AgencyAccount, hours: number): AgencyAccount {
  return {
    ...agency,
    hoursSavedReporting: Math.round((agency.hoursSavedReporting || 0) + hours),
  };
}

export function freshAttributionId(): string {
  return randomUUID();
}
