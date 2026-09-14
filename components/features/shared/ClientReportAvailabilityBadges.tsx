"use client";

import {
  CLIENT_REPORT_BADGE_STYLE,
  isPartialClientReport,
  isUnavailableClientReport,
  type ClientReportMetricMeta,
} from "@/lib/clientReportingAvailability";

export default function ClientReportAvailabilityBadges({
  meta,
}: {
  meta?: ClientReportMetricMeta | null;
}) {
  if (!meta?.availability) return null;
  const badges: { key: string; label: string; color: string; background: string }[] = [];
  if (meta.is_proxy) {
    badges.push({ key: "proxy", label: "Proxy", color: "#7C2D12", background: "#FFEDD5" });
  }
  if (isPartialClientReport(meta)) {
    badges.push({ key: "partial", label: "Partial", color: "#92400E", background: "#FEF3C7" });
  } else if (isUnavailableClientReport(meta)) {
    badges.push({ key: "unavailable", label: "Unavailable", color: "#475569", background: "#F1F5F9" });
  }
  if (!badges.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {badges.map((b) => (
        <span
          key={b.key}
          aria-label={b.label}
          style={{ ...CLIENT_REPORT_BADGE_STYLE, color: b.color, background: b.background }}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
