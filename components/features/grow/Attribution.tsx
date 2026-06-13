"use client";

// Native React port of the legacy `attribution` panel (was `buildAttribution`
// / `loadAttribution` / `loadAttributionCohorts` / `loadAttributionForecast` in
// public/js/ig_attribution_scorer.js + `#view-attribution` in index.html).
// Unifies Meta + Google + TikTok ad spend with Amplitude/PostHog conversions
// across an attribution model, plus weekly cohorts and a 30-day forecast, from
// the existing Express API (`GET /api/attribution/overview|cohorts|forecast`)
// via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

type Tab = "channels" | "cohorts" | "forecast";
type ChannelKey = "meta" | "google" | "tiktok";

interface ChannelStats {
  ok: boolean;
  error?: string;
  spend?: number;
  revenue?: number;
  roas?: number | null;
  roi?: number | null;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  cpa?: number | null;
  ctr?: number | null;
  cpc?: number | null;
  weight?: number | null;
  modelAdjusted?: boolean;
}
interface OverviewData {
  ok: boolean;
  error?: string;
  days: number;
  attributionModel: string;
  conversionSource: string;
  aov: number;
  totals: {
    spend?: number;
    conversions?: number;
    revenue?: number;
    blendedROAS?: number | null;
    blendedCAC?: number | null;
    blendedROI?: number | null;
  };
  channels: Partial<Record<ChannelKey, ChannelStats>>;
  insight?: {
    winner?: { channel: string; roas?: number | null; roi?: number };
    loser?: { channel: string; roas?: number | null; roi?: number };
  };
  generatedAt: string;
}

interface CohortWeek {
  week: string;
  weekStart: string;
  spend: number;
  conversions: number;
  revenue: number;
  roas?: number | null;
  cac?: number | null;
  channels: Record<ChannelKey, { spend: number }>;
}
interface CohortData {
  ok: boolean;
  error?: string;
  days: number;
  conversionSource: string;
  weeks?: CohortWeek[];
  channelStatus?: Record<string, boolean>;
  trend?: {
    spendDelta?: number | null;
    conversionsDelta?: number | null;
    roasDelta?: number | null;
    cacDelta?: number | null;
  };
  generatedAt: string;
}

interface ForecastPoint {
  date: string;
  spend: number;
  conversions: number;
}
interface ForecastData {
  ok: boolean;
  error?: string;
  warning?: string;
  days: number;
  conversionSource: string;
  aov: number;
  summary?: {
    avgDailySpend?: number;
    trendDirection?: string;
    avgDailyConversions?: number;
    conversionsTrend?: string;
    projSpend?: number;
    projConversions?: number;
    projRevenue?: number;
    projROAS?: number | null;
    projCAC?: number | null;
  };
  actual: ForecastPoint[];
  forecast: ForecastPoint[];
  generatedAt: string;
}

const CHANNEL_DEFS: {
  key: ChannelKey;
  name: string;
  color: string;
  bg: string;
  icon: string;
}[] = [
  { key: "meta", name: "Meta Ads", color: "#1877F2", bg: "#EFF6FF", icon: "📘" },
  { key: "google", name: "Google Ads", color: "#4285F4", bg: "#F0F7FF", icon: "🔵" },
  { key: "tiktok", name: "TikTok Ads", color: "#0F172A", bg: "#F1F5F9", icon: "⚫" },
];
const COHORT_DEFS: { key: ChannelKey; color: string; name: string }[] = [
  { key: "meta", color: "#1877F2", name: "Meta" },
  { key: "google", color: "#4285F4", name: "Google" },
  { key: "tiktok", color: "#0F172A", name: "TikTok" },
];
const MODEL_LABELS: Record<string, string> = {
  "last-click": "Last-Click",
  linear: "Linear",
  "time-decay": "Time-Decay",
  "position-based": "Position-Based",
};

const fmtMoney = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtNum = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toFixed(1) + "%";
const fmt$0 = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtN0 = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function ErrorBox({ title, msg }: { title: string; msg: string }) {
  return (
    <div
      style={{
        background: "#FEF2F2",
        border: "1px solid #FECACA",
        borderRadius: 14,
        padding: 24,
        color: "#991B1B",
      }}
    >
      <b>{title}</b>
      <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{msg}</div>
    </div>
  );
}
function Loading({ msg }: { msg: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: 64,
        color: "#64748B",
        fontWeight: 600,
      }}
    >
      ⏳ {msg}
    </div>
  );
}

