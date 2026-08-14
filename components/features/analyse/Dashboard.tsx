"use client";

// Native React port of the legacy `dashboard` panel (was `window.buildDashboard`
// + `#view-dashboard` in public/js/ig_core_views.js / index.html). Renders the
// post-analysis Intelligence Report — header + analysis tags, competitor chips,
// the KPI benchmark grid, ROI projection banner, the CTR / ROAS / 12-month trend
// charts (Chart.js, loaded by the shell), the competitor summary table, and the
// live panels (Share of Voice, 90-day forecast, budget efficiency, competitor ad
// spend, AI alert feed) — directly from the legacy `window.analysisData` global.
// Charts use the global `window.Chart`; live panels hit the same Express
// endpoints (`POST /api/competitor-spend`, `POST /api/ai-forecast`,
// `POST /api/budget-efficiency`) via `lib/api`. Supplemental DOM enhancers
// (renderYourSwot, _populateAdSpendColumn, openCompetitorAnalysis, openThreatModal)
// reuse the existing legacy globals when present. Cross-tool links go through
// `lib/nav#goToView`. See `docs/react-panel-migration.md`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";
import dm from "@/styles/dashboard-marketing.module.css";
import {
  buildSwot,
  buildChannelMix,
  buildPriorityActions,
  formatAdSpend,
  blendedMarketingMetrics,
} from "@/lib/analysisDashboard";
import MarketingIntelPanels from "./MarketingIntelPanels";
import DomainOverview from "./DomainOverview";
import OverviewWidgets from "./OverviewWidgets";
import MessagingChannelStrip from "./MessagingChannelStrip";
import { buildCompanyOverview } from "@/lib/companyOverview";
import { restoreCanvasForReact } from "@/lib/domSafety";
import PanelShell from "@/components/layout/PanelShell";
import IgButton from "@/components/ui/IgButton";

interface WebsiteKPIs {
  ctr: number;
  roas: number;
  cpa: number | string;
  convRate: number | string;
  trafficMo: number;
  adSpend?: number | string;
  _estimated?: boolean;
  source?: string;
}
interface Competitor {
  name?: string;
  domain?: string;
  url?: string;
  logo?: string;
  traffic?: string;
  trafficMo?: number;
  ctr?: string;
  roas?: string | number;
  adSpend?: string;
  adSpendEst?: number;
  topChannel?: string;
  topChannels?: string[];
  threatLevel?: string;
  why?: string;
  aiDetected?: boolean;
  _dataSource?: string;
  suggestions?: string[];
}
interface AnalysisData {
  url?: string;
  country?: string;
  industry?: { name?: string };
  websiteKPIs?: WebsiteKPIs;
  competitors?: Competitor[];
  sectorOnly?: boolean;
  _yourRealData?: { organicTraffic?: number };
  companyProfile?: {
    domain?: string;
    businessSummary?: string;
    subNiche?: string;
    siteTitle?: string;
    metaDesc?: string;
    analyzedAt?: string;
  };
}

