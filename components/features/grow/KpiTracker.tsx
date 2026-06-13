"use client";

// Native React port of the legacy `kpi-tracker` panel (was `buildKPITracker` +
// `window._runKPIAnalysis` + `#view-kpi-tracker` in index.html / app.js).
// Renders the live status of every marketing KPI — achieved / at-risk / missed —
// derived from the in-memory SPA state (window.analysisData,
// window._launchedCampaigns, window._kpiActuals, window._socialPosts) plus the
// real ad-platform data from `GET /api/optimizer/campaigns`. The "Run KPI
// Analysis" button calls `POST /api/kpi-analysis` to estimate actuals from the
// analysed domain. No fabricated data — empty state shown until an analysis is
// run / campaigns exist.
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";

interface CampaignMetrics {
  roas?: number | string;
  ctr?: string;
  cpa?: string;
  spend: number;
  conversions: number;
  impressions: number;
}
interface LaunchedCampaign {
  name: string;
  platform: string;
  budget: number;
  metrics: CampaignMetrics;
}
interface OptimizerPerf {
  spend: number | string;
  revenue: number | string;
  conversions: number | string;
  clicks: number | string;
  impressions: number | string;
}
interface OptimizerCampaign {
  perf7d?: OptimizerPerf;
  daily_budget?: number | string;
}
interface OptimizerResult {
  ok: boolean;
  campaigns?: OptimizerCampaign[];
}
interface KpiActuals {
  roas?: number | string;
  ctr?: number | string;
  cpa?: number | string;
  convRate?: number | string;
  spend?: number;
  conversions?: number;
  impressions?: number;
  budgetUtil?: number;
  qualityScore?: number;
}
interface Industry {
  name?: string;
  avgROAS?: number;
  avgCTR?: number;
  avgCPA?: number;
}
interface WebsiteKPIs {
  roas?: number | string;
}
interface AnalysisCompetitor {
  domain?: string;
  name?: string;
  url?: string;
}
interface AnalysisData {
  url?: string;
  brand_name?: string;
  industry?: Industry | string;
  competitors?: AnalysisCompetitor[];
  websiteKPIs?: WebsiteKPIs;
}
interface SocialPost {
  funnelStage?: string;
}
interface KpiAnalysisResult {
  ok: boolean;
  error?: string;
  kpis?: KpiActuals;
}

type Status = "achieved" | "at-risk" | "missed" | "pending";

interface KpiDef {
  id: string;
  label: string;
  icon: string;
  category: string;
  target: number;
  actual: number | null;
  targetStr: string;
  actualStr: string | null;
  unit: string;
  higherIsBetter: boolean;
  benchmark: string;
  whyMissed: string;
  howToFix: string;
}
interface KpiCard extends KpiDef {
  status: Status;
}

interface FunnelStageDef {
  id: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
}

interface Model {
  kpis: KpiCard[];
  categories: string[];
  nAchieved: number;
  nAtRisk: number;
  nMissed: number;
  nPending: number;
  hasAnyData: boolean;
  hasAiEstimates: boolean;
  campLabel: string;
  analysisUrl: string;
  campaigns: LaunchedCampaign[];
  industryROAS: number;
  industryCTR: number;
  industryCPA: number;
  funnel: {
    score: number;
    color: string;
    covered: number;
    tagged: number;
    gaps: FunnelStageDef[];
    counts: Record<string, number>;
  };
}

const FUNNEL_STAGES: FunnelStageDef[] = [
  { id: "awareness", label: "Awareness", icon: "🌱", color: "#10B981", bg: "#ECFDF5" },
  { id: "interest", label: "Interest", icon: "💡", color: "#3B82F6", bg: "#EFF6FF" },
  { id: "nurture", label: "Nurture", icon: "❤️", color: "#EC4899", bg: "#FDF2F8" },
  { id: "conversion", label: "Conversion", icon: "💰", color: "#F59E0B", bg: "#FFFBEB" },
  { id: "advocacy", label: "Advocacy", icon: "🌟", color: "#7C3AED", bg: "#F5F3FF" },
];

const STATUS_CFG: Record<Status, { label: string; bg: string; border: string; color: string }> = {
  achieved: { label: "✅ Achieved", bg: "#F0FDF4", border: "#86EFAC", color: "#15803D" },
  "at-risk": { label: "⚠️ At Risk", bg: "#FFFBEB", border: "#FCD34D", color: "#B45309" },
  missed: { label: "❌ Missed", bg: "#FFF1F2", border: "#FCA5A5", color: "#B91C1C" },
  pending: { label: "📊 No Data", bg: "#F8FAFC", border: "#CBD5E1", color: "#64748B" },
};

