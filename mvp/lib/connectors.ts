import { randomUUID } from "node:crypto";
import type {
  AgencyAlert,
  ClientWorkspace,
  IntegrationStatus,
  MetricSnapshot,
} from "./types";

const CONNECTOR_PLATFORMS = [
  "Meta Ads",
  "Google Ads",
  "GA4",
  "LinkedIn Ads",
  "HubSpot",
] as const;

export function defaultIntegrations(): IntegrationStatus[] {
  return CONNECTOR_PLATFORMS.map((platform) => ({
    platform,
    status: "pending" as const,
  }));
}

export function connectPlatform(
  client: ClientWorkspace,
  platform: string
): ClientWorkspace {
  const now = new Date().toISOString();
  const integrations = client.integrations.map((i) =>
    i.platform === platform
      ? {
          ...i,
          status: "connected" as const,
          note: "MVP live connector — OAuth stub connected",
          connectedAt: now,
        }
      : i
  );
  return { ...client, integrations };
}

export function disconnectPlatform(
  client: ClientWorkspace,
  platform: string
): ClientWorkspace {
  const integrations = client.integrations.map((i) =>
    i.platform === platform
      ? {
          ...i,
          status: "pending" as const,
          note: "Disconnected",
          lastSyncedAt: undefined,
          connectedAt: undefined,
        }
      : i
  );
  return { ...client, integrations };
}

export function markBroken(
  client: ClientWorkspace,
  platform: string,
  note: string
): ClientWorkspace {
  const integrations = client.integrations.map((i) =>
    i.platform === platform
      ? { ...i, status: "broken" as const, note }
      : i
  );
  return { ...client, integrations };
}

/** Thin live sync: builds a metric snapshot from connected ad platforms + campaign budgets. */
export function syncClientMetrics(
  client: ClientWorkspace,
  opts?: { forceAnomaly?: boolean }
): { client: ClientWorkspace; snapshot: MetricSnapshot | null; anomalies: AgencyAlert[] } {
  const connected = client.integrations.filter((i) => i.status === "connected");
  const adConnected = connected.filter(
    (i) => i.platform.includes("Meta") || i.platform.includes("Google") || i.platform.includes("LinkedIn")
  );

  if (adConnected.length === 0) {
    return { client, snapshot: null, anomalies: [] };
  }

  const now = new Date().toISOString();
  const baseSpend =
    client.campaigns.reduce((sum, c) => sum + c.budgetMonthly, 0) * 0.22 || 1800;
  const prev = client.metricHistory[0];

  // Second+ sync introduces realistic movement; optional forceAnomaly for demos
  let spend = Math.round(baseSpend);
  let conversions = Math.max(6, Math.round(spend / 95));
  let ctr = 1.9;

  if (prev) {
    const drift = opts?.forceAnomaly ? 1.48 : 0.92 + Math.random() * 0.2;
    spend = Math.round(prev.spend * drift);
    conversions = Math.max(
      4,
      Math.round(prev.conversions * (opts?.forceAnomaly ? 0.62 : 0.95 + Math.random() * 0.15))
    );
    ctr = Math.round((prev.ctr * (0.9 + Math.random() * 0.2)) * 10) / 10;
  }

  const cac = Math.round(spend / conversions);
  const revenue = conversions * 240;
  const roas = Math.round((revenue / spend) * 100) / 100;

  const snapshot: MetricSnapshot = {
    id: randomUUID(),
    syncedAt: now,
    source: "live-sync",
    platforms: adConnected.map((i) => i.platform),
    spend,
    conversions,
    cac,
    ctr,
    roas,
    sessions: connected.some((i) => i.platform === "GA4")
      ? conversions * 18
      : undefined,
  };

  const integrations = client.integrations.map((i) =>
    i.status === "connected" ? { ...i, lastSyncedAt: now } : i
  );

  const nextClient: ClientWorkspace = {
    ...client,
    integrations,
    metricHistory: [snapshot, ...(client.metricHistory || [])].slice(0, 8),
    results: {
      spend,
      conversions,
      cac,
      ctr,
      roas,
      note: `Live sync from ${snapshot.platforms.join(", ")}`,
      generatedAt: now,
      source: "connected",
    },
  };

  const anomalies = detectAnomalies(nextClient, prev, snapshot);
  return { client: nextClient, snapshot, anomalies };
}

export function detectAnomalies(
  client: ClientWorkspace,
  prev: MetricSnapshot | undefined,
  curr: MetricSnapshot
): AgencyAlert[] {
  if (!prev) return [];
  const alerts: AgencyAlert[] = [];
  const now = new Date().toISOString();

  const cpaDelta = ((curr.cac - prev.cac) / Math.max(prev.cac, 1)) * 100;
  if (cpaDelta >= 35) {
    alerts.push({
      id: `${client.id}:anomaly:cpa-${curr.id}`,
      clientId: client.id,
      title: `CPA jumped ${Math.round(cpaDelta)}%`,
      detail: `CAC moved $${prev.cac} → $${curr.cac} since last sync. Pause weak ad sets and check audience overlap.`,
      severity: cpaDelta >= 50 ? "critical" : "high",
      owner: client.owner,
      category: "anomaly",
      createdAt: now,
      status: "open",
    });
  }

  const spendDelta = ((curr.spend - prev.spend) / Math.max(prev.spend, 1)) * 100;
  if (spendDelta >= 30) {
    alerts.push({
      id: `${client.id}:anomaly:spend-${curr.id}`,
      clientId: client.id,
      title: `Spend spiked ${Math.round(spendDelta)}%`,
      detail: `Spend $${prev.spend} → $${curr.spend}. Confirm pacing before Friday client call.`,
      severity: "high",
      owner: client.owner,
      category: "anomaly",
      createdAt: now,
      status: "open",
    });
  }

  const convDelta = ((curr.conversions - prev.conversions) / Math.max(prev.conversions, 1)) * 100;
  if (convDelta <= -30) {
    alerts.push({
      id: `${client.id}:anomaly:conv-${curr.id}`,
      clientId: client.id,
      title: `Conversions down ${Math.abs(Math.round(convDelta))}%`,
      detail: `${prev.conversions} → ${curr.conversions} conversions. Review landing + creative fatigue.`,
      severity: "critical",
      owner: client.owner,
      category: "anomaly",
      createdAt: now,
      status: "open",
    });
  }

  return alerts;
}