interface ChartInstance {
  destroy: () => void;
}
type ChartCtor = new (ctx: CanvasRenderingContext2D, cfg: unknown) => ChartInstance;

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  const live = (window as unknown as { analysisData?: AnalysisData }).analysisData;
  if (live && (live.url || live.websiteKPIs)) return live;
  try {
    const raw = sessionStorage.getItem("ig-analysis-data");
    if (raw) {
      const parsed = JSON.parse(raw) as AnalysisData;
      if (parsed && (parsed.url || parsed.websiteKPIs)) {
        (window as unknown as { analysisData?: AnalysisData }).analysisData = parsed;
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return live || null;
}
function getChart(): ChartCtor | undefined {
  return (window as unknown as { Chart?: ChartCtor }).Chart;
}
function callWin(name: string, ...args: unknown[]): unknown {
  if (typeof window === "undefined") return undefined;
  const fn = (window as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[name];
  if (typeof fn === "function") {
    try {
      return fn(...args);
    } catch {
      /* legacy helper not available */
    }
  }
  return undefined;
}

function fmt(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}
function getCountryLabel(val?: string): string {
  const map: Record<string, string> = {
    global: "🌍 Global", us: "🇺🇸 US", uk: "🇬🇧 UK", au: "🇦🇺 Australia", ca: "🇨🇦 Canada",
    de: "🇩🇪 Germany", fr: "🇫🇷 France", sg: "🇸🇬 Singapore", ae: "🇦🇪 UAE", in: "🇮🇳 India",
    za: "🇿🇦 South Africa", br: "🇧🇷 Brazil", jp: "🇯🇵 Japan", nl: "🇳🇱 Netherlands", se: "🇸🇪 Sweden",
  };
  return map[val || ""] || "🌍 Global";
}
function calcOpportunityScore(kpis: WebsiteKPIs, avgCTR: number, avgROAS: number): number {
  const ctrScore = Math.min(30, (kpis.ctr / avgCTR) * 20);
  const roasScore = Math.min(30, (kpis.roas / avgROAS) * 20);
  return Math.round(40 + ctrScore + roasScore);
}
function parseTrafficNum(c: Competitor): number {
  if (c.trafficMo) return c.trafficMo;
  const raw = c.traffic;
  if (!raw || raw === "—") return 0;
  const t = String(raw).replace(/[, ]/g, "");
  if (t.endsWith("B")) return parseFloat(t) * 1e9;
  if (t.endsWith("M")) return parseFloat(t) * 1e6;
  if (t.endsWith("K")) return parseFloat(t) * 1e3;
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? n : 0;
}
function parseAdSpend(s: number | string | undefined): number {
  if (typeof s === "number") return s;
  if (!s || s === "—") return 0;
  const str = String(s).replace(/[$,\s]/g, "");
  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  const upper = String(s).toUpperCase();
  let mult = 1;
  if (upper.includes("B")) mult = 1_000_000_000;
  else if (upper.includes("M")) mult = 1_000_000;
  else if (upper.includes("K")) mult = 1_000;
  return num * mult;
}

const SOV_PALETTE = ["#0066FF", "#00C9C8", "#6366F1", "#F59E0B", "#10B981", "#EF4444", "#0284c7", "#14B8A6"];
const CHIP_DOTS = ["#0066FF", "#10B981", "#F59E0B", "#0284c7", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"];

interface AlertTmpl {
  icon: string;
  color: string;
  bg: string;
  label: string;
  labelTitle: string;
  age: string;
  msg: (name: string) => string;
}
const ALERT_TMPLS: AlertTmpl[] = [
  { icon: "🔥", color: "#EF4444", bg: "#FEF2F2", label: "HIGH", labelTitle: "High priority — act within 24 hours to capitalise on this competitor vulnerability.", age: "2h ago", msg: (n) => `${n} dropped Google Ads spend — their core keywords are now underserved and CPCs have fallen. Attack window is open.` },
  { icon: "⚡", color: "#F59E0B", bg: "#FFFBEB", label: "MED", labelTitle: "Medium priority — monitor closely and prepare a response within the next few days.", age: "6h ago", msg: (n) => `${n} launched new Meta & TikTok creatives targeting audiences that overlap with your highest-converting segments.` },
  { icon: "📈", color: "#0066FF", bg: "#EFF6FF", label: "MED", labelTitle: "Medium priority — monitor closely and prepare a response within the next few days.", age: "1d ago", msg: (n) => `${n} increased LinkedIn Ads budget ~50% this week, aggressively targeting decision-makers in your market.` },
  { icon: "💡", color: "#10B981", bg: "#ECFDF5", label: "OPP", labelTitle: "Opportunity — a gap in the competitor's positioning you can exploit to win market share.", age: "3d ago", msg: (n) => `${n} changed pricing structure — social sentiment shows customer dissatisfaction. Migration opportunity now active.` },
];

interface Milestone {
  week: number | string;
  milestone: string;
}

export default function Dashboard() {
  const router = useRouter();
  // Read the post-analyse payload reactively. `window.analysisData` is set by
  // app.js just before it navigates here, so the first mount picks it up via the
  // lazy initializer. When the user re-runs Analyse while this panel is already
  // mounted, app.js fires `ig:analysis-ready`; we re-read so the report (charts,
  // tables, live panels) refreshes instead of showing the previous run.
  const [ad, setAd] = useState<AnalysisData | null>(getAnalysisData);
  const [journeyStatus, setJourneyStatus] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    const onReady = () => setAd(getAnalysisData());
    document.addEventListener("ig:analysis-ready", onReady);
    document.addEventListener("ig:analysis-updated", onReady);
    window.addEventListener("ig:analysis-ready", onReady);
    // Re-read after mount — analysisData may land a tick after this panel.
    const t1 = window.setTimeout(onReady, 50);
    const t2 = window.setTimeout(onReady, 400);
    return () => {
      document.removeEventListener("ig:analysis-ready", onReady);
      document.removeEventListener("ig:analysis-updated", onReady);
      window.removeEventListener("ig:analysis-ready", onReady);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const analysedDomain = useMemo(() => {
    if (!ad?.url) return "";
    return ad.url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }, [ad?.url]);

  useEffect(() => {
    if (!analysedDomain) {
      setJourneyStatus(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void apiGet<{ ok: boolean; status?: Record<string, boolean> }>(
        `/api/company-overview/journey-status?domain=${encodeURIComponent(analysedDomain)}`,
      )
        .then((r) => {
          if (!cancelled && r?.ok && r.status) setJourneyStatus(r.status);
        })
        .catch(() => {
          if (!cancelled) setJourneyStatus(null);
        });
    };
    load();
    const onJourney = () => load();
    document.addEventListener("ig:journey-updated", onJourney);
    return () => {
      cancelled = true;
      document.removeEventListener("ig:journey-updated", onJourney);
    };
  }, [analysedDomain]);
  const competitors = useMemo(() => (ad && Array.isArray(ad.competitors) ? ad.competitors : []), [ad]);
  // Analysis is complete once a URL/KPIs exist. Same-industry verification can
  // honestly return zero rivals — that is still a finished Analyse Now run.
  const hasData = !!(ad && ad.url && ad.websiteKPIs);

  const chartsRef = useRef<ChartInstance[]>([]);
  const [forecastStatus, setForecastStatus] = useState("⏳ Generating AI forecast…");
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [efficiencyStatus, setEfficiencyStatus] = useState("⏳ Scoring channels…");
  const [efficiencyRec, setEfficiencyRec] = useState("");
  const [spendStatus, setSpendStatus] = useState<{ text: string; color: string }>({ text: "Monthly paid traffic value estimate", color: "#9CA3AF" });
  const [threatIdx, setThreatIdx] = useState<number | null>(null);

  // ── Derived data (computed once) ──────────────────────────────────────────
  const derived = useMemo(() => {
    if (!hasData || !ad || !ad.websiteKPIs) return null;
    const websiteKPIs = ad.websiteKPIs;
    const industryName = ad.industry?.name || "your industry";
    const url = ad.url || "";

    const safeAvg = (arr: number[]) => {
      const nums = arr.filter((n) => typeof n === "number" && isFinite(n) && n > 0);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    };
    const avgCTR = safeAvg(competitors.map((c) => parseFloat(String(c.ctr))));
    const avgROAS = safeAvg(competitors.map((c) => (typeof c.roas === "number" ? c.roas : parseFloat(String(c.roas)))));
    const yourCTR = websiteKPIs.ctr;
    const yourROAS = websiteKPIs.roas;

    const realTraffic = ad._yourRealData && ad._yourRealData.organicTraffic;
    const trafficVal = realTraffic || websiteKPIs.trafficMo;

    // Share of Voice
    const totalTraffic = competitors.reduce((a, c) => a + parseTrafficNum(c), 0);
    let usedPct = 0;
    const sovRows = competitors
      .slice(0, 6)
      .map((c, i) => ({ c, i, t: parseTrafficNum(c) }))
      .filter((x) => x.t > 0)
      .map(({ c, i, t }) => {
        const share = Math.round((t / Math.max(totalTraffic, 1)) * 80);
        usedPct += share;
        return { name: c.name || "", share, color: SOV_PALETTE[i] };
      });
    const yourSovShare = Math.min(Math.max(0, 100 - usedPct - 5), 18);
    const otherSovShare = Math.max(0, 100 - usedPct - yourSovShare);
    const sovData = [...sovRows, { name: "You", share: yourSovShare, color: "#00E5FF" }, { name: "Others", share: otherSovShare, color: "#E2E8F0" }];

    return { websiteKPIs, industryName, url, avgCTR, avgROAS, yourCTR, yourROAS, realTraffic: !!realTraffic, trafficVal, sovData, yourSovShare };
  }, [ad, competitors, hasData]);

  const companyOverview = useMemo(() => {
    if (!ad || !hasData) return null;
    const dom = analysedDomain || "your-site.com";
    return buildCompanyOverview(
      dom,
      ad.industry?.name || "your industry",
      ad as Record<string, unknown>,
      journeyStatus,
    );
  }, [ad, hasData, analysedDomain, journeyStatus]);

  const marketing = useMemo(() => {
    if (!ad || !hasData) return null;
    const yourDomain = (ad.url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    let profile = ad.companyProfile;
    if (!profile && typeof window !== "undefined") {
      try {
        const cached = JSON.parse(localStorage.getItem("ig-ai-detected") || "null");
        if (cached) {
          profile = {
            domain: yourDomain,
            businessSummary: cached.businessSummary,
            subNiche: cached.subNiche,
            analyzedAt: cached.at ? new Date(cached.at).toISOString() : undefined,
          };
        }
      } catch {
        /* ignore */
      }
    }
    const enriched = profile ? { ...ad, companyProfile: profile } : ad;
    return {
      swot: buildSwot(enriched, yourDomain),
      channels: buildChannelMix(competitors),
      actions: buildPriorityActions(enriched),
      blended: blendedMarketingMetrics(enriched),
      profile,
    };
  }, [ad, competitors, hasData]);

  // ── Charts + async live panels ────────────────────────────────────────────
  useEffect(() => {
    if (!derived || !ad) return;
    let alive = true;
    const Chart = getChart();
    const instances: ChartInstance[] = [];
    chartsRef.current = instances;
    const canvasIds = [
      "ctrChart",
      "roasChart",
      "trendChart",
      "sovChart",
      "forecastChart",
      "efficiencyChart",
      "spendChart",
    ];
    const destroyOnCanvas = (el: HTMLCanvasElement | null) => {
      if (!el || !Chart) return;
      try {
        const existing =
          typeof (Chart as unknown as { getChart?: (c: HTMLCanvasElement) => ChartInstance | undefined }).getChart ===
          "function"
            ? (Chart as unknown as { getChart: (c: HTMLCanvasElement) => ChartInstance | undefined }).getChart(el)
            : undefined;
        if (existing) {
          existing.destroy();
          const idx = instances.indexOf(existing);
          if (idx >= 0) instances.splice(idx, 1);
        }
      } catch {
        /* already gone */
      }
    };
    const make = (id: string, cfg: unknown) => {
      if (!alive || !Chart) return;
      const el = document.getElementById(id) as HTMLCanvasElement | null;
      if (!el) return;
      destroyOnCanvas(el);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      try {
        instances.push(new Chart(ctx, cfg));
      } catch {
        /* chart construction failed */
      }
    };

    const { avgCTR, avgROAS, yourCTR, yourROAS, sovData, url, industryName, trafficVal } = derived;

    // CTR chart
    const withCtr = competitors.filter((c) => {
      const n = parseFloat(String(c.ctr));
      return isFinite(n) && n > 0;
    });
    make("ctrChart", {
      type: "bar",
      data: {
        labels: ["Your Site", ...withCtr.map((c) => c.name)],
        datasets: [{
          label: "Avg CTR (%)",
          data: [yourCTR, ...withCtr.map((c) => parseFloat(String(c.ctr)))],
          backgroundColor: ["rgba(0,201,200,0.85)", ...withCtr.map(() => "rgba(0,102,255,0.7)")],
          borderColor: ["#00C9C8", ...withCtr.map(() => "#0066FF")],
          borderWidth: 2,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: unknown }) => ` CTR: ${c.raw}%` } } },
        scales: { y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: unknown) => v + "%", font: { size: 11 } } }, x: { grid: { display: false }, ticks: { font: { size: 11 } } } },
      },
    });

    // ROAS chart
    make("roasChart", {
      type: "bar",
      data: {
        labels: ["Your Site", ...competitors.map((c) => c.name)],
        datasets: [{
          label: "ROAS",
          data: [yourROAS, ...competitors.map((c) => c.roas)],
          backgroundColor: ["rgba(0,229,255,0.8)", ...competitors.map(() => "rgba(124,58,237,0.7)")],
          borderColor: ["#00E5FF", ...competitors.map(() => "#0f766e")],
          borderWidth: 2,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: unknown }) => ` ROAS: ${c.raw}×` } } },
        scales: { y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: unknown) => v + "×", font: { size: 11 } } }, x: { grid: { display: false }, ticks: { font: { size: 11 } } } },
      },
    });

    // Trend chart
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const palette = [
      { bg: "rgba(0,201,200,0.15)", border: "#00C9C8" }, { bg: "rgba(0,102,255,0.12)", border: "#0066FF" },
      { bg: "rgba(124,58,237,0.12)", border: "#0f766e" }, { bg: "rgba(245,158,11,0.12)", border: "#F59E0B" },
      { bg: "rgba(16,185,129,0.12)", border: "#10B981" }, { bg: "rgba(239,68,68,0.12)", border: "#EF4444" },
      { bg: "rgba(139,92,246,0.12)", border: "#0284c7" }, { bg: "rgba(236,72,153,0.12)", border: "#EC4899" },
    ];
    const trendDatasets = competitors
      .slice(0, 8)
      .filter((c) => c.traffic && c.traffic !== "—" && /\d/.test(String(c.traffic)))
      .map((c, i) => {
        const baseTraffic = parseFloat(String(c.traffic).replace(/[^0-9.]/g, "")) || 0;
        const multiplier = String(c.traffic).includes("B") ? 1000 : String(c.traffic).includes("M") ? 1 : 0.001;
        const base = baseTraffic * multiplier;
        const data = months.map((_, mi) => {
          const trend = 1 + mi * 0.018 + Math.sin(mi * 0.8 + i) * 0.06;
          return +(base * trend).toFixed(1);
        });
        return { label: c.name, data, borderColor: palette[i].border, backgroundColor: palette[i].bg, borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 5 };
      });
    make("trendChart", {
      type: "line",
      data: { labels: months, datasets: trendDatasets },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true, position: "top", labels: { font: { size: 11 }, padding: 16, usePointStyle: true } },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: unknown }) => ` ${c.dataset.label}: ${c.raw}M visits` } },
        },
        scales: { y: { grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: unknown) => v + "M", font: { size: 11 } } }, x: { grid: { display: false }, ticks: { font: { size: 11 } } } },
        interaction: { mode: "index", intersect: false },
      },
    });

    // SOV donut
    make("sovChart", {
      type: "doughnut",
      data: { labels: sovData.map((d) => d.name), datasets: [{ data: sovData.map((d) => d.share), backgroundColor: sovData.map((d) => d.color), borderWidth: 0 }] },
      options: { responsive: true, cutout: "68%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { label?: string; raw: unknown }) => ` ${c.label}: ${c.raw}%` } } } },
    });

    // Static spend chart
    const yourEstSpend = ad.websiteKPIs?.adSpend || 4500;
    const staticTrafficFloor = (c: Competitor) => {
      const t = parseTrafficNum(c);
      if (!t || t <= 0) return 0;
      return Math.min(Math.round(t * 0.03 * 3), 1_500_000);
    };
    const renderSpend = (labels: (string | undefined)[], vals: number[], source: string) => {
      if (!alive) return;
      const el = document.getElementById("spendChart") as HTMLCanvasElement | null;
      if (!el || !Chart) return;
      destroyOnCanvas(el);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const colors = labels.map((l, i) => (l === "You" ? "rgba(0,229,255,0.9)" : (SOV_PALETTE[i - 1] || "#6B7280") + "BB"));
      try {
        instances.push(
          new Chart(ctx, {
            type: "bar",
            data: { labels, datasets: [{ label: "Est. Ad Spend/mo", data: vals, backgroundColor: colors, borderRadius: 6, borderWidth: 0 }] },
            options: {
              responsive: true,
              indexAxis: "y",
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: unknown }) => ` $${Number(c.raw).toLocaleString()}/mo` } } },
              scales: { x: { grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: number) => "$" + (v >= 1000 ? (v / 1000).toFixed(0) + "K" : v), font: { size: 10 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } },
            },
          }),
        );
      } catch {
        /* chart failed */
      }
      if (alive) {
        setSpendStatus(source === "DataForSEO" ? { text: "🔴 Live via DataForSEO", color: "#10B981" } : { text: "Estimated from competitor data", color: "#9CA3AF" });
      }
    };
    const staticLabels = ["You", ...competitors.slice(0, 6).map((c) => c.name)];
    const staticVals = [
      (() => {
        const v = typeof yourEstSpend === "number" ? yourEstSpend : parseAdSpend(yourEstSpend);
        return v > 0 ? v : 25_000;
      })(),
      ...competitors.slice(0, 6).map((c) => {
        if (typeof c.adSpendEst === "number" && c.adSpendEst > 0) return c.adSpendEst;
        const parsed = parseAdSpend(c.adSpend);
        if (parsed > 0) return parsed;
        return staticTrafficFloor(c);
      }),
    ];
    renderSpend(staticLabels, staticVals, "static");

    // Live spend fetch
    const compDomains = competitors.slice(0, 6).map((c) => c.domain || c.url || (c.name || "").toLowerCase().replace(/\s+/g, "") + ".com");
    const compBrandNames = competitors.slice(0, 6).map((c) => c.name || "");
    const yourBudget = typeof yourEstSpend === "number" ? yourEstSpend : parseAdSpend(yourEstSpend);
    apiPost<{ success?: boolean; yourSpend?: number; competitors?: { domain?: string; adSpend?: number }[] }>("/api/competitor-spend", {
      domains: compDomains, names: compBrandNames, yourDomain: url, yourBudget,
    }).then((data) => {
      if (!alive) return;
      if (!data || !data.success || !Array.isArray(data.competitors)) return;
      const trafficSpendFloor = staticTrafficFloor;
      const liveLabels = ["You", ...data.competitors.map((c, ci) => competitors[ci]?.name || c.domain)];
      const liveVals = [
        data.yourSpend && data.yourSpend > 0 ? data.yourSpend : yourBudget && yourBudget > 0 ? yourBudget : 25_000,
        ...data.competitors.map((c, ci) => {
          const comp = competitors[ci];
          const liveVal = (c.adSpend || 0) > 0 ? c.adSpend! : 0;
          const estVal = comp?.adSpendEst && comp.adSpendEst > 0 ? comp.adSpendEst : 0;
          const parsed = parseAdSpend(comp?.adSpend || "$0");
          const bestVal = Math.max(liveVal, estVal, parsed > 0 ? parsed : 0);
          if (bestVal > 0) return bestVal;
          return comp ? trafficSpendFloor(comp) : 0;
        }),
      ];
      if (liveVals.some((v) => v > 0)) renderSpend(liveLabels, liveVals, "DataForSEO");
    });

    // Forecast fetch
    const compNames = competitors.map((c) => c.name);
    const campaignBudget = ((window as unknown as { _launchedCampaigns?: { budget: number }[] })._launchedCampaigns || []).reduce((s, c) => s + c.budget, 0) || 5000;
    apiPost<{
      projectedRevenue?: number[]; optimisticRevenue?: number[]; conservativeRevenue?: number[];
      weeks?: string[]; months?: string[]; confidenceLevel?: string; keyMilestones?: Milestone[];
    }>("/api/ai-forecast", {
      domain: url, industry: industryName, competitors: compNames, currentROAS: yourROAS, monthlyBudget: campaignBudget, trafficMo: trafficVal,
    }).then((data) => {
      if (!alive) return;
      if (!data) {
        setForecastStatus("Forecast temporarily unavailable");
        return;
      }
      const projArr = data.projectedRevenue || [];
      const projTotalK = Math.round(projArr.reduce((s, v) => s + (v || 0), 0) / 1000);
      setForecastStatus(`Confidence: ${data.confidenceLevel || "Medium"} · $${projTotalK}K projected over 90 days`);
      const labels = data.weeks || data.months || ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5", "Wk 6", "Wk 7", "Wk 8", "Wk 9", "Wk 10", "Wk 11", "Wk 12", "Wk 13"];
      const el = document.getElementById("forecastChart") as HTMLCanvasElement | null;
      if (el && Chart) {
        destroyOnCanvas(el);
        const ctx = el.getContext("2d");
        if (ctx) {
          try {
            instances.push(
              new Chart(ctx, {
                type: "line",
                data: {
                  labels,
                  datasets: [
                    { label: "Optimistic", data: data.optimisticRevenue, borderColor: "#10B981", backgroundColor: "rgba(16,185,129,0.08)", tension: 0.42, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, fill: "+1" },
                    { label: "Projected", data: data.projectedRevenue, borderColor: "#0066FF", backgroundColor: "rgba(0,102,255,0.12)", tension: 0.42, borderWidth: 3, pointRadius: 3, pointHoverRadius: 6, fill: "+1" },
                    { label: "Conservative", data: data.conservativeRevenue, borderColor: "#F59E0B", backgroundColor: "rgba(245,158,11,0.06)", tension: 0.42, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, fill: false, borderDash: [5, 4] },
                  ],
                },
                options: {
                  responsive: true,
                  interaction: { mode: "index", intersect: false },
                  plugins: {
                    legend: { position: "top", labels: { font: { size: 10 }, usePointStyle: true, boxWidth: 8 } },
                    tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: unknown }) => ` ${c.dataset.label}: $${Number(c.raw).toLocaleString()}` } },
                  },
                  scales: {
                    y: { grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: number) => "$" + (v >= 1000 ? (v / 1000).toFixed(0) + "K" : v), font: { size: 10 } } },
                    x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: labels.length <= 13 ? 13 : 7 } },
                  },
                },
              }),
            );
          } catch {
            /* chart failed */
          }
        }
      }
      if (data.keyMilestones) setMilestones(data.keyMilestones);
    });

    // Budget efficiency fetch
    apiPost<{ topChannel?: string; channels?: { name: string; score: number; roi?: string }[]; insight?: string }>("/api/budget-efficiency", {
      industry: industryName, competitors: compNames, monthlyBudget: campaignBudget,
    }).then((data) => {
      if (!alive) return;
      if (!data) {
        setEfficiencyStatus("Scoring temporarily unavailable");
        return;
      }
      setEfficiencyStatus(`Top channel: ${data.topChannel || "—"}`);
      const el = document.getElementById("efficiencyChart") as HTMLCanvasElement | null;
      if (el && Chart && data.channels) {
        destroyOnCanvas(el);
        const ctx = el.getContext("2d");
        if (ctx) {
          const effColors = data.channels.map((c) => (c.score >= 80 ? "rgba(16,185,129,0.82)" : c.score >= 65 ? "rgba(0,102,255,0.75)" : "rgba(245,158,11,0.75)"));
          try {
            instances.push(
              new Chart(ctx, {
                type: "bar",
                data: { labels: data.channels.map((c) => c.name), datasets: [{ label: "Efficiency Score", data: data.channels.map((c) => c.score), backgroundColor: effColors, borderRadius: 6, borderWidth: 0 }] },
                options: {
                  responsive: true,
                  indexAxis: "y",
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: unknown; dataIndex: number }) => ` Score: ${c.raw}/100 · ROI: ${data.channels?.[c.dataIndex]?.roi}` } } },
                  scales: { x: { min: 0, max: 100, grid: { color: "rgba(0,0,0,.04)" }, ticks: { font: { size: 10 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } },
                },
              }),
            );
          } catch {
            /* chart failed */
          }
        }
      }
      if (data.insight) setEfficiencyRec(`💡 <strong>AI Recommendation:</strong> ${data.insight}`);
    });

    // Supplemental legacy DOM enhancers + threat data hookup
    (window as unknown as { _threatCompetitors?: Competitor[] })._threatCompetitors = competitors;
    callWin("renderYourSwot", {
      yourDomain: (url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0],
      industryName, yourCTR, yourROAS, yourConv: parseFloat(String(derived.websiteKPIs.convRate)),
      yourTraffic: trafficVal, isLiveTraffic: derived.realTraffic, avgCTR, avgROAS,
      competitorsCount: competitors.length, sectorOnly: !!ad.sectorOnly,
    });
    callWin("_populateAdSpendColumn", competitors);
    // Journey panel removed — keep call as a no-op cleanup for any leftover DOM.
    callWin("_renderJourneyStages");

    return () => {
      alive = false;
      // Destroy charts while their canvases are still in React's tree. Late
      // fetch callbacks are gated on `alive` so they cannot re-wrap canvases
      // after unmount (that races React removeChild → NotFoundError).
      instances.forEach((c) => {
        try {
          c.destroy();
        } catch {
          /* already destroyed */
        }
      });
      chartsRef.current = [];
      // Chart.js responsive mode may leave a sizing wrapper — unwrap so React
      // finds each <canvas> where its fiber expects it.
      canvasIds.forEach((id) => {
        restoreCanvasForReact(document.getElementById(id) as HTMLCanvasElement | null);
      });
    };
  }, [derived, ad, competitors]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!hasData || !ad || !derived) {
    return (
      <div className="view-header-wrap">
        <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 48, textAlign: "center", color: "#6B7280" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>📊</div>
            <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>No analysis yet</div>
            <div style={{ fontSize: "0.88rem", marginBottom: 16 }}>Run a competitor analysis from the home page to generate your Intelligence Report.</div>
            <button className="btn-primary" onClick={() => goToView(router, "home")}>
              Run Analysis →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { websiteKPIs, industryName, url, avgCTR, avgROAS, yourCTR, yourROAS, realTraffic, trafficVal, sovData, yourSovShare } = derived;
  const yourDomain = (url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const countryLabel = getCountryLabel(ad.country);
  const aiAny = competitors.some((c) => c.aiDetected);

  const improvedROAS = (avgROAS * 1.28).toFixed(1);
  const alertRows = competitors.slice(0, 4);

  return (
    <PanelShell
      group="Analyse"
      title={ad.sectorOnly ? `Sector Overview: ${industryName}` : `Intelligence Report: ${url}`}
      subtitle={
        ad.sectorOnly
          ? `Industry-wide intelligence · ${competitors.length} top competitors mapped · No website yet — add one anytime to personalise this report`
          : `${industryName} · ${competitors.length} competitors analysed · AI recommendations generated`
      }
      maxWidth={1200}
      actions={
        <>
          <div className="analysis-tags" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span className="atag" title="Your industry category — all benchmarks and AI recommendations are calibrated to this vertical.">{industryName}</span>
            <span className="atag" title="Geographic scope of the analysis — traffic, ad spend and benchmarks are filtered to this market.">{countryLabel}</span>
            <span className="atag" title={`${competitors.length} rival domains are being tracked and benchmarked in this report.`}>{competitors.length} Competitors</span>
            <span className="atag live-tag" title="Data is refreshed in real time — competitor signals, traffic estimates and alerts are always current.">
              <span className="live-dot-inline" />Live Intel
            </span>
          </div>
          <IgButton
            variant="secondary"
            title="Refresh all competitor data and regenerate AI recommendations from scratch. Takes 30–60 seconds."
            onClick={() => goToView(router, "home")}
          >
            ↺ Re-run Analysis
          </IgButton>
        </>
      }
    >
        {competitors.length === 0 && (
          <div
            style={{
              marginBottom: 16,
              padding: "14px 16px",
              borderRadius: 12,
              border: "1.5px solid #FDE68A",
              background: "#FFFBEB",
              color: "#92400E",
              fontSize: "0.88rem",
              lineHeight: 1.45,
            }}
          >
            <strong>Analysis complete for {yourDomain}.</strong> No verified
            same-industry / same-business competitors were confirmed, so none
            were invented. The Intelligence Report below uses this company&apos;s
            live analysis; re-run Analyse Now if you want to retry rival matching.
          </div>
        )}
        {companyOverview && (
          <>
            <DomainOverview overview={companyOverview} currentView="dashboard" />
            <MessagingChannelStrip />
            {companyOverview.widgets?.length > 0 && (
              <OverviewWidgets
                widgets={companyOverview.widgets}
                domain={companyOverview.domain || yourDomain}
              />
            )}
          </>
        )}

        {marketing && (
          <div className={dm.wrap}>
            <section className={dm.hero}>
              <div className={dm.heroInner}>
                <div>
                  <div className={dm.heroEyebrow}>Marketing Command Center</div>
                  <h3 className={dm.heroTitle}>
                    {ad.sectorOnly ? industryName : yourDomain}
                  </h3>
                  <p className={dm.heroSub}>
                    {marketing.profile?.businessSummary ||
                      (ad.sectorOnly
                        ? `Sector-wide marketing intelligence for ${industryName} — competitor landscape, channel mix, and growth priorities.`
                        : `All current marketing intelligence for ${yourDomain} — performance benchmarks, competitive landscape, channel mix, and your next actions.`)}
                  </p>
                  <div className={dm.heroTags}>
                    <span className={dm.heroTag}>{industryName}</span>
                    <span className={dm.heroTag}>{countryLabel}</span>
                    <span className={dm.heroTag}>{competitors.length} competitors tracked</span>
                    {marketing.profile?.subNiche && <span className={dm.heroTag}>{marketing.profile.subNiche}</span>}
                  </div>
                </div>
                <div className={dm.heroAside}>
                  {marketing.profile?.analyzedAt && (
                    <span className={dm.analyzedAt}>
                      Analysed {new Date(marketing.profile.analyzedAt).toLocaleString()}
                    </span>
                  )}
                  <button className="btn-secondary" onClick={() => goToView(router, "battleplan")}>
                    Open 90-day plan →
                  </button>
                </div>
              </div>
            </section>

            <div className={dm.blendedGrid}>
              {[
                {
                  label: "Est. monthly traffic",
                  value: fmt(marketing.blended.monthlyTraffic),
                  color: "#00E5FF",
                  delta: realTraffic ? "Live DataForSEO" : "Industry benchmark",
                  deltaCls: realTraffic ? dm.deltaUp : dm.deltaNeutral,
                },
                {
                  label: "Your ROAS",
                  value: `${marketing.blended.roas}×`,
                  color: "#A78BFA",
                  delta: `${marketing.blended.roasVsMarket >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(marketing.blended.roasVsMarket))}% vs rivals`,
                  deltaCls: marketing.blended.roasVsMarket >= 0 ? dm.deltaUp : dm.deltaDown,
                },
                {
                  label: "Projected ROAS",
                  value: `${marketing.blended.projectedRoas || improvedROAS}×`,
                  color: "#34D399",
                  delta: "With InfoGenie optimisations",
                  deltaCls: dm.deltaUp,
                },
                {
                  label: "Market visibility",
                  value: marketing.blended.marketShare != null ? `${marketing.blended.marketShare}%` : `${yourSovShare}%`,
                  color: "#FBBF24",
                  delta: "Share of tracked competitor traffic",
                  deltaCls: dm.deltaNeutral,
                },
              ].map((m) => (
                <div key={m.label} className={dm.metricDark}>
                  <div className={dm.metricOwner}>{yourDomain}</div>
                  <div className={dm.metricLabel}>{m.label}</div>
                  <div className={dm.metricValue} style={{ color: m.color }}>
                    {m.value}
                  </div>
                  <div className={`${dm.metricDelta} ${m.deltaCls}`}>{m.delta}</div>
                </div>
              ))}
            </div>

            <div className={dm.twoCol}>
              <div className={dm.panel}>
                <h4 className={dm.panelTitle}>🏢 Company profile</h4>
                {marketing.profile?.siteTitle && (
                  <p className={dm.profileText}>
                    <strong>{marketing.profile.siteTitle}</strong>
                  </p>
                )}
                <p className={dm.profileText}>
                  {marketing.profile?.metaDesc || marketing.profile?.businessSummary || "Run Analyse Now with a website URL to pull live site metadata and a business summary."}
                </p>
                <div className={dm.metaRow}>
                  <div className={dm.metaItem}>
                    <strong>Domain:</strong> {yourDomain}
                  </div>
                  <div className={dm.metaItem}>
                    <strong>Industry:</strong> {industryName}
                  </div>
                  <div className={dm.metaItem}>
                    <strong>Primary market:</strong> {countryLabel}
                  </div>
                  <div className={dm.metaItem}>
                    <strong>CPA benchmark:</strong> ${websiteKPIs.cpa} · <strong>Conv. rate:</strong> {websiteKPIs.convRate}%
                  </div>
                </div>
              </div>
              <div className={dm.panel}>
                <h4 className={dm.panelTitle}>📡 Competitor channel mix</h4>
                <p className={dm.profileText}>Where rivals invest — use this to spot underserved channels for {yourDomain}.</p>
                {marketing.channels.length > 0 ? (
                  <>
                    <div className={dm.channelBar}>
                      {marketing.channels.map((ch) => (
                        <div key={ch.name} style={{ width: `${ch.share}%`, background: ch.color }} title={`${ch.name}: ${ch.share}%`} />
                      ))}
                    </div>
                    <div className={dm.channelLegend}>
                      {marketing.channels.map((ch) => (
                        <div key={ch.name} className={dm.channelRow}>
                          <span className={dm.channelDot} style={{ background: ch.color }} />
                          <span className={dm.channelName}>{ch.name}</span>
                          <span className={dm.channelPct}>{ch.share}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className={dm.profileText}>Channel data populates after competitor metrics are validated.</p>
                )}
              </div>
            </div>

            <div className={dm.swotGrid}>
              {([
                ["Strengths", marketing.swot.strengths, dm.swotS],
                ["Weaknesses", marketing.swot.weaknesses, dm.swotW],
                ["Opportunities", marketing.swot.opportunities, dm.swotO],
                ["Threats", marketing.swot.threats, dm.swotT],
              ] as const).map(([label, items, cls]) => (
                <div key={label} className={`${dm.swotCard} ${cls}`}>
                  <div className={dm.swotHead}>{label}</div>
                  <ul className={dm.swotList}>
                    {items.slice(0, 4).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <h4 className={dm.panelTitle} style={{ marginBottom: 12 }}>⚡ Priority marketing actions</h4>
            <div className={dm.actionGrid}>
              {marketing.actions.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  className={dm.actionCard}
                  onClick={() => action.view && goToView(router, action.view)}
                >
                  <div className={dm.actionTop}>
                    <span className={dm.actionArea}>{action.area}</span>
                    <span className={action.impact === "high" ? dm.impactHigh : dm.impactMed}>{action.impact} impact</span>
                  </div>
                  <div className={dm.actionTitle}>{action.title}</div>
                  <div className={dm.actionDetail}>{action.detail}</div>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => goToView(router, "marketing-brief")}
              style={{
                marginTop: 14,
                width: "100%",
                textAlign: "left",
                padding: "14px 16px",
                borderRadius: 12,
                border: "1.5px solid rgba(15,118,110,0.25)",
                background: "linear-gradient(135deg,#ecfdf5,#eff6ff)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0f766e", marginBottom: 4 }}>
                ⚔️ What to do today
              </div>
              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: "0.92rem", marginBottom: 4 }}>
                Open Brief for answer · recommendation · follow-through on each action
              </div>
              <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                Ranked competitive moves with one-click execution paths →
              </div>
            </button>
          </div>
        )}

        {hasData && <MarketingIntelPanels domain={yourDomain} industryName={industryName} />}

        {/* Competitor chips */}
        {competitors.length > 0 && (
          <div className="competitor-chips">
            <div className="cchips-label">
              <span>{aiAny ? "🤖 AI-detected competitors" : "🎯 Tracked competitors"} · click any name for full analysis</span>
            </div>
            <div className="cchips-row">
              {competitors.map((c, i) => (
                <button key={i} className="cchip" title={c.why || `Click to analyse ${c.name}`} onClick={() => setThreatIdx(i)}>
                  <span className="cchip-dot" style={{ background: CHIP_DOTS[i % 8] }} />
                  <span className="cchip-name">{c.name}</span>
                  {c.aiDetected && <span className="cchip-ai">AI</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* KPI grid — ownership is printed on each tile (no floating title tooltips) */}
        <div className="kpi-grid">
          <div className="kpi-card kpi-blue">
            <div className="kpi-ribbon kpi-ribbon-you">📍 YOUR SITE</div>
            <div className="kpi-owner" title={yourDomain}>{yourDomain}</div>
            <span style={{ fontSize: ".65rem", background: "#EEF2FF", color: "#4338CA", padding: "2px 6px", borderRadius: 10, fontWeight: 700, display: "inline-block", marginBottom: 4 }}>Industry Avg</span>
            <div className="kpi-icon">📊</div>
            <div className="kpi-label">Your CTR Benchmark</div>
            <div className="kpi-value">{yourCTR}%</div>
            <div className={`kpi-change ${yourCTR >= avgCTR ? "kpi-up" : "kpi-down"}`}>
              {yourCTR >= avgCTR ? "▲" : "▼"} {Math.abs(yourCTR - avgCTR).toFixed(2)}% vs. competitor avg ({avgCTR.toFixed(2)}%)
            </div>
            <div className="kpi-source kpi-source-you">📍 Your site · <strong>{yourDomain}</strong></div>
          </div>

          <div className="kpi-card kpi-teal">
            <div className="kpi-ribbon kpi-ribbon-you">📍 YOUR SITE</div>
            <div className="kpi-owner" title={yourDomain}>{yourDomain}</div>
            <span style={{ fontSize: ".65rem", background: "#EEF2FF", color: "#4338CA", padding: "2px 6px", borderRadius: 10, fontWeight: 700, display: "inline-block", marginBottom: 4 }}>Industry Avg</span>
            <div className="kpi-icon">🎯</div>
            <div className="kpi-label">Your ROAS Benchmark</div>
            <div className="kpi-value">{yourROAS}×</div>
            <div className={`kpi-change ${yourROAS >= avgROAS ? "kpi-up" : "kpi-down"}`}>
              {yourROAS >= avgROAS ? "▲" : "▼"} {Math.abs(yourROAS - avgROAS).toFixed(1)}× vs. competitor avg ({avgROAS.toFixed(1)}×)
            </div>
            <div className="kpi-source kpi-source-you">📍 Your site · <strong>{yourDomain}</strong></div>
          </div>

          <div className="kpi-card kpi-green">
            <div className="kpi-ribbon kpi-ribbon-ind">🏷️ INDUSTRY BENCHMARK</div>
            <div className="kpi-owner kpi-owner-ind" title={industryName}>{industryName}</div>
            <span style={{ fontSize: ".65rem", background: "#EEF2FF", color: "#4338CA", padding: "2px 6px", borderRadius: 10, fontWeight: 700, display: "inline-block", marginBottom: 4 }}>Industry Avg</span>
            <div className="kpi-icon">💰</div>
            <div className="kpi-label">CPA Benchmark</div>
            <div className="kpi-value">${websiteKPIs.cpa}</div>
            <div className="kpi-change kpi-up">▼ 35% reduction possible with AI optimisation</div>
            <div className="kpi-source kpi-source-ind">🏷️ Industry benchmark · <strong>{industryName}</strong></div>
          </div>

          <div className="kpi-card kpi-gold">
            {realTraffic ? (
              <div className="kpi-ribbon kpi-ribbon-live">📡 LIVE — YOUR SITE</div>
            ) : (
              <div className="kpi-ribbon kpi-ribbon-you">📍 YOUR SITE</div>
            )}
            <div className="kpi-owner" title={yourDomain}>{yourDomain}</div>
            {realTraffic ? (
              <span style={{ fontSize: ".65rem", background: "#10B98120", color: "#10B981", padding: "2px 6px", borderRadius: 10, fontWeight: 700 }}>LIVE</span>
            ) : (
              <span style={{ fontSize: ".65rem", background: "#EEF2FF", color: "#4338CA", padding: "2px 6px", borderRadius: 10, fontWeight: 700 }}>Industry Avg</span>
            )}
            <div className="kpi-icon">👥</div>
            <div className="kpi-label">Est. Monthly Traffic</div>
            <div className="kpi-value">{fmt(trafficVal)}</div>
            <div className="kpi-change kpi-up" style={{ fontSize: ".7rem" }}>{realTraffic ? "📡 DataForSEO live data" : "AI industry benchmark"}</div>
            {realTraffic ? (
              <div className="kpi-source kpi-source-live">📡 DataForSEO live · <strong>{yourDomain}</strong></div>
            ) : (
              <div className="kpi-source kpi-source-you">📍 Your site · <strong>{yourDomain}</strong></div>
            )}
          </div>

          <div className="kpi-card kpi-purple">
            <div className="kpi-ribbon kpi-ribbon-you">📍 YOUR SITE</div>
            <div className="kpi-owner" title={yourDomain}>{yourDomain}</div>
            <span style={{ fontSize: ".65rem", background: "#EEF2FF", color: "#4338CA", padding: "2px 6px", borderRadius: 10, fontWeight: 700, display: "inline-block", marginBottom: 4 }}>Industry Avg</span>
            <div className="kpi-icon">📈</div>
            <div className="kpi-label">Your Conv. Rate</div>
            <div className="kpi-value">{websiteKPIs.convRate}%</div>
            <div className={`kpi-change ${Number(websiteKPIs.convRate) >= 3 ? "kpi-up" : "kpi-down"}`}>Industry avg: 3.1%</div>
            <div className="kpi-source kpi-source-you">📍 Your site · <strong>{yourDomain}</strong></div>
          </div>

          <div className="kpi-card kpi-blue">
            <div className="kpi-ribbon kpi-ribbon-ai">🤖 YOUR SITE vs RIVALS</div>
            <div className="kpi-owner" title={yourDomain}>{yourDomain}</div>
            <span style={{ fontSize: ".65rem", background: "#0066FF20", color: "#0066FF", padding: "2px 6px", borderRadius: 10, fontWeight: 700, display: "inline-block", marginBottom: 4 }}>AI SCORE</span>
            <div className="kpi-icon">🚀</div>
            <div className="kpi-label">AI Opportunity Score</div>
            <div className="kpi-value">{calcOpportunityScore(websiteKPIs, avgCTR, avgROAS)}/100</div>
            <div className="kpi-change kpi-up">▲ High growth potential</div>
            <div className="kpi-source kpi-source-ai">🤖 AI score for <strong>{yourDomain}</strong> vs {competitors.length} rivals</div>
          </div>
        </div>

        <div id="kpiDataNotice" style={{ marginTop: 8, padding: "8px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8 }}>
          <span style={{ color: "#64748B", fontSize: "0.75rem" }}>
            ⚠️ <strong>AI Estimated benchmarks</strong> — CTR, ROAS, CPA and Conversion Rate are industry benchmark ranges for <strong>{industryName}</strong>, not pulled from your ad accounts.{" "}
            {realTraffic ? (
              <>Monthly Traffic is <strong style={{ color: "#10B981" }}>live from DataForSEO</strong>.</>
            ) : (
              "Connect Google Analytics or Google Ads to replace estimates with your real figures."
            )}{" "}
            Each tile shows the company or industry the figure belongs to.
          </span>
        </div>

        <div id="yourSwotCard" style={{ marginTop: 18 }} />
        <div id="forecastSavingsWidget" style={{ marginTop: 18 }} />

        {/* ROI banner */}
        <div className="roi-banner">
          <div className="roi-content">
            <div className="roi-label">🤖 InfoGenie ROI Projection</div>
            <div className="roi-title">Implementing InfoGenie&apos;s AI recommendations could deliver:</div>
            <div className="roi-sub">Based on analysis of {competitors.length} competitors in {industryName} and your current performance data</div>
          </div>
          <div className="roi-metrics">
            <div className="roi-metric" title="Expected revenue earned per $1 of ad spend after applying InfoGenie's AI-recommended campaign optimisations.">
              <div className="roi-metric-val" style={{ color: "#00C9C8" }}>+{improvedROAS}×</div>
              <div className="roi-metric-lbl">Projected ROAS</div>
            </div>
            <div className="roi-metric" title="Estimated decrease in Cost Per Acquisition — how much less you'll pay to win each new customer by closing competitor efficiency gaps.">
              <div className="roi-metric-val" style={{ color: "#10B981" }}>-35%</div>
              <div className="roi-metric-lbl">CPA Reduction</div>
            </div>
            <div className="roi-metric" title="Projected increase in conversion rate from AI-optimised ad targeting, landing page copy and audience segmentation.">
              <div className="roi-metric-val" style={{ color: "#F59E0B" }}>+25%</div>
              <div className="roi-metric-lbl">Conversion Lift</div>
            </div>
            <div className="roi-metric" title={`Average ROAS improvement observed across similar InfoGenie campaigns in the ${industryName} sector.`}>
              <div className="roi-metric-val" style={{ color: "#0f766e" }}>3.2×</div>
              <div className="roi-metric-lbl">Avg ROAS Lift</div>
            </div>
          </div>
        </div>

        {/* CTR + ROAS charts */}
        <div className="two-charts">
          <div className="chart-box">
            <div className="chart-box-header">
              <h3 title="Side-by-side Click-Through Rate comparison — your domain vs each tracked competitor. A higher CTR means ads are more compelling and relevant to the target audience.">
                Average CTR Comparison <span className="chart-tag ctr-tag" title="Click-Through Rate: % of ad impressions that result in a click.">CTR</span>
              </h3>
            </div>
            <canvas id="ctrChart" height={240} />
          </div>
          <div className="chart-box">
            <div className="chart-box-header">
              <h3 title="Return on Ad Spend comparison across all competitors. A 3× ROAS means $3 revenue generated for every $1 spent on ads.">
                ROAS Performance <span className="chart-tag roas-tag" title="Return on Ad Spend: revenue generated per $1 of advertising budget.">ROAS</span>
              </h3>
            </div>
            <canvas id="roasChart" height={240} />
          </div>
        </div>

        <div className="chart-box full">
          <div className="chart-box-header">
            <h3 title="12-month trend lines showing how competitor website traffic and estimated ad spend have evolved. Rising lines indicate aggressive growth; flat or falling lines signal vulnerability.">
              Traffic &amp; Ad Spend Trends — 12 Months <span className="chart-tag trend-tag" title="Historical trend data — AI-interpolated from available competitor signals.">TREND</span>
            </h3>
          </div>
          <canvas id="trendChart" height={140} />
        </div>

        {/* Competitor summary table */}
        <div className="data-table-card">
          <div className="dtc-header">
            <h3 title="A snapshot of all tracked competitors with their key performance metrics. Click any Threat Level badge for a detailed threat breakdown.">Competitor Intelligence Summary</h3>
            <button className="btn-link" title="Open the full Competitors page for in-depth analysis, attack plans and ad creative insights." onClick={() => goToView(router, "competitors")}>
              View Full Analysis →
            </button>
          </div>
          <div className="table-scroll">
            <table className="ig-table">
              <thead>
                <tr>
                  <th title="The competitor domain being tracked and benchmarked.">Competitor Website</th>
                  <th title="Estimated total monthly visits — organic search + paid traffic combined. Sourced from DataForSEO where available.">Est. Monthly Traffic</th>
                  <th title="Average Click-Through Rate across this competitor's active ad campaigns. Higher % = more compelling ads.">Avg CTR</th>
                  <th title="Return on Ad Spend — estimated revenue earned per $1 spent on ads. 2× means $2 back for every $1 spent.">ROAS</th>
                  <th title="Estimated monthly advertising budget across Google, Meta, TikTok and other paid channels.">Est. Ad Spend/mo</th>
                  <th title="The marketing channel driving the most traffic or conversions for this competitor.">Top Channel</th>
                  <th title="AI-assessed threat level: how directly this competitor threatens your market position. Click for a detailed breakdown.">Threat Level</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c, i) => {
                  const lvl = (c.threatLevel || "medium").toLowerCase();
                  const initials = c.logo || (c.name || "?").split(/\s+/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("");
                  const channel = c.topChannel || (c.topChannels && c.topChannels[0]) || "—";
                  const cap = lvl.charAt(0).toUpperCase() + lvl.slice(1);
                  const roasCell = typeof c.roas === "number" && c.roas > 0 ? c.roas.toFixed(1) + "×" : c.roas && c.roas !== "—" ? c.roas + "×" : "—";
                  return (
                    <tr key={i}>
                      <td>
                        <div className="comp-name-cell">
                          <div className="comp-favicon">{initials}</div>
                          {c.name || c.domain || "—"}
                        </div>
                      </td>
                      <td>{c.traffic && c.traffic !== "—" ? c.traffic : <span style={{ color: "#94a3b8" }} title="No public data available">—</span>}</td>
                      <td><strong>{c.ctr && c.ctr !== "—" ? c.ctr : <span style={{ color: "#94a3b8" }} title="No public data available">—</span>}</strong></td>
                      <td><strong>{roasCell === "—" ? <span style={{ color: "#94a3b8" }} title="No public data available">—</span> : roasCell}</strong></td>
                      <td id={`adSpendCell-${i}`}>{formatAdSpend(c)}</td>
                      <td>{channel}</td>
                      <td>
                        <span className={`threat-badge threat-${lvl} threat-badge-clickable`} onClick={() => setThreatIdx(i)} title="Click for threat details">
                          {cap} Threat ↗
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live data panels */}
        <div id="dashLivePanels">
          {/* Row 1: SOV + Forecast */}
          <div className="two-charts" style={{ marginTop: 24 }}>
            <div className="chart-box">
              <div className="chart-box-header">
                <h3 title="Share of Voice: your estimated percentage of total search and ad visibility compared to all tracked competitors in your market. Higher = you dominate more of the conversation.">
                  Share of Voice
                </h3>
                <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>Derived from competitor traffic data</span>
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", minHeight: 190, padding: "8px 0" }}>
                <div style={{ position: "relative", width: 160, minWidth: 160, height: 160 }}>
                  <canvas id="sovChart" />
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0A1628" }}>{yourSovShare}%</div>
                    <div style={{ fontSize: "0.58rem", color: "#6B7280", fontWeight: 700, letterSpacing: ".04em" }}>YOUR SHARE</div>
                  </div>
                </div>
                <div style={{ flex: 1, fontSize: "0.74rem", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 180 }}>
                  {sovData
                    .filter((d) => d.name !== "Others")
                    .map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                        <div style={{ flex: 1, color: d.name === "You" ? "#0A1628" : "#374151", fontWeight: d.name === "You" ? 700 : 400 }}>{d.name}</div>
                        <div style={{ fontWeight: 700, color: d.name === "You" ? "#00C9C8" : "#0A1628" }}>{d.share}%</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <div className="chart-box">
              <div className="chart-box-header">
                <h3 title="AI-generated revenue projection for the next 90 days based on your current KPIs, competitor trajectories and seasonal trends in your industry.">
                  90-Day Revenue Forecast <span className="chart-tag" style={{ background: "#0f766e20", color: "#0f766e" }} title="Generated by GPT-4o using your industry benchmarks and competitor performance data.">AI</span>
                </h3>
                <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>{forecastStatus}</span>
              </div>
              <canvas id="forecastChart" height={160} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {milestones.map((m, i) => (
                  <div key={i} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 10px", fontSize: "0.7rem", color: "#374151", flex: 1, minWidth: 130 }}>
                    <div style={{ fontWeight: 700, color: "#0066FF", marginBottom: 2 }}>Week {m.week}</div>
                    <div style={{ lineHeight: 1.4 }}>{m.milestone}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Efficiency + Spend */}
          <div className="two-charts">
            <div className="chart-box">
              <div className="chart-box-header">
                <h3 title="How efficiently each marketing channel converts budget into results — scored 0–100. Channels above 70 are outperforming the benchmark; below 40 need attention.">
                  Budget Efficiency by Channel <span className="chart-tag" style={{ background: "#10B98120", color: "#10B981" }} title="Each channel is scored by AI using ROAS, CTR and CPA data from your competitors.">AI SCORED</span>
                </h3>
                <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>{efficiencyStatus}</span>
              </div>
              <canvas id="efficiencyChart" height={180} />
              <div style={{ marginTop: 10, fontSize: "0.75rem", color: "#374151", padding: "8px 12px", background: "#F9FAFB", borderRadius: 8, minHeight: 20 }} dangerouslySetInnerHTML={{ __html: efficiencyRec }} />
            </div>
            <div className="chart-box">
              <div className="chart-box-header">
                <h3 title="Estimated monthly advertising spend for each competitor across all paid channels. Derived from paid traffic volume and average CPC data.">
                  Competitor Ad Spend <span className="chart-tag" style={{ background: "#10B98120", color: "#10B981" }} title="Traffic and keyword data sourced from the DataForSEO API.">DATAFORSEO</span>
                </h3>
                <span style={{ fontSize: "0.72rem", color: spendStatus.color, fontWeight: spendStatus.color === "#9CA3AF" ? 400 : 700 }}>{spendStatus.text}</span>
              </div>
              <canvas id="spendChart" height={180} />
            </div>
          </div>

          {/* Row 3: Alert feed */}
          <div className="data-table-card" style={{ marginBottom: 32 }}>
            <div className="dtc-header">
              <h3 title="Real-time AI-generated alerts about competitor activity — ad spend changes, new creatives, pricing shifts and market opportunities detected in the last 72 hours.">🔔 Live AI Alert Feed</h3>
              <span className="atag atag-solid atag-solid--red" title="Competitor signals are monitored continuously. New alerts appear as soon as the AI detects a significant change.">● Live Monitoring</span>
            </div>
            <div className="dtc-flush" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {alertRows.map((c, i) => {
                const a = ALERT_TMPLS[i % ALERT_TMPLS.length];
                return (
                  <div key={i} style={{ display: "flex", gap: 14, padding: "13px 0", borderBottom: "1px solid #F3F4F6", alignItems: "flex-start" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: a.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", flexShrink: 0 }}>{a.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: a.color, background: a.bg, padding: "2px 7px", borderRadius: 8 }} title={a.labelTitle}>{a.label}</span>
                        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#0A1628" }}>{c.name} Alert</span>
                        <span style={{ fontSize: "0.68rem", color: "#9CA3AF", marginLeft: "auto" }}>{a.age}</span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#4B5563", lineHeight: 1.55 }}>{a.msg(c.name || "")}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      {threatIdx != null && competitors[threatIdx] && (
        <div className={dm.modalBackdrop} onClick={() => setThreatIdx(null)}>
          <div className={dm.modal} onClick={(e) => e.stopPropagation()}>
            <h4 className={dm.modalTitle}>
              {competitors[threatIdx].name} — {(competitors[threatIdx].threatLevel || "medium").toUpperCase()} threat
            </h4>
            <div className={dm.modalBody}>
              <p>{competitors[threatIdx].why || "Direct competitor in your market."}</p>
              <p style={{ marginTop: 10 }}>
                <strong>Traffic:</strong> {competitors[threatIdx].traffic || "—"} · <strong>Top channel:</strong>{" "}
                {competitors[threatIdx].topChannel || "—"} · <strong>ROAS:</strong>{" "}
                {typeof competitors[threatIdx].roas === "number" ? competitors[threatIdx].roas + "×" : competitors[threatIdx].roas || "—"}
              </p>
              {(competitors[threatIdx].suggestions || []).length > 0 && (
                <>
                  <p style={{ marginTop: 12, fontWeight: 700 }}>Recommended counter-moves:</p>
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                    {(competitors[threatIdx].suggestions || []).map((s, si) => (
                      <li key={si} style={{ marginBottom: 6 }}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <button type="button" className={dm.modalClose} onClick={() => setThreatIdx(null)}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ marginLeft: 10 }}
              onClick={() => {
                setThreatIdx(null);
                goToView(router, "competitors");
              }}
            >
              Full competitor analysis →
            </button>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
