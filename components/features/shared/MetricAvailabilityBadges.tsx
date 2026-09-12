"use client";

import {
  BADGE_STYLE,
  isPartialCanonical,
  isUnavailableCanonical,
  type MetricAvailabilityMeta,
} from "@/lib/metricAvailability";

export default function MetricAvailabilityBadges({
  meta,
}: {
  meta?: MetricAvailabilityMeta | null;
}) {
  if (!meta) return null;
  const badges: { key: string; label: string; color: string; background: string }[] = [];
  if (meta.metric_is_proxy) {
    badges.push({ key: "proxy", label: "Proxy", color: "#7C2D12", background: "#FFEDD5" });
  }
  if (isPartialCanonical(meta)) {
    badges.push({ key: "partial", label: "Partial", color: "#92400E", background: "#FEF3C7" });
  } else if (isUnavailableCanonical(meta)) {
    badges.push({ key: "unavailable", label: "Unavailable", color: "#475569", background: "#F1F5F9" });
  }
  if (!badges.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", marginLeft: 6 }}>
      {badges.map((b) => (
        <span
          key={b.key}
          aria-label={b.label}
          style={{ ...BADGE_STYLE, color: b.color, background: b.background }}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
