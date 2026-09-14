import { apiGet, type ApiResult } from "@/lib/api";
import { ADMIN_API, PORTAL_API } from "@/lib/clientReportingPortal";

export type DrilldownColumn = { key: string; label: string };
export type DrilldownRecord = Record<string, string | number | boolean | null>;
export type DrilldownPeriod = {
  key: string;
  label: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
};

export type DrilldownResponse = ApiResult & {
  metric?: string;
  metric_label?: string;
  source?: "search-intel" | "campaigns";
  currency?: string | null;
  period?: DrilldownPeriod;
  live_notice?: string;
  total_count?: number;
  page_count?: number;
  records?: DrilldownRecord[];
  columns?: DrilldownColumn[];
  has_more?: boolean;
  next_cursor?: number | null;
};

export type DrilldownTarget = {
  metricKey: string;
  currency: string | null;
  startDate?: string;
  endDate?: string;
};

export type DrilldownRowMeta = {
  metric_key: string;
  currency: string | null;
  drillable: boolean;
};

const SCALAR_KEYS = new Set([
  "runs", "successful_runs", "brand_mentions",
  "performance_rows", "spend", "impressions", "clicks", "conversions", "revenue",
]);

export function isScalarMetric(key: string): boolean {
  return SCALAR_KEYS.has(key);
}

export function unsupportedDrilldownLabel(reason: string | null | undefined): string {
  if (reason === "list_metric") return "This metric already lists contributing records in the report and does not support drilldown.";
  if (reason === "unsupported_metric") return "Drilldown is not available for this metric.";
  return "Drilldown is not available.";
}

export function validDrilldown(value: unknown): value is DrilldownResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as DrilldownResponse;
  return row.ok === true && typeof row.metric === "string" && typeof row.metric_label === "string"
    && typeof row.total_count === "number" && Number.isFinite(row.total_count)
    && Array.isArray(row.records) && Array.isArray(row.columns)
    && row.columns.every((column) => typeof column.key === "string" && typeof column.label === "string")
    && typeof row.live_notice === "string" && !!row.period && typeof row.period.timezone === "string";
}

function queryString(target: DrilldownTarget, cursor = 0, limit = 50): string {
  const params = new URLSearchParams({ cursor: String(cursor), limit: String(limit) });
  if (target.currency) params.set("currency", target.currency);
  if (target.startDate && target.endDate) {
    params.set("start_date", target.startDate);
    params.set("end_date", target.endDate);
  }
  return params.toString();
}

export async function fetchAdminDrilldown(clientId: number, target: DrilldownTarget, cursor = 0, limit = 50): Promise<DrilldownResponse> {
  const qs = queryString(target, cursor, limit);
  return apiGet<DrilldownResponse>(`${ADMIN_API}/${clientId}/metric-drilldown/${target.metricKey}?${qs}`);
}

export async function fetchPortalDrilldown(target: DrilldownTarget, cursor = 0, limit = 50): Promise<DrilldownResponse> {
  const qs = queryString(target, cursor, limit);
  return apiGet<DrilldownResponse>(`${PORTAL_API}/metric-drilldown/${target.metricKey}?${qs}`);
}

export function formatDrilldownCell(value: DrilldownRecord[string]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
