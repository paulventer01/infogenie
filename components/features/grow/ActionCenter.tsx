"use client";

// Native React port of the legacy `action-center` panel (was
// `initActionCenter` / `acBuild` in public/js/ig_csuite.js + `#view-action-center`
// in index.html). Renders a live marketing command view — What's Live, Going
// Live / Next Actions, Risks and Opportunities — derived from the legacy
// in-memory SPA state (window._launchedCampaigns, window._infoGenieActions,
// window.analysisData, window._brandAssets, window._abTests) and the shared
// window.getIndustryROASBenchmark helper. Cross-tool links use goToView().
// No new /api/* calls — this panel summarises already-loaded client state,
// exactly like the legacy builder.
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface AcCampaign {
  name?: string;
  platform?: string;
  budget?: number;
  metrics?: {
    roas?: number | string;
    ctr?: string;
    cpa?: string;
    spend?: number;
    conversions?: number;
    impressions?: number;
  };
  launchedAt?: string;
}
interface AcCompetitor {
  name?: string;
  roas?: number;
  adSpend?: number;
  estimatedAdSpend?: number;
}
interface AcAnalysis {
  competitors?: AcCompetitor[];
  industry?: { name?: string } | string;
}
interface Bench {
  avg: number;
  top: number;
  min: number;
  label: string;
}

interface LiveItem {
  icon: string;
  color: string;
  tag: string;
  title: string;
  detail: string;
  meta: string;
}
interface GoingItem {
  icon: string;
  color: string;
  tag: string;
  title: string;
  detail: string;
  view?: string;
  ctaLabel?: string;
}
interface RiskItem {
  sev: "high" | "medium" | "low";
  icon: string;
  title: string;
  detail: string;
  action: string;
}
interface OppItem {
  icon: string;
  color: string;
  title: string;
  detail: string;
  upside: string;
}

interface AcModel {
  liveItems: LiveItem[];
  goingLive: GoingItem[];
  risks: RiskItem[];
  opps: OppItem[];
  ts: string;
  indLabel: string;
  compsLen: number;
  campsLen: number;
}

function getWin() {
  return window as unknown as {
    _launchedCampaigns?: AcCampaign[];
    _infoGenieActions?: unknown[];
    analysisData?: AcAnalysis;
    _brandAssets?: unknown[];
    _abTests?: unknown[];
    getIndustryROASBenchmark?: () => Bench;
  };
}

