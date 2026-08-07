"use client";

// Customer 360 — unified account view. Stitches together everything InfoGenie
// already knows about this tenant's brand + customers into one dashboard:
// Brand Foundation (ICP + positioning), Voice of Customer themes, lead
// pipeline (landing pages, link-in-bio, qualified leads), audience segments
// and brand-deal pipeline. Pure read aggregation — GET /api/customer-360/overview.

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

interface BrandSnapshot {
  has_data: boolean;
  icp_name?: string;
  icp_role?: string;
  icp_pain?: string;
  icp_dream_outcome?: string;
  positioning_statement?: string;
  purpose_why?: string;
  voice_tone_warm?: number;
  voice_tone_witty?: number;
  voice_tone_bold?: number;
  updated_at?: string | null;
}
interface VocTheme {
  kind?: string;
  label?: string;
  frequency?: number;
  sentiment_score?: number;
}
interface VocSummary {
  brand: string;
  mention_count: number;
  themes: VocTheme[];
  summary: string;
  source: string;
  created_at: string;
}
interface RecentLead {
  id: string;
  name: string;
  email: string;
  source: string;
  detail: string;
  at: string;
}
interface LeadTotals {
  landing_pages: number;
  link_in_bio: number;
  qualified: number;
  total: number;
}
interface Segment {
  id: number;
  name: string;
  member_count: number;
  enabled: boolean;
  last_evaluated_at: string | null;
}
interface BrandDeal {
  id: number;
  brand_name: string;
  status: string;
  offered_rate: number | null;
  negotiated_rate: number | null;
  currency: string;
  created_at: string;
}
interface Overview {
  ok?: boolean;
  error?: string;
  brand: BrandSnapshot;
  voice_of_customer: VocSummary | null;
  leads: {
    totals: LeadTotals;
    qualified_by_tier: Record<string, number>;
    recent: RecentLead[];
  };
  audience_segments: Segment[];
  brand_deals: BrandDeal[];
}

const KIND_COLOR: Record<string, string> = {
  praise: "#15803D",
  complaint: "#B91C1C",
  question: "#0891B2",
  feature_request: "#7C3AED",
  neutral: "#6B7280",
};

function card(children: React.ReactNode, extra?: React.CSSProperties) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 20,
        ...extra,
      }}
    >
      {children}
    </div>
  );
}