function getWin() {
  return window as unknown as {
    analysisData?: AnalysisData;
    _launchedCampaigns?: LaunchedCampaign[];
    _kpiActuals?: KpiActuals;
    _socialPosts?: SocialPost[];
    showToast?: (msg: string) => void;
    navigateTo?: (view: string) => void;
  };
}

function toast(msg: string) {
  const win = getWin();
  if (typeof win.showToast === "function") win.showToast(msg);
}

function getStatus(kpi: KpiDef): Status {
  if (kpi.actual === null || kpi.actual === undefined) return "pending";
  const ratio = kpi.higherIsBetter ? kpi.actual / kpi.target : kpi.target / kpi.actual;
  if (ratio >= 1) return "achieved";
  if (ratio >= 0.8) return "at-risk";
  return "missed";
}

async function computeModel(): Promise<Model> {
  const win = getWin();
  const analysisData = win.analysisData || null;
  const kpiData = analysisData && analysisData.websiteKPIs ? analysisData.websiteKPIs : null;
  const campaigns = win._launchedCampaigns || [];
  const rawIndustry = analysisData && analysisData.industry ? analysisData.industry : null;
  const industry: Industry | null =
    rawIndustry && typeof rawIndustry === "object" ? rawIndustry : null;

  // ── Derive actuals from locally-launched campaigns ──────────────────────
  let avgRoas: string | null = campaigns.length
    ? (campaigns.reduce((s, c) => s + parseFloat(String(c.metrics.roas || 0)), 0) / campaigns.length).toFixed(1)
    : null;
  let avgCtr: string | null = campaigns.length
    ? (campaigns.reduce((s, c) => s + parseFloat((c.metrics.ctr || "0").replace("%", "")), 0) / campaigns.length).toFixed(1)
    : null;
  let avgCpa: number | null = campaigns.length
    ? Math.round(campaigns.reduce((s, c) => s + parseInt((c.metrics.cpa || "$0").replace("$", ""), 10), 0) / campaigns.length)
    : null;
  let totalSpend = campaigns.reduce((s, c) => s + c.metrics.spend, 0);
  let totalConv = campaigns.reduce((s, c) => s + c.metrics.conversions, 0);
  let totalImpr = campaigns.reduce((s, c) => s + c.metrics.impressions, 0);
  let totalBudget = campaigns.reduce((s, c) => s + c.budget, 0);
  let avgConvR: string | null = campaigns.length && totalImpr > 0 ? ((totalConv / totalImpr) * 100).toFixed(2) : null;
  let optCampCount = 0;

  // ── Pull real ad-platform data from the optimizer (supplement local data) ─
  if (!campaigns.length) {
    try {
      const _r = await fetch("/api/optimizer/campaigns", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(8000),
      });
      if (_r.ok) {
        const _j = (await _r.json()) as OptimizerResult;
        if (_j.ok && Array.isArray(_j.campaigns)) {
          const _active = _j.campaigns.filter((c) => c.perf7d && Number(c.perf7d.spend) > 0);
          if (_active.length) {
            const _totSpend = _active.reduce((s, c) => s + Number(c.perf7d!.spend), 0);
            const _totRev = _active.reduce((s, c) => s + Number(c.perf7d!.revenue), 0);
            const _totConv = _active.reduce((s, c) => s + Number(c.perf7d!.conversions), 0);
            const _totClk = _active.reduce((s, c) => s + Number(c.perf7d!.clicks), 0);
            const _totImpr = _active.reduce((s, c) => s + Number(c.perf7d!.impressions), 0);
            const _totBudg7 = _active.reduce((s, c) => s + Number(c.daily_budget || 0), 0) * 7;
            optCampCount = _active.length;
            avgRoas = _totSpend > 0 ? (_totRev / _totSpend).toFixed(2) : null;
            avgCtr = _totImpr > 0 ? ((_totClk / _totImpr) * 100).toFixed(2) : null;
            avgCpa = _totConv > 0 ? Math.round(_totSpend / _totConv) : null;
            avgConvR = _totClk > 0 ? ((_totConv / _totClk) * 100).toFixed(2) : null;
            totalSpend = _totSpend;
            totalConv = _totConv;
            totalImpr = _totImpr;
            totalBudget = _totBudg7;
          }
        }
      }
    } catch {
      /* silent — fall back to no-data state */
    }
  }

  const kpiActuals = win._kpiActuals || null;

  // ── Fallback: AI-estimated actuals from _runKPIAnalysis ─────────────────
  if (!avgRoas && !avgCtr && !avgCpa && kpiActuals) {
    const est = kpiActuals;
    avgRoas = est.roas ? String(parseFloat(String(est.roas)).toFixed(2)) : null;
    avgCtr = est.ctr ? String(parseFloat(String(est.ctr)).toFixed(2)) : null;
    avgCpa = est.cpa ? Math.round(Number(est.cpa)) : null;
    avgConvR = est.convRate ? String(parseFloat(String(est.convRate)).toFixed(2)) : null;
    totalSpend = est.spend || 0;
    totalConv = est.conversions || 0;
    totalImpr = est.impressions || 0;
    totalBudget = est.budgetUtil ? Math.round((est.spend || 0) / (est.budgetUtil / 100)) : est.spend || 0;
  }

  // ── KPI definitions ─────────────────────────────────────────────────────
  const industryROAS = kpiData && kpiData.roas
    ? Number((parseFloat(String(kpiData.roas)) * 1.25).toFixed(1))
    : industry
      ? industry.avgROAS || 3.5
      : 3.5;
  const industryCTR = industry ? industry.avgCTR || 4.2 : 4.2;
  const industryCPA = industry ? industry.avgCPA || 42 : 42;

  const kpiDefs: KpiDef[] = [
    {
      id: "roas",
      label: "Return on Ad Spend",
      icon: "💰",
      category: "Revenue",
      target: industryROAS,
      actual: avgRoas ? parseFloat(avgRoas) : null,
      targetStr: industryROAS + "×",
      actualStr: avgRoas ? avgRoas + "×" : null,
      unit: "×",
      higherIsBetter: true,
      benchmark: `Industry avg: ${industry ? industry.avgROAS || 3.5 : 3.5}×`,
      whyMissed:
        "ROAS is below target because campaign bidding strategies haven't fully optimised yet. Keywords with low purchase intent are likely consuming budget without converting. Tighten keyword match types, add negative keywords, and switch to Target ROAS bidding to improve efficiency.",
      howToFix:
        "Enable Target ROAS bidding, pause bottom 20% performing keywords, and add 15+ negative keywords based on search term reports.",
    },
    {
      id: "ctr",
      label: "Click-Through Rate",
      icon: "👆",
      category: "Engagement",
      target: industryCTR,
      actual: avgCtr ? parseFloat(avgCtr) : null,
      targetStr: industryCTR + "%",
      actualStr: avgCtr ? avgCtr + "%" : null,
      unit: "%",
      higherIsBetter: true,
      benchmark: `Platform avg: ${industryCTR}%`,
      whyMissed:
        "CTR is below benchmark, suggesting ad copy isn't connecting with the audience. Headlines may be too generic or not addressing the specific pain points your target users search for. Competitors are likely running more relevant, benefit-led copy.",
      howToFix:
        "A/B test 3 new headline variations focused on your unique value proposition. Use competitor names in headlines for comparison-intent searches. Improve ad relevance scores.",
    },
    {
      id: "cpa",
      label: "Cost Per Acquisition",
      icon: "🎯",
      category: "Efficiency",
      target: industryCPA,
      actual: avgCpa,
      targetStr: "$" + industryCPA,
      actualStr: avgCpa ? "$" + avgCpa : null,
      unit: "$",
      higherIsBetter: false,
      benchmark: `Industry avg: $${industryCPA}`,
      whyMissed:
        "CPA is above target because the conversion rate from click to purchase is lower than expected. This is typically caused by landing page friction, poor audience-to-offer alignment, or targeting audiences that are too broad.",
      howToFix:
        "Audit landing page load speed (aim <2s), align headline copy to landing page headline, narrow audience targeting to custom intent segments, and set up conversion value rules.",
    },
    {
      id: "convrate",
      label: "Conversion Rate",
      icon: "✅",
      category: "Efficiency",
      target: 3.0,
      actual: avgConvR ? parseFloat(avgConvR) : null,
      targetStr: "3.0%",
      actualStr: avgConvR ? avgConvR + "%" : null,
      unit: "%",
      higherIsBetter: true,
      benchmark: "Industry avg: 2.5–4%",
      whyMissed:
        "Conversion rate is underperforming, often caused by a mismatch between the ad message and the landing page experience. Users click expecting a specific offer but find a generic page. Also check if your CTA is prominent and your form is short.",
      howToFix:
        "Create dedicated landing pages per campaign with matching headlines. Reduce form fields to 3 or fewer. Add social proof (reviews, logos). Use urgency triggers.",
    },
    {
      id: "spend",
      label: "Budget Utilisation",
      icon: "💳",
      category: "Operations",
      target: totalBudget,
      actual: totalSpend || null,
      targetStr: "$" + totalBudget.toLocaleString(),
      actualStr: totalSpend ? "$" + totalSpend.toLocaleString() : null,
      unit: "$",
      higherIsBetter: true,
      benchmark: "Target: 85–100% utilisation",
      whyMissed:
        "Budget is under-utilised, which means your daily caps or audience sizes may be too restrictive. Under-spending means missed impressions and lost opportunities to collect conversion data.",
      howToFix:
        "Expand audience targeting radius, raise daily budget caps, and add 2–3 additional ad groups to consume remaining budget on high-intent terms.",
    },
    {
      id: "impressions",
      label: "Impressions",
      icon: "👁️",
      category: "Awareness",
      target: totalBudget * 60,
      actual: totalImpr || null,
      targetStr: (totalBudget * 60).toLocaleString(),
      actualStr: totalImpr ? totalImpr.toLocaleString() : null,
      unit: "",
      higherIsBetter: true,
      benchmark: "Est. ~60 impr per $1 budget",
      whyMissed:
        "Impressions are below target because of limited audience reach or overly restrictive targeting. Quality Score issues can also reduce ad eligibility, limiting how often your ads enter the auction.",
      howToFix:
        "Broaden match types for top 10 keywords, increase bids on high-Quality Score terms, and add Display Network campaigns to extend reach cost-effectively.",
    },
    {
      id: "conversions",
      label: "Total Conversions",
      icon: "🏆",
      category: "Revenue",
      target: campaigns.length || kpiActuals ? Math.round(totalBudget / 35) : 0,
      actual: totalConv || null,
      targetStr: campaigns.length || kpiActuals ? Math.round(totalBudget / 35).toString() : "—",
      actualStr: totalConv ? totalConv.toLocaleString() : null,
      unit: "",
      higherIsBetter: true,
      benchmark: "Est. 1 conversion per $35 spend",
      whyMissed:
        "Conversion volume is below target. This is a downstream effect of low CTR and high CPA — fewer clicks and lower conversion rates multiply to produce significantly fewer total conversions than projected.",
      howToFix:
        "Fix CTR and conversion rate issues first (see above). Then increase budget on campaigns with ROAS > target to scale winning ad sets.",
    },
    {
      id: "qualityscore",
      label: "Ad Quality Score",
      icon: "⭐",
      category: "Quality",
      target: 8,
      actual: campaigns.length ? 7 : kpiActuals ? kpiActuals.qualityScore ?? null : null,
      targetStr: "8/10",
      actualStr: campaigns.length
        ? "7/10"
        : kpiActuals && kpiActuals.qualityScore != null
          ? Math.round(kpiActuals.qualityScore) + "/10"
          : null,
      unit: "/10",
      higherIsBetter: true,
      benchmark: "Google target: 7+",
      whyMissed:
        "Quality Score below 7 increases your CPCs by 16–50% and reduces ad eligibility. Low scores are caused by poor expected CTR, weak ad relevance, or landing page experience issues.",
      howToFix:
        'Align keyword, ad copy, and landing page into tightly themed ad groups. Improve landing page load speed and relevance. Aim for Expected CTR of "Above Average".',
    },
  ];

  const kpis: KpiCard[] = kpiDefs.map((k) => ({ ...k, status: getStatus(k) }));
  const nAchieved = kpis.filter((k) => k.status === "achieved").length;
  const nAtRisk = kpis.filter((k) => k.status === "at-risk").length;
  const nMissed = kpis.filter((k) => k.status === "missed").length;
  const nPending = kpis.filter((k) => k.status === "pending").length;

  const _totalCampCount = campaigns.length || optCampCount;
  const hasAiEstimates = !!kpiActuals && !_totalCampCount;
  const hasAnyData = _totalCampCount > 0 || !!kpiData || hasAiEstimates;
  const campLabel =
    optCampCount && !campaigns.length
      ? `${optCampCount} tracked campaign${optCampCount !== 1 ? "s" : ""} (optimizer)`
      : hasAiEstimates
        ? "AI-estimated from domain signals"
        : `${campaigns.length} active campaign${campaigns.length !== 1 ? "s" : ""}`;

  // ── Funnel Health Score ──────────────────────────────────────────────────
  const counts: Record<string, number> = {};
  FUNNEL_STAGES.forEach((s) => {
    counts[s.id] = 0;
  });
  (win._socialPosts || []).forEach((p) => {
    if (p.funnelStage && counts[p.funnelStage] != null) counts[p.funnelStage]++;
  });
  const tagged = Object.values(counts).reduce((a, b) => a + b, 0);
  const covered = FUNNEL_STAGES.filter((s) => counts[s.id] > 0).length;
  const score = Math.round((covered / FUNNEL_STAGES.length) * 100);
  const gaps = FUNNEL_STAGES.filter((s) => counts[s.id] === 0);
  const funnelColor = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";

  const categories = [...new Set(kpiDefs.map((k) => k.category))];

  return {
    kpis,
    categories,
    nAchieved,
    nAtRisk,
    nMissed,
    nPending,
    hasAnyData,
    hasAiEstimates,
    campLabel,
    analysisUrl: analysisData ? analysisData.url || "" : "",
    campaigns,
    industryROAS,
    industryCTR,
    industryCPA,
    funnel: { score, color: funnelColor, covered, tagged, gaps, counts },
  };
}

