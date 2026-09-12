/**
 * Shared UI helpers for canonical metric availability metadata (PR10G.3).
 * Mirrors services/canonical_metrics/consumer.js display rules for React panels.
 */

export type MetricAvailability = "available" | "unavailable" | "partial" | string;

export interface MetricAvailabilityMeta {
  metric_availability?: MetricAvailability | null;
  metric_availability_reason?: string | null;
  metric_is_proxy?: boolean | null;
}

const SAFE_REASONS = new Set([
  "database_unavailable",
  "source_query_failed",
  "input_unavailable",
  "no_data",
  "not_configured",
]);

export function safeAvailabilityReason(reason?: string | null): string {
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

export function hasCanonicalAvailability(meta?: MetricAvailabilityMeta | null): boolean {
  return Boolean(meta?.metric_availability);
}

export function isUnavailableCanonical(meta?: MetricAvailabilityMeta | null): boolean {
  return meta?.metric_availability === "unavailable";
}

export function isPartialCanonical(meta?: MetricAvailabilityMeta | null): boolean {
  return meta?.metric_availability === "partial";
}

export function formatMetricValue(
  value: number | string | null | undefined,
  unit: string,
  meta?: MetricAvailabilityMeta | null,
): string {
  const availability = meta?.metric_availability;
  const reason = safeAvailabilityReason(meta?.metric_availability_reason);

  if (availability === "unavailable") {
    return `Unavailable (${reason})`;
  }

  if (value == null || value === "") {
    if (availability === "partial") return `Partial (${reason})`;
    return "—";
  }

  const n = Number(value);
  if (!Number.isFinite(n)) {
    if (availability === "partial") return `Partial (${reason})`;
    return "—";
  }

  let base: string;
  if (unit === "$") {
    base = "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } else if (unit === "%") {
    base = n.toFixed(1) + "%";
  } else if (unit === "x") {
    base = `${n}x`;
  } else {
    base = n.toLocaleString();
  }

  return base;
}

export function progressPctFromValues(
  current: number | string | null | undefined,
  target: number | string | null | undefined,
  meta?: MetricAvailabilityMeta | null,
): number | null {
  if (isUnavailableCanonical(meta)) return null;
  const cur = Number(current);
  const tgt = Number(target);
  if (!Number.isFinite(tgt) || tgt <= 0) return null;
  if (!Number.isFinite(cur)) return null;
  return Math.min(100, Math.round((cur / tgt) * 100));
}

export function progressLabel(pct: number | null, meta?: MetricAvailabilityMeta | null): string {
  if (pct == null) return "—";
  if (isPartialCanonical(meta)) return `${pct}% (Partial)`;
  return `${pct}%`;
}

export function mergeMetricAvailability<T extends MetricAvailabilityMeta>(
  existing: T,
  incoming?: MetricAvailabilityMeta | null,
): T {
  if (!incoming || !hasCanonicalAvailability(incoming)) return existing;
  return {
    ...existing,
    metric_availability: incoming.metric_availability ?? existing.metric_availability ?? null,
    metric_availability_reason:
      incoming.metric_availability_reason ?? existing.metric_availability_reason ?? null,
    metric_is_proxy: incoming.metric_is_proxy ?? existing.metric_is_proxy ?? false,
  };
}

export const BADGE_STYLE: Record<string, string | number> = {
  fontSize: 9,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderRadius: 999,
  padding: "1px 6px",
  lineHeight: 1.4,
};
