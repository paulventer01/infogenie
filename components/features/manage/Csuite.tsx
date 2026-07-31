"use client";

// Native React port of the legacy `csuite` panel (was `initCsuite` /
// `csBuildView` / `csROIPanel` / `csBuildCEO|CMO|CFO|COO` / `csSuitePDF` /
// `csPeriodLabel` in public/js/ig_csuite.js + `#view-csuite` in index.html).
// This panel has no `/api/csuite/*` endpoints — the legacy builder reads SPA
// state globals (analysisData, _launchedCampaigns, _infoGenieActions,
// _brandAssets, _abTests, _leadData) that still live on `window` during the
// incremental migration. All `cs-*` styling lives in global style.css.
//
// See docs/react-panel-migration.md for the porting pattern.

import { useRef, useState } from "react";
import { showToast } from "@/hooks/useToast";

// ── SPA global shapes ─────────────────────────────────────────────────────────
interface Metrics {
  roas?: number | string;
  conversions?: number;
  impressions?: number;
  spend?: number;
}
interface Campaign {
  name?: string;
  platform?: string;
  budget?: number;
  budgetStr?: string;
  status?: string;
  launchedAt?: string;
  metrics?: Metrics;
  estROAS?: number | string;
}
interface Competitor {
  name: string;
  traffic?: string | number;
  estimatedAdSpend?: number | string;
  adSpend?: number | string;
  roas?: number | string;
  topChannels?: string[];
  topKeywords?: string[];
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  websiteKPIs?: { roas?: number | string };
  competitors?: Competitor[];
}
interface InfoAction {
  type?: string;
  action?: string;
  impact?: string;
  date?: string;
  time?: string;
}
interface LeadData {
  messages?: number;
  calls?: number;
}

function getGlobal<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, T>)[key];
}
function getAnalysisData(): AnalysisData | undefined {
  return getGlobal<AnalysisData>("analysisData");
}
function getCampaigns(): Campaign[] {
  return getGlobal<Campaign[]>("_launchedCampaigns") || [];
}
function getActions(): InfoAction[] {
  return getGlobal<InfoAction[]>("_infoGenieActions") || [];
}
function getBrandAssets(): unknown[] {
  return getGlobal<unknown[]>("_brandAssets") || [];
}
function getAbTests(): unknown[] {
  return getGlobal<unknown[]>("_abTests") || [];
}
function getLeadData(): LeadData {
  return getGlobal<LeadData>("_leadData") || {};
}

type Role = "ceo" | "cmo" | "cfo" | "coo";
type Period = "7d" | "30d" | "90d" | "1y";
type Dir = "up" | "down" | "neutral";

interface RoleMeta {
  label: string;
  color: string;
  accent: string;
  icon: string;
}
const roleMap: Record<Role, RoleMeta> = {
  ceo: { label: "Chief Executive Officer", color: "#7C3AED", accent: "rgba(124,58,237,.15)", icon: "👔" },
  cmo: { label: "Chief Marketing Officer", color: "#0066FF", accent: "rgba(0,102,255,.12)", icon: "📣" },
  cfo: { label: "Chief Financial Officer", color: "#059669", accent: "rgba(5,150,105,.12)", icon: "💰" },
  coo: { label: "Chief Operating Officer", color: "#D97706", accent: "rgba(217,119,6,.12)", icon: "⚙️" },
};

interface CsData {
  ad?: AnalysisData;
  camps: Campaign[];
  budget: number;
  roas: number;
  conv: number;
  impr: number;
  cpl: string;
  comps: Competitor[];
  url: string;
  ind: string;
  sov: number;
  sovComp: number;
}

function csPeriodLabel(period: Period): string {
  return (
    { "7d": "Last 7 Days", "30d": "Last 30 Days", "90d": "Last Quarter", "1y": "Annual" }[period] ||
    "Last 30 Days"
  );
}

function csData(): CsData {
  const ad = getAnalysisData();
  const camps = getCampaigns();
  const budget = camps.reduce((s, c) => s + (c.budget || 0), 0);
  const roasStr = camps.length
    ? (camps.reduce((s, c) => s + parseFloat(String(c.metrics?.roas || 0)), 0) / camps.length).toFixed(1)
    : ad?.websiteKPIs?.roas || "3.2";
  const conv = camps.reduce((s, c) => s + (c.metrics?.conversions || 0), 0);
  const impr = camps.reduce((s, c) => s + (c.metrics?.impressions || 0), 0);
  const cpl = (() => {
    const ld = getLeadData();
    const t = (ld.messages || 0) + (ld.calls || 0);
    return t > 0 && budget > 0 ? (budget / t).toFixed(2) : "—";
  })();
  const comps = ad?.competitors || [];
  const myROAS = parseFloat(String(roasStr));
  const url = ad?.url || "your website";
  const ind = ad?.industry?.name || "your industry";
  const sov = ad ? Math.min(Math.round(35 + camps.length * 8), 72) : 28;
  const sovComp = 100 - sov;
  return { ad, camps, budget, roas: myROAS, conv, impr, cpl, comps, url, ind, sov, sovComp };
}

function fmtMoney(n: number): string {
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + Math.round(n / 1000) + "K";
  return "$" + n.toLocaleString();
}

