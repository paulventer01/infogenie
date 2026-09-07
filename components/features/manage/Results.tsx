"use client";

// Native React port of the legacy `results` panel (was `window.buildResults`
// inline in app.js + the PDF-export / customise-panel / competitor-ROAS-breakdown
// helpers in public/js/ig_results_export.js + `#view-results`). The Results
// Snapshot has NO /api/* report data source — it reads entirely from the legacy
// SPA window globals (`analysisData`, `_launchedCampaigns`, `_infoGenieActions`,
// `_lastCampRecs`, `_abTests`) and localStorage (`ig_lead_data`), exactly as the
// legacy builder did. Reads are via typed casts (TechStack.tsx precedent), guarded
// for undefined. Performance charts use the global Chart.js (vendor lib loaded by
// the shell), the lead dashboard / customise panel / PDF export are ported to React.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { useToast } from "@/hooks/useToast";

// ── Legacy data shapes (window globals) ──────────────────────────────────────
interface Industry {
  name?: string;
}
interface Competitor {
  name?: string;
  domain?: string;
  url?: string;
  roas?: number | string;
  avgCPC?: number | string;
  qualityScore?: number | string;
  usesExactMatch?: boolean;
  usesRetargeting?: boolean;
  landingPageScore?: number | string;
  bounceRate?: number | string;
  ctr?: number | string;
  topChannel?: string;
  topChannels?: string[];
  topKeywords?: string[];
}
interface WebsiteKPIs {
  roas?: number | string;
}
interface AnalysisData {
  url?: string;
  industry?: Industry | string;
  competitors?: Competitor[];
  websiteKPIs?: WebsiteKPIs;
}
interface Metrics {
  roas?: number | string;
  ctr?: number | string;
  conversions?: number;
  impressions?: number;
  spend?: number;
  cpa?: number | string;
}
interface Campaign {
  name?: string;
  platform?: string;
  budget: number;
  budgetStr?: string;
  metrics: Metrics;
  audience?: string;
  status?: string;
  launchedAt?: string;
  estROAS?: number | string;
  estCTR?: number | string;
  estCPA?: number | string;
}
interface ActionItem {
  time?: string;
  date?: string;
  action?: string;
  type?: string;
  impact?: string;
}
interface Rec {
  budget?: string;
  estROAS?: number | string;
}
interface AbVariant {
  platform: string;
  roas: number | string;
  ctr: number | string;
}
interface AbTest {
  name: string;
  varA: AbVariant;
  varB: AbVariant;
  winner: string;
  split: number;
  days: number;
  startedAt: string;
}
interface LeadData {
  messages: number;
  calls: number;
  budget: number;
}

interface ChartInstance {
  destroy(): void;
}
type ChartCtor = new (
  ctx: CanvasRenderingContext2D,
  config: unknown,
) => ChartInstance;

interface LegacyWindow {
  analysisData?: AnalysisData;
  _launchedCampaigns?: Campaign[];
  _infoGenieActions?: ActionItem[];
  _lastCampRecs?: Rec[];
  _abTests?: AbTest[];
  _leadData?: LeadData;
  Chart?: ChartCtor;
}

function lw(): LegacyWindow {
  if (typeof window === "undefined") return {};
  return window as unknown as LegacyWindow;
}

// ── Customise-panel sections (from ig_results_export.js) ──────────────────────
const RESULTS_SECTIONS: { key: string; label: string }[] = [
  { key: "stats", label: "📊 Summary KPIs" },
  { key: "leads", label: "📋 Lead Reporting Dashboard" },
  { key: "charts", label: "📈 Performance Charts" },
  { key: "roas-breakdown", label: "📉 Competitor ROAS Breakdown" },
  { key: "improvement", label: "✅ Improvement Analysis" },
  { key: "campaigns", label: "🚀 Active Campaigns Table" },
  { key: "abtests", label: "🧪 A/B Test Results" },
  { key: "actions", label: "⚡ Action History Timeline" },
];

// ── Industry ROAS benchmarks (from ig_results_export.js) ──────────────────────
interface Benchmark {
  min: number;
  avg: number;
  top: number;
  label: string;
}
const INDUSTRY_ROAS_BENCHMARKS: Record<string, Benchmark> = {
  "e-commerce": { min: 2.5, avg: 4.5, top: 8.0, label: "E-commerce" },
  ecommerce: { min: 2.5, avg: 4.5, top: 8.0, label: "E-commerce" },
  retail: { min: 2.0, avg: 4.0, top: 7.0, label: "Retail" },
  saas: { min: 2.0, avg: 3.5, top: 6.0, label: "SaaS / Software" },
  software: { min: 2.0, avg: 3.5, top: 6.0, label: "Software" },
  finance: { min: 1.5, avg: 3.0, top: 5.0, label: "Financial Services" },
  fintech: { min: 1.5, avg: 3.0, top: 5.0, label: "Fintech" },
  insurance: { min: 1.2, avg: 2.5, top: 4.5, label: "Insurance" },
  realestate: { min: 1.5, avg: 2.8, top: 4.5, label: "Real Estate" },
  "real estate": { min: 1.5, avg: 2.8, top: 4.5, label: "Real Estate" },
  healthcare: { min: 1.8, avg: 3.2, top: 5.5, label: "Healthcare" },
  medical: { min: 1.8, avg: 3.2, top: 5.5, label: "Medical" },
  education: { min: 2.0, avg: 3.5, top: 6.0, label: "Education" },
  travel: { min: 2.5, avg: 4.0, top: 7.0, label: "Travel & Tourism" },
  hospitality: { min: 2.0, avg: 3.5, top: 6.0, label: "Hospitality" },
  automotive: { min: 2.0, avg: 3.8, top: 6.5, label: "Automotive" },
  food: { min: 2.5, avg: 4.5, top: 8.0, label: "Food & Beverage" },
  restaurant: { min: 2.5, avg: 4.5, top: 8.0, label: "Restaurant / Food" },
  beauty: { min: 3.0, avg: 5.5, top: 9.0, label: "Beauty & Cosmetics" },
  fitness: { min: 2.0, avg: 3.8, top: 6.5, label: "Fitness & Wellness" },
  legal: { min: 1.5, avg: 2.8, top: 4.5, label: "Legal Services" },
  marketing: { min: 2.5, avg: 4.0, top: 7.0, label: "Marketing / Agency" },
  agency: { min: 2.5, avg: 4.0, top: 7.0, label: "Agency Services" },
  default: { min: 2.0, avg: 3.5, top: 6.0, label: "Your Industry" },
};

function industryName(ad: AnalysisData | null): string {
  if (!ad) return "";
  const ind = ad.industry;
  if (!ind) return "";
  return typeof ind === "string" ? ind : ind.name || "";
}

function getIndustryROASBenchmark(ad: AnalysisData | null): Benchmark {
  const ind = industryName(ad).toLowerCase();
  for (const [key, bench] of Object.entries(INDUSTRY_ROAS_BENCHMARKS)) {
    if (ind.includes(key)) return bench;
  }
  const keys = Object.keys(INDUSTRY_ROAS_BENCHMARKS).filter((k) => k !== "default");
  const match = keys.find((k) => k.split(" ").some((w) => ind.includes(w)));
  return (match && INDUSTRY_ROAS_BENCHMARKS[match]) || INDUSTRY_ROAS_BENCHMARKS.default;
}