function buildModel(): AcModel {
  const win = getWin();
  const camps = win._launchedCampaigns || [];
  const actions = win._infoGenieActions || [];
  const ad = win.analysisData;
  const comps = ad?.competitors || [];
  const bench: Bench =
    typeof win.getIndustryROASBenchmark === "function"
      ? win.getIndustryROASBenchmark()
      : { avg: 3.5, top: 6.0, min: 2.0, label: "Your Industry" };
  const assets = win._brandAssets || [];
  const abTests = win._abTests || [];
  const budget = camps.reduce((s, c) => s + (c.budget || 0), 0);
  const avgROAS = camps.length
    ? camps.reduce(
        (s, c) => s + parseFloat(String(c.metrics?.roas ?? bench.avg)),
        0,
      ) / camps.length
    : 0;
  const indLabel = bench.label;

  // ── What's LIVE ──
  const liveItems: LiveItem[] = [
    ...camps.map((c) => ({
      icon: "🚀",
      color: "#10B981",
      tag: "CAMPAIGN LIVE",
      title: c.name || "Campaign",
      detail: `${c.platform} · $${(c.budget || 0).toLocaleString()}/mo · ROAS ${parseFloat(String(c.metrics?.roas ?? bench.avg)).toFixed(1)}×`,
      meta: c.launchedAt || "Active",
    })),
    ...(ad
      ? [
          {
            icon: "🔍",
            color: "#00C9C8",
            tag: "ANALYSIS ACTIVE",
            title: `Competitive intelligence — ${comps.length} rivals tracked`,
            detail: `${indLabel} · ${comps.length} competitor${comps.length !== 1 ? "s" : ""} monitored in real-time`,
            meta: "Live",
          },
        ]
      : []),
    ...(actions.length
      ? [
          {
            icon: "⚡",
            color: "#0f766e",
            tag: "AUTOMATIONS RUNNING",
            title: `${actions.length} AI automation${actions.length !== 1 ? "s" : ""} executed`,
            detail: `~${(actions.length * 2.5).toFixed(0)} hours of manual work saved by InfoGenie`,
            meta: `${actions.length} actions`,
          },
        ]
      : []),
    ...(assets.length
      ? [
          {
            icon: "🖼️",
            color: "#0066FF",
            tag: "BRAND ASSETS LIVE",
            title: `${assets.length} creative asset${assets.length !== 1 ? "s" : ""} in library`,
            detail: "Brand creatives available for campaign deployment",
            meta: `${assets.length} files`,
          },
        ]
      : []),
    ...(abTests.length
      ? [
          {
            icon: "🧪",
            color: "#F59E0B",
            tag: "A/B TESTS RUNNING",
            title: `${abTests.length} split test${abTests.length !== 1 ? "s" : ""} active`,
            detail:
              "Live experiments running — check Campaign view for results",
            meta: "Testing",
          },
        ]
      : []),
  ];

  // ── Going LIVE ──
  const goingLive: GoingItem[] = [
    ...(!ad
      ? [
          {
            icon: "🔍",
            color: "#6B7280",
            tag: "NEXT STEP",
            title: "Run competitor analysis",
            detail:
              "Enter your website URL to activate market intelligence — unlocks all features",
            view: "home",
            ctaLabel: "Start Analysis",
          },
        ]
      : []),
    ...(camps.length === 0
      ? [
          {
            icon: "🚀",
            color: "#6B7280",
            tag: "RECOMMENDED",
            title: "Launch your first ad campaign",
            detail: `InfoGenie has ${ad ? "campaign templates ready" : "AI-powered templates"} — takes 2 minutes to deploy`,
            view: "campaigns",
            ctaLabel: "Go to Campaigns",
          },
        ]
      : []),
    ...(assets.length === 0
      ? [
          {
            icon: "🖼️",
            color: "#6B7280",
            tag: "RECOMMENDED",
            title: "Upload brand creatives",
            detail:
              "Add your logos and ad images to the Brand Assets library for faster campaign deployment",
            view: "brand-assets",
            ctaLabel: "Upload Assets",
          },
        ]
      : []),
    ...(abTests.length === 0 && camps.length > 0
      ? [
          {
            icon: "🧪",
            color: "#6B7280",
            tag: "IMPROVE ROAS",
            title: "Start your first A/B test",
            detail: `Split testing typically lifts ROAS by 15–25% in ${indLabel} — quick win available`,
            view: "campaigns",
            ctaLabel: "Set Up Test",
          },
        ]
      : []),
    {
      icon: "📊",
      color: "#6B7280",
      tag: "AVAILABLE NOW",
      title: "C-Suite executive reports",
      detail:
        "CEO/CMO/CFO/COO dashboards with PDF export — ready to share with your board",
      view: "csuite",
      ctaLabel: "View Reports",
    },
    {
      icon: "🤖",
      color: "#6B7280",
      tag: "AVAILABLE NOW",
      title: "Configure AI automations",
      detail:
        "Set up automated campaign optimisation, alert triggers and scheduled reports",
      view: "automations",
      ctaLabel: "Set Up Automations",
    },
  ];

  // ── Risks ──
  const risks: RiskItem[] = [];
  if (!ad) {
    risks.push({
      sev: "high",
      icon: "🔴",
      title: "No competitor intelligence active",
      detail:
        "Without analysis, you have no visibility into what competitors are spending, where they're winning, or how to outbid them.",
      action: "Run analysis from the home page",
    });
  }
  if (camps.length === 0) {
    risks.push({
      sev: "high",
      icon: "🔴",
      title: "Zero campaigns live — no market presence",
      detail:
        "Competitors are capturing the audiences that should be yours. Every day without campaigns is budget given to rivals.",
      action: "Launch at least one campaign to establish presence",
    });
  }
  if (avgROAS > 0 && avgROAS < bench.min) {
    risks.push({
      sev: "high",
      icon: "🔴",
      title: `ROAS ${avgROAS.toFixed(1)}× is below the ${indLabel} minimum (${bench.min}×)`,
      detail:
        "Your campaigns are burning budget below break-even for this industry. Immediate restructure required.",
      action: `Pause underperformers and restructure targeting to reach ${bench.avg}× minimum`,
    });
  } else if (avgROAS > 0 && avgROAS < bench.avg) {
    risks.push({
      sev: "medium",
      icon: "🟡",
      title: `ROAS ${avgROAS.toFixed(1)}× below ${indLabel} average (${bench.avg}×)`,
      detail: `You're profitable but leaving money on the table. ${indLabel} top performers achieve ${bench.top}×.`,
      action: `Optimise bidding and creative to push towards ${bench.avg}× industry average`,
    });
  }
  if (assets.length === 0) {
    risks.push({
      sev: "medium",
      icon: "🟡",
      title: "No brand creative assets uploaded",
      detail:
        "Ad campaigns using generic or placeholder creatives underperform by 40–60%. Brand consistency directly impacts ROAS.",
      action: "Upload brand logo, ad images and approved creative variants",
    });
  }
  if (comps.length > 0 && budget > 0) {
    const biggestComp = comps[0];
    const theirSpend =
      biggestComp?.adSpend || biggestComp?.estimatedAdSpend || "Unknown";
    risks.push({
      sev: "medium",
      icon: "🟡",
      title: `${biggestComp.name} is your primary competitive threat in ${indLabel}`,
      detail: `${biggestComp.name} is actively running campaigns targeting the same audience segments. Their ad spend: ${typeof theirSpend === "number" ? "$" + theirSpend.toLocaleString() : theirSpend}.`,
      action:
        "Use competitor intelligence in Results to find and exploit their weak spots",
    });
  }
  if (budget > 0 && abTests.length === 0) {
    risks.push({
      sev: "low",
      icon: "🟢",
      title: "No A/B tests running — creative fatigue risk",
      detail: `In ${indLabel}, ad creative fatigue typically sets in after 21 days. Without split testing, CTR will decline 10–15% per month.`,
      action: "Start a 50/50 creative split test in the Campaigns view",
    });
  }
  if (risks.length === 0) {
    risks.push({
      sev: "low",
      icon: "🟢",
      title: "No critical risks detected",
      detail:
        "Your marketing setup looks healthy. Keep monitoring ROAS against the industry benchmark and refresh creatives regularly.",
      action: "Continue monitoring via C-Suite reports",
    });
  }

  // ── Opportunities ──
  const opps: OppItem[] = [];
  if (comps.length > 0) {
    const weakComp = [...comps].sort(
      (a, b) => (a.roas || 99) - (b.roas || 99),
    )[0];
    if (weakComp) {
      const gap = weakComp.roas
        ? (bench.avg - weakComp.roas).toFixed(1)
        : "1.5";
      opps.push({
        icon: "⚔️",
        color: "#0f766e",
        title: `Exploit ${weakComp.name}'s ROAS gap`,
        detail: `${weakComp.name} is running at ${weakComp.roas || "—"}× ROAS — ${gap}× below the ${indLabel} average. Their wasted ad spend is a direct capture opportunity for your brand.`,
        upside: `+${gap}× ROAS potential on competitor-targeted campaigns`,
      });
    }
  }
  if (avgROAS > 0 && avgROAS < bench.top) {
    const lift = (bench.top - avgROAS).toFixed(1);
    opps.push({
      icon: "📈",
      color: "#10B981",
      title: `Scale to ${bench.top}× ROAS — top ${indLabel} benchmark`,
      detail: `Your current ${avgROAS.toFixed(1)}× ROAS has headroom to reach ${bench.top}× (top 10% of ${indLabel}). The gap = ${lift}× of unrealised revenue per $1 spent.`,
      upside: `${lift}× ROAS improvement = $${Math.round(budget * parseFloat(lift)).toLocaleString()}/mo additional revenue at current spend`,
    });
  }
  if (camps.length > 0) {
    const bestCamp = camps
      .slice()
      .sort(
        (a, b) =>
          parseFloat(String(b.metrics?.roas ?? 0)) -
          parseFloat(String(a.metrics?.roas ?? 0)),
      )[0];
    if (bestCamp && parseFloat(String(bestCamp.metrics?.roas ?? 0)) > bench.avg) {
      opps.push({
        icon: "🚀",
        color: "#0066FF",
        title: `Scale "${bestCamp.name}" — top performing campaign`,
        detail: `This campaign is running above the ${indLabel} average at ${parseFloat(String(bestCamp.metrics?.roas ?? bench.avg)).toFixed(1)}×. Increasing budget here has the highest probability of efficient return.`,
        upside:
          "Scale budget by 30% to capture additional high-intent audience without efficiency loss",
      });
    }
  }
  if (ad && comps.length > 0) {
    const unusedCh = ["TikTok", "Pinterest", "LinkedIn", "YouTube"].find(
      (ch) =>
        !camps.some((c) =>
          c.platform?.toLowerCase().includes(ch.toLowerCase()),
        ),
    );
    if (unusedCh) {
      opps.push({
        icon: "📡",
        color: "#00C9C8",
        title: `Untapped channel: ${unusedCh} is underused by competitors`,
        detail: `InfoGenie's analysis shows competitors have minimal ${unusedCh} presence. First-mover advantage in ${indLabel} on this platform typically delivers 0.5–0.8× ROAS premium.`,
        upside: `Test $500/mo on ${unusedCh} — expect lower CPC and higher reach in under-served segments`,
      });
    }
  }
  if (opps.length === 0) {
    opps.push({
      icon: "💡",
      color: "#0066FF",
      title: "Run analysis to unlock personalised opportunities",
      detail:
        "After InfoGenie analyses your website and competitors, AI identifies specific gaps, keyword opportunities and audience segments tailored to your market.",
      upside: "Complete the analysis to see your custom opportunity playbook",
    });
  }

  return {
    liveItems,
    goingLive,
    risks,
    opps,
    ts: new Date().toLocaleString(),
    indLabel,
    compsLen: comps.length,
    campsLen: camps.length,
  };
}

