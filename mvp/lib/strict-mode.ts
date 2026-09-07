import type { AgencyAccount, ClientWorkspace, ResultsSnapshot, DataMode } from "./types";

export type { DataMode } from "./types";

export function getDataMode(agency: AgencyAccount): DataMode {
  return agency.dataMode || "strict";
}

export function hasConnectedAds(client: ClientWorkspace): boolean {
  return client.integrations.some(
    (i) =>
      i.status === "connected" &&
      (i.platform.includes("Meta") || i.platform.includes("Google"))
  );
}

export function canShowLiveMetrics(client: ClientWorkspace, mode: DataMode): boolean {
  if (mode === "demo" && client.results) return true;
  return hasConnectedAds(client) && client.results?.source === "connected";
}

export function withholdReason(client: ClientWorkspace, mode: DataMode): string {
  if (mode === "demo") return "";
  if (!hasConnectedAds(client)) {
    return "Meta or Google Ads not connected — metrics withheld in strict mode.";
  }
  if (!client.results || client.results.source !== "connected") {
    return "No live campaign data synced yet — connect integrations and refresh.";
  }
  return "";
}

export function allowIllustrativeResults(mode: DataMode): boolean {
  return mode === "demo";
}

export function sanitizeResultsForDisplay(
  results: ResultsSnapshot | null,
  client: ClientWorkspace,
  mode: DataMode
): ResultsSnapshot | null {
  if (!results) return null;
  if (mode === "strict" && results.source !== "connected") return null;
  return results;
}