interface ROASIssues {
  roasEst: string;
  primary: string;
  fixes: string[];
  bench: Benchmark;
}
function compROASIssues(comp: Competitor, ad: AnalysisData | null): ROASIssues {
  const _bench = getIndustryROASBenchmark(ad);
  const _haveRoas =
    (typeof comp.roas === "number" && comp.roas > 0) ||
    (typeof comp.roas === "string" && comp.roas !== "—" && !isNaN(parseFloat(comp.roas)));
  const roasEst = _haveRoas ? parseFloat(String(comp.roas)).toFixed(1) : _bench.avg.toFixed(1);
  const bench = getIndustryROASBenchmark(ad);
  const roasNum = parseFloat(roasEst);
  const gap = (bench.avg - roasNum).toFixed(1);
  const isUnderBench = roasNum < bench.avg;

  const hasHighCpc = !!comp.avgCPC && parseFloat(String(comp.avgCPC)) > 3.5;
  const lowQscore = !!comp.qualityScore && parseFloat(String(comp.qualityScore)) < 6;
  const broadMatch = !comp.usesExactMatch;
  const noRetarg = !comp.usesRetargeting;
  const poorLanding = !!comp.landingPageScore && parseFloat(String(comp.landingPageScore)) < 70;
  const highBounce = !!comp.bounceRate && parseFloat(String(comp.bounceRate)) > 65;
  const lowCtr = !!comp.ctr && parseFloat(String(comp.ctr)) < 2.5;
  const topCh = (comp.topChannel || comp.topChannels?.[0] || "").toLowerCase();

  const allIssues = [
    { cond: hasHighCpc, label: `Overpaying per click — ${bench.label} avg CPC is falling due to bid inflation on broad match terms`, fixes: ["Use SKAG bid structure", "Add 200+ negative keywords"] },
    { cond: lowQscore, label: "Low Quality Score — ad-to-landing-page mismatch reducing ad rank and increasing CPC", fixes: ["Align ad copy with landing page H1", "Add emotion-driven CTAs"] },
    { cond: broadMatch, label: `Broad match keywords wasting ${bench.label} budget on irrelevant traffic — conversion rate suffers`, fixes: ["Shift to phrase/exact match", "Layer audience bid modifiers"] },
    { cond: noRetarg, label: "Zero retargeting — warm visitors who showed buying intent are being handed back to competitors", fixes: ["Add RLSA campaigns", "Build 7/14/30-day custom audiences"] },
    { cond: poorLanding, label: "Weak landing page UX — ${bench.label} buyers have high intent but drop-off before converting", fixes: ["Add social proof above fold", "Single CTA per page"] },
    { cond: highBounce, label: "High bounce rate indicates ad promise mismatches the landing page — trust collapses on arrival", fixes: ["Match ad headline to page H1", "A/B test headline + offer"] },
    { cond: lowCtr, label: `CTR of ${comp.ctr} is below ${bench.label} average (2.5%+) — ad copy lacks relevance or differentiation`, fixes: ["Test question-based headlines", "Add dynamic keyword insertion"] },
    { cond: topCh === "meta" && isUnderBench, label: `Meta-only strategy in ${bench.label} misses high-intent Google search traffic where ROAS is ${(roasNum + 0.8).toFixed(1)}×+`, fixes: ["Add Google Search campaigns", "Use Google Shopping for product ads"] },
    { cond: topCh === "google" && isUnderBench, label: `Google-only strategy misses Meta's warm audience retargeting loop — ${bench.label} brands see +0.6× ROAS lift adding Meta`, fixes: ["Add Meta retargeting layer", "Run brand awareness on Meta Stories"] },
  ].filter((i) => i.cond);

  const fallbackIssues = [
    { label: `Ad creative fatigue — in ${bench.label} the average creative lifespan is 21 days; CTR is likely declining week-on-week`, fixes: ["Rotate 3+ creative variants", "Refresh every 3 weeks"] },
    { label: `Generic offer messaging — ${bench.label} buyers respond to specificity; this brand lacks a clear differentiator in ad copy`, fixes: ["Lead with a unique value prop", "Use direct competitor comparison angles"] },
    { label: `No dayparting strategy — ${bench.label} conversions peak in specific windows; budget burning during off-peak hours`, fixes: ["Analyse hourly conversion data", "Schedule bids to peak windows only"] },
    { label: `Single-channel reliance increases CPA by ~22% vs. multi-channel in ${bench.label} — attribution gap reduces ROAS`, fixes: ["Add a second platform", "Implement cross-channel attribution"] },
    { label: `Audience targeting too broad — ${bench.label} campaigns require tight lookalike and interest layering to hit ${bench.avg}× ROAS`, fixes: ["Build 1% LTV lookalike audiences", "Layer purchase-intent audiences"] },
  ];

  const combined = [...allIssues, ...fallbackIssues].slice(0, 2);
  const primary =
    combined[0]?.label ||
    `ROAS of ${roasEst}× is ${gap}× below the ${bench.label} industry average of ${bench.avg}× — structural targeting inefficiency`;
  const fixes = combined.flatMap((i) => i.fixes).slice(0, 4);

  return { roasEst, primary, fixes, bench };
}

const statusColor: Record<string, string> = {
  active: "#10B981",
  paused: "#F59E0B",
  completed: "#6B7280",
  draft: "#0066FF",
};

function parseBudgetStr(b: unknown): number {
  const n = parseInt(String(b || "").replace(/[^0-9]/g, ""));
  return isFinite(n) && n > 0 ? n : 0;
}