const SEV_CFG = {
  high: { bg: "#FEF2F2", bd: "#FECACA", col: "#DC2626", label: "HIGH" },
  medium: { bg: "#FFFBEB", bd: "#FDE68A", col: "#D97706", label: "MEDIUM" },
  low: { bg: "#F0FDF4", bd: "#86EFAC", col: "#059669", label: "LOW" },
};
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function Card({
  title,
  sub,
  empty,
  children,
}: {
  title: string;
  sub: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E2E8F0",
        borderRadius: 18,
        padding: "22px 24px",
        marginBottom: 22,
        boxShadow: "0 1px 6px rgba(0,0,0,.05)",
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "0.95rem",
            fontWeight: 800,
            color: "#0A1628",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
          {sub}
        </div>
      </div>
      {empty ? (
        <div
          style={{
            textAlign: "center",
            padding: 28,
            color: "#9CA3AF",
            fontSize: "0.82rem",
          }}
        >
          No items yet
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export default function ActionCenter() {
  const router = useRouter();
  const [model, setModel] = useState<AcModel | null>(null);

  const rebuild = useCallback(() => {
    setModel(buildModel());
  }, []);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  if (!model) return null;

  const { liveItems, goingLive, risks, opps, ts, indLabel, compsLen, campsLen } =
    model;
  const sortedRisks = [...risks].sort(
    (a, b) => (SEV_ORDER[a.sev] ?? 2) - (SEV_ORDER[b.sev] ?? 2),
  );
  const critCount = risks.filter((r) => r.sev === "high").length;
  const liveCount = liveItems.length;
  const oppCount = opps.length;

  const stats: [string, number, string][] = [
    ["🟢 Live", liveCount, "#059669"],
    ["🔜 Going Live", goingLive.length, "#0284c7"],
    ["⚠️ Risks", risks.length, critCount > 0 ? "#dc2626" : "#d97706"],
    ["💡 Opportunities", opps.length, "#0f766e"],
  ];

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
          borderBottom: "1px solid rgba(0,229,255,.2)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span>{" "}
                <span className="bc-sep">›</span> Action Center
              </div>
              <h2 className="view-title">Action Center</h2>
              <p className="view-sub">
                Live status, upcoming launches, risks and opportunities — your
                full marketing command view
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-secondary" onClick={rebuild}>
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 28, paddingBottom: 60 }}
      >
        {/* Summary Banner — light card so stat colours stay readable (dark --ig-grad +
            light-theme text overrides made blue-on-blue numbers invisible). */}
        <div
          className="ac-command-banner"
          style={{
            background:
              "linear-gradient(135deg, #e7f5f2 0%, #eaf3fb 55%, #eef6ff 100%)",
            borderRadius: 18,
            padding: "22px 28px",
            marginBottom: 28,
            border: "1px solid rgba(15, 118, 110, 0.22)",
            boxShadow: "0 4px 18px rgba(11, 18, 32, 0.06)",
          }}
        >
          <div className="ac-cmd-eyebrow" style={{ fontSize: "0.68rem", fontWeight: 700, color: "#0f766e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
            🎯 Command Overview — {ts}
          </div>
          <div className="ac-cmd-headline" style={{ fontFamily: "Sora,sans-serif", fontSize: "1.35rem", fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
            {liveCount} item{liveCount !== 1 ? "s" : ""} live · {critCount}{" "}
            critical risk{critCount !== 1 ? "s" : ""} · {oppCount} opportunit
            {oppCount === 1 ? "y" : "ies"} ready
          </div>
          <div className="ac-cmd-sub" style={{ fontSize: "0.8rem", color: "#334155", marginBottom: 18 }}>
            {indLabel} · InfoGenie AI monitoring {compsLen} competitor
            {compsLen !== 1 ? "s" : ""} · {campsLen} campaign
            {campsLen !== 1 ? "s" : ""} active
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {stats.map(([l, v, c], i) => (
              <div
                key={i}
                className="ac-cmd-stat"
                style={{
                  textAlign: "center",
                  background: "rgba(255,255,255,0.72)",
                  border: "1px solid rgba(15, 118, 110, 0.14)",
                  borderRadius: 12,
                  padding: "12px 8px",
                }}
              >
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1.6rem",
                    fontWeight: 800,
                    color: c,
                    lineHeight: 1.1,
                  }}
                >
                  {v}
                </div>
                <div
                  className="ac-cmd-stat-label"
                  style={{
                    fontSize: "0.65rem",
                    color: "#475569",
                    marginTop: 6,
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                    fontWeight: 700,
                  }}
                >
                  {l}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Two-column layout */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 22,
          }}
        >
          <div>
            {/* What's Live */}
            <Card
              title="🟢 What's Live"
              sub={`${liveItems.length} active item${liveItems.length !== 1 ? "s" : ""} — updated ${ts}`}
              empty={liveItems.length === 0}
            >
              {liveItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: "1px solid #F3F4F6",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: `${item.color}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1rem",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 3,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: item.color,
                          background: `${item.color}15`,
                          border: `1px solid ${item.color}30`,
                          borderRadius: 99,
                          padding: "2px 8px",
                        }}
                      >
                        {item.tag}
                      </span>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: "#0A1628",
                        }}
                      >
                        {item.title}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.73rem", color: "#6B7280" }}>
                      {item.detail}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      color: item.color,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {item.meta}
                  </div>
                </div>
              ))}
            </Card>

            {/* Going Live */}
            <Card
              title="🔜 Going Live / Next Actions"
              sub={`${goingLive.length} recommended item${goingLive.length !== 1 ? "s" : ""} — priority order`}
              empty={goingLive.length === 0}
            >
              {goingLive.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: "1px solid #F3F4F6",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: "#F3F4F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1rem",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 3,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: item.color,
                          background: `${item.color}15`,
                          border: `1px solid ${item.color}30`,
                          borderRadius: 99,
                          padding: "2px 8px",
                        }}
                      >
                        {item.tag}
                      </span>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          color: "#0A1628",
                        }}
                      >
                        {item.title}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.73rem",
                        color: "#6B7280",
                        marginBottom: 6,
                      }}
                    >
                      {item.detail}
                    </div>
                    {item.view && (
                      <button
                        onClick={() => goToView(router, item.view as string)}
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: "#0066FF",
                          background: "#EFF6FF",
                          border: "1px solid #BFDBFE",
                          borderRadius: 6,
                          padding: "3px 10px",
                          cursor: "pointer",
                        }}
                      >
                        → {item.ctaLabel}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </div>

          <div>
            {/* Risks */}
            <Card
              title="⚠️ Risks"
              sub={`${risks.filter((r) => r.sev === "high").length} critical, ${risks.filter((r) => r.sev === "medium").length} medium, ${risks.filter((r) => r.sev === "low").length} low`}
              empty={risks.length === 0}
            >
              {sortedRisks.map((r, i) => {
                const cfg = SEV_CFG[r.sev] || SEV_CFG.low;
                return (
                  <div
                    key={i}
                    style={{
                      background: cfg.bg,
                      border: `1px solid ${cfg.bd}`,
                      borderRadius: 12,
                      padding: "14px 16px",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "1.1rem",
                          lineHeight: 1.2,
                          flexShrink: 0,
                        }}
                      >
                        {r.icon}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 4,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.62rem",
                              fontWeight: 800,
                              color: cfg.col,
                              background: `${cfg.col}20`,
                              borderRadius: 4,
                              padding: "1px 7px",
                              textTransform: "uppercase",
                            }}
                          >
                            {cfg.label} RISK
                          </span>
                          <span
                            style={{
                              fontSize: "0.82rem",
                              fontWeight: 700,
                              color: "#0A1628",
                            }}
                          >
                            {r.title}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#374151",
                            marginBottom: 6,
                            lineHeight: 1.45,
                          }}
                        >
                          {r.detail}
                        </div>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            color: cfg.col,
                          }}
                        >
                          ▶ {r.action}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* Opportunities */}
            <Card
              title="💡 Opportunities"
              sub={`${opps.length} exploitable opportunity${opps.length !== 1 ? "s" : ""} identified for ${indLabel}`}
              empty={opps.length === 0}
            >
              {opps.map((o, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid #E2E8F0",
                    borderLeft: `3px solid ${o.color}`,
                    borderRadius: 12,
                    padding: "14px 16px",
                    marginBottom: 10,
                    background: "#FAFAFA",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        background: `${o.color}15`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1rem",
                        flexShrink: 0,
                      }}
                    >
                      {o.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          color: "#0A1628",
                          marginBottom: 4,
                        }}
                      >
                        {o.title}
                      </div>
                      <div
                        style={{
                          fontSize: "0.73rem",
                          color: "#6B7280",
                          marginBottom: 8,
                          lineHeight: 1.45,
                        }}
                      >
                        {o.detail}
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: `${o.color}12`,
                          border: `1px solid ${o.color}25`,
                          borderRadius: 8,
                          padding: "5px 10px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            color: o.color,
                          }}
                        >
                          📈 UPSIDE: {o.upside}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