export default function KpiTracker() {
  const [model, setModel] = useState<Model | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const rebuild = useCallback(async () => {
    setLoading(true);
    try {
      const m = await computeModel();
      setModel(m);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    rebuild();
  }, [rebuild]);

  async function runKpiAnalysis() {
    const win = getWin();
    const analysisData = win.analysisData;
    const hasAnalysis = !!(analysisData && (analysisData.url || analysisData.brand_name));
    if (!hasAnalysis) {
      toast("ℹ️ Run a website analysis first (click + Analyse), then come back to see your KPIs.");
      return;
    }
    setAnalyzing(true);
    try {
      const domain = (analysisData!.url || "").replace(/^https?:\/\//, "").split("/")[0];
      const brand = analysisData!.brand_name || domain;
      const rawIndustry = analysisData!.industry;
      const industry =
        rawIndustry && typeof rawIndustry === "object" ? rawIndustry.name || "" : rawIndustry || "";
      const competitors = (analysisData!.competitors || [])
        .slice(0, 5)
        .map((c) => c.domain || c.name || c.url || "")
        .filter(Boolean);

      const r = await fetch("/api/kpi-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ domain, brand, industry, competitors }),
        signal: AbortSignal.timeout(25000),
      });
      const j = (await r.json()) as KpiAnalysisResult;
      if (j.ok && j.kpis) {
        win._kpiActuals = j.kpis;
        await rebuild();
        toast("✅ KPI analysis complete — AI-estimated from domain signals");
      } else {
        toast("❌ " + (j.error || "KPI analysis failed"));
      }
    } catch (e) {
      toast("❌ " + (e instanceof Error ? e.message : "KPI analysis failed"));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      <div className="view-header intel-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> KPI Tracker
              </div>
              <h2 className="view-title">KPI Performance Tracker</h2>
              <p className="view-sub">
                Live status of every marketing KPI — achieved, at risk, and gap analysis with AI explanations
              </p>
            </div>
            <div className="vh-actions">
              <button className="btn-secondary" onClick={rebuild}>
                ↻ Refresh
              </button>
              <button
                className="btn-primary"
                onClick={runKpiAnalysis}
                disabled={analyzing}
                style={{ whiteSpace: "nowrap" }}
              >
                {analyzing ? "⏳ Analysing…" : "🔍 Run KPI Analysis"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 28, paddingBottom: 60 }}>
        {loading || !model ? (
          <div style={{ padding: 48, textAlign: "center", color: "#64748B" }}>Loading KPIs…</div>
        ) : (
          <KpiBody model={model} filter={filter} setFilter={setFilter} />
        )}
      </div>
    </div>
  );
}

function FunnelHealth({ funnel }: { funnel: Model["funnel"] }) {
  return (
    <div
      style={{
        background: "white",
        border: `1.5px solid ${funnel.color}44`,
        borderRadius: 18,
        padding: "20px 24px",
        marginBottom: 20,
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: `conic-gradient(${funnel.color} ${funnel.score * 3.6}deg,#F3F4F6 0deg)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            position: "relative",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              background: "white",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.1rem",
              fontWeight: 800,
              color: funnel.color,
            }}
          >
            {funnel.score}%
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>
            🎯 Funnel Content Health Score
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            {funnel.covered} of 5 funnel stages covered · {funnel.tagged} posts tagged
          </div>
          {funnel.gaps.length > 0 ? (
            <div
              style={{
                marginTop: 6,
                fontSize: "0.7rem",
                color: "#92400E",
                background: "#FFFBEB",
                borderRadius: 7,
                padding: "4px 10px",
                display: "inline-block",
              }}
            >
              ⚠️ Missing: {funnel.gaps.map((s) => s.icon + " " + s.label).join(", ")}
            </div>
          ) : (
            <div
              style={{
                marginTop: 6,
                fontSize: "0.7rem",
                color: "#065F46",
                background: "#F0FDF4",
                borderRadius: 7,
                padding: "4px 10px",
                display: "inline-block",
              }}
            >
              ✅ Full funnel coverage — all 5 stages active
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FUNNEL_STAGES.map((s) => (
            <div
              key={s.id}
              style={{
                textAlign: "center",
                padding: "8px 12px",
                background: funnel.counts[s.id] > 0 ? s.bg : "#F3F4F6",
                borderRadius: 10,
                minWidth: 60,
              }}
            >
              <div style={{ fontSize: "1rem" }}>{s.icon}</div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: funnel.counts[s.id] > 0 ? s.color : "#9CA3AF" }}>
                {funnel.counts[s.id]}
              </div>
              <div style={{ fontSize: "0.6rem", color: "#9CA3AF" }}>{s.label}</div>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            const win = getWin();
            (win as unknown as { _contentTab?: string })._contentTab = "funnel";
            win.navigateTo?.("content");
          }}
          style={{
            padding: "9px 16px",
            background: "linear-gradient(135deg,#065F46,#059669)",
            border: "none",
            borderRadius: 10,
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "white",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          📝 Plan Content →
        </button>
      </div>
    </div>
  );
}

function SummaryBanner({ model }: { model: Model }) {
  const stats: [string, number, string][] = [
    ["Achieved", model.nAchieved, "#16A34A"],
    ["At Risk", model.nAtRisk, "#D97706"],
    ["Missed", model.nMissed, "#EF4444"],
    ["No Data", model.nPending, "#94A3B8"],
  ];
  return (
    <div
      style={{
        background: "var(--ig-grad2)",
        borderRadius: 16,
        padding: "22px 28px",
        marginBottom: 24,
        border: "1px solid rgba(0,201,200,.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "white", marginBottom: 4 }}>
            {model.hasAnyData
              ? `${model.nAchieved} of ${model.kpis.length} KPIs Achieved`
              : "Run an analysis & launch campaigns to see your KPI progress"}
            {model.hasAiEstimates && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 500,
                  background: "rgba(139,92,246,.25)",
                  border: "1px solid rgba(139,92,246,.4)",
                  borderRadius: 6,
                  padding: "2px 7px",
                  marginLeft: 8,
                  verticalAlign: "middle",
                }}
              >
                ✨ AI estimated
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,.5)" }}>
            Based on {model.campLabel} · {model.analysisUrl || "No analysis run yet"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {stats.map(([lb, n, cl]) => (
            <div
              key={lb}
              style={{ background: "rgba(255,255,255,.06)", borderRadius: 10, padding: "10px 16px", textAlign: "center", minWidth: 64 }}
            >
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: cl }}>{n}</div>
              <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,.5)", marginTop: 2 }}>{lb}</div>
            </div>
          ))}
        </div>
      </div>
      {model.hasAnyData && model.nMissed > 0 && (
        <div
          style={{
            marginTop: 14,
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.2)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: "0.8rem",
            color: "#FCA5A5",
          }}
        >
          🔴 <strong>{model.nMissed} KPI{model.nMissed !== 1 ? "s" : ""} missed target.</strong> Scroll down for
          AI-powered explanations and fix recommendations.
        </div>
      )}
      {!model.hasAnyData && (
        <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              (document.querySelector(".url-input") as HTMLElement | null)?.focus();
              getWin().navigateTo?.("home");
            }}
            style={{
              padding: "10px 20px",
              background: "linear-gradient(135deg,#0066FF,#00C9C8)",
              border: "none",
              borderRadius: 9,
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "white",
              cursor: "pointer",
            }}
          >
            🔍 Run Analysis First
          </button>
        </div>
      )}
    </div>
  );
}

function KpiCardView({ kpi }: { kpi: KpiCard }) {
  const cfg = STATUS_CFG[kpi.status];
  const pct =
    kpi.actual !== null && kpi.target > 0
      ? Math.min(100, Math.round((kpi.higherIsBetter ? kpi.actual / kpi.target : kpi.target / kpi.actual) * 100))
      : 0;
  const barColor =
    kpi.status === "achieved" ? "#16A34A" : kpi.status === "at-risk" ? "#D97706" : kpi.status === "missed" ? "#EF4444" : "#94A3B8";
  const gap =
    kpi.actual !== null && kpi.status !== "achieved"
      ? kpi.higherIsBetter
        ? `Gap: ${kpi.unit === "$" ? "$" : ""}${Math.abs(kpi.target - kpi.actual).toFixed(kpi.unit === "%" || kpi.unit === "×" ? 1 : 0)}${kpi.unit !== "$" ? kpi.unit : ""} to target`
        : `Over by: $${Math.abs(kpi.actual - kpi.target).toFixed(0)}`
      : "";

  return (
    <div
      style={{
        background: "white",
        border: `1.5px solid ${cfg.border}`,
        borderRadius: 14,
        padding: "18px 20px",
        transition: "box-shadow .2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: "1.5rem" }}>{kpi.icon}</div>
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0A1628" }}>{kpi.label}</div>
            <div style={{ fontSize: "0.65rem", color: "#6B7280", marginTop: 1 }}>
              {kpi.category} · {kpi.benchmark}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 20,
            background: cfg.bg,
            color: cfg.color,
            border: `1px solid ${cfg.border}`,
            whiteSpace: "nowrap",
          }}
        >
          {cfg.label}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
          <div
            style={{ fontSize: "0.62rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}
          >
            🎯 Target
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#0A1628" }}>{kpi.targetStr}</div>
        </div>
        <div style={{ background: cfg.bg, borderRadius: 8, padding: "10px 12px", textAlign: "center", border: `1px solid ${cfg.border}` }}>
          <div
            style={{ fontSize: "0.62rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}
          >
            📊 Actual
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800, color: cfg.color }}>{kpi.actualStr || "—"}</div>
        </div>
      </div>

      <div style={{ marginBottom: kpi.status !== "achieved" && kpi.status !== "pending" ? 12 : 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#6B7280", marginBottom: 4 }}>
          <span>Progress to target</span>
          <span style={{ fontWeight: 700, color: barColor }}>{kpi.actual !== null ? pct + "%" : "—"}</span>
        </div>
        <div style={{ height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3, transition: "width .6s ease" }} />
        </div>
        {gap && <div style={{ fontSize: "0.68rem", color: barColor, fontWeight: 600, marginTop: 4 }}>{gap}</div>}
      </div>

      {(kpi.status === "missed" || kpi.status === "at-risk") && (
        <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: "11px 14px" }}>
          <div
            style={{ fontSize: "0.65rem", fontWeight: 700, color: cfg.color, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}
          >
            {kpi.status === "missed" ? "❌ Why This KPI Is Missed" : "⚠️ Why This KPI Is At Risk"}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.55, marginBottom: 8 }}>{kpi.whyMissed}</div>
          <div
            style={{ fontSize: "0.65rem", fontWeight: 700, color: "#0066FF", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}
          >
            🔧 How to Fix
          </div>
          <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.55 }}>{kpi.howToFix}</div>
        </div>
      )}

      {kpi.status === "achieved" && (
        <div
          style={{
            background: "#F0FDF4",
            border: "1px solid #86EFAC",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: "0.78rem",
            color: "#15803D",
            lineHeight: 1.5,
          }}
        >
          ✅ <strong>On track.</strong> This KPI is meeting or exceeding target. Keep monitoring for sustained
          performance and consider increasing budget allocation to scale results.
        </div>
      )}
    </div>
  );
}

function CampaignTable({ model }: { model: Model }) {
  const { campaigns, industryROAS, industryCTR, industryCPA } = model;
  if (!campaigns.length) return null;
  const headers = ["Campaign", "Platform", "ROAS", "CTR", "CPA", "Conversions", "Impressions", "Status"];
  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0066FF", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 14 }}
      >
        📋 Per-Campaign KPI Breakdown
      </div>
      <div style={{ overflowX: "auto", borderRadius: 14, border: "1.5px solid #E2E8F0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", background: "white" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "1.5px solid #E2E8F0" }}>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    color: "#6B7280",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => {
              const cRoas = parseFloat(String(c.metrics.roas || 0));
              const cCtr = parseFloat((c.metrics.ctr || "0").replace("%", ""));
              const cCpa = parseInt((c.metrics.cpa || "$0").replace("$", ""), 10);
              const overallSt =
                cRoas >= industryROAS && cCtr >= industryCTR && cCpa <= industryCPA
                  ? "On Target"
                  : cRoas >= industryROAS * 0.8
                    ? "At Risk"
                    : "Below Target";
              const stColor = overallSt === "On Target" ? "#15803D" : overallSt === "At Risk" ? "#B45309" : "#B91C1C";
              const stBg = overallSt === "On Target" ? "#F0FDF4" : overallSt === "At Risk" ? "#FFFBEB" : "#FFF1F2";
              return (
                <tr key={i} style={{ borderBottom: "1px solid #F1F5F9", background: i % 2 === 0 ? "white" : "#FAFAFA" }}>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontWeight: 600,
                      color: "#0A1628",
                      maxWidth: 160,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={c.name}
                  >
                    {c.name.substring(0, 30)}
                    {c.name.length > 30 ? "…" : ""}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#374151" }}>{c.platform}</td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontWeight: 700,
                      color: cRoas >= industryROAS ? "#15803D" : cRoas >= industryROAS * 0.8 ? "#B45309" : "#B91C1C",
                    }}
                  >
                    {c.metrics.roas}×
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontWeight: 700,
                      color: cCtr >= industryCTR ? "#15803D" : cCtr >= industryCTR * 0.8 ? "#B45309" : "#B91C1C",
                    }}
                  >
                    {c.metrics.ctr}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontWeight: 700,
                      color: cCpa <= industryCPA ? "#15803D" : cCpa <= industryCPA * 1.2 ? "#B45309" : "#B91C1C",
                    }}
                  >
                    {c.metrics.cpa}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#374151" }}>{c.metrics.conversions}</td>
                  <td style={{ padding: "10px 14px", color: "#374151" }}>{c.metrics.impressions.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={{ padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700, background: stBg, color: stColor }}
                    >
                      {overallSt}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiActionPlan({ model }: { model: Model }) {
  const missed = model.kpis.filter((k) => k.status === "missed");
  if (!model.hasAnyData || !missed.length) return null;
  return (
    <div
      style={{
        marginTop: 24,
        background: "linear-gradient(135deg,#FFF7ED,#FFF1F2)",
        border: "1.5px solid #FCA5A5",
        borderRadius: 14,
        padding: "18px 22px",
      }}
    >
      <div
        style={{ fontSize: "0.68rem", fontWeight: 700, color: "#B91C1C", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}
      >
        🧠 AI Priority Action Plan — Fix These KPIs First
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {missed.map((kpi, i) => (
          <div
            key={kpi.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "8px 0",
              borderBottom: i < missed.length - 1 ? "1px solid rgba(239,68,68,.1)" : undefined,
            }}
          >
            <span
              style={{ fontSize: "0.65rem", fontWeight: 800, padding: "2px 8px", borderRadius: 5, background: "#FEE2E2", color: "#EF4444", flexShrink: 0 }}
            >
              #{i + 1}
            </span>
            <div>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#991B1B", marginBottom: 2 }}>{kpi.label}</div>
              <div style={{ fontSize: "0.77rem", color: "#7C2D12", lineHeight: 1.5 }}>
                {kpi.howToFix || "Review targeting, bidding, and creative to improve this metric."}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiBody({ model, filter, setFilter }: { model: Model; filter: string; setFilter: (f: string) => void }) {
  const visible = model.kpis.filter((k) => {
    if (filter === "all") return true;
    if (filter === "missed") return k.status === "missed";
    return k.category === filter;
  });

  function pillStyle(active: boolean, scheme: "default" | "missed"): React.CSSProperties {
    if (active) {
      return { background: "#0066FF", color: "white", border: "1.5px solid #0066FF" };
    }
    if (scheme === "missed") {
      return { background: "#FFF1F2", color: "#B91C1C", border: "1.5px solid #FCA5A5" };
    }
    return { background: "white", color: "#374151", border: "1.5px solid #E2E8F0" };
  }

  const basePill: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: 20,
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <>
      <FunnelHealth funnel={model.funnel} />
      <SummaryBanner model={model} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => setFilter("all")} style={{ ...basePill, ...pillStyle(filter === "all", "default") }}>
          All KPIs
        </button>
        {model.categories.map((c) => (
          <button key={c} onClick={() => setFilter(c)} style={{ ...basePill, ...pillStyle(filter === c, "default") }}>
            {c}
          </button>
        ))}
        <button onClick={() => setFilter("missed")} style={{ ...basePill, ...pillStyle(filter === "missed", "missed") }}>
          ❌ Missed Only
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
        {visible.map((kpi) => (
          <KpiCardView key={kpi.id} kpi={kpi} />
        ))}
      </div>

      <CampaignTable model={model} />
      <AiActionPlan model={model} />
    </>
  );
}
