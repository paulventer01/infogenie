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

/** Recognized canonical auto metrics that must carry availability metadata. */
export function isCanonicalAutoKr(kr: { metric_type?: string; linked_channel?: string | null }): boolean {
  return kr.metric_type === "roas" && !kr.linked_channel;
}

export function carriesCanonicalMetadata(meta?: MetricAvailabilityMeta | null): boolean {
  if (!meta) return false;
  return (
    "metric_availability" in meta ||
    "metric_availability_reason" in meta ||
    "metric_is_proxy" in meta
  );
}

/** Missing or unavailable canonical metadata is unverified — not verified zero. */
export function isUnverifiedCanonical(
  meta?: MetricAvailabilityMeta | null,
  recognized = true,
): boolean {
  if (!recognized) return false;
  if (!carriesCanonicalMetadata(meta)) return true;
  const avail = meta?.metric_availability;
  return !avail || avail === "unavailable";
}

export function coerceMetricNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatMetricTarget(
  value: number | string | null | undefined,
  unit: string,
): string {
  const n = coerceMetricNumber(value);
  if (n == null) return "—";
  if (unit === "$") return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (unit === "%") return n.toFixed(1) + "%";
  if (unit === "x") return `${n}x`;
  return n.toLocaleString();
}

export function formatMetricValue(
  value: number | string | null | undefined,
  unit: string,
  meta?: MetricAvailabilityMeta | null,
  recognizedCanonical = Boolean(meta && carriesCanonicalMetadata(meta)),
): string {
  const availability = meta?.metric_availability;
  const reason = safeAvailabilityReason(meta?.metric_availability_reason);

  if (recognizedCanonical && isUnverifiedCanonical(meta, true)) {
    return `Unavailable (${reason})`;
  }

  if (availability === "unavailable") {
    return `Unavailable (${reason})`;
  }

  const n = coerceMetricNumber(value);
  if (n == null) {
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
  recognizedCanonical = Boolean(meta && carriesCanonicalMetadata(meta)),
): number | null {
  if (recognizedCanonical && isUnverifiedCanonical(meta, true)) return null;
  if (isUnavailableCanonical(meta)) return null;
  const cur = coerceMetricNumber(current);
  const tgt = coerceMetricNumber(target);
  if (tgt == null || tgt <= 0) return null;
  if (cur == null) return null;
  return Math.min(100, Math.round((cur / tgt) * 100));
}

export function progressLabel(pct: number | null, meta?: MetricAvailabilityMeta | null): string {
  if (pct == null) return "—";
  if (isPartialCanonical(meta)) return `${pct}% (Partial)`;
  return `${pct}%`;
}

export interface ObjectiveSummaryInput {
  status: string;
  key_results: Array<{
    metric_type: string;
    linked_channel?: string | null;
    target_value: number;
    current_value: number | null;
    metric_availability?: MetricAvailability | null;
    metric_availability_reason?: string | null;
    metric_is_proxy?: boolean | null;
  }>;
}

export interface ObjectiveSummary {
  statusKey: string;
  statusLabel: string;
  statusIcon: string;
  statusColor: string;
  statusBg: string;
  avgPct: number | null;
  avgLabel: string;
}

function manualKrProgress(kr: ObjectiveSummaryInput["key_results"][number]): number | null {
  const cur = coerceMetricNumber(kr.current_value);
  const tgt = coerceMetricNumber(kr.target_value);
  if (tgt == null || tgt <= 0 || cur == null) return null;
  return Math.min(100, Math.round((cur / tgt) * 100));
}

function autoKrProgress(kr: ObjectiveSummaryInput["key_results"][number]): number | null {
  const recognized = isCanonicalAutoKr(kr);
  if (recognized && isUnverifiedCanonical(kr, true)) return null;
  return progressPctFromValues(kr.current_value, kr.target_value, kr, recognized);
}

export function summarizeObjective(obj: ObjectiveSummaryInput): ObjectiveSummary {
  const krs = obj.key_results || [];
  const complete: ObjectiveSummary = {
    statusKey: "complete",
    statusLabel: "Complete",
    statusIcon: "✅",
    statusColor: "#1d4ed8",
    statusBg: "#eff6ff",
    avgPct: null,
    avgLabel: "—",
  };
  if (obj.status === "complete") return complete;

  const unverified: ObjectiveSummary = {
    statusKey: "unverified",
    statusLabel: "Unverified",
    statusIcon: "❔",
    statusColor: "#475569",
    statusBg: "#f1f5f9",
    avgPct: null,
    avgLabel: "—",
  };

  const statusMap: Record<string, ObjectiveSummary> = {
    on_track: { statusKey: "on_track", statusLabel: "On Track", statusIcon: "🟢", statusColor: "#15803d", statusBg: "#dcfce7", avgPct: null, avgLabel: "—" },
    at_risk: { statusKey: "at_risk", statusLabel: "At Risk", statusIcon: "🟡", statusColor: "#92400e", statusBg: "#fef9c3", avgPct: null, avgLabel: "—" },
    off_track: { statusKey: "off_track", statusLabel: "Off Track", statusIcon: "🔴", statusColor: "#b91c1c", statusBg: "#fee2e2", avgPct: null, avgLabel: "—" },
    unverified,
  };

  const hasPartial = krs.some((kr) => isPartialCanonical(kr));
  const excludedUnavailable = krs.filter(
    (kr) => isCanonicalAutoKr(kr) && isUnverifiedCanonical(kr, true),
  ).length;
  const pcts = krs
    .map((kr) => (kr.metric_type === "manual" ? manualKrProgress(kr) : autoKrProgress(kr)))
    .filter((p): p is number => p != null);

  const avgPct = pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : null;
  let avgLabel = avgPct == null ? "—" : `${avgPct}%`;
  if (avgPct != null) {
    if (hasPartial) avgLabel = `${avgPct}% (Partial)`;
    else if (excludedUnavailable > 0) avgLabel = `${avgPct}% (Incomplete)`;
  }

  if (krs.length > 0 && pcts.length === 0) {
    return { ...unverified, avgLabel };
  }

  const cannotVerifyStored =
    excludedUnavailable > 0 ||
    krs.some((kr) => isCanonicalAutoKr(kr) && isUnverifiedCanonical(kr, true));

  if (cannotVerifyStored) {
    return { ...unverified, avgPct, avgLabel };
  }

  const verified = statusMap[obj.status] || statusMap.on_track;
  return { ...verified, avgPct, avgLabel };
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
