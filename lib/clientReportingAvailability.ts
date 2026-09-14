/**
 * PR10G.6 — shared client report metric availability helpers for React panels.
 */

export type ClientReportAvailability = "available" | "unavailable" | "partial" | string;

export interface ClientReportMetricMeta {
  metric_key?: string;
  currency?: string | null;
  value?: number | string | null;
  availability?: ClientReportAvailability | null;
  availability_reason?: string | null;
  is_proxy?: boolean | null;
}

const SAFE_REASONS = new Set([
  "database_unavailable",
  "source_query_failed",
  "input_unavailable",
  "input_partial",
  "no_data",
  "not_configured",
]);

export function safeClientReportReason(reason?: string | null): string {
  if (!reason) return "unavailable";
  if (SAFE_REASONS.has(reason)) return reason.replace(/_/g, " ");
  if (reason.startsWith("input_unavailable:") || reason.startsWith("source_query_failed:")) {
    return reason.replace(/_/g, " ");
  }
  if (/error|exception|ECONN|relation|syntax|password|pg_/i.test(reason)) {
    return "source query failed";
  }
  return reason.replace(/_/g, " ").slice(0, 80);
}

export function hasClientReportAvailability(meta?: ClientReportMetricMeta | null): boolean {
  return Boolean(meta?.availability);
}

export function isUnavailableClientReport(meta?: ClientReportMetricMeta | null): boolean {
  return meta?.availability === "unavailable";
}

export function isPartialClientReport(meta?: ClientReportMetricMeta | null): boolean {
  return meta?.availability === "partial";
}

export function isUnverifiedClientReport(meta?: ClientReportMetricMeta | null): boolean {
  const avail = meta?.availability;
  return !avail || avail === "unavailable";
}

export function formatClientReportValue(meta?: ClientReportMetricMeta | null): string {
  const reason = safeClientReportReason(meta?.availability_reason);
  if (isUnavailableClientReport(meta)) return `Unavailable (${reason})`;
  if (meta?.value == null) {
    if (isPartialClientReport(meta)) return `Partial (${reason})`;
    return "—";
  }
  const numeric = typeof meta.value === "number"
    ? (Number.isInteger(meta.value)
      ? meta.value.toLocaleString()
      : meta.value.toLocaleString(undefined, { maximumFractionDigits: 2 }))
    : String(meta.value);
  const tags: string[] = [];
  if (meta?.is_proxy) tags.push("Proxy");
  if (isPartialClientReport(meta)) tags.push(`Partial (${reason})`);
  return tags.length ? `${numeric} · ${tags.join(" · ")}` : numeric;
}

export function clientReportCellDisplay(
  cell: string | number | null | undefined,
  meta?: ClientReportMetricMeta | null,
): string {
  if (meta && hasClientReportAvailability(meta)) return formatClientReportValue(meta);
  if (cell === null || cell === undefined) return "—";
  return String(cell);
}

export const CLIENT_REPORT_BADGE_STYLE: Record<string, string | number> = {
  fontSize: 9,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderRadius: 999,
  padding: "1px 6px",
  lineHeight: 1.4,
};