function cardTitle(icon: string, title: string, sub?: string) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: "1.02rem", fontWeight: 700 }}>
        {icon} {title}
      </h3>
      {sub && (
        <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#6B7280" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function emptyState(text: string, linkView: string, linkLabel: string) {
  return (
    <div
      style={{
        padding: "18px 14px",
        background: "#F9FAFB",
        border: "1px dashed #D1D5DB",
        borderRadius: 8,
        fontSize: "0.82rem",
        color: "#6B7280",
        textAlign: "center",
      }}
    >
      {text}
      <div style={{ marginTop: 8 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            (window as unknown as { navigateTo?: (v: string) => void }).navigateTo?.(
              linkView,
            );
          }}
          style={{ color: "#2563EB", fontWeight: 600, textDecoration: "none" }}
        >
          {linkLabel} →
        </a>
      </div>
    </div>
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
function money(v: number | null, currency: string) {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

const pillStyle = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: 999,
  fontSize: "0.7rem",
  fontWeight: 700,
  background: bg,
  color,
});

export default function Customer360() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  async function load() {
    setStatus("loading");
    const r = await apiGet<Overview>("/api/customer-360/overview");
    if (!r.ok) {
      setStatus("error");
      setErrMsg(r.error || "failed");
      return;
    }
    setData(r);
    setStatus("idle");
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Customer 360
              </div>
              <h2 className="view-title">🧭 Customer 360 (Unified Account View)</h2>
              <p className="view-sub">
                One screen for everything InfoGenie knows about your brand and
                your customers — identity, voice-of-customer themes, lead
                pipeline and audience segments, stitched from every tier.
              </p>
            </div>
            <button
              onClick={load}
              disabled={status === "loading"}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #D1D5DB",
                background: "#fff",
                fontWeight: 600,
                fontSize: "0.82rem",
                cursor: status === "loading" ? "wait" : "pointer",
              }}
            >
              {status === "loading" ? "Refreshing…" : "🔄 Refresh"}
            </button>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {status === "error" && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 10,
              padding: 14,
              marginBottom: 18,
              color: "#B91C1C",
              fontSize: "0.85rem",
            }}
          >
            ⚠️ Couldn&apos;t load Customer 360: {errMsg}
          </div>
        )}

        {status === "loading" && !data && (
          <div style={{ color: "#6B7280", fontSize: "0.9rem" }}>Loading…</div>
        )}

        {data && (
          <>
            {/* KPI strip */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 18,
              }}
            >
              {[
                { label: "Total Leads", value: data.leads.totals.total },
                { label: "Landing Page Leads", value: data.leads.totals.landing_pages },
                { label: "Link-in-Bio Leads", value: data.leads.totals.link_in_bio },
                { label: "Qualified Leads", value: data.leads.totals.qualified },
                { label: "Audience Segments", value: data.audience_segments.length },
              ].map((k) => (
                <div
                  key={k.label}
                  style={{
                    background: "linear-gradient(135deg,#111827,#1F2937)",
                    borderRadius: 12,
                    padding: "16px 14px",
                    color: "#fff",
                  }}
                >
                  <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{k.value}</div>
                  <div style={{ fontSize: "0.72rem", opacity: 0.75, marginTop: 2 }}>
                    {k.label}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.1fr 0.9fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              {/* Brand identity */}
              <div>
                {card(
                  <>
                    {cardTitle("🎯", "Brand & Ideal Customer", "From Brand Foundation")}
                    {!data.brand.has_data ? (
                      emptyState(
                        "No Brand Foundation set up yet — fill it in once and it powers this view plus landing pages, cold email and Creator Studio.",
                        "brand-foundation",
                        "Set up Brand Foundation",
                      )
                    ) : (
                      <div style={{ display: "grid", gap: 10, fontSize: "0.84rem" }}>
                        {data.brand.icp_name && (
                          <div>
                            <strong>ICP:</strong> {data.brand.icp_name}
                            {data.brand.icp_role ? ` — ${data.brand.icp_role}` : ""}
                          </div>
                        )}
                        {data.brand.icp_pain && (
                          <div>
                            <strong>Pain point:</strong> {data.brand.icp_pain}
                          </div>
                        )}
                        {data.brand.icp_dream_outcome && (
                          <div>
                            <strong>Dream outcome:</strong>{" "}
                            {data.brand.icp_dream_outcome}
                          </div>
                        )}
                        {data.brand.positioning_statement && (
                          <div>
                            <strong>Positioning:</strong>{" "}
                            {data.brand.positioning_statement}
                          </div>
                        )}
                        {data.brand.purpose_why && (
                          <div>
                            <strong>Why:</strong> {data.brand.purpose_why}
                          </div>
                        )}
                        <div style={{ color: "#9CA3AF", fontSize: "0.72rem" }}>
                          Updated {fmtDate(data.brand.updated_at)}
                        </div>
                      </div>
                    )}
                  </>,
                )}
              </div>

              {/* Voice of customer */}
              <div>
                {card(
                  <>
                    {cardTitle(
                      "🗣️",
                      "Voice of Customer",
                      data.voice_of_customer
                        ? `Latest scan — ${data.voice_of_customer.brand}`
                        : undefined,
                    )}
                    {!data.voice_of_customer ? (
                      emptyState(
                        "No VoC scan has run yet — mine recent mentions into themes with sample quotes.",
                        "voc",
                        "Run Voice of Customer Mining",
                      )
                    ) : (
                      <div>
                        {data.voice_of_customer.source === "ai_synthesized" && (
                          <div style={pillStyle("#FEF3C7", "#92400E")}>
                            AI-synthesised themes
                          </div>
                        )}
                        <p
                          style={{
                            fontSize: "0.82rem",
                            color: "#374151",
                            margin: "8px 0 10px",
                          }}
                        >
                          {data.voice_of_customer.summary || "No summary available."}
                        </p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {data.voice_of_customer.themes.map((t, i) => (
                            <span
                              key={i}
                              style={pillStyle(
                                `${KIND_COLOR[t.kind || "neutral"]}22`,
                                KIND_COLOR[t.kind || "neutral"] || "#374151",
                              )}
                            >
                              {t.label || t.kind} {t.frequency ? `(${t.frequency})` : ""}
                            </span>
                          ))}
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: "0.72rem",
                            color: "#9CA3AF",
                          }}
                        >
                          {data.voice_of_customer.mention_count} mentions analysed ·{" "}
                          {fmtDate(data.voice_of_customer.created_at)}
                        </div>
                      </div>
                    )}
                  </>,
                )}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.3fr 0.7fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              {/* Recent lead activity */}
              <div>
                {card(
                  <>
                    {cardTitle(
                      "📥",
                      "Recent Customer Activity",
                      "Newest leads across every capture channel",
                    )}
                    {data.leads.recent.length === 0 ? (
                      emptyState(
                        "No leads captured yet across landing pages, link-in-bio or the lead qualifier.",
                        "lead-gen",
                        "Open Lead Generation",
                      )
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                          <thead>
                            <tr style={{ textAlign: "left", color: "#6B7280" }}>
                              <th style={{ padding: "6px 8px" }}>Name</th>
                              <th style={{ padding: "6px 8px" }}>Email</th>
                              <th style={{ padding: "6px 8px" }}>Source</th>
                              <th style={{ padding: "6px 8px" }}>Detail</th>
                              <th style={{ padding: "6px 8px" }}>When</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.leads.recent.map((r) => (
                              <tr key={r.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.name}</td>
                                <td style={{ padding: "6px 8px" }}>{r.email || "—"}</td>
                                <td style={{ padding: "6px 8px" }}>{r.source}</td>
                                <td style={{ padding: "6px 8px", color: "#6B7280" }}>
                                  {r.detail || "—"}
                                </td>
                                <td style={{ padding: "6px 8px", color: "#9CA3AF" }}>
                                  {fmtDateTime(r.at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {Object.keys(data.leads.qualified_by_tier).length > 0 && (
                      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {Object.entries(data.leads.qualified_by_tier).map(([tier, n]) => (
                          <span key={tier} style={pillStyle("#EFF6FF", "#1D4ED8")}>
                            {tier}: {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </>,
                )}
              </div>

              {/* Audience segments */}
              <div>
                {card(
                  <>
                    {cardTitle("👥", "Audience Segments")}
                    {data.audience_segments.length === 0 ? (
                      emptyState(
                        "No dynamic audience segments defined yet.",
                        "audiences-dynamic",
                        "Build a Segment",
                      )
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {data.audience_segments.map((s) => (
                          <div
                            key={s.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: "0.82rem",
                              padding: "6px 0",
                              borderBottom: "1px solid #F3F4F6",
                            }}
                          >
                            <span>
                              {s.name}{" "}
                              {!s.enabled && (
                                <span style={{ color: "#9CA3AF" }}>(paused)</span>
                              )}
                            </span>
                            <strong>{s.member_count}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </>,
                )}
              </div>
            </div>

            {data.brand_deals.length > 0 && (
              <div>
                {card(
                  <>
                    {cardTitle("🤝", "Partnership / Brand Deal Pipeline")}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                        <thead>
                          <tr style={{ textAlign: "left", color: "#6B7280" }}>
                            <th style={{ padding: "6px 8px" }}>Brand</th>
                            <th style={{ padding: "6px 8px" }}>Status</th>
                            <th style={{ padding: "6px 8px" }}>Offered</th>
                            <th style={{ padding: "6px 8px" }}>Negotiated</th>
                            <th style={{ padding: "6px 8px" }}>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.brand_deals.map((d) => (
                            <tr key={d.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                              <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                                {d.brand_name}
                              </td>
                              <td style={{ padding: "6px 8px" }}>{d.status}</td>
                              <td style={{ padding: "6px 8px" }}>
                                {money(d.offered_rate, d.currency)}
                              </td>
                              <td style={{ padding: "6px 8px" }}>
                                {money(d.negotiated_rate, d.currency)}
                              </td>
                              <td style={{ padding: "6px 8px", color: "#9CA3AF" }}>
                                {fmtDate(d.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>,
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