function ChannelsView({ j }: { j: OverviewData }) {
  const t = j.totals || {};
  const okCount = CHANNEL_DEFS.filter((d) => j.channels?.[d.key]?.ok).length;
  const modelLabel = MODEL_LABELS[j.attributionModel] || "Last-Click";
  const insight = j.insight || {};
  const heroMetric = (label: string, value: string, color?: string) => (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          opacity: 0.75,
          textTransform: "uppercase",
          letterSpacing: ".5px",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.85rem",
          fontWeight: 900,
          marginTop: 4,
          ...(color ? { color } : {}),
        }}
      >
        {value}
      </div>
    </div>
  );
  const cellLabel: React.CSSProperties = {
    color: "#64748B",
    fontSize: "0.68rem",
    textTransform: "uppercase",
    fontWeight: 700,
  };
  const cellVal: React.CSSProperties = { fontWeight: 700, color: "#0A1628" };

  // allocation bar / legend
  const liveDefs = CHANNEL_DEFS.filter((d) => j.channels?.[d.key]?.ok);
  const spend = t.spend || 0;

  // warnings
  const missing = CHANNEL_DEFS.filter((d) => !j.channels?.[d.key]?.ok);
  const showWarnings =
    missing.length > 0 || (j.aov === 0 && (t.revenue || 0) === 0);
  const warnItems: React.ReactNode[] = [];
  if (missing.length)
    warnItems.push(
      <li key="missing">
        {missing.map((m) => m.name).join(", ")} not connected — settings →
        integrations to wire them up.
      </li>,
    );
  if (j.aov === 0 && (t.revenue || 0) === 0)
    warnItems.push(
      <li key="aov">
        No revenue detected from Meta action_values. Enter your{" "}
        <b>average order value</b> in the toolbar to estimate ROAS from
        conversions.
      </li>,
    );
  if (j.conversionSource !== "amplitude")
    warnItems.push(
      <li key="src">
        Using ad-platform-reported conversions. Configure <b>Amplitude</b>{" "}
        conversion events for ground-truth measurement.
      </li>,
    );

  const showRec =
    insight.winner &&
    insight.loser &&
    insight.winner.channel !== insight.loser.channel;

  return (
    <>
      {/* Hero */}
      <div
        style={{
          background:
            "linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%)",
          borderRadius: 18,
          padding: 30,
          color: "white",
          marginBottom: 22,
          boxShadow: "0 8px 28px rgba(67,56,202,.28)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 14,
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.72rem",
                textTransform: "uppercase",
                letterSpacing: ".6px",
                opacity: 0.85,
                fontWeight: 700,
              }}
            >
              Attribution model · {modelLabel} · last {j.days} days · {okCount}/3
              channels live
            </div>
            <div
              style={{ fontSize: "0.78rem", opacity: 0.78, marginTop: 4 }}
            >
              Conversions sourced from{" "}
              <b>
                {j.conversionSource === "amplitude"
                  ? "Amplitude (ground truth)"
                  : "ad-platform reported"}
              </b>
              {j.aov > 0 ? ` · AOV $${j.aov}` : ""}
            </div>
          </div>
          {insight.winner && (
            <div
              style={{
                background: "rgba(255,255,255,.12)",
                border: "1px solid rgba(255,255,255,.18)",
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: "0.82rem",
              }}
            >
              <b style={{ textTransform: "capitalize" }}>
                🏆 {insight.winner.channel}
              </b>{" "}
              is your top ROAS at{" "}
              <b>
                {insight.winner.roas != null
                  ? insight.winner.roas + "x"
                  : "—"}
              </b>
            </div>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
            gap: 18,
          }}
        >
          {heroMetric("Total Spend", fmtMoney(t.spend))}
          {heroMetric("Conversions", fmtNum(t.conversions))}
          {heroMetric("Revenue", fmtMoney(t.revenue))}
          {heroMetric(
            "Blended ROAS",
            t.blendedROAS != null ? t.blendedROAS + "x" : "—",
            (t.blendedROAS || 0) >= 1 ? "#A7F3D0" : "#FECACA",
          )}
          {heroMetric("Blended CAC", fmtMoney(t.blendedCAC))}
          {heroMetric(
            "ROI",
            t.blendedROI != null ? t.blendedROI + "%" : "—",
            (t.blendedROI || 0) >= 0 ? "#A7F3D0" : "#FECACA",
          )}
        </div>
      </div>

      {/* Channel cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 14,
        }}
      >
        {CHANNEL_DEFS.map((d) => {
          const c = j.channels?.[d.key] || ({} as ChannelStats);
          if (!c.ok) {
            return (
              <div
                key={d.key}
                style={{
                  background: "#FAFAFA",
                  border: "1.5px dashed #E5E7EB",
                  borderRadius: 14,
                  padding: 22,
                  color: "#64748B",
                }}
              >
                <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>
                  {d.icon}
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    color: "#0A1628",
                    marginBottom: 4,
                  }}
                >
                  {d.name}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#94A3B8" }}>
                  Not configured ·{" "}
                  {c.error || "connect this platform to see ROI"}
                </div>
              </div>
            );
          }
          const spendShare = spend > 0 ? ((c.spend || 0) / spend) * 100 : 0;
          const roasColor =
            c.roas == null
              ? "#94A3B8"
              : c.roas >= 2
                ? "#10B981"
                : c.roas >= 1
                  ? "#F59E0B"
                  : "#EF4444";
          return (
            <div
              key={d.key}
              style={{
                background: "white",
                border: `1.5px solid ${d.color}33`,
                borderRadius: 14,
                padding: 20,
                boxShadow: "0 2px 8px rgba(0,0,0,.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: d.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.2rem",
                  }}
                >
                  {d.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 800,
                      color: "#0A1628",
                      fontSize: "1rem",
                    }}
                  >
                    {d.name}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#64748B" }}>
                    {spendShare.toFixed(1)}% of spend
                    {c.weight != null ? ` · ${c.weight}% of conversions` : ""}
                    {c.modelAdjusted ? " · model-adjusted" : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "0.65rem",
                      color: "#64748B",
                      textTransform: "uppercase",
                      letterSpacing: ".5px",
                      fontWeight: 700,
                    }}
                  >
                    ROAS
                  </div>
                  <div
                    style={{
                      fontSize: "1.4rem",
                      fontWeight: 900,
                      color: roasColor,
                    }}
                  >
                    {c.roas != null ? c.roas + "x" : "—"}
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2,1fr)",
                  gap: "10px 14px",
                  fontSize: "0.8rem",
                }}
              >
                <div>
                  <div style={cellLabel}>Spend</div>
                  <div style={cellVal}>{fmtMoney(c.spend)}</div>
                </div>
                <div>
                  <div style={cellLabel}>Revenue</div>
                  <div style={cellVal}>{fmtMoney(c.revenue)}</div>
                </div>
                <div>
                  <div style={cellLabel}>Impressions</div>
                  <div style={cellVal}>{fmtNum(c.impressions)}</div>
                </div>
                <div>
                  <div style={cellLabel}>Clicks</div>
                  <div style={cellVal}>{fmtNum(c.clicks)}</div>
                </div>
                <div>
                  <div style={cellLabel}>Conversions</div>
                  <div style={cellVal}>{fmtNum(c.conversions)}</div>
                </div>
                <div>
                  <div style={cellLabel}>CPA</div>
                  <div style={cellVal}>{fmtMoney(c.cpa)}</div>
                </div>
                <div>
                  <div style={cellLabel}>CTR</div>
                  <div style={cellVal}>{fmtPct(c.ctr)}</div>
                </div>
                <div>
                  <div style={cellLabel}>CPC</div>
                  <div style={cellVal}>{fmtMoney(c.cpc)}</div>
                </div>
                <div
                  style={{
                    gridColumn: "1/-1",
                    paddingTop: 8,
                    marginTop: 4,
                    borderTop: "1px dashed #E5E7EB",
                  }}
                >
                  <div style={cellLabel}>ROI</div>
                  <div
                    style={{
                      fontWeight: 800,
                      color: (c.roi || 0) >= 0 ? "#10B981" : "#EF4444",
                      fontSize: "1rem",
                    }}
                  >
                    {c.roi != null ? c.roi + "%" : "—"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Spend allocation */}
      {spend > 0 && (
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 14,
            padding: 18,
            marginTop: 18,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#0A1628",
              fontSize: "0.95rem",
              marginBottom: 10,
            }}
          >
            📊 Spend allocation
          </div>
          <div
            style={{
              display: "flex",
              height: 14,
              borderRadius: 8,
              overflow: "hidden",
              background: "#F1F5F9",
            }}
          >
            {liveDefs.map((d) => {
              const c = j.channels[d.key]!;
              const pct = ((c.spend || 0) / spend) * 100;
              return (
                <div
                  key={d.key}
                  style={{ background: d.color, height: "100%", width: `${pct}%` }}
                  title={`${d.name} · ${pct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 10,
            }}
          >
            {liveDefs.map((d) => {
              const c = j.channels[d.key]!;
              const pct = ((c.spend || 0) / spend) * 100;
              return (
                <div
                  key={d.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.78rem",
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: d.color,
                    }}
                  />
                  <b style={{ color: "#0A1628" }}>{d.name}</b>
                  <span style={{ color: "#64748B" }}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendation */}
      {showRec && (
        <div
          style={{
            background: "linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%)",
            border: "1px solid #6EE7B7",
            borderRadius: 14,
            padding: 18,
            marginTop: 18,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#065F46",
              fontSize: "0.95rem",
              marginBottom: 6,
            }}
          >
            💡 Reallocation recommendation
          </div>
          <div
            style={{ fontSize: "0.86rem", color: "#047857", lineHeight: 1.5 }}
          >
            Based on the <b>{modelLabel}</b> attribution model over {j.days}{" "}
            days,{" "}
            <b style={{ textTransform: "capitalize" }}>
              {insight.winner!.channel}
            </b>{" "}
            is returning <b>{insight.winner!.roas}x ROAS</b> (
            {insight.winner!.roi}% ROI), while{" "}
            <b style={{ textTransform: "capitalize" }}>
              {insight.loser!.channel}
            </b>{" "}
            is at <b>{insight.loser!.roas}x</b> ({insight.loser!.roi}% ROI).
            Consider shifting 10–20% of{" "}
            <b style={{ textTransform: "capitalize" }}>
              {insight.loser!.channel}
            </b>{" "}
            spend into{" "}
            <b style={{ textTransform: "capitalize" }}>
              {insight.winner!.channel}
            </b>{" "}
            and re-measuring next week.
          </div>
        </div>
      )}

      {/* Setup checks */}
      {showWarnings && (
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 14,
            padding: 16,
            marginTop: 18,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#92400E",
              fontSize: "0.9rem",
              marginBottom: 8,
            }}
          >
            ⚙️ Setup checks
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              color: "#78350F",
              fontSize: "0.82rem",
              lineHeight: 1.7,
            }}
          >
            {warnItems}
          </ul>
        </div>
      )}

      <div
        style={{
          textAlign: "center",
          fontSize: "0.7rem",
          color: "#94A3B8",
          marginTop: 14,
        }}
      >
        Generated {new Date(j.generatedAt).toLocaleString()}
      </div>
    </>
  );
}

function TrendBadge({
  val,
  suffix = "",
  invert = false,
}: {
  val: number | null | undefined;
  suffix?: string;
  invert?: boolean;
}) {
  if (val == null) return null;
  const up = invert ? val < 0 : val > 0;
  const cls =
    val === 0
      ? "cohort-trend-flat"
      : up
        ? "cohort-trend-up"
        : "cohort-trend-down";
  const sym = val === 0 ? "→" : val > 0 ? "▲" : "▼";
  return (
    <span className={cls}>
      {sym} {Math.abs(val).toFixed(1)}
      {suffix}
    </span>
  );
}

function CohortsView({ j }: { j: CohortData }) {
  if (!j.weeks?.length) {
    const offline = Object.entries(j.channelStatus || {})
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return (
      <div
        style={{
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 14,
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>🗓️</div>
        <div
          style={{
            fontWeight: 800,
            color: "#92400E",
            fontSize: "1.05rem",
            marginBottom: 6,
          }}
        >
          No cohort data yet
        </div>
        <div style={{ fontSize: "0.85rem", color: "#78350F" }}>
          No spend or conversions detected in the last {j.days} days
          {offline.length ? ` — ${offline.join(", ")} not connected.` : "."}{" "}
          Once your ad accounts have daily traffic, weekly cohorts will appear
          here.
        </div>
      </div>
    );
  }
  const maxSpend = Math.max(...j.weeks.map((w) => w.spend));
  const trend = j.trend;
  return (
    <>
      <div
        style={{
          background:
            "linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%)",
          borderRadius: 18,
          padding: 24,
          color: "white",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: ".5px",
            opacity: 0.85,
            fontWeight: 700,
          }}
        >
          Weekly Cohorts · last {j.days} days · {j.weeks.length} cohorts ·
          conversions from{" "}
          <b>
            {j.conversionSource === "amplitude"
              ? "Amplitude (ground truth)"
              : "ad-platform reported"}
          </b>
        </div>
        <div style={{ fontSize: "1.4rem", fontWeight: 900, marginTop: 6 }}>
          Acquisition cohort decay
        </div>
        <div style={{ fontSize: "0.85rem", opacity: 0.85, marginTop: 4 }}>
          Each row = a Monday-starting week. Spend bar shows the channel split.
          Compare weeks side-by-side to spot rising or falling efficiency.
        </div>
      </div>
      {trend && (
        <div
          style={{
            background: "white",
            border: "1.5px solid #E5E7EB",
            borderRadius: 14,
            padding: "14px 18px",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 18,
              fontSize: "0.82rem",
              color: "#475569",
            }}
          >
            <div>
              Spend WoW: <TrendBadge val={trend.spendDelta} suffix="%" />
            </div>
            <div>
              Conversions WoW:{" "}
              <TrendBadge val={trend.conversionsDelta} suffix="%" />
            </div>
            {trend.roasDelta != null && (
              <div>
                ROAS WoW: <TrendBadge val={trend.roasDelta} suffix="x" />
              </div>
            )}
            {trend.cacDelta != null && (
              <div>
                CAC WoW:{" "}
                <TrendBadge val={trend.cacDelta} suffix="$" invert />
              </div>
            )}
          </div>
        </div>
      )}
      <div
        style={{
          background: "white",
          border: "1.5px solid #E5E7EB",
          borderRadius: 14,
          padding: "6px 8px",
          overflowX: "auto",
        }}
      >
        <table className="cohort-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Spend</th>
              <th>Conversions</th>
              <th>Revenue</th>
              <th>ROAS</th>
              <th>CAC</th>
            </tr>
          </thead>
          <tbody>
            {j.weeks
              .slice()
              .reverse()
              .map((w) => {
                const barPct = maxSpend > 0 ? (w.spend / maxSpend) * 100 : 0;
                const segs = COHORT_DEFS.map((d) => {
                  const c = w.channels[d.key];
                  const pct = w.spend > 0 ? ((c?.spend || 0) / w.spend) * 100 : 0;
                  if (pct < 1) return null;
                  return (
                    <span
                      key={d.key}
                      title={`${d.name} · ${fmt$0(c.spend)} · ${pct.toFixed(0)}%`}
                      style={{
                        display: "inline-block",
                        width: `${pct}%`,
                        height: 6,
                        background: d.color,
                      }}
                    />
                  );
                }).filter(Boolean);
                return (
                  <tr key={w.week}>
                    <td>
                      <b style={{ color: "#0A1628" }}>{w.weekStart}</b>
                      <div
                        style={{
                          fontSize: "0.66rem",
                          color: "#94A3B8",
                          fontWeight: 600,
                        }}
                      >
                        {w.week}
                      </div>
                    </td>
                    <td>
                      {fmt$0(w.spend)}
                      <div
                        style={{
                          marginTop: 4,
                          height: 6,
                          background: "#F1F5F9",
                          borderRadius: 3,
                          overflow: "hidden",
                          display: "flex",
                        }}
                      >
                        {segs.length ? (
                          segs
                        ) : (
                          <span
                            className="cohort-bar"
                            style={{ width: `${barPct}%` }}
                          />
                        )}
                      </div>
                    </td>
                    <td>{fmtN0(w.conversions)}</td>
                    <td>{fmt$0(w.revenue)}</td>
                    <td>{w.roas != null ? <b>{w.roas}x</b> : "—"}</td>
                    <td>{w.cac != null ? fmt$0(w.cac) : "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 14,
          marginTop: 10,
          fontSize: "0.74rem",
          color: "#64748B",
        }}
      >
        {COHORT_DEFS.map((d) => (
          <span key={d.key}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: d.color,
                borderRadius: 2,
                verticalAlign: "middle",
              }}
            />{" "}
            {d.name}
          </span>
        ))}
      </div>
      <div
        style={{
          textAlign: "center",
          fontSize: "0.68rem",
          color: "#94A3B8",
          marginTop: 14,
        }}
      >
        Generated {new Date(j.generatedAt).toLocaleString()}
      </div>
    </>
  );
}

function Spark({
  actual,
  forecast,
  label,
  color,
  firstDate,
  lastDate,
}: {
  actual: number[];
  forecast: number[];
  label: string;
  color: string;
  firstDate: string;
  lastDate: string;
}) {
  const all = [...actual, ...forecast];
  const max = Math.max(...all, 1);
  const W = 700;
  const H = 120;
  const pad = 8;
  const totalN = all.length;
  const x = (i: number) =>
    pad + (i / Math.max(1, totalN - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / (max || 1)) * (H - pad * 2);
  const actualPath = actual
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const lastActualIdx = actual.length - 1;
  const fcPath = forecast
    .map((v, i) => {
      const idx = lastActualIdx + i;
      if (i === 0)
        return `M${x(lastActualIdx).toFixed(1)},${y(actual[lastActualIdx]).toFixed(1)} L${x(idx + 1).toFixed(1)},${y(v).toFixed(1)}`;
      return `L${x(idx + 1).toFixed(1)},${y(v).toFixed(1)}`;
    })
    .join(" ");
  const splitX = x(lastActualIdx);
  return (
    <div
      style={{
        background: "white",
        border: "1.5px solid #E5E7EB",
        borderRadius: 14,
        padding: 18,
        marginTop: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.95rem" }}>
          {label}
        </div>
        <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 2,
              background: color,
              verticalAlign: "middle",
            }}
          />{" "}
          Actual ·{" "}
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 2,
              background: color,
              opacity: 0.5,
              borderTop: `1px dashed ${color}`,
              verticalAlign: "middle",
            }}
          />{" "}
          Forecast
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 140, display: "block" }}
      >
        <line
          x1={splitX}
          x2={splitX}
          y1={pad}
          y2={H - pad}
          stroke="#CBD5E1"
          strokeDasharray="3,3"
          strokeWidth={1}
        />
        <text
          x={splitX + 4}
          y={pad + 10}
          fontSize={10}
          fill="#94A3B8"
          fontWeight={700}
        >
          Today
        </text>
        <path
          d={actualPath}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={fcPath}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray="5,4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.65}
        />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.7rem",
          color: "#94A3B8",
          marginTop: 4,
        }}
      >
        <span>{firstDate}</span>
        <span>Today</span>
        <span>{lastDate}</span>
      </div>
    </div>
  );
}

function ForecastView({ j }: { j: ForecastData }) {
  if (j.warning) {
    return (
      <div
        style={{
          background: "#FFFBEB",
          border: "1px solid #FDE68A",
          borderRadius: 14,
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>🔮</div>
        <div
          style={{
            fontWeight: 800,
            color: "#92400E",
            fontSize: "1.05rem",
            marginBottom: 6,
          }}
        >
          Not enough history yet
        </div>
        <div style={{ fontSize: "0.85rem", color: "#78350F" }}>{j.warning}</div>
      </div>
    );
  }
  const s = j.summary || {};
  const trendArrow = (dir?: string) =>
    dir === "up" ? (
      <span style={{ color: "#10B981" }}>▲ Rising</span>
    ) : dir === "down" ? (
      <span style={{ color: "#DC2626" }}>▼ Falling</span>
    ) : (
      <span style={{ color: "#94A3B8" }}>→ Flat</span>
    );
  return (
    <>
      <div
        style={{
          background:
            "linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%)",
          borderRadius: 18,
          padding: 24,
          color: "white",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: ".5px",
            opacity: 0.85,
            fontWeight: 700,
          }}
        >
          30-Day Forecast · trailing {j.days} days of daily data · conversions
          from <b>{j.conversionSource === "amplitude" ? "Amplitude" : "ad platforms"}</b>
        </div>
        <div style={{ fontSize: "1.4rem", fontWeight: 900, marginTop: 6 }}>
          Where you&apos;re heading
        </div>
        <div style={{ fontSize: "0.85rem", opacity: 0.85, marginTop: 4 }}>
          Linear trend + EMA smoothing on your daily spend &amp; conversions,
          projected forward 30 days. Use it to size next month&apos;s budget and
          spot where you&apos;ll land before you commit.
        </div>
      </div>
      <div className="fc-summary">
        <div className="fc-card">
          <div className="fc-card-label">
            Avg daily spend (last {j.days}d)
          </div>
          <div className="fc-card-value">{fmt$0(s.avgDailySpend)}</div>
          <div className="fc-card-sub">Trend {trendArrow(s.trendDirection)}</div>
        </div>
        <div className="fc-card">
          <div className="fc-card-label">Avg daily conversions</div>
          <div className="fc-card-value">{fmtN0(s.avgDailyConversions)}</div>
          <div className="fc-card-sub">
            Trend {trendArrow(s.conversionsTrend)}
          </div>
        </div>
        <div className="fc-card">
          <div className="fc-card-label">Projected spend (next 30d)</div>
          <div className="fc-card-value">{fmt$0(s.projSpend)}</div>
          <div className="fc-card-sub">Forecast horizon</div>
        </div>
        <div className="fc-card">
          <div className="fc-card-label">Projected conversions</div>
          <div className="fc-card-value">{fmtN0(s.projConversions)}</div>
          <div className="fc-card-sub">
            {j.aov > 0 || (s.projRevenue || 0) > 0
              ? "Rev " + fmt$0(s.projRevenue)
              : "Add AOV for revenue"}
          </div>
        </div>
        <div className="fc-card">
          <div className="fc-card-label">Projected ROAS</div>
          <div className="fc-card-value">
            {s.projROAS != null ? s.projROAS + "x" : "—"}
          </div>
          <div className="fc-card-sub">
            {j.aov > 0 ? "using AOV $" + j.aov : "reported revenue only"}
          </div>
        </div>
        <div className="fc-card">
          <div className="fc-card-label">Projected CAC</div>
          <div className="fc-card-value">
            {s.projCAC != null ? fmt$0(s.projCAC) : "—"}
          </div>
          <div className="fc-card-sub">Cost per conversion</div>
        </div>
      </div>
      <Spark
        actual={j.actual.map((d) => d.spend)}
        forecast={j.forecast.map((d) => d.spend)}
        label="Daily Spend"
        color="#4338CA"
        firstDate={j.actual.length ? j.actual[0].date : ""}
        lastDate={j.forecast.length ? j.forecast[j.forecast.length - 1].date : ""}
      />
      <Spark
        actual={j.actual.map((d) => d.conversions)}
        forecast={j.forecast.map((d) => d.conversions)}
        label="Daily Conversions"
        color="#059669"
        firstDate={j.actual.length ? j.actual[0].date : ""}
        lastDate={j.forecast.length ? j.forecast[j.forecast.length - 1].date : ""}
      />
      <div
        style={{
          textAlign: "center",
          fontSize: "0.68rem",
          color: "#94A3B8",
          marginTop: 14,
        }}
      >
        Generated {new Date(j.generatedAt).toLocaleString()} · forecast is a
        directional estimate, not a guarantee
      </div>
    </>
  );
}

export default function Attribution() {
  const [tab, setTab] = useState<Tab>("channels");
  const [days, setDays] = useState(30);
  const [model, setModel] = useState("last-click");
  const [aov, setAov] = useState("");
  const [state, setState] = useState<"loading" | "error" | "done">("loading");
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [cohorts, setCohorts] = useState<CohortData | null>(null);
  const [forecast, setForecast] = useState<ForecastData | null>(null);

  const aovNum = parseFloat(aov) || 0;

  const load = useCallback(
    async (t: Tab, d: number, m: string, a: number) => {
      setState("loading");
      setError("");
      if (t === "channels") {
        const r = await apiGet<OverviewData>(
          `/api/attribution/overview?days=${d}&model=${encodeURIComponent(m)}&aov=${a}`,
        );
        if (!r.ok) {
          setError(r.error || "Failed to load");
          setState("error");
          return;
        }
        setOverview(r);
      } else if (t === "cohorts") {
        const range = Math.min(120, Math.max(28, d * 3));
        const r = await apiGet<CohortData>(
          `/api/attribution/cohorts?days=${range}&aov=${a}`,
        );
        if (!r.ok) {
          setError(r.error || "Failed to load");
          setState("error");
          return;
        }
        setCohorts(r);
      } else {
        const r = await apiGet<ForecastData>(
          `/api/attribution/forecast?days=${Math.max(14, d)}&horizon=30&aov=${a}`,
        );
        if (!r.ok) {
          setError(r.error || "Failed to load");
          setState("error");
          return;
        }
        setForecast(r);
      }
      setState("done");
    },
    [],
  );

  useEffect(() => {
    load(tab, days, model, aovNum);
  }, [load, tab, days, model, aovNum]);

  const loadingMsg =
    tab === "channels"
      ? "Pulling spend from Meta + Google + TikTok and conversions from Amplitude…"
      : tab === "cohorts"
        ? "Pulling daily breakdown from Meta + Google + TikTok and bucketing into weekly cohorts…"
        : "Building forecast from trailing daily data…";

  const renderBody = () => {
    if (state === "loading") return <Loading msg={loadingMsg} />;
    if (state === "error")
      return (
        <ErrorBox
          title={
            tab === "channels"
              ? "⚠️ Could not load"
              : tab === "cohorts"
                ? "⚠️ Could not load cohorts"
                : "⚠️ Could not load forecast"
          }
          msg={error}
        />
      );
    if (tab === "channels" && overview) return <ChannelsView j={overview} />;
    if (tab === "cohorts" && cohorts) return <CohortsView j={cohorts} />;
    if (tab === "forecast" && forecast) return <ForecastView j={forecast} />;
    return null;
  };

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{
          background:
            "linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#C7D2FE" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(199,210,254,.75)" }}
                >
                  Grow
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: "rgba(255,255,255,.3)" }}
                >
                  ›
                </span>{" "}
                Attribution &amp; ROI
              </div>
              <h2 className="view-title">Attribution &amp; ROI Dashboard</h2>
              <p className="view-sub">
                Unify Meta, Google, and TikTok ad spend with Amplitude/PostHog
                conversion data — pick an attribution model, plug in your AOV,
                and see exactly which channels are paying back.
              </p>
            </div>
            <div className="vh-actions" style={{ gap: 8 }}>
              <select
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10))}
                style={{
                  padding: "9px 12px",
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{
                  padding: "9px 12px",
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  display: tab === "channels" ? "" : "none",
                }}
              >
                <option value="last-click">Last-Click</option>
                <option value="linear">Linear</option>
                <option value="time-decay">Time-Decay</option>
                <option value="position-based">Position-Based</option>
              </select>
              <input
                type="number"
                min={0}
                step={1}
                placeholder="AOV $"
                value={aov}
                onChange={(e) => setAov(e.target.value)}
                style={{
                  width: 90,
                  padding: "9px 10px",
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              />
              <button
                className="btn-refresh-solid"
                style={{ color: "#4338CA" }}
                onClick={() => load(tab, days, model, aovNum)}
              >
                ↻ Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 18 }}>
        <div
          id="attrTabs"
          style={{
            display: "flex",
            gap: 8,
            borderBottom: "2px solid #E5E7EB",
            paddingBottom: 0,
          }}
        >
          <button
            className={`attr-tab${tab === "channels" ? " attr-tab-active" : ""}`}
            onClick={() => setTab("channels")}
            title="Per-channel ROAS, ROI, CAC and reallocation recommendations across the chosen attribution model."
          >
            📊 Channels
          </button>
          <button
            className={`attr-tab${tab === "cohorts" ? " attr-tab-active" : ""}`}
            onClick={() => setTab("cohorts")}
            title="Weekly acquisition cohorts — see how spend and conversions move week over week, with per-channel breakdown."
          >
            🗓️ Cohorts
          </button>
          <button
            className={`attr-tab${tab === "forecast" ? " attr-tab-active" : ""}`}
            onClick={() => setTab("forecast")}
            title="Linear+EMA projection of the next 30 days of spend, conversions, ROAS and CAC based on your trailing daily trend."
          >
            🔮 Forecast
          </button>
        </div>
      </div>
      <div
        className="container"
        style={{ paddingTop: 18, paddingBottom: 60 }}
      >
        {renderBody()}
      </div>
    </div>
  );
}