// ── ROI Summary Panel (shared across all C-Suite roles) ───────────────────────
function ROIPanel({ d }: { d: CsData }) {
  const { camps, budget, roas, ad } = d;
  const noData = !camps.length && budget === 0;

  const estSpend = noData ? 5000 : null;
  const estRoas = noData ? parseFloat(String(ad?.websiteKPIs?.roas)) || roas || 2.2 : null;

  const totalSpend = noData
    ? (estSpend as number)
    : camps.reduce(
        (s, c) => s + (c.metrics && c.metrics.spend ? c.metrics.spend : Math.round((c.budget || 0) * 0.25)),
        0,
      ) || budget;
  const effectiveRoas = noData ? (estRoas as number) : roas;
  const totalRev = Math.round(totalSpend * effectiveRoas);
  const projRevMonth = noData
    ? Math.round((estSpend as number) * (estRoas as number))
    : Math.round(budget * roas);
  const profit = totalRev - totalSpend;
  const roi = totalSpend > 0 ? Math.round((profit / totalSpend) * 100) : 0;
  // Light tints — hero uses --ig-grad2 (teal→green); #059669 disappears on that bg
  const roiColor = roi >= 100 ? "#6EE7B7" : roi >= 0 ? "#FBBF24" : "#FCA5A5";
  const roiIcon = roi >= 100 ? "📈" : roi >= 0 ? "⚠️" : "📉";

  return (
    <div
      style={{
        background: "var(--ig-grad2)",
        border: "1px solid rgba(0,201,200,.18)",
        borderRadius: 16,
        padding: "22px 28px",
        marginBottom: 22,
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          fontWeight: 700,
          color: "#FFFFFF",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          marginBottom: 6,
          textShadow: "0 1px 2px rgba(0,0,0,.35)",
        }}
      >
        💼 Investment Performance Overview
        {noData && (
          <span
            style={{
              fontSize: "0.6rem",
              background: "#FEF9C3",
              color: "#92400E",
              borderRadius: 4,
              padding: "1px 6px",
              fontWeight: 700,
              verticalAlign: "middle",
              marginLeft: 6,
              textShadow: "none",
            }}
          >
            ESTIMATED
          </span>
        )}
      </div>
      {noData && (
        <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.85)", marginBottom: 12 }}>
          No campaigns launched yet — showing estimated benchmarks for a $5K/mo budget
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))",
          gap: 14,
        }}
      >
        <div
          style={{
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.2)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              fontWeight: 600,
              color: "rgba(255,255,255,.45)",
              textTransform: "uppercase",
              letterSpacing: ".07em",
              marginBottom: 6,
            }}
          >
            💸 Total Ad Spend
          </div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "#F87171",
              lineHeight: 1,
            }}
          >
            {fmtMoney(totalSpend)}
          </div>
          <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,.35)", marginTop: 5 }}>
            {fmtMoney(budget || totalSpend)}/mo budget · {camps.length} campaign
            {camps.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div
          style={{
            background: "rgba(5,150,105,.08)",
            border: "1px solid rgba(5,150,105,.2)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              fontWeight: 600,
              color: "rgba(255,255,255,.45)",
              textTransform: "uppercase",
              letterSpacing: ".07em",
              marginBottom: 6,
            }}
          >
            💰 Revenue Generated
          </div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "#34D399",
              lineHeight: 1,
            }}
          >
            {fmtMoney(totalRev)}
          </div>
          <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,.35)", marginTop: 5 }}>
            {fmtMoney(projRevMonth)}/mo projected · {effectiveRoas}× ROAS
          </div>
        </div>

        <div
          style={{
            background: "rgba(99,102,241,.08)",
            border: "1px solid rgba(99,102,241,.2)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              fontWeight: 600,
              color: "rgba(255,255,255,.45)",
              textTransform: "uppercase",
              letterSpacing: ".07em",
              marginBottom: 6,
            }}
          >
            📊 Net Profit
          </div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1.5rem",
              fontWeight: 800,
              color: profit >= 0 ? "#818CF8" : "#F87171",
              lineHeight: 1,
            }}
          >
            {profit >= 0 ? "+" : "-"}
            {fmtMoney(Math.abs(profit))}
          </div>
          <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,.35)", marginTop: 5 }}>
            Revenue minus total spend
          </div>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 12,
            padding: "14px 16px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              fontWeight: 600,
              color: "rgba(255,255,255,.45)",
              textTransform: "uppercase",
              letterSpacing: ".07em",
              marginBottom: 6,
            }}
          >
            {roiIcon} Return on Investment
          </div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1.5rem",
              fontWeight: 800,
              color: roiColor,
              lineHeight: 1,
            }}
          >
            {roi >= 0 ? "+" : ""}
            {roi}%
          </div>
          <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,.35)", marginTop: 5 }}>
            {roi >= 100
              ? "Exceeding target — scale spend"
              : roi >= 0
                ? "Positive ROI — optimise to improve"
                : "Below break-even — review targeting"}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "rgba(255,255,255,.06)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: Math.min(100, Math.abs(roi)) + "%",
                background: roiColor,
                transition: "width .6s ease",
              }}
            />
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          padding: "10px 14px",
          background: "rgba(255,255,255,.03)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.7)" }}>ROI formula:</span>
        <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,.85)", fontStyle: "italic" }}>
          (Revenue − Spend) ÷ Spend × 100
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.75rem",
            fontWeight: 700,
            color: roiColor,
            textShadow: "0 1px 2px rgba(0,0,0,.35)",
          }}
        >
          {fmtMoney(Math.abs(profit))} {profit >= 0 ? "returned above" : "in deficit against"}{" "}
          {fmtMoney(totalSpend)} invested
        </span>
      </div>
    </div>
  );
}