export default function Results() {
  const router = useRouter();
  const toast = useToast();

  const [mounted, setMounted] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [camps, setCamps] = useState<Campaign[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [abTests, setAbTests] = useState<AbTest[]>([]);
  const [leadData, setLeadData] = useState<LeadData>({ messages: 0, calls: 0, budget: 0 });
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  // Customise panel
  const [showCust, setShowCust] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<Record<string, boolean>>({});

  // Lead inputs
  const [msgsInput, setMsgsInput] = useState("");
  const [callsInput, setCallsInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");

  const roasRef = useRef<HTMLCanvasElement>(null);
  const platformRef = useRef<HTMLCanvasElement>(null);

  // ── Read legacy window globals + localStorage on mount ──────────────────────
  useEffect(() => {
    let cancelled = false;
    const w = lw();
    let saved: LeadData | null = null;
    try {
      const s = localStorage.getItem("ig_lead_data");
      if (s) saved = JSON.parse(s) as LeadData;
    } catch {
      /* ignore */
    }
    const ld = saved || w._leadData || { messages: 0, calls: 0, budget: 0 };
    if (cancelled) return;
    setAnalysisData(w.analysisData || null);
    setCamps(w._launchedCampaigns || []);
    setActions(w._infoGenieActions || []);
    setRecs(w._lastCampRecs || []);
    setAbTests(w._abTests || []);
    setLeadData(ld);
    setMsgsInput(ld.messages ? String(ld.messages) : "");
    setCallsInput(ld.calls ? String(ld.calls) : "");
    setMounted(true);
    return () => {
      cancelled = true;
    };
  }, []);

  const rShow = useCallback((key: string) => prefs[key] !== false, [prefs]);

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const totalBudget = camps.reduce((s, c) => s + c.budget, 0);
  const avgROAS =
    camps.length > 0
      ? (camps.reduce((s, c) => s + parseFloat(String(c.metrics.roas || 0)), 0) / camps.length).toFixed(1)
      : null;
  const totalConv = camps.reduce((s, c) => s + (c.metrics.conversions || 0), 0);
  const totalImpressions = camps.reduce((s, c) => s + (c.metrics.impressions || 0), 0);

  const projTotalBudget = recs.reduce((s, r) => s + parseBudgetStr(r.budget), 0);
  const projAvgROAS =
    recs.length > 0
      ? (recs.reduce((s, r) => s + parseFloat(String(r.estROAS || 0)), 0) / recs.length).toFixed(1)
      : null;
  const projImpressions = projTotalBudget > 0 ? Math.round(projTotalBudget / 0.003) : 0;
  const projConv = projImpressions > 0 ? Math.round(projImpressions * 0.025) : 0;

  const isProjected = camps.length === 0 && recs.length > 0;
  const displayBudget = totalBudget > 0 ? totalBudget : projTotalBudget;
  const displayROAS = avgROAS || projAvgROAS;
  const displayConv = totalConv > 0 ? totalConv : projConv;
  const displayImpr = totalImpressions > 0 ? totalImpressions : projImpressions;

  // Auto-generated analysis actions
  const autoActions = useMemo<ActionItem[]>(() => {
    if (!analysisData) return [];
    const date = new Date().toLocaleDateString();
    const comps = analysisData.competitors || [];
    return [
      { time: "", date, action: `Analysed ${analysisData.url} — detected ${industryName(analysisData)} industry`, type: "analysis", impact: `${comps.length} competitors found` },
      { time: "", date, action: `Generated ${recs.length} AI campaign recommendations`, type: "campaigns", impact: "Ranked by projected ROI impact" },
      { time: "", date, action: `Auto-detected target audience segments from competitor data`, type: "audience", impact: `Applied to all campaign targeting` },
      { time: "", date, action: `Competitor intelligence report built for ${comps.length} competitors`, type: "intelligence", impact: "CTR, ROAS, budget gaps identified" },
    ];
  }, [analysisData, recs.length]);
  const allActions = useMemo(() => [...actions, ...autoActions], [actions, autoActions]);

  // ── Performance charts (Chart.js global) ────────────────────────────────────
  useEffect(() => {
    if (!mounted || camps.length === 0) return;
    const ChartCtor = lw().Chart;
    if (!ChartCtor) return;
    const instances: ChartInstance[] = [];

    const rt = roasRef.current;
    if (rt) {
      const ctx = rt.getContext("2d");
      if (ctx) {
        const weeks = ["Wk1", "Wk2", "Wk3", "Wk4", "Wk5", "Wk6", "Wk7", "Wk8"];
        const campColors = ["#0066FF", "#00C9C8", "#10B981", "#F59E0B", "#0f766e", "#EF4444"];
        instances.push(
          new ChartCtor(ctx, {
            type: "line",
            data: {
              labels: weeks,
              datasets: camps.slice(0, 4).map((c, i) => {
                const baseROAS = parseFloat(String(c.metrics.roas)) || 3.0;
                const trend = weeks.map((_, w) =>
                  +(baseROAS * (0.85 + w * 0.025 + ((i * 7 + w * 3) % 6) / 100)).toFixed(2),
                );
                return {
                  label: (c.name || "").substring(0, 18),
                  data: trend,
                  borderColor: campColors[i % campColors.length],
                  backgroundColor: campColors[i % campColors.length] + "15",
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 3,
                  fill: i === 0,
                };
              }),
            },
            options: {
              responsive: true,
              plugins: {
                legend: { position: "top", labels: { font: { size: 10 }, usePointStyle: true, boxWidth: 8 } },
                tooltip: { callbacks: { label: (c: { dataset: { label: string }; raw: unknown }) => ` ${c.dataset.label}: ${c.raw}×` } },
              },
              scales: {
                y: { grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: number) => v + "×", font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
              },
            },
          }),
        );
      }
    }

    const pp = platformRef.current;
    if (pp) {
      const ctx = pp.getContext("2d");
      if (ctx) {
        const platformMap: Record<string, { roas: number[]; ctr: number[] }> = {};
        camps.forEach((c) => {
          const key = c.platform || "—";
          if (!platformMap[key]) platformMap[key] = { roas: [], ctr: [] };
          platformMap[key].roas.push(parseFloat(String(c.metrics.roas)) || 3);
          platformMap[key].ctr.push(parseFloat(String(c.metrics.ctr)) || 3);
        });
        const ppLabels = Object.keys(platformMap);
        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        instances.push(
          new ChartCtor(ctx, {
            type: "bar",
            data: {
              labels: ppLabels,
              datasets: [
                { label: "Avg ROAS (×)", data: ppLabels.map((p) => +avg(platformMap[p].roas).toFixed(2)), backgroundColor: "rgba(0,102,255,0.8)", borderRadius: 6, yAxisID: "y", borderWidth: 0 },
                { label: "Avg CTR (%)", data: ppLabels.map((p) => +avg(platformMap[p].ctr).toFixed(2)), backgroundColor: "rgba(0,201,200,0.75)", borderRadius: 6, yAxisID: "y2", borderWidth: 0 },
              ],
            },
            options: {
              responsive: true,
              plugins: { legend: { position: "top", labels: { font: { size: 10 }, usePointStyle: true, boxWidth: 8 } } },
              scales: {
                y: { position: "left", grid: { color: "rgba(0,0,0,.04)" }, ticks: { callback: (v: number) => v + "×", font: { size: 10 } } },
                y2: { position: "right", grid: { display: false }, ticks: { callback: (v: number) => v + "%", font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
              },
            },
          }),
        );
      }
    }

    return () => {
      instances.forEach((i) => i.destroy());
    };
  }, [mounted, camps, prefs]);

  // ── Lead reporting ──────────────────────────────────────────────────────────
  function saveLeadData() {
    const msgs = parseInt(msgsInput || "0") || 0;
    const calls = parseInt(callsInput || "0") || 0;
    const budget = parseInt(budgetInput || "0") || 0;
    const next = { messages: msgs, calls, budget };
    setLeadData(next);
    try {
      localStorage.setItem("ig_lead_data", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    toast("✅ Lead data saved!");
  }

  function loadLeadFromAnalysis() {
    let saved: LeadData | null = null;
    try {
      const s = localStorage.getItem("ig_lead_data");
      if (s) saved = JSON.parse(s) as LeadData;
    } catch {
      /* ignore */
    }
    const launchedBudget = camps.reduce((s, c) => s + c.budget, 0);
    const recsBudget = recs.reduce((s, r) => s + parseBudgetStr(r.budget), 0);
    const autoBudget = launchedBudget || recsBudget;
    if (saved) {
      setLeadData(saved);
      if (saved.messages) setMsgsInput(String(saved.messages));
      if (saved.calls) setCallsInput(String(saved.calls));
    }
    setBudgetInput(String(saved?.budget || autoBudget || ""));
    toast("✅ Lead data loaded from analysis");
  }

  // ── Customise panel ─────────────────────────────────────────────────────────
  function openCust() {
    const draft: Record<string, boolean> = {};
    RESULTS_SECTIONS.forEach((s) => {
      draft[s.key] = prefs[s.key] !== false;
    });
    setDraftPrefs(draft);
    setShowCust(true);
  }
  function rcApply() {
    setPrefs(draftPrefs);
    setShowCust(false);
    toast("✅ View updated");
  }

  // ── PDF export (opens a print window, mirrors ig_results_export.js) ──────────
  function exportResultsPDF() {
    const ad = analysisData;
    const now = new Date().toLocaleString();
    const tBudget = camps.reduce((s, c) => s + c.budget, 0);
    const aROAS = camps.length
      ? (camps.reduce((s, c) => s + parseFloat(String(c.metrics?.roas || 0)), 0) / camps.length).toFixed(1)
      : "—";
    const tConv = camps.reduce((s, c) => s + (c.metrics?.conversions || 0), 0);

    const campRows = camps
      .map(
        (c) => `
    <tr>
      <td>${c.name || "—"}</td>
      <td>${c.platform || "—"}</td>
      <td>${c.budgetStr || "$" + c.budget}/mo</td>
      <td style="color:#10B981;font-weight:700">${c.metrics?.roas || "—"}×</td>
      <td>${c.metrics?.ctr || "—"}</td>
      <td>${(c.metrics?.conversions || 0).toLocaleString()}</td>
      <td>${c.metrics?.cpa || "—"}</td>
      <td>${c.launchedAt || "—"}</td>
    </tr>`,
      )
      .join("");

    const actionRows = actions
      .slice(0, 40)
      .map(
        (a) => `
    <tr>
      <td>${a.date || "—"} ${a.time || ""}</td>
      <td>${a.action || "—"}</td>
      <td style="color:#059669">${a.impact || ""}</td>
    </tr>`,
      )
      .join("");

    const roasRows = ad
      ? (ad.competitors || [])
          .slice(0, 6)
          .map((comp) => {
            const issues = compROASIssues(comp, ad);
            return `<tr>
      <td><strong>${comp.name}</strong></td>
      <td style="color:#DC2626;font-weight:700">${issues.roasEst}×</td>
      <td>${issues.primary}</td>
      <td>${issues.fixes.join(" · ")}</td>
    </tr>`;
          })
          .join("")
      : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>InfoGenie Campaign Results Report</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color:#1a1a2e; background:#fff; padding:32px 40px; }
    h1 { font-size:1.8rem; color:#0066FF; margin-bottom:4px; }
    .subtitle { font-size:0.85rem; color:#6B7280; margin-bottom:28px; }
    .logo { display:flex; align-items:center; gap:10px; margin-bottom:24px; }
    .logo-icon { width:36px; height:36px; background:linear-gradient(135deg,#00C9C8,#0066FF); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:900; font-size:1rem; }
    .logo-text { font-size:1.4rem; font-weight:900; background:linear-gradient(135deg,#00C9C8,#0066FF); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:28px; }
    .kpi-card { border:1px solid #E2E8F0; border-radius:10px; padding:14px 16px; }
    .kpi-val { font-size:1.5rem; font-weight:800; color:#0066FF; }
    .kpi-label { font-size:0.72rem; color:#6B7280; margin-top:3px; }
    section { margin-bottom:28px; }
    h2 { font-size:1rem; font-weight:700; color:#0A1628; border-bottom:2px solid #E2E8F0; padding-bottom:6px; margin-bottom:12px; }
    table { width:100%; border-collapse:collapse; font-size:0.78rem; }
    th { background:#F9FAFB; text-align:left; padding:8px 10px; font-size:0.68rem; text-transform:uppercase; letter-spacing:.04em; color:#6B7280; border-bottom:1px solid #E2E8F0; }
    td { padding:8px 10px; border-bottom:1px solid #F3F4F6; vertical-align:top; }
    tr:last-child td { border-bottom:none; }
    .footer { margin-top:40px; font-size:0.72rem; color:#9CA3AF; text-align:center; border-top:1px solid #E2E8F0; padding-top:16px; }
    @media print {
      body { padding:16px 20px; }
      @page { margin:14mm 12mm; }
    }
  </style>
</head>
<body>
  <div class="logo">
    <div class="logo-icon">IG</div>
    <div class="logo-text">InfoGenie</div>
  </div>
  <h1>Campaign Results Report</h1>
  <div class="subtitle">Generated: ${now}${ad ? " &nbsp;·&nbsp; Analysis: " + ad.url : ""}</div>

  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-val">${camps.length}</div><div class="kpi-label">Campaigns Launched</div></div>
    <div class="kpi-card"><div class="kpi-val">${camps.length ? "$" + tBudget.toLocaleString() : "—"}</div><div class="kpi-label">Total Budget / mo</div></div>
    <div class="kpi-card"><div class="kpi-val">${aROAS}×</div><div class="kpi-label">Average ROAS</div></div>
    <div class="kpi-card"><div class="kpi-val">${tConv.toLocaleString()}</div><div class="kpi-label">Total Conversions</div></div>
    <div class="kpi-card"><div class="kpi-val">${ad ? (ad.competitors || []).length : "—"}</div><div class="kpi-label">Competitors Analysed</div></div>
    <div class="kpi-card"><div class="kpi-val">${actions.length}</div><div class="kpi-label">AI Actions Taken</div></div>
  </div>

  ${camps.length ? `
  <section>
    <h2>🚀 Active Campaigns</h2>
    <table>
      <thead><tr><th>Campaign</th><th>Platform</th><th>Budget</th><th>ROAS</th><th>CTR</th><th>Conversions</th><th>CPA</th><th>Launched</th></tr></thead>
      <tbody>${campRows}</tbody>
    </table>
  </section>` : ""}

  ${roasRows ? `
  <section>
    <h2>📉 Competitor ROAS Breakdown — Why They're Underperforming</h2>
    <table>
      <thead><tr><th>Competitor</th><th>Est. ROAS</th><th>Primary Issue</th><th>Recommended Fixes</th></tr></thead>
      <tbody>${roasRows}</tbody>
    </table>
  </section>` : ""}

  ${actionRows ? `
  <section>
    <h2>⚡ Action History</h2>
    <table>
      <thead><tr><th>Date / Time</th><th>Action</th><th>Impact</th></tr></thead>
      <tbody>${actionRows}</tbody>
    </table>
  </section>` : ""}

  <div class="footer">InfoGenie — AI Autonomous Marketing Intelligence &nbsp;·&nbsp; Confidential — Do not distribute</div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      toast("⚠ Please allow pop-ups to export PDF");
      return;
    }
    win.document.write(html);
    win.document.close();
    toast('📄 PDF print dialog opened — choose "Save as PDF"');
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const header = (
    <div className="view-header ig-panel-hero">
      <div className="container">
        <div className="vh-inner">
          <div>
            <div className="breadcrumb">
              <span className="bc-group">Grow</span> <span className="bc-sep">›</span> Results
            </div>
            <h2 className="view-title">Campaign Results &amp; Action History</h2>
            <p className="view-sub">
              Live tracking of InfoGenie&apos;s actions, launched campaigns, and performance improvements
            </p>
          </div>
          <div className="vh-actions" style={{ gap: 10 }}>
            <button className="btn-secondary" title="Show/hide sections" onClick={openCust}>
              ⚙ Customise View
            </button>
            <button className="btn-primary" onClick={exportResultsPDF}>
              📄 Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!mounted) {
    return (
      <div id="view-results">
        {header}
        <div className="container" />
      </div>
    );
  }

  // Empty state
  if (camps.length === 0 && !analysisData) {
    return (
      <div id="view-results">
        {header}
        <div className="container">
          <div style={{ textAlign: "center", padding: "60px 24px" }}>
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>📊</div>
            <h3 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.25rem", fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>
              No Results Yet
            </h3>
            <p style={{ color: "#6B7280", fontSize: "0.9rem", marginBottom: 24, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
              Run an analysis and launch campaigns to see InfoGenie&apos;s results and action history here.
            </p>
            <button className="btn-primary" onClick={() => goToView(router, "home")} style={{ margin: "0 auto" }}>
              ← Run Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Funnel + pacing pre-compute
  const totalClicks = Math.round(totalImpressions * 0.045);
  const funnelData: [string, number, string, number][] = [
    ["Impressions", totalImpressions, "#0066FF", 100],
    ["Clicks", totalClicks, "#00C9C8", totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 100) : 45],
    ["Conversions", totalConv, "#10B981", totalImpressions > 0 ? Math.round((totalConv / totalImpressions) * 100) : 2],
    ["Repeat Buys", Math.round(totalConv * 0.28), "#0f766e", totalImpressions > 0 ? Math.round(((totalConv * 0.28) / totalImpressions) * 100) : 1],
  ];

  const proj = isProjected ? (
    <span style={{ fontSize: "0.6rem", fontWeight: 600, color: "#9CA3AF", verticalAlign: "middle" }}> (proj.)</span>
  ) : null;

  const statTiles: { label: string; val: React.ReactNode; color: string; tip: string }[] = [
    { label: "🚀 Campaigns Launched", val: isProjected ? `${recs.length} AI Ready` : String(camps.length), color: "#00C9C8", tip: isProjected ? "AI campaign plans ready to launch — run analysis and click Launch on any campaign card to make these live." : "Total number of campaigns you have deployed through InfoGenie across all ad platforms." },
    { label: "💰 Total Budget/mo", val: displayBudget > 0 ? <>{"$" + displayBudget.toLocaleString()}{proj}</> : "—", color: "#0066FF", tip: isProjected ? "Projected total monthly budget if all AI-recommended campaigns are launched." : "Combined monthly advertising budget across all active campaigns." },
    { label: "📈 Avg. ROAS", val: displayROAS ? <>{displayROAS + "×"}{proj}</> : "—", color: "#10B981", tip: isProjected ? "Projected average ROAS from your AI campaign recommendations based on competitor benchmarks." : "Average Return on Ad Spend across all campaigns — the blended revenue earned per $1 of total ad budget." },
    { label: "🎯 Total Conversions", val: displayConv > 0 ? <>{displayConv.toLocaleString()}{proj}</> : "—", color: "#F59E0B", tip: isProjected ? "Projected monthly conversions if recommended campaigns are launched at the suggested budgets." : "Total completed goals (sign-ups, purchases, calls) driven by all InfoGenie campaigns combined." },
    { label: "👁 Impressions", val: displayImpr > 0 ? <>{displayImpr >= 1e6 ? (displayImpr / 1e6).toFixed(1) + "M" : (displayImpr / 1e3).toFixed(0) + "K"}{proj}</> : "—", color: "#0f766e", tip: isProjected ? "Estimated monthly impressions based on recommended budgets and industry CPM benchmarks." : "Total number of times your ads have been shown across all platforms and campaigns." },
    { label: "⚡ AI Actions", val: String(allActions.length), color: "#00E5FF", tip: "Total automated and AI-assisted actions InfoGenie has taken: analyses run, campaigns built, audiences detected, and optimisations applied." },
  ];

  // Lead tiles (use SAVED leadData, like legacy)
  const ldMsgs = leadData.messages || 0;
  const ldCalls = leadData.calls || 0;
  const ldTotal = ldMsgs + ldCalls;
  const ldBudget = leadData.budget || displayBudget;
  const cpl = ldBudget > 0 && ldTotal > 0 ? "$" + (ldBudget / ldTotal).toFixed(2) : "—";
  const cpm = ldBudget > 0 && ldMsgs > 0 ? "$" + (ldBudget / ldMsgs).toFixed(2) : "—";
  const cpc2 = ldBudget > 0 && ldCalls > 0 ? "$" + (ldBudget / ldCalls).toFixed(2) : "—";
  const convRate = ldTotal > 0 && totalConv > 0 ? ((totalConv / ldTotal) * 100).toFixed(1) + "%" : "—";
  const leadTiles: [string, number | string, string, string][] = [
    ["💬 Messages", ldMsgs, "#0066FF", "Total message enquiries received — WhatsApp, email, contact forms or DMs logged here."],
    ["📞 Calls", ldCalls, "#10B981", "Total inbound phone calls received from prospects. Log all calls to accurately calculate your cost-per-call."],
    ["🧲 Total Leads", ldTotal, "#0f766e", "Combined total of all inbound leads: messages + calls. This is your overall lead volume."],
    ["💰 Cost-per-Lead", cpl, "#F59E0B", "Total monthly ad budget divided by total leads. The lower this number, the more efficient your ad spend."],
    ["💬 Cost/Message", cpm, "#0066FF", "Monthly budget divided by total messages received — cost to generate one message enquiry."],
    ["📞 Cost/Call", cpc2, "#10B981", "Monthly budget divided by total calls received — cost to generate one inbound phone call."],
    ["📈 Lead→Conv Rate", convRate, "#00C9C8", "Percentage of leads that converted into paying customers. Higher is better — target 15–30% for most industries."],
  ];

  // Live CPL preview (from input fields)
  const liveMsgs = parseInt(msgsInput || "0") || 0;
  const liveCalls = parseInt(callsInput || "0") || 0;
  const liveTotal = liveMsgs + liveCalls;
  const liveAutoBudget = camps.reduce((s, c) => s + c.budget, 0);
  const liveBudget = (parseInt(budgetInput || "0") || 0) || liveAutoBudget;
  const liveCpl = liveTotal > 0 && liveBudget > 0 ? "$" + (liveBudget / liveTotal).toFixed(2) : "—";
  const liveLabel = `Cost per lead (${liveMsgs} msg + ${liveCalls} calls = ${liveTotal} leads)`;

  // ROAS breakdown derived
  const adComps = analysisData?.competitors || [];
  const benchTop = getIndustryROASBenchmark(analysisData);
  const myROAS = analysisData?.websiteKPIs?.roas ? parseFloat(String(analysisData.websiteKPIs.roas)) : benchTop.avg;
  const projROAS = Math.min(+(myROAS * 1.25).toFixed(1), benchTop.top);

  return (
    <div id="view-results">
      {header}
      <div className="container">
        {/* SUMMARY STATS */}
        <div
          data-results-section="stats"
          style={{
            display: rShow("stats") ? "grid" : "none",
            gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
            gap: 14,
            marginBottom: 28,
            paddingTop: 24,
          }}
        >
          {statTiles.map((t) => (
            <div
              key={t.label}
              title={t.tip}
              style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}
            >
              <div style={{ fontSize: "1.4rem", fontWeight: 800, color: t.color, fontFamily: "Sora,sans-serif" }}>{t.val}</div>
              <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 4, fontWeight: 500 }}>{t.label}</div>
            </div>
          ))}
        </div>

        {/* LEAD REPORTING PANEL */}
        <div
          data-results-section="leads"
          style={{ display: rShow("leads") ? "block" : "none", background: "white", border: "1px solid #E2E8F0", borderRadius: 18, padding: "22px 24px", marginBottom: 28, boxShadow: "0 1px 6px rgba(0,0,0,.06)" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
            <div>
              <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "#0A1628" }}>📋 Lead Reporting Dashboard</div>
              <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 3 }}>Log your messages, calls and InfoGenie calculates your cost-per-lead automatically</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={loadLeadFromAnalysis} style={{ padding: "9px 16px", background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "#15803D", cursor: "pointer" }}>📥 Load Saved Data</button>
              <button onClick={saveLeadData} style={{ padding: "9px 20px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}>💾 Save Lead Data</button>
            </div>
          </div>

          {/* KPI Tiles Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
            {leadTiles.map(([label, val, color, tip]) => (
              <div key={label} title={tip} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 12, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: "1.3rem", fontWeight: 800, color, fontFamily: "Sora,sans-serif" }}>{val}</div>
                <div style={{ fontSize: "0.65rem", color: "#6B7280", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Input Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, padding: 16, background: "#F9FAFB", borderRadius: 12 }}>
            <div>
              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 }}>💬 Messages Received</label>
              <input type="number" min={0} placeholder="e.g. 34" value={msgsInput} onChange={(e) => setMsgsInput(e.target.value)} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontSize: "0.88rem", color: "#0A1628", fontWeight: 600, boxSizing: "border-box" }} />
              <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 4 }}>Total inbound messages from all ad campaigns</div>
            </div>
            <div>
              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 }}>📞 Calls Received</label>
              <input type="number" min={0} placeholder="e.g. 18" value={callsInput} onChange={(e) => setCallsInput(e.target.value)} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontSize: "0.88rem", color: "#0A1628", fontWeight: 600, boxSizing: "border-box" }} />
              <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 4 }}>Total inbound calls from all ad campaigns</div>
            </div>
            <div>
              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 }}>💰 Monthly Ad Spend</label>
              <input type="number" min={0} placeholder="e.g. 3000" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E5E7EB", borderRadius: 8, fontSize: "0.88rem", color: "#0A1628", fontWeight: 600, boxSizing: "border-box" }} />
              <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 4 }}>Leave blank to use total campaign budgets above</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", marginBottom: 2 }}>⚡ Live CPL Preview</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0066FF", fontFamily: "Sora,sans-serif" }}>{liveCpl}</div>
              <div style={{ fontSize: "0.68rem", color: "#6B7280" }}>{liveLabel}</div>
            </div>
          </div>
        </div>

        {/* PERFORMANCE PANELS (campaigns-driven) */}
        {camps.length > 0 && (
          <div data-results-section="charts" style={{ display: rShow("charts") ? "block" : "none" }}>
            <div className="two-charts" style={{ marginTop: 0 }}>
              <div className="chart-box">
                <div className="chart-box-header">
                  <h3>📈 ROAS Trend by Campaign <span className="chart-tag" style={{ background: "#10B98120", color: "#10B981" }}>Live</span></h3>
                </div>
                <canvas ref={roasRef} height={200} />
              </div>
              <div className="chart-box">
                <div className="chart-box-header">
                  <h3>📊 Platform Performance <span className="chart-tag" style={{ background: "#0066FF20", color: "#0066FF" }}>CTR · CPA · ROAS</span></h3>
                </div>
                <canvas ref={platformRef} height={200} />
              </div>
            </div>
            <div className="two-charts">
              <div className="chart-box">
                <div className="chart-box-header"><h3>🎯 Conversion Funnel</h3></div>
                <div style={{ padding: "14px 0" }}>
                  {funnelData.map(([label, val, color, pct]) => (
                    <div key={label} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#374151", marginBottom: 5 }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ fontWeight: 700, color }}>
                          {Number(val).toLocaleString()} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>({pct}%)</span>
                        </span>
                      </div>
                      <div style={{ background: "#F3F4F6", borderRadius: 6, height: 10, overflow: "hidden" }}>
                        <div style={{ width: Math.max(pct, 4) + "%", background: color, height: "100%", borderRadius: 6 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="chart-box">
                <div className="chart-box-header"><h3>💰 Budget Pacing</h3></div>
                <div style={{ padding: "14px 0" }}>
                  {camps.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 24, color: "#9CA3AF", fontSize: "0.82rem" }}>No campaigns launched yet</div>
                  ) : (
                    camps.slice(0, 4).map((c, i) => {
                      const paced = c.metrics.spend || Math.round(c.budget * 0.15);
                      const pct = Math.min(Math.round((paced / c.budget) * 100 * 12), 100);
                      const pcolor = pct < 50 ? "#10B981" : pct < 80 ? "#F59E0B" : "#EF4444";
                      return (
                        <div key={i} style={{ marginBottom: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, color: "#0A1628" }}>{(c.name || "").substring(0, 26)}</span>
                            <span style={{ color: "#6B7280", fontSize: "0.72rem" }}>{c.platform}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, background: "#F3F4F6", borderRadius: 6, height: 8, overflow: "hidden" }}>
                              <div style={{ width: pct + "%", background: pcolor, height: "100%", borderRadius: 6 }} />
                            </div>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: pcolor }}>{pct}%</span>
                          </div>
                          <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 3 }}>${paced.toLocaleString()} spent of {c.budgetStr}/mo</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* COMPETITOR ROAS BREAKDOWN */}
        {analysisData && adComps.length > 0 && (
          <div data-results-section="roas-breakdown" style={{ display: rShow("roas-breakdown") ? "block" : "none" }}>
            <div style={{ background: "var(--ig-grad2)", borderRadius: 18, padding: "22px 24px", marginBottom: 24, border: "1px solid rgba(239,68,68,.2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1rem", fontWeight: 800, color: "white" }}>📉 Competitor ROAS Intelligence — Why They&apos;re Underperforming</div>
                  <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,.5)", marginTop: 3 }}>
                    Clear breakdown of each competitor&apos;s ROAS failures and the exact gaps you can exploit
                  </div>
                </div>
                <div style={{ background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.3)", borderRadius: 10, padding: "8px 14px", textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#10B981" }}>{projROAS}×</div>
                  <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.5)", marginTop: 1 }}>Your ROAS Target</div>
                </div>
                <div style={{ background: "rgba(0,229,255,.08)", border: "1px solid rgba(0,229,255,.15)", borderRadius: 10, padding: "8px 14px", textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#00E5FF" }}>{benchTop.avg}×</div>
                  <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.5)", marginTop: 1 }}>{benchTop.label} Avg ROAS</div>
                </div>
                <div style={{ background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.2)", borderRadius: 10, padding: "8px 14px", textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#10B981" }}>{benchTop.top}×</div>
                  <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.5)", marginTop: 1 }}>Top 10% {benchTop.label}</div>
                </div>
              </div>
              <div className="ig-roas-callout" style={{ borderRadius: 10, padding: "12px 16px", marginBottom: 18, fontSize: "0.8rem", lineHeight: 1.55 }}>
                <strong className="ig-roas-q">Why are competitors underperforming vs. the {benchTop.label} ROAS benchmark ({benchTop.avg}×)?</strong> <span>The analysis below identifies structural, creative, and targeting failures specific to this industry. Industry average ROAS:</span> <strong className="ig-roas-avg">{benchTop.avg}×</strong><span>. Top performers:</span> <strong className="ig-roas-top">{benchTop.top}×</strong><span>. These are real exploitable gaps — each one represents budget you can capture from their wasted spend.</span>
              </div>
              <div style={{ color: "#0A1628" }}>
                {adComps.slice(0, 6).map((comp, idx) => {
                  const { roasEst, primary, fixes } = compROASIssues(comp, analysisData);
                  const roasNum = parseFloat(roasEst);
                  const severity = roasNum < benchTop.min ? "critical" : roasNum < benchTop.avg ? "weak" : "moderate";
                  const sevColor = severity === "critical" ? "#DC2626" : severity === "weak" ? "#F59E0B" : "#D97706";
                  const sevLabel = severity === "critical" ? "Critical" : severity === "weak" ? "Below Industry Avg" : "Moderate";
                  const barPct = Math.min(Math.round((parseFloat(roasEst) / projROAS) * 100), 100);
                  return (
                    <div key={idx} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 14, padding: "16px 20px", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,.05)" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: `${sevColor}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", flexShrink: 0 }}>📉</div>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0A1628" }}>{comp.name}</div>
                            <div style={{ fontSize: "0.7rem", color: "#6B7280", marginTop: 2 }}>{comp.domain || comp.url || "Competitor #" + (idx + 1)}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: sevColor, fontFamily: "Sora,sans-serif" }}>{roasEst}×</div>
                          <div style={{ fontSize: "0.62rem", fontWeight: 700, color: sevColor, textTransform: "uppercase", letterSpacing: ".06em" }}>{sevLabel} ROAS</div>
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#6B7280", marginBottom: 4 }}>
                          <span>Their ROAS vs your target ({projROAS}×)</span>
                          <span style={{ fontWeight: 700, color: sevColor }}>{barPct}%</span>
                        </div>
                        <div style={{ background: "#F3F4F6", borderRadius: 6, height: 8, overflow: "hidden" }}>
                          <div style={{ width: barPct + "%", background: sevColor, height: "100%", borderRadius: 6, transition: "width .6s ease" }} />
                        </div>
                      </div>
                      <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 9, padding: "10px 12px", marginBottom: 10 }}>
                        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#991B1B", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>⚠ Primary Failure Reason</div>
                        <div style={{ fontSize: "0.8rem", color: "#7F1D1D", lineHeight: 1.45 }}>{primary}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#065F46", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>✅ How InfoGenie Exploits This Gap</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {fixes.map((f, fi) => (
                            <span key={fi} style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 20, padding: "3px 10px", fontSize: "0.71rem", color: "#065F46", fontWeight: 600 }}>{f}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* IMPROVEMENT ANALYSIS */}
        {analysisData && (
          <div data-results-section="improvement" style={{ display: rShow("improvement") ? "block" : "none" }}>
            <div className="data-table-card" style={{ marginBottom: 24, background: "linear-gradient(135deg,#F0FDF4,#DCFCE7)", border: "1.5px solid #86EFAC" }}>
              <div className="dtc-header">
                <h3 style={{ color: "#065F46" }}>📈 InfoGenie Improvement Analysis</h3>
                <span className="atag atag-solid atag-solid--green">Live Tracking</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
                {[
                  { title: "Competitor Gap Identified", before: "Unknown", after: adComps.length + " competitors analysed", icon: "🔍", color: "#059669" },
                  { title: "Keyword Opportunities", before: "No data", after: adComps[0]?.topKeywords?.slice(0, 3).join(", ") || "High-intent terms found", icon: "🔑", color: "#0369A1" },
                  { title: "Campaign Strategy", before: "Manual / Guesswork", after: recs.length + " AI-ranked campaigns ready", icon: "🎯", color: "#0f766e" },
                  { title: "Audience Targeting", before: "Broad / Generic", after: "Auto-segmented from " + adComps.length + " competitors", icon: "👥", color: "#D97706" },
                  { title: "Projected ROAS", before: (analysisData.websiteKPIs?.roas || "2.8") + "× (current)", after: (parseFloat(String(analysisData.websiteKPIs?.roas || 2.8)) * 1.3).toFixed(1) + "× (projected)", icon: "💰", color: "#10B981" },
                  { title: "Market Intelligence", before: "No competitor data", after: "Full 360° competitor view active", icon: "⚡", color: "#0066FF" },
                ].map((item) => (
                  <div key={item.title} style={{ background: "white", borderRadius: 10, padding: "14px 16px", border: "1px solid #BBF7D0" }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: item.color, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{item.icon} {item.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.78rem" }}>
                      <div style={{ color: "#DC2626", textDecoration: "line-through", opacity: 0.7 }}>{item.before}</div>
                      <div style={{ color: "#6B7280" }}>→</div>
                      <div style={{ color: "#065F46", fontWeight: 700 }}>{item.after}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* LAUNCHED CAMPAIGNS TABLE */}
        <div data-results-section="campaigns" style={{ display: rShow("campaigns") ? "block" : "none" }}>
          <div className="data-table-card" style={{ marginBottom: 24 }}>
            <div className="dtc-header">
              <h3>🚀 Active Campaigns</h3>
              <span className="atag">{camps.length} Running</span>
            </div>
            {camps.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "#6B7280" }}>
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>🎯</div>
                <div style={{ fontSize: "0.875rem" }}>No campaigns launched yet — go to <strong>Campaigns</strong> and click <strong>Launch this Campaign</strong></div>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="ig-table">
                  <thead>
                    <tr><th>Campaign</th><th>Platform</th><th>Budget</th><th>ROAS</th><th>CTR</th><th>Conversions</th><th>CPA</th><th>Status</th><th>Launched</th><th></th></tr>
                  </thead>
                  <tbody>
                    {camps.map((c, ci) => {
                      const m = c.metrics || {};
                      const aud = c.audience || "";
                      const budg = c.budgetStr || "$" + (c.budget || 0).toLocaleString();
                      const roas = m.roas || c.estROAS || "—";
                      const ctr = m.ctr || c.estCTR || "—";
                      const conv = (m.conversions || 0).toLocaleString();
                      const cpa = m.cpa || c.estCPA || "—";
                      const stat = c.status || "active";
                      return (
                        <tr key={ci}>
                          <td><strong>{c.name || "Campaign"}</strong><br /><span style={{ fontSize: "0.72rem", color: "#6B7280" }}>{aud.substring(0, 40)}{aud.length > 40 ? "…" : ""}</span></td>
                          <td>{c.platform || "—"}</td>
                          <td>{budg}/mo</td>
                          <td><strong style={{ color: "#10B981" }}>{roas}×</strong></td>
                          <td>{ctr}</td>
                          <td>{conv}</td>
                          <td>{cpa}</td>
                          <td><span style={{ background: statusColor[stat] || "#10B981", color: "white", fontSize: "0.65rem", fontWeight: 700, padding: "3px 8px", borderRadius: 10, textTransform: "uppercase" }}>{stat}</span></td>
                          <td style={{ fontSize: "0.75rem", color: "#6B7280" }}>{c.launchedAt || "—"}</td>
                          <td><button onClick={() => goToView(router, "campaigns")} className="btn-primary" style={{ padding: "5px 12px", fontSize: "0.7rem", whiteSpace: "nowrap" }}>👁 View</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* A/B TESTS RESULTS */}
        {abTests.length > 0 && (
          <div data-results-section="abtests" style={{ display: rShow("abtests") ? "block" : "none" }}>
            <div className="data-table-card" style={{ marginBottom: 24 }}>
              <div className="dtc-header">
                <h3>🧪 A/B Test Results</h3>
                <span className="atag atag-solid atag-solid--purple">{abTests.length} Tests</span>
              </div>
              <div className="table-scroll">
                <table className="ig-table">
                  <thead>
                    <tr><th>Test Name</th><th>Variant A</th><th>ROAS A</th><th>CTR A</th><th>Variant B</th><th>ROAS B</th><th>CTR B</th><th>Split</th><th>Duration</th><th>Winner</th><th>Started</th></tr>
                  </thead>
                  <tbody>
                    {abTests.map((t, ti) => (
                      <tr key={ti}>
                        <td><strong>{t.name}</strong></td>
                        <td style={{ fontSize: "0.78rem" }}>{t.varA.platform}</td>
                        <td><strong style={{ color: t.winner === "A" ? "#059669" : "#DC2626" }}>{t.varA.roas}×</strong></td>
                        <td>{t.varA.ctr}</td>
                        <td style={{ fontSize: "0.78rem" }}>{t.varB.platform}</td>
                        <td><strong style={{ color: t.winner === "B" ? "#059669" : "#DC2626" }}>{t.varB.roas}×</strong></td>
                        <td>{t.varB.ctr}</td>
                        <td>{t.split}/{100 - t.split}</td>
                        <td>{t.days} days</td>
                        <td><span style={{ background: t.winner === "A" ? "#059669" : "#0066FF", color: "white", fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>Variant {t.winner} 🏆</span></td>
                        <td style={{ fontSize: "0.72rem", color: "#6B7280" }}>{t.startedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ACTION HISTORY TIMELINE */}
        <div data-results-section="actions" style={{ display: rShow("actions") ? "block" : "none" }}>
          <div className="data-table-card" style={{ marginBottom: 48 }}>
            <div className="dtc-header">
              <h3>⚡ InfoGenie Action History</h3>
              <span className="atag">{allActions.length} Actions</span>
            </div>
            <div className="dtc-flush" style={{ display: "flex", flexDirection: "column", gap: 0, padding: "0 24px" }}>
              {allActions.map((a, i) => {
                const iconMap: Record<string, string> = { campaign_launch: "🚀", config: "⚙️", audience: "👥", analysis: "🔍", campaigns: "🎯", intelligence: "⚡", budget: "💰" };
                const colorMap: Record<string, string> = { campaign_launch: "#0066FF", config: "#6B7280", audience: "#0f766e", analysis: "#00C9C8", campaigns: "#10B981", intelligence: "#F59E0B", budget: "#D97706" };
                const icon = (a.type && iconMap[a.type]) || "•";
                const color = (a.type && colorMap[a.type]) || "#6B7280";
                return (
                  <div key={i} style={{ display: "flex", gap: 14, padding: "12px 0", borderBottom: i < allActions.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem" }}>{icon}</div>
                      {i < allActions.length - 1 && <div style={{ width: 1, flex: 1, background: "#E5E7EB", marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1, paddingTop: 4 }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#0A1628", marginBottom: 2 }}>{a.action}</div>
                      {a.impact && <div style={{ fontSize: "0.75rem", color: "#059669", fontWeight: 500 }}>✓ {a.impact}</div>}
                      {(a.time || a.date) && <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 3 }}>{a.date || ""} {a.time || ""}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* CUSTOMISE PANEL */}
      {showCust && (
        <div style={{ position: "fixed", top: 96, right: 20, zIndex: 4000, background: "#0D1F3C", border: "1px solid rgba(0,201,200,.2)", borderRadius: 16, padding: "18px 20px", width: 280, boxShadow: "0 12px 48px rgba(0,0,0,.5)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "white" }}>⚙ Customise View</div>
            <button onClick={() => setShowCust(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.5)", fontSize: "1rem", cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.4)", marginBottom: 12 }}>Toggle sections on/off</div>
          <div>
            {RESULTS_SECTIONS.map((s) => {
              const on = draftPrefs[s.key] !== false;
              return (
                <label key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.06)", cursor: "pointer", gap: 8 }}>
                  <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,.8)" }}>{s.label}</span>
                  <div
                    onClick={() => setDraftPrefs((prev) => ({ ...prev, [s.key]: !on }))}
                    style={{ flexShrink: 0, width: 36, height: 20, borderRadius: 10, background: on ? "#00C9C8" : "rgba(255,255,255,.15)", position: "relative", cursor: "pointer", transition: "background .2s" }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: on ? 18 : 2, transition: "left .2s" }} />
                  </div>
                </label>
              );
            })}
          </div>
          <button onClick={rcApply} style={{ marginTop: 14, width: "100%", padding: 9, background: "linear-gradient(135deg,#00C9C8,#0066FF)", border: "none", borderRadius: 9, fontSize: "0.8rem", fontWeight: 700, color: "white", cursor: "pointer" }}>Apply Changes</button>
        </div>
      )}
    </div>
  );
}
