import type { AgencyAccount, AgencyAlert, ClientWorkspace } from "./types";

const SEVERITY_RANK: Record<AgencyAlert["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortAlerts(alerts: AgencyAlert[]): AgencyAlert[] {
  return [...alerts].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function alertId(clientId: string, category: string, key: string): string {
  return `${clientId}:${category}:${key}`;
}

export function deriveClientAlerts(client: ClientWorkspace): AgencyAlert[] {
  const alerts: AgencyAlert[] = [];
  const now = new Date().toISOString();

  for (const integration of client.integrations) {
    if (integration.status === "broken") {
      alerts.push({
        id: alertId(client.id, "integration", integration.platform),
        clientId: client.id,
        title: `${integration.platform} connection broken`,
        detail: integration.note || "Reconnect OAuth to restore reporting and alerts.",
        severity: "high",
        owner: client.owner,
        category: "integration",
        createdAt: now,
        status: "open",
      });
    }
  }

  if (!client.analysis) {
    alerts.push({
      id: alertId(client.id, "reporting", "no-analysis"),
      clientId: client.id,
      title: "No analysis run yet",
      detail: "Run Analyse to unlock competitors, brand foundation, and weekly reports.",
      severity: "medium",
      owner: client.owner,
      category: "reporting",
      createdAt: now,
      status: "open",
    });
  }

  if (client.results && client.results.source === "connected" && client.results.cac > 120) {
    alerts.push({
      id: alertId(client.id, "cpa", "above-target"),
      clientId: client.id,
      title: "CPA above target",
      detail: `CAC at $${client.results.cac} — review creative and audience overlap.`,
      severity: "critical",
      owner: client.owner,
      category: "cpa",
      createdAt: now,
      status: "open",
    });
  }

  if (client.campaigns.some((c) => c.budgetMonthly > 5000)) {
    alerts.push({
      id: alertId(client.id, "spend", "pacing-high"),
      clientId: client.id,
      title: "Spend pacing high",
      detail: "Monthly budget exceeds $5k — confirm pacing with client before Friday.",
      severity: "high",
      owner: client.owner,
      category: "spend",
      createdAt: now,
      status: "open",
    });
  }

  if (client.analysis && !client.weeklyReport) {
    alerts.push({
      id: alertId(client.id, "deadline", "weekly-report"),
      clientId: client.id,
      title: "Weekly report not generated",
      detail: "Client expects Friday delivery — generate and edit narrative in Reports.",
      severity: "medium",
      owner: client.owner,
      category: "deadline",
      createdAt: now,
      status: "open",
    });
  }

  return alerts;
}

export function refreshAgencyAlerts(agency: AgencyAccount): AgencyAccount {
  const clients = agency.clients.map((client) => {
    const acknowledged = new Set(client.acknowledgedAlertIds || []);
    const derived = deriveClientAlerts(client).filter((a) => !acknowledged.has(a.id));
    return { ...client, alerts: derived };
  });
  return { ...agency, clients };
}

export function allAgencyAlerts(agency: AgencyAccount): (AgencyAlert & { clientName: string })[] {
  const merged = agency.clients.flatMap((c) =>
    c.alerts.map((a) => ({ ...a, clientName: c.name }))
  );
  return sortAlerts(merged) as (AgencyAlert & { clientName: string })[];
}

export function severityLabel(severity: AgencyAlert["severity"]): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