function PeriodSelector({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const periods: [Period, string][] = [
    ["7d", "7 Days"],
    ["30d", "30 Days"],
    ["90d", "Quarter"],
    ["1y", "Annual"],
  ];
  return (
    <div className="cs-period-sel">
      {periods.map(([v, l]) => (
        <button
          key={v}
          className={`cs-period-btn${period === v ? " active" : ""}`}
          onClick={() => setPeriod(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

interface ExecStatsProps {
  stats: [string, string | number][];
}
function ExecStats({ stats }: ExecStatsProps) {
  return (
    <div className="cs-exec-stats">
      {stats.map(([l, v], i) => (
        <span key={l} style={{ display: "contents" }}>
          <div className="cs-exec-stat">
            <div className="cs-exec-stat-val">{v}</div>
            <div className="cs-exec-stat-label">{l}</div>
          </div>
          {i < stats.length - 1 && <div className="cs-exec-stat-sep" />}
        </span>
      ))}
    </div>
  );
}

interface KpiItem {
  label: string;
  val: string | number;
  delta: string;
  dir: Dir;
}
function KpiGrid({ accent, items }: { accent: string; items: KpiItem[] }) {
  return (
    <div className="cs-kpi-grid" style={{ ["--cs-accent" as string]: accent } as React.CSSProperties}>
      {items.map((k) => (
        <div className="cs-kpi" key={k.label}>
          <div className="cs-kpi-val">{k.val}</div>
          <div className="cs-kpi-label">{k.label}</div>
          <div className={`cs-kpi-delta ${k.dir}`}>{k.delta}</div>
        </div>
      ))}
    </div>
  );
}

interface AlertItem {
  type: string;
  icon: string;
  text: string;
  val: string;
}
function Alert({ a }: { a: AlertItem }) {
  return (
    <div className={`cs-alert cs-alert-${a.type}`}>
      <span className="cs-alert-icon">{a.icon}</span>
      <span className="cs-alert-text">{a.text}</span>
      <span className="cs-alert-val">{a.val}</span>
    </div>
  );
}

// ── CEO Report ────────────────────────────────────────────────────────────────
function CEOReport({ d, rm, period, setPeriod }: ReportProps) {
  const { camps, budget, roas, comps, url, ind, sov, sovComp } = d;
  const projRev = budget > 0 ? "$" + (budget * roas).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
  const mktShare = sov;
  const compSOV = sovComp;
  const ySov = Math.max(mktShare - 12, 8);
  const actions = getActions();
  const brandAssets = getBrandAssets();

  const topInsights = [
    {
      icon: "📈",
      bg: "#EFF6FF",
      text: `Marketing generated ${camps.length} active campaigns with projected ${projRev}/mo revenue attribution`,
      label: "Revenue Attribution",
    },
    {
      icon: "🎯",
      bg: "#F0FDF4",
      text: `Share of voice at ${mktShare}% — up from ${ySov}% in prior period. Competitors hold ${compSOV}% combined`,
      label: "Market Position",
    },
    {
      icon: "🤖",
      bg: "#FEF3C7",
      text: `InfoGenie AI executed ${actions.length + camps.length} autonomous actions — saving ~${(actions.length * 2.5).toFixed(0)} hours of manual work`,
      label: "AI Efficiency",
    },
    {
      icon: "⚡",
      bg: "#FDF4FF",
      text: `${comps.length} competitors tracked in real-time across ${ind}. Key threat: ${comps[0]?.name || "primary competitor"}`,
      label: "Competitive Intel",
    },
  ];

  const alerts: AlertItem[] = [
    {
      type: roas >= 3 ? "success" : "warning",
      icon: roas >= 3 ? "✅" : "⚠️",
      text: `Blended ROAS at ${roas}× ${roas >= 3 ? "— above industry benchmark of 3×" : "— below 3× target, action required"}`,
      val: `${roas}×`,
    },
    {
      type: camps.length >= 2 ? "success" : "warning",
      icon: camps.length >= 2 ? "✅" : "⚠️",
      text: `${camps.length} campaign${camps.length !== 1 ? "s" : ""} active across ${[...new Set(camps.map((c) => c.platform))].length || 1} platform${camps.length > 1 ? "s" : ""}`,
      val: `${camps.length} live`,
    },
    {
      type: "success",
      icon: "📊",
      text: `Competitor intelligence active — monitoring ${comps.length} rivals in ${ind}`,
      val: `${comps.length} rivals`,
    },
  ];

  const execStats: [string, string | number][] = [
    ["Revenue Attribution", projRev],
    ["Active Campaigns", camps.length || "0"],
    ["Avg ROAS", roas + "×"],
    ["Share of Voice", mktShare + "%"],
    ["Competitors Tracked", comps.length || "0"],
    ["AI Actions Taken", actions.length],
  ];

  const kpis: KpiItem[] = [
    { label: "Revenue Attribution/mo", val: projRev, delta: "↑ vs prior period", dir: "up" },
    { label: "Total Ad Spend/mo", val: budget > 0 ? "$" + budget.toLocaleString() : "—", delta: `${camps.length} campaigns`, dir: "neutral" },
    { label: "Blended ROAS", val: roas + "×", delta: roas >= 3 ? "↑ Above benchmark" : "↓ Below 3× target", dir: roas >= 3 ? "up" : "down" },
    { label: "Share of Voice", val: mktShare + "%", delta: `↑ vs ${ySov}% prior period`, dir: "up" },
    { label: "Competitors Monitored", val: comps.length || "0", delta: `in ${ind}`, dir: "neutral" },
    { label: "AI Actions Executed", val: actions.length || "0", delta: `~${((actions.length || 0) * 2.5).toFixed(0)}h saved`, dir: "up" },
  ];

  const parseT = (c: Competitor): number => {
    const raw = String(c.traffic || "").replace(/[, ]/g, "").toUpperCase();
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return 0;
    if (raw.includes("B")) return n * 1e9;
    if (raw.includes("M")) return n * 1e6;
    if (raw.includes("K")) return n * 1e3;
    return n;
  };
  const withT = comps.slice(0, 5).map((c) => ({ c, t: parseT(c) }));
  const totalT = withT.reduce((a, x) => a + x.t, 0);

  return (
    <>
      <div className="cs-exec-banner">
        <div className="cs-exec-role-badge">
          {rm.icon} {rm.label} · Executive Summary
        </div>
        <div className="cs-exec-headline">Business Growth Intelligence Report</div>
        <div className="cs-exec-sub">
          High-level overview of marketing performance, competitive position, revenue attribution and
          AI-driven growth metrics for {url || "your brand"}. Period: {csPeriodLabel(period)}.
        </div>
        <ExecStats stats={execStats} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628" }}>
          CEO Dashboard{" "}
          <span suppressHydrationWarning style={{ fontSize: "0.72rem", fontWeight: 400, color: "#6B7280" }}>
            · Generated {new Date().toLocaleDateString()}
          </span>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      <div style={{ marginBottom: 22 }}>
        {alerts.map((a, i) => (
          <Alert key={i} a={a} />
        ))}
      </div>

      <KpiGrid accent={rm.color} items={kpis} />

      <div className="cs-two-col">
        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">🧠 Strategic Insights</div>
              <div className="cs-card-sub">Board-level action items</div>
            </div>
          </div>
          {topInsights.map((i, idx) => (
            <div className="cs-insight" key={idx}>
              <div className="cs-insight-icon" style={{ background: i.bg }}>
                {i.icon}
              </div>
              <div className="cs-insight-text">
                <div className="cs-insight-title">{i.label}</div>
                <div className="cs-insight-sub">{i.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">🏆 Market Position</div>
              <div className="cs-card-sub">Share of voice vs. competitors</div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div className="cs-bar-row">
              <div className="cs-bar-label" style={{ color: "#0A1628", fontWeight: 700 }}>
                Your Brand
              </div>
              <div className="cs-bar-track">
                <div
                  className="cs-bar-fill"
                  style={{ width: mktShare + "%", background: `linear-gradient(90deg,${rm.color},#00C9C8)` }}
                />
              </div>
              <div className="cs-bar-val" style={{ color: rm.color }}>
                {mktShare}%
              </div>
            </div>
            {withT.map(({ c, t }, i) => {
              if (t > 0 && totalT > 0) {
                const w = Math.max(1, Math.round((t / totalT) * 80));
                return (
                  <div className="cs-bar-row" key={i}>
                    <div className="cs-bar-label">{c.name.substring(0, 18)}</div>
                    <div className="cs-bar-track">
                      <div className="cs-bar-fill" style={{ width: w + "%", background: "#E2E8F0" }} />
                    </div>
                    <div className="cs-bar-val">{w}%</div>
                  </div>
                );
              }
              return (
                <div className="cs-bar-row" key={i}>
                  <div className="cs-bar-label">{c.name.substring(0, 18)}</div>
                  <div className="cs-bar-track">
                    <div className="cs-bar-fill" style={{ width: "0%", background: "#E2E8F0" }} />
                  </div>
                  <div className="cs-bar-val" style={{ color: "#94a3b8" }} title="No public traffic data available">
                    —
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              background: "#F9FAFB",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: "0.75rem",
              color: "#374151",
              lineHeight: 1.5,
            }}
          >
            <strong>CEO Recommendation:</strong> Growing SOV from {ySov}% to {mktShare}% signals effective
            campaign execution. Target {Math.min(mktShare + 10, 65)}% within next quarter by increasing
            spend on top-performing platforms.
          </div>
        </div>
      </div>

      {comps.length > 0 && (
        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">🔍 Competitive Landscape — {ind}</div>
              <div className="cs-card-sub">Top competitor performance signals vs. your brand</div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="cs-comp-table">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Est. Ad Spend</th>
                  <th>ROAS Signal</th>
                  <th>Primary Channel</th>
                  <th>Threat Level</th>
                  <th>CEO Action</th>
                </tr>
              </thead>
              <tbody>
                {comps.slice(0, 6).map((c, i) => {
                  const threat = i === 0 ? "High" : i <= 2 ? "Medium" : "Low";
                  const tc = threat === "High" ? "#EF4444" : threat === "Medium" ? "#F59E0B" : "#10B981";
                  const rawSpend = c.estimatedAdSpend || c.adSpend;
                  const haveSpend = rawSpend !== undefined && rawSpend !== null && rawSpend !== "—";
                  const ch = c.topChannels?.[0] || ["Google", "Meta", "TikTok", "LinkedIn"][i % 4];
                  const haveR =
                    (typeof c.roas === "number" && c.roas > 0) ||
                    (typeof c.roas === "string" && c.roas !== "—" && !isNaN(parseFloat(c.roas)));
                  const roasEst = haveR ? parseFloat(String(c.roas)).toFixed(1) : null;
                  return (
                    <tr key={i}>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td>
                        {haveSpend ? (
                          typeof rawSpend === "number" ? (
                            "$" + rawSpend.toLocaleString()
                          ) : (
                            rawSpend
                          )
                        ) : (
                          <span style={{ color: "#94a3b8" }} title="No public spend data available">
                            —
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="cs-trend-down">
                          {roasEst ? (
                            `${roasEst}×`
                          ) : (
                            <span style={{ color: "#94a3b8" }} title="No public ROAS data available">
                              —
                            </span>
                          )}
                        </span>{" "}
                        <span style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>vs your {roas}×</span>
                      </td>
                      <td>{ch}</td>
                      <td>
                        <span
                          className="cs-badge"
                          style={{ background: `${tc}20`, color: tc, border: `1px solid ${tc}40` }}
                        >
                          {threat}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                        {threat === "High" ? "Increase counter-spend" : "Monitor quarterly"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* brandAssets referenced for parity with legacy globals */}
      <span hidden>{brandAssets.length}</span>
    </>
  );
}

// ── CMO Report ────────────────────────────────────────────────────────────────
function CMOReport({ d, rm, period, setPeriod }: ReportProps) {
  const { camps, budget, roas, conv, impr, comps, url, ind, sov } = d;
  const clicks = Math.round(impr * 0.045);
  const leads = Math.round(clicks * 0.08);
  const cpa = budget > 0 && conv > 0 ? "$" + (budget / Math.max(conv, 1)).toFixed(0) : "—";
  const channels = [...new Set(camps.map((c) => c.platform))];
  const brandAssets = getBrandAssets();

  const execStats: [string, string | number][] = [
    ["Campaigns Live", camps.length || 0],
    ["Total Impressions", impr > 0 ? (impr / 1000).toFixed(0) + "K" : "-"],
    ["Avg ROAS", roas + "×"],
    ["Conversions", conv || 0],
    ["Channels Active", channels.length || 1],
    ["Creative Assets", brandAssets.length],
  ];

  const kpis: KpiItem[] = [
    { label: "Total Ad Spend/mo", val: budget > 0 ? "$" + budget.toLocaleString() : "—", delta: `${channels.length || 1} channels`, dir: "neutral" },
    { label: "Blended ROAS", val: roas + "×", delta: roas >= 3 ? "↑ Above target" : "↓ Needs optimisation", dir: roas >= 3 ? "up" : "down" },
    { label: "Total Impressions", val: impr > 0 ? (impr / 1000).toFixed(0) + "K" : "—", delta: "Paid reach", dir: "up" },
    { label: "Est. Clicks", val: clicks > 0 ? clicks.toLocaleString() : "—", delta: "~4.5% CTR", dir: "neutral" },
    { label: "Conversions", val: conv > 0 ? conv : "—", delta: "From all campaigns", dir: "up" },
    { label: "Cost per Acquisition", val: cpa, delta: "All channels blended", dir: "neutral" },
    { label: "Share of Voice", val: sov + "%", delta: "vs competitors", dir: "up" },
    { label: "Brand Assets", val: brandAssets.length, delta: "In creative library", dir: "neutral" },
  ];

  const funnel: [string, string, string, number][] = [
    ["Impressions", impr > 0 ? impr.toLocaleString() : "Pending", "#0066FF", 100],
    ["Clicks", clicks > 0 ? clicks.toLocaleString() : "Pending", "#00C9C8", Math.round((clicks / Math.max(impr, 1)) * 100) || 45],
    ["Leads", leads > 0 ? leads.toLocaleString() : "Pending", "#7C3AED", Math.round((leads / Math.max(impr, 1)) * 100) || 8],
    ["Conversions", conv > 0 ? conv.toLocaleString() : "Pending", "#10B981", Math.round((conv / Math.max(impr, 1)) * 100) || 2],
    ["Revenue", budget > 0 ? "$" + (budget * roas).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—", "#F59E0B", Math.round((conv / Math.max(impr, 1)) * 70) || 1],
  ];

  return (
    <>
      <div className="cs-exec-banner" style={{ background: "var(--ig-grad)" }}>
        <div
          className="cs-exec-role-badge"
          style={{ background: "rgba(0,102,255,.2)", borderColor: "rgba(0,102,255,.3)", color: "#93C5FD" }}
        >
          {rm.icon} {rm.label} · Marketing Performance Report
        </div>
        <div className="cs-exec-headline">Full-Funnel Campaign Intelligence</div>
        <div className="cs-exec-sub">
          Comprehensive view of campaign performance, creative output, audience reach, and channel ROAS
          for {url || "your brand"}. Period: {csPeriodLabel(period)}.
        </div>
        <ExecStats stats={execStats} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628" }}>
          CMO Dashboard{" "}
          <span suppressHydrationWarning style={{ fontSize: "0.72rem", fontWeight: 400, color: "#6B7280" }}>
            · {new Date().toLocaleDateString()}
          </span>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      <KpiGrid accent={rm.color} items={kpis} />

      <div className="cs-two-col">
        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">🎯 Marketing Funnel</div>
              <div className="cs-card-sub">Impressions → Revenue</div>
            </div>
          </div>
          {funnel.map(([l, v, c, p], i) => (
            <div className="cs-bar-row" key={i}>
              <div className="cs-bar-label">{l}</div>
              <div className="cs-bar-track">
                <div className="cs-bar-fill" style={{ width: Math.max(p, 4) + "%", background: c }} />
              </div>
              <div className="cs-bar-val" style={{ color: c }}>
                {v}
              </div>
            </div>
          ))}
        </div>

        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">📡 Channel Performance</div>
              <div className="cs-card-sub">ROAS by platform</div>
            </div>
          </div>
          {camps.length ? (
            camps.slice(0, 5).map((c, i) => {
              const cr = parseFloat(String(c.metrics?.roas || c.estROAS || roas));
              const pct = Math.min(Math.round((cr / 5) * 100), 100);
              const col = cr >= 3 ? "#10B981" : cr >= 2 ? "#F59E0B" : "#EF4444";
              return (
                <div className="cs-bar-row" key={i}>
                  <div className="cs-bar-label">{(c.platform || "Platform").substring(0, 14)}</div>
                  <div className="cs-bar-track">
                    <div className="cs-bar-fill" style={{ width: pct + "%", background: col }} />
                  </div>
                  <div className="cs-bar-val" style={{ color: col }}>
                    {cr.toFixed(1)}×
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: "center", padding: 20, color: "#9CA3AF", fontSize: "0.82rem" }}>
              Launch campaigns to see channel ROAS breakdown
            </div>
          )}
        </div>
      </div>

      {comps.length > 0 && (
        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">⚔️ Competitor Ad Intelligence</div>
              <div className="cs-card-sub">What your rivals are doing — and where they&apos;re failing</div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="cs-comp-table">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Top Keywords</th>
                  <th>Primary Channel</th>
                  <th>Est. ROAS Gap</th>
                  <th>CMO Exploit</th>
                </tr>
              </thead>
              <tbody>
                {comps.slice(0, 6).map((c, i) => {
                  const gap = (roas - (2.5 - i * 0.15)).toFixed(1);
                  const kw = (c.topKeywords || []).slice(0, 2).join(", ") || "brand + category terms";
                  const ch = c.topChannels?.[0] || ["Google", "Meta", "LinkedIn", "TikTok"][i % 4];
                  return (
                    <tr key={i}>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td style={{ fontSize: "0.73rem", color: "#6B7280" }}>{kw}</td>
                      <td>{ch}</td>
                      <td>
                        <span className="cs-trend-up">+{gap}× advantage</span>
                      </td>
                      <td style={{ fontSize: "0.72rem", color: "#0066FF" }}>
                        Target their top keywords at +15% bid
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <span hidden>{ind}</span>
    </>
  );
}

// ── CFO Report ────────────────────────────────────────────────────────────────
function CFOReport({ d, rm, period, setPeriod }: ReportProps) {
  const { camps, budget, roas, conv, cpl } = d;
  const revenue = (budget * roas).toFixed(0);
  const efficiency = budget > 0 ? (((roas - 1) / roas) * 100).toFixed(1) : "—";
  const cpa = budget > 0 && conv > 0 ? (budget / Math.max(conv, 1)).toFixed(2) : "—";
  const projQ = (budget * 3 * roas).toFixed(0);

  const channelBreakdown = camps.length
    ? camps.map((c) => ({
        name: c.platform || "Platform",
        spend: c.budget || 0,
        roas: parseFloat(String(c.metrics?.roas || c.estROAS || roas)),
        rev: Math.round((c.budget || 0) * parseFloat(String(c.metrics?.roas || roas))),
      }))
    : [];

  const execStats: [string, string | number][] = [
    ["Monthly Spend", "$" + (budget || 0).toLocaleString()],
    ["Revenue Attr.", "$" + Number(revenue).toLocaleString()],
    ["Blended ROAS", roas + "×"],
    ["Profit Margin", efficiency + "%"],
    ["Cost-per-Lead", cpl !== "—" ? "$" + cpl : cpl],
    ["Qtr Projection", "$" + Number(projQ).toLocaleString()],
  ];

  const kpis: KpiItem[] = [
    { label: "Total Marketing Spend/mo", val: budget > 0 ? "$" + budget.toLocaleString() : "$0", delta: "All channels combined", dir: "neutral" },
    { label: "Revenue Attributed/mo", val: budget > 0 ? "$" + Number(revenue).toLocaleString() : "—", delta: `At ${roas}× ROAS`, dir: "up" },
    { label: "Net Marketing Profit/mo", val: budget > 0 ? "$" + (Number(revenue) - budget).toLocaleString() : "—", delta: "Revenue − Spend", dir: "up" },
    { label: "ROAS (Return on Ad Spend)", val: roas + "×", delta: roas >= 3 ? "↑ Above 3× threshold" : "↓ Below target", dir: roas >= 3 ? "up" : "down" },
    { label: "Cost Per Acquisition", val: cpa !== "—" ? "$" + cpa : "—", delta: "Per conversion", dir: "neutral" },
    { label: "Cost Per Lead", val: cpl !== "—" ? "$" + cpl : "—", delta: "Messages + Calls", dir: "neutral" },
    { label: "Quarterly Projection", val: "$" + Number(projQ).toLocaleString(), delta: `${csPeriodLabel(period)} extrapolation`, dir: "up" },
    { label: "Active Campaigns", val: camps.length, delta: `${[...new Set(camps.map((c) => c.platform))].length || 1} platforms`, dir: "neutral" },
  ];

  const alerts: AlertItem[] = [
    { type: roas >= 3 ? "success" : "warning", icon: roas >= 3 ? "✅" : "⚠️", text: `ROAS ${roas >= 3 ? "exceeds" : "below"} 3× threshold — ${roas >= 3 ? "budget can scale safely" : "pause lowest performers first"}`, val: roas + "×" },
    { type: budget > 0 ? "success" : "warning", icon: budget > 0 ? "💰" : "⚠️", text: `Monthly marketing budget of $${(budget || 0).toLocaleString()} is ${budget > 0 ? "actively deployed" : "not yet set"}`, val: "$" + budget.toLocaleString() },
    { type: "success", icon: "📊", text: `InfoGenie AI optimisation preventing estimated $${Math.round(budget * 0.18).toLocaleString()}/mo in wasted spend`, val: "-18%" },
    { type: Number(cpa) < 50 ? "success" : "warning", icon: "🎯", text: `CPA of ${cpa !== "—" ? "$" + cpa : cpa} — ${Number(cpa) < 50 ? "within efficient range" : "review conversion targeting"}`, val: cpa !== "—" ? "$" + cpa : "—" },
  ];

  return (
    <>
      <div className="cs-exec-banner" style={{ background: "var(--ig-grad)" }}>
        <div
          className="cs-exec-role-badge"
          style={{ background: "rgba(5,150,105,.2)", borderColor: "rgba(5,150,105,.3)", color: "#6EE7B7" }}
        >
          {rm.icon} {rm.label} · Financial Marketing Report
        </div>
        <div className="cs-exec-headline">Marketing ROI &amp; Budget Efficiency</div>
        <div className="cs-exec-sub">
          Financial performance of all marketing channels — spend efficiency, revenue attribution,
          cost-per-outcome, and quarterly projection. Period: {csPeriodLabel(period)}.
        </div>
        <ExecStats stats={execStats} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628" }}>
          CFO Dashboard{" "}
          <span suppressHydrationWarning style={{ fontSize: "0.72rem", fontWeight: 400, color: "#6B7280" }}>
            · {new Date().toLocaleDateString()}
          </span>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      <KpiGrid accent={rm.color} items={kpis} />

      <div className="cs-two-col">
        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">💹 Budget Efficiency by Channel</div>
              <div className="cs-card-sub">Spend vs revenue per platform</div>
            </div>
          </div>
          {channelBreakdown.length ? (
            channelBreakdown.map((c, i) => {
              const pct = Math.min(Math.round((c.roas / 5) * 100), 100);
              const col = c.roas >= 3 ? "#10B981" : c.roas >= 2 ? "#F59E0B" : "#EF4444";
              return (
                <div
                  key={i}
                  style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #F3F4F6" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0A1628" }}>{c.name}</span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: col }}>
                      {c.roas.toFixed(1)}× ROAS
                    </span>
                  </div>
                  <div className="cs-bar-track" style={{ marginBottom: 4 }}>
                    <div className="cs-bar-fill" style={{ width: pct + "%", background: col }} />
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#9CA3AF" }}
                  >
                    <span>Spend: ${c.spend.toLocaleString()}/mo</span>
                    <span style={{ color: "#059669", fontWeight: 600 }}>Revenue: ${c.rev.toLocaleString()}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: "center", padding: 20, color: "#9CA3AF", fontSize: "0.82rem" }}>
              No campaigns yet
            </div>
          )}
        </div>

        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">🚨 CFO Alerts &amp; Recommendations</div>
            </div>
          </div>
          {alerts.map((a, i) => (
            <Alert key={i} a={a} />
          ))}

          <div style={{ background: "#F9FAFB", borderRadius: 10, padding: 12, marginTop: 14 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", marginBottom: 6 }}>
              📋 CFO Recommended Actions
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.73rem", color: "#6B7280", lineHeight: 1.7 }}>
              <li>Reallocate {roas < 3 ? "15% of" : "no"} budget from underperforming channels</li>
              <li>Scale top ROAS channel by +20% if ROAS &gt; 3.5×</li>
              <li>Review CPA monthly against LTV ratio (target LTV:CAC ≥ 3:1)</li>
              <li>Approve quarterly budget review after {camps.length > 0 ? "30-day" : "first campaign"} results</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

// ── COO Report ────────────────────────────────────────────────────────────────
function COOReport({ d, rm, period, setPeriod }: ReportProps) {
  const { camps, comps, url, ind } = d;
  const actions = getActions();
  const abTests = getAbTests();
  const brandAssets = getBrandAssets();
  const hrsSaved = (actions.length * 2.5).toFixed(0);
  const channels = [...new Set(camps.map((c) => c.platform))];

  const ops: { icon: string; label: string; val: number; status: "green" | "amber" | "neutral"; note: string }[] = [
    { icon: "🚀", label: "Campaigns Active", val: camps.length, status: camps.length > 0 ? "green" : "amber", note: camps.length > 0 ? "Running on schedule" : "No campaigns live" },
    { icon: "🤖", label: "AI Actions Executed", val: actions.length, status: "green", note: `~${hrsSaved}h manual work saved` },
    { icon: "🧪", label: "A/B Tests Running", val: abTests.length, status: abTests.length > 0 ? "green" : "neutral", note: abTests.length > 0 ? "Optimisation active" : "Start a test in Campaigns" },
    { icon: "📡", label: "Ad Platforms Connected", val: channels.length || 1, status: "green", note: channels.join(", ") || "No campaigns yet" },
    { icon: "🖼️", label: "Brand Assets Uploaded", val: brandAssets.length, status: brandAssets.length > 0 ? "green" : "amber", note: "In creative library" },
    { icon: "📊", label: "Competitors Monitored", val: comps.length, status: comps.length > 0 ? "green" : "amber", note: `In ${ind}` },
  ];

  const statusCol: Record<string, string> = { green: "#10B981", amber: "#F59E0B", neutral: "#6B7280" };

  const execStats: [string, string | number][] = [
    ["Campaigns Live", camps.length],
    ["AI Actions", actions.length],
    ["Hours Saved", hrsSaved + "h"],
    ["A/B Tests", abTests.length],
    ["Platforms", channels.length || 1],
    ["Assets", brandAssets.length],
  ];

  const logItems: InfoAction[] = [
    ...actions.slice(0, 4),
    ...(!actions.length
      ? [
          { type: "analysis", action: "Competitor intelligence engine activated", impact: `${comps.length} rivals mapped` },
          { type: "campaigns", action: "AI campaign recommendations generated", impact: `${camps.length || "N/A"} campaigns scored` },
          { type: "audience", action: "Target audience auto-segmented", impact: "Applied to all campaigns" },
        ]
      : []),
  ].slice(0, 5);
  const logColMap: Record<string, string> = {
    campaign_launch: "#0066FF",
    analysis: "#00C9C8",
    campaigns: "#10B981",
    audience: "#7C3AED",
    config: "#6B7280",
  };

  const bottlenecks = [
    {
      icon: "📤",
      bg: "#EFF6FF",
      col: "#1D4ED8",
      title: "Creative Refresh",
      desc:
        brandAssets.length === 0
          ? "No brand assets uploaded — creative library is empty. Upload logos and ad creatives."
          : `${brandAssets.length} assets in library. Schedule monthly refresh cycle.`,
    },
    {
      icon: "🧪",
      bg: "#FDF4FF",
      col: "#7C3AED",
      title: "A/B Testing Cadence",
      desc:
        abTests.length === 0
          ? "No A/B tests running. Start split testing to improve ROAS by estimated 15–25%."
          : `${abTests.length} test(s) active. Review winners weekly and rotate creatives.`,
    },
    {
      icon: "🔌",
      bg: "#F0FDF4",
      col: "#059669",
      title: "Platform Connections",
      desc:
        channels.length >= 2
          ? `${channels.length} platforms connected. Ensure API tokens are valid and refresh alerts are set.`
          : "Connect additional ad platforms to diversify and reduce single-channel risk.",
    },
    {
      icon: "📊",
      bg: "#FFF7ED",
      col: "#D97706",
      title: "Reporting Cadence",
      desc: "C-Suite reports should be reviewed weekly. Enable automated email reports for board distribution.",
    },
  ];

  return (
    <>
      <div className="cs-exec-banner" style={{ background: "var(--ig-grad)" }}>
        <div
          className="cs-exec-role-badge"
          style={{ background: "rgba(217,119,6,.2)", borderColor: "rgba(217,119,6,.3)", color: "#FDE68A" }}
        >
          {rm.icon} {rm.label} · Operations Report
        </div>
        <div className="cs-exec-headline">Marketing Operations &amp; Execution Status</div>
        <div className="cs-exec-sub">
          Campaign execution health, automation performance, platform integrations, and operational
          bottlenecks for {url || "your brand"}. Period: {csPeriodLabel(period)}.
        </div>
        <ExecStats stats={execStats} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628" }}>
          COO Dashboard{" "}
          <span suppressHydrationWarning style={{ fontSize: "0.72rem", fontWeight: 400, color: "#6B7280" }}>
            · {new Date().toLocaleDateString()}
          </span>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} />
      </div>

      <div className="cs-kpi-grid" style={{ ["--cs-accent" as string]: rm.color } as React.CSSProperties}>
        {ops.map((o, i) => {
          const col = statusCol[o.status];
          return (
            <div className="cs-kpi" key={i} style={{ ["--cs-accent" as string]: col } as React.CSSProperties}>
              <div style={{ fontSize: "1.5rem", marginBottom: 4 }}>{o.icon}</div>
              <div className="cs-kpi-val" style={{ color: col, fontSize: "1.3rem" }}>
                {o.val}
              </div>
              <div className="cs-kpi-label">{o.label}</div>
              <div className="cs-kpi-delta neutral" style={{ color: col }}>
                {o.note}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cs-two-col">
        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">📋 Campaign Execution Status</div>
              <div className="cs-card-sub">All active campaigns</div>
            </div>
          </div>
          {camps.length ? (
            camps.map((c, i) => {
              const stat = c.status || "active";
              const sc = stat === "active" ? "#10B981" : stat === "paused" ? "#F59E0B" : "#6B7280";
              const spend = Math.round((c.budget || 0) * 0.15);
              const pct = Math.min(Math.round((spend / (c.budget || 1)) * 100 * 12), 100);
              return (
                <div className="cs-insight" key={i}>
                  <div className="cs-insight-icon" style={{ background: `${sc}15`, color: sc }}>
                    🚀
                  </div>
                  <div className="cs-insight-text">
                    <div className="cs-insight-title">{c.name}</div>
                    <div className="cs-insight-sub">
                      {c.platform} · {c.budgetStr}/mo ·{" "}
                      <span style={{ color: sc, fontWeight: 700 }}>{stat.toUpperCase()}</span>
                    </div>
                    <div className="cs-bar-track" style={{ marginTop: 5, height: 5 }}>
                      <div className="cs-bar-fill" style={{ width: pct + "%", background: sc }} />
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "#9CA3AF", marginTop: 2 }}>
                      Budget pacing: {pct}% of monthly
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: "center", padding: 24, color: "#9CA3AF", fontSize: "0.82rem" }}>
              No campaigns launched yet
            </div>
          )}
        </div>

        <div className="cs-card">
          <div className="cs-card-header">
            <div>
              <div className="cs-card-title">⚡ AI Automation Log</div>
              <div className="cs-card-sub">Automated actions taken by InfoGenie</div>
            </div>
          </div>
          {logItems.map((a, i) => {
            const col = logColMap[a.type || ""] || "#7C3AED";
            return (
              <div className="cs-insight" key={i}>
                <div className="cs-insight-icon" style={{ background: `${col}15`, color: col }}>
                  ⚡
                </div>
                <div className="cs-insight-text">
                  <div className="cs-insight-title">{a.action}</div>
                  {a.impact && (
                    <div className="cs-insight-sub" style={{ color: "#059669" }}>
                      ✓ {a.impact}
                    </div>
                  )}
                  {a.date && (
                    <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>
                      {a.date} {a.time || ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="cs-card">
        <div className="cs-card-header">
          <div>
            <div className="cs-card-title">🔍 Operational Bottlenecks &amp; COO Actions</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {bottlenecks.map((b, i) => (
            <div key={i} style={{ background: b.bg, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: "1.1rem", marginBottom: 6 }}>{b.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: b.col, marginBottom: 4 }}>{b.title}</div>
              <div style={{ fontSize: "0.72rem", color: "#374151", lineHeight: 1.45 }}>{b.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

interface ReportProps {
  d: CsData;
  rm: RoleMeta;
  period: Period;
  setPeriod: (p: Period) => void;
}

const PDF_STYLE = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:28px 36px}
h1{font-size:1.5rem;color:#7C3AED;margin-bottom:4px}
.subtitle{font-size:0.8rem;color:#6B7280;margin-bottom:24px}
.logo-row{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.logo-icon{width:32px;height:32px;background:linear-gradient(135deg,#00C9C8,#0066FF);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:0.9rem}
.logo-text{font-size:1.2rem;font-weight:900;color:#0066FF}
.cs-exec-banner{background:var(--ig-panel);border-radius:12px;padding:20px 24px;margin-bottom:20px;color:var(--ig-text)}
.cs-exec-headline{font-size:1.2rem;font-weight:800;color:white;margin-bottom:4px}
.cs-exec-sub{font-size:0.75rem;color:rgba(255,255,255,.5)}
.cs-exec-stats{display:flex;gap:16px;margin-top:14px;flex-wrap:wrap}
.cs-exec-stat-val{font-size:1.2rem;font-weight:800;color:white}
.cs-exec-stat-label{font-size:0.58rem;color:rgba(255,255,255,.4);text-transform:uppercase}
.cs-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.cs-kpi{border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px}
.cs-kpi-val{font-size:1.3rem;font-weight:800;color:#7C3AED}
.cs-kpi-label{font-size:0.62rem;color:#6B7280;margin-top:3px}
.cs-kpi-delta{font-size:0.62rem;margin-top:2px;color:#10B981}
.cs-card{border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;margin-bottom:14px}
.cs-card-title{font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:10px}
.cs-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:0.72rem}
.cs-bar-label{min-width:110px;font-weight:600;color:#374151}
.cs-bar-track{flex:1;background:#F3F4F6;border-radius:4px;height:7px;overflow:hidden}
.cs-bar-fill{height:100%;border-radius:4px}
.cs-bar-val{font-size:0.7rem;font-weight:700;min-width:36px;text-align:right}
.cs-two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.cs-comp-table{width:100%;border-collapse:collapse;font-size:0.72rem}
.cs-comp-table th{background:#F9FAFB;padding:6px 8px;text-align:left;border-bottom:1px solid #E2E8F0;font-size:0.62rem;color:#6B7280;text-transform:uppercase}
.cs-comp-table td{padding:7px 8px;border-bottom:1px solid #F3F4F6}
.cs-alert{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:0.72rem}
.cs-alert-success{background:#F0FDF4;border:1px solid #86EFAC;color:#065F46}
.cs-alert-warning{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E}
.cs-alert-critical{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B}
.cs-insight{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #F3F4F6;font-size:0.75rem}
.cs-exec-role-badge{display:inline-block;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:99px;padding:3px 12px;font-size:0.62rem;font-weight:700;color:#C4B5FD;text-transform:uppercase;margin-bottom:10px}
.footer{margin-top:32px;font-size:0.65rem;color:#9CA3AF;text-align:center;border-top:1px solid #E2E8F0;padding-top:14px}
@media print{body{padding:12px 16px}@page{margin:10mm 8mm}}`;

export default function Csuite() {
  const [role, setRole] = useState<Role>("ceo");
  const [period, setPeriod] = useState<Period>("30d");
  const wrapRef = useRef<HTMLDivElement>(null);

  const d = csData();
  const rm = roleMap[role];

  function exportPDF() {
    const roleU = role.toUpperCase();
    const roleLabel =
      { CEO: "Chief Executive Officer", CMO: "Chief Marketing Officer", CFO: "Chief Financial Officer", COO: "Chief Operating Officer" }[
        roleU
      ] || roleU;
    const content = wrapRef.current?.innerHTML || "";
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>InfoGenie ${roleU} Report</title>
<style>
${PDF_STYLE}
</style></head>
<body>
<div class="logo-row"><div class="logo-icon">IG</div><div class="logo-text">InfoGenie</div></div>
<h1>${roleU} Executive Report — ${roleLabel}</h1>
<div class="subtitle">Generated: ${new Date().toLocaleString()} · Period: ${csPeriodLabel(period)} · Confidential</div>
${content}
<div class="footer">InfoGenie — AI Autonomous Marketing Intelligence &nbsp;·&nbsp; Confidential — Board Use Only</div>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`;

    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) {
      showToast("⚠ Allow pop-ups to export PDF");
      return;
    }
    win.document.write(html);
    win.document.close();
    showToast(`📄 ${roleU} report opening for PDF export`);
  }

  return (
    <div className="view">
      <div
        className="view-header ig-panel-hero"
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
          borderBottom: "1px solid rgba(124,58,237,.25)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span> <span className="bc-sep">›</span> C-Suite Reports
              </div>
              <h2 className="view-title">C-Suite Executive Intelligence</h2>
              <p className="view-sub">
                Board-ready dashboards for CEO, CMO, CFO and COO — one click to PDF
              </p>
            </div>
            <div className="vh-actions" style={{ gap: 10 }}>
              <div className="cs-role-tabs" id="csRoleTabs">
                {(["ceo", "cmo", "cfo", "coo"] as Role[]).map((r) => (
                  <button
                    key={r}
                    className={`cs-role-btn${role === r ? " active" : ""}`}
                    onClick={() => setRole(r)}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              <button className="btn-primary" onClick={exportPDF}>
                📄 Export PDF
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="container" ref={wrapRef} style={{ paddingTop: 28, paddingBottom: 60 }}>
        <ROIPanel d={d} />
        {role === "ceo" && <CEOReport d={d} rm={rm} period={period} setPeriod={setPeriod} />}
        {role === "cmo" && <CMOReport d={d} rm={rm} period={period} setPeriod={setPeriod} />}
        {role === "cfo" && <CFOReport d={d} rm={rm} period={period} setPeriod={setPeriod} />}
        {role === "coo" && <COOReport d={d} rm={rm} period={period} setPeriod={setPeriod} />}
      </div>
    </div>
  );
}
