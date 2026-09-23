import type { AgencyAccount, ClientWorkspace } from "./types";

export type RagStatus = "red" | "amber" | "green";

export type ClientStatusRow = {
  clientId: string;
  name: string;
  owner: string;
  domain?: string;
  rag: RagStatus;
  ragLabel: string;
  openAlerts: number;
  lastReportDate: string | null;
  lastReportStatus: string | null;
  spendSignal: string | null;
  connectedChannels: number;
};

export function computeRag(client: ClientWorkspace): { rag: RagStatus; label: string } {
  const open = client.alerts.filter((a) => a.status === "open");
  const critical = open.some((a) => a.severity === "critical");
  const high = open.some((a) => a.severity === "high");
  const broken = client.integrations.some((i) => i.status === "broken");

  if (critical || broken) return { rag: "red", label: "Needs attention" };
  if (high || open.length > 0 || !client.analysis) return { rag: "amber", label: "Watch" };
  return { rag: "green", label: "On track" };
}

export function spendAnomaly(client: ClientWorkspace): string | null {
  const highBudget = client.campaigns.find((c) => c.budgetMonthly > 5000);
  if (highBudget) {
    return `Spend pacing high — $${highBudget.budgetMonthly.toLocaleString()}/mo budget`;
  }
  if (client.results && client.results.spend > 4000) {
    return `Spend $${client.results.spend.toLocaleString()} — review pacing`;
  }
  return null;
}

export function buildClientStatusRow(client: ClientWorkspace): ClientStatusRow {
  const { rag, label } = computeRag(client);
  const report = client.weeklyReport;
  return {
    clientId: client.id,
    name: client.name,
    owner: client.owner,
    domain: client.domain,
    rag,
    ragLabel: label,
    openAlerts: client.alerts.filter((a) => a.status === "open").length,
    lastReportDate: report?.updatedAt || report?.generatedAt || null,
    lastReportStatus: report?.status || null,
    spendSignal: spendAnomaly(client),
    connectedChannels: client.integrations.filter((i) => i.status === "connected").length,
  };
}

export function allClientStatuses(agency: AgencyAccount): ClientStatusRow[] {
  return agency.clients.map(buildClientStatusRow);
}
