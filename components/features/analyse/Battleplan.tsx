"use client";

// Native React port of the legacy `battleplan` panel (was `window.buildBattlePlan`
// + `window.switchBattlePlanComp` + `#view-battleplan` in public/js/ig_compete.js /
// index.html). Renders the per-competitor Battle Plan — hero, competitor tabs,
// selected-competitor summary, priority banner and the six action sections
// (weaknesses, keyword attack, creative, audiences, campaign counter-moves, quick
// wins) plus the Full Attack Plan launcher — directly from the legacy
// `window.analysisData` global (set by the home-page competitor analysis).
// Action buttons invoke the existing legacy globals (bpLC/bpCS/bpGA/bpBC/bpTA/bpCC/
// bpQW/openFullAttackPlanModal) which prefill the Creative Studio / Campaign
// launcher; cross-tool links go through `lib/nav#goToView`. See
// `docs/react-panel-migration.md`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";
import { apiPost } from "@/lib/api";
import PanelHero from "@/components/layout/PanelHero";

interface Campaign {
  name?: string;
  channel?: string;
  ctr?: string;
  roas?: number;
  status?: string;
  budget?: string;
}
interface Audience {
  label?: string;
  pct?: number;
}
interface AdCopy {
  headline?: string;
  body?: string;
}
interface Competitor {
  name?: string;
  url?: string;
  logo?: string;
  threatLevel?: string;
  trafficMo?: number;
  traffic?: string;
  ctr?: string;
  roas?: string | number;
  adSpend?: string;
  topChannel?: string;
  topKeywords?: string[];
  suggestions?: string[];
  campaigns?: Campaign[];
  audiences?: Audience[];
  adCopy?: AdCopy[];
  estimatedROI?: string;
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: Competitor[];
}

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || null;
}

// Deterministic seed hash — ported verbatim from the legacy `_blSeed` so the
// opportunity score and per-keyword CPC match the original presentation exactly.
function blSeed(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function callWin(name: string, ...args: number[]): void {
  if (typeof window === "undefined") return;
  const fn = (window as unknown as Record<string, ((...a: number[]) => void) | undefined>)[name];
  if (typeof fn === "function") {
    try {
      fn(...args);
      return;
    } catch {
      /* legacy handler error */
    }
  }
  const w = window as unknown as { showToast?: (m: string) => void };
  w.showToast?.(`⚠️ Action not ready — refresh the page and try again (${name})`);
}

function fmtT(n: number): string {
  return n >= 1e9
    ? (n / 1e9).toFixed(1) + "B"
    : n >= 1e6
      ? (n / 1e6).toFixed(1) + "M"
      : n >= 1e3
        ? (n / 1e3).toFixed(0) + "K"
        : String(n || 0);
}

const KW_VOLUMES = [14800, 8200, 22000, 6600, 18400, 4400, 9800, 12000];
const KW_DIFFICULTIES = ["Low", "Medium", "Medium", "High"];
const KW_COLORS = ["#0066FF", "#0f766e", "#059669", "#D97706"];
const ANGLES = ["Pain-Point Contrast", "Benefit Superiority", "Social Proof Attack", "Value Proposition"];
const AUD_CHANNELS = ["Meta Ads", "Google Ads", "LinkedIn Ads", "TikTok Ads"];
const AUD_GAPS = [
  "Underserved by competitor — low ad frequency in this segment",
  "Poor creative resonance — competitor uses generic messaging here",
  "Budget mismatch — competitor over-spends on lower-intent tiers",
];

interface Btn {
  label: string;
  onClick: () => void;
  style: CSSProperties;
}
interface CardData {
  border: string;
  badgeStyle: CSSProperties;
  badge: string;
  title: string;
  body: string;
  buttons: Btn[];
}

const btnBase: CSSProperties = {
  padding: "6px 14px",
  border: "none",
  borderRadius: 8,
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
};
const primaryStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff" };
const dangerStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#EF4444,#DC2626)", color: "#fff" };
const purpleStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#0f766e,#4F46E5)", color: "#fff" };
const greenStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff" };
const ghostStyle: CSSProperties = { ...btnBase, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151" };
const tealStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#00C9C8,#00E5FF)", color: "#0A1628" };

function Card({ data }: { data: CardData }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E5E7EB",
        borderLeft: `4px solid ${data.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: "0.62rem", fontWeight: 800, padding: "3px 8px", borderRadius: 5, flexShrink: 0, ...data.badgeStyle }}>
          {data.badge}
        </span>
        <div
          style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0A1628", lineHeight: 1.4 }}
          dangerouslySetInnerHTML={{ __html: data.title }}
        />
      </div>
      <div
        style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.55, marginBottom: 10 }}
        dangerouslySetInnerHTML={{ __html: data.body }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {data.buttons.map((b, i) => (
          <button key={i} onClick={b.onClick} style={b.style}>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="ig-section-card" style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{icon}</span>
        <div>
          <div className="ig-section-title" style={{ fontFamily: "Sora,sans-serif", fontSize: "0.9rem", fontWeight: 800, color: "#0F172A" }} dangerouslySetInnerHTML={{ __html: title }} />
          <div className="ig-section-sub" style={{ fontSize: "0.7rem", color: "#64748B", marginTop: 2 }} dangerouslySetInnerHTML={{ __html: sub }} />
        </div>
      </div>
      {children}
    </div>
  );
}

type AttackPlan = {
  executiveSummary?: string;
  opportunityScore?: number;
  estimatedROILift?: string;
  timeToResults?: string;
  weeklyPlan?: { week?: string; focus?: string; actions?: string[]; kpi?: string }[];
  keywordTargets?: { keyword?: string; volume?: string; cpc?: string; priority?: string }[];
  criticalWins?: { win?: string; impact?: string; timeframe?: string }[];
  channelStrategy?: { channel?: string; budgetPct?: number; tactic?: string; expectedROAS?: string }[];
};

const DEMO_COMPS: Competitor[] = [
  { name: "Competitor A", url: "competitor-a.com", threatLevel: "high", traffic: "1.2M", ctr: "2.4%", roas: 3.1, adSpend: "$48k", topChannel: "Google Ads", topKeywords: ["brand alternative", "best platform", "pricing comparison"], suggestions: ["Weak comparison content", "Thin FAQ / schema coverage", "Over-indexed on branded search"] },
  { name: "Competitor B", url: "competitor-b.com", threatLevel: "medium", traffic: "640K", ctr: "1.8%", roas: 2.4, adSpend: "$22k", topChannel: "Meta Ads", topKeywords: ["vs competitor", "free trial", "reviews"], suggestions: ["Generic creative", "No TikTok/Reels", "Slow content cadence"] },
];

function AttackPlanModal({
  open,
  loading,
  error,
  competitor,
  plan,
  sources,
  warning,
  onClose,
  onExecute,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  competitor: string;
  plan: AttackPlan | null;
  sources?: string[];
  warning?: string;
  onClose: () => void;
  onExecute: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "weekly" | "keywords" | "wins">("overview");
  useEffect(() => {
    if (open) setTab("overview");
  }, [open, plan]);
  if (!open) return null;

  return (
    <div
      id="attackPlanModalReact"
      className="ig-attack-plan-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10050, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)", padding: 20 }}
    >
      <div style={{ background: "#fff", borderRadius: 16, maxWidth: 720, width: "100%", maxHeight: "90vh", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.35)", color: "#0F172A" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: 12 }}>⏳</div>
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>Building attack plan…</div>
            <div style={{ fontSize: "0.85rem", color: "#64748B", marginTop: 8 }}>Usually 15–30 seconds</div>
          </div>
        ) : error && !plan ? (
          <div style={{ padding: 32 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Could not generate plan</div>
            <p style={{ color: "#B91C1C", fontSize: "0.9rem" }}>{error}</p>
            <button type="button" onClick={onClose} style={{ marginTop: 16, padding: "10px 16px", borderRadius: 8, border: "none", background: "#F1F5F9", fontWeight: 700, cursor: "pointer" }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ background: "linear-gradient(135deg,#0066FF,#00C9C8)", padding: "20px 24px", color: "#fff", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#fff" }}>⚔️ Full Attack Plan vs {competitor}</div>
                <div style={{ fontSize: "0.78rem", opacity: 0.9, marginTop: 4, color: "#fff" }}>
                  8-week strategy · keywords · channels · quick wins
                  {sources?.length ? ` · ${sources.join(" + ")}` : ""}
                </div>
                {warning ? <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9 }}>{warning}</div> : null}
              </div>
              <button type="button" onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", width: 32, height: 32, borderRadius: 8, color: "#fff", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderBottom: "1px solid #E2E8F0" }}>
              {(["overview", "weekly", "keywords", "wins"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: tab === t ? "1px solid #BFDBFE" : "1px solid transparent",
                    background: tab === t ? "#EFF6FF" : "transparent",
                    color: tab === t ? "#1D4ED8" : "#475569",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {t === "overview" ? "Overview" : t === "weekly" ? "8-Week Plan" : t === "keywords" ? "Keywords" : "Quick Wins"}
                </button>
              ))}
            </div>
            <div className="ig-ap-body" style={{ maxHeight: "55vh", overflow: "auto", padding: "20px 24px", color: "#0F172A" }}>
              {tab === "overview" && (
                <>
                  <p style={{ fontSize: "0.95rem", lineHeight: 1.6, margin: "0 0 16px" }}>{plan?.executiveSummary || "Strategic attack plan ready."}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                    <div style={{ background: "#F0FDF4", borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#059669" }}>{plan?.opportunityScore ?? "—"}</div>
                      <div style={{ fontSize: "0.7rem", color: "#64748B" }}>Opportunity</div>
                    </div>
                    <div style={{ background: "#EFF6FF", borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0066FF" }}>{plan?.estimatedROILift || "—"}</div>
                      <div style={{ fontSize: "0.7rem", color: "#64748B" }}>ROI lift</div>
                    </div>
                    <div style={{ background: "#FEF3C7", borderRadius: 10, padding: 14, textAlign: "center" }}>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#D97706" }}>{plan?.timeToResults || "—"}</div>
                      <div style={{ fontSize: "0.7rem", color: "#64748B" }}>Time to results</div>
                    </div>
                  </div>
                  {(plan?.channelStrategy || []).length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>Channel mix</div>
                      {(plan?.channelStrategy || []).map((ch, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #F1F5F9", fontSize: "0.82rem" }}>
                          <span><strong>{ch.channel}</strong> · {ch.tactic}</span>
                          <span style={{ color: "#64748B", whiteSpace: "nowrap" }}>{ch.budgetPct}% · {ch.expectedROAS}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {tab === "weekly" && (
                <div>
                  {(plan?.weeklyPlan || []).map((w, i) => (
                    <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                      <div style={{ fontWeight: 800, marginBottom: 4 }}>{w.week} — {w.focus}</div>
                      <ul style={{ margin: "8px 0 0 18px", color: "#475569", fontSize: "0.85rem" }}>
                        {(w.actions || []).map((a, j) => <li key={j}>{a}</li>)}
                      </ul>
                      <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 8 }}>KPI: {w.kpi}</div>
                    </div>
                  ))}
                </div>
              )}
              {tab === "keywords" && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ background: "#F8FAFC" }}>
                      <th style={{ textAlign: "left", padding: 8 }}>Keyword</th>
                      <th>Volume</th>
                      <th>CPC</th>
                      <th>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(plan?.keywordTargets || []).map((k, i) => (
                      <tr key={i}>
                        <td style={{ padding: 8, borderTop: "1px solid #E2E8F0" }}>{k.keyword}</td>
                        <td style={{ textAlign: "center", borderTop: "1px solid #E2E8F0" }}>{k.volume}</td>
                        <td style={{ textAlign: "center", borderTop: "1px solid #E2E8F0" }}>{k.cpc}</td>
                        <td style={{ textAlign: "center", borderTop: "1px solid #E2E8F0", fontWeight: 700 }}>{k.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "wins" && (
                <div>
                  {(plan?.criticalWins || []).map((w, i) => (
                    <div key={i} style={{ borderLeft: "4px solid #10B981", padding: "10px 14px", marginBottom: 10, background: "#F0FDF4", borderRadius: "0 8px 8px 0" }}>
                      <div style={{ fontWeight: 700 }}>{w.win}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 4 }}>Impact: {w.impact} · {w.timeframe}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} style={{ padding: "10px 18px", background: "#F1F5F9", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Close</button>
              <button type="button" onClick={onExecute} style={{ padding: "10px 18px", background: "linear-gradient(135deg,#EF4444,#DC2626)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer" }}>⚡ Execute Top Priority</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Battleplan() {
  const router = useRouter();
  const [ad, setAd] = useState<AnalysisData | null>(null);
  const [idxState, setIdxState] = useState(0);
  const [useDemo, setUseDemo] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [attackPlan, setAttackPlan] = useState<AttackPlan | null>(null);
  const [planSources, setPlanSources] = useState<string[]>([]);
  const [planWarning, setPlanWarning] = useState("");
  const [planCompName, setPlanCompName] = useState("");

  useEffect(() => {
    const sync = () => setAd(getAnalysisData());
    sync();
    if (typeof window === "undefined") return;
    window.addEventListener("ig:analysis-ready", sync as EventListener);
    window.addEventListener("storage", sync);
    const t = window.setInterval(sync, 2500);
    return () => {
      window.removeEventListener("ig:analysis-ready", sync as EventListener);
      window.removeEventListener("storage", sync);
      window.clearInterval(t);
    };
  }, []);

  const liveComps = useMemo(() => (ad && Array.isArray(ad.competitors) ? ad.competitors : []), [ad]);
  const comps = liveComps.length > 0 ? liveComps : useDemo ? DEMO_COMPS : [];
  const hasData = comps.length > 0;
  const idx = Math.min(idxState, Math.max(0, comps.length - 1));
  const c = hasData ? comps[idx] : null;
  const cName = c?.name || "Competitor";

  // Mirror the legacy `_bpCache` so the global action wrappers (bpLC/bpCS/…)
  // resolve the same competitor payload they would in the legacy panel.
  useEffect(() => {
    if (typeof window === "undefined" || !c) return;
    const w = window as unknown as { _bpCache?: Record<number, unknown>; _bpIdx?: number };
    w._bpCache = w._bpCache || {};
    w._bpCache[idx] = {
      name: c.name || "Competitor",
      channel: c.topChannel || null,
      keywords: (c.topKeywords || ["competitor brand alternative", "industry best tool", "vs competitor", "top rated solution"]).slice(0, 8),
      campaigns: (c.campaigns || []).slice(0, 4),
      audiences: (c.audiences || [
        { label: "High-Intent Buyers", pct: 38 },
        { label: "Decision Makers", pct: 24 },
        { label: "Mid-Market Segment", pct: 22 },
      ]).slice(0, 3),
      suggestions: (c.suggestions || []).slice(0, 4),
      adCopy: c.adCopy || null,
    };
    w._bpIdx = idx;
  }, [c, idx]);

  function switchComp(i: number) {
    setIdxState(i);
    if (typeof window !== "undefined") {
      (window as unknown as { _bpIdx?: number })._bpIdx = i;
      window.scrollTo(0, 0);
    }
  }

  const generateAttackPlan = useCallback(async (compIdx: number) => {
    const list = (ad && Array.isArray(ad.competitors) && ad.competitors.length) ? ad.competitors : (useDemo ? DEMO_COMPS : comps);
    const comp = list[compIdx] || list[0] || DEMO_COMPS[0];
    if (!comp) {
      setModalOpen(true);
      setModalError("Add competitors via analysis first, or preview with demo data.");
      return;
    }
    if (!list.length) setUseDemo(true);
    setPlanCompName(comp.name || "Competitor");
    setModalOpen(true);
    setModalLoading(true);
    setModalError("");
    setAttackPlan(null);
    setPlanWarning("");
    const myDomain = ad?.url || "yourdomain.com";
    const industry = ad?.industry?.name || "your industry";
    // Prefer React API path — do not depend on legacy window.openFullAttackPlanModal.
    const data = await apiPost<{
      plan?: AttackPlan;
      sources?: string[];
      warning?: string;
      error?: string;
      ok?: boolean;
    }>("/api/ai-attack-plan", {
      myDomain,
      competitor: comp.name,
      industry,
      competitorData: {
        traffic: comp.traffic || comp.trafficMo,
        adSpend: comp.adSpend,
        channels: comp.topChannel ? [comp.topChannel] : [],
        weaknesses: comp.suggestions || [],
      },
      prefillKeywords: (comp.topKeywords || []).slice(0, 5),
    });
    setModalLoading(false);
    if (!data.plan) {
      // Last resort: still try legacy modal if available
      const legacy = (window as unknown as { openFullAttackPlanModal?: (i: number) => void }).openFullAttackPlanModal;
      if (typeof legacy === "function") {
        setModalOpen(false);
        legacy(compIdx);
        return;
      }
      setModalError(data.error || "Attack plan request failed");
      return;
    }
    setAttackPlan(data.plan);
    setPlanSources(Array.isArray(data.sources) ? data.sources : []);
    setPlanWarning(data.warning || "");
    // Keep legacy global in sync for action buttons that expect it
    (window as unknown as { _apPlanData?: AttackPlan; renderAttackPlan?: (p: AttackPlan, n: string) => void })._apPlanData = data.plan;
  }, [ad, useDemo, comps]);

  // Deep-link: /analyse/battleplan?generate=1 opens the Attack Plan window once.
  const autoGenerateRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || autoGenerateRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("generate") !== "1") return;
    autoGenerateRef.current = true;
    if (!liveComps.length) setUseDemo(true);
    const t = window.setTimeout(() => {
      void generateAttackPlan(0);
      params.delete("generate");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
    }, 300);
    return () => window.clearTimeout(t);
  }, [generateAttackPlan, liveComps.length]);

  if (!hasData || !c) {
    return (
      <div className="view-header-wrap ig-panel-shell" style={{ padding: "24px 20px 56px" }}>
        <div className="container" style={{ maxWidth: 720, margin: "0 auto" }}>
          <PanelHero
            group="Analyse"
            title="⚔️ Battle Plan"
            subtitle="Generate an 8-week attack plan with keywords, channels, and weekly milestones — even before a full analysis."
          />
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>⚔️</div>
            <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>No analysis loaded yet</div>
            <p style={{ color: "#64748B", maxWidth: 420, margin: "10px auto 18px", fontSize: "0.9rem", lineHeight: 1.6 }}>
              Run a competitor analysis for a personalised Battle Plan, or preview with demo rivals and generate a Full Attack Plan window now.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => goToView(router, "home")}
                style={{ padding: "12px 22px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer" }}
              >
                Run Analysis →
              </button>
              <button
                type="button"
                onClick={() => { setUseDemo(true); setIdxState(0); }}
                style={{ padding: "12px 22px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, color: "#0F172A", fontWeight: 700, cursor: "pointer" }}
              >
                Preview with demo data
              </button>
              <button
                type="button"
                onClick={() => { setUseDemo(true); void generateAttackPlan(0); }}
                style={{ padding: "12px 22px", background: "linear-gradient(135deg,#EF4444,#DC2626)", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer" }}
              >
                🚀 Generate Attack Plan
              </button>
            </div>
          </div>
        </div>
        <AttackPlanModal
          open={modalOpen}
          loading={modalLoading}
          error={modalError}
          competitor={planCompName}
          plan={attackPlan}
          sources={planSources}
          warning={planWarning}
          onClose={() => setModalOpen(false)}
          onExecute={() => { setModalOpen(false); callWin("bpLC", 0, 0); }}
        />
      </div>
    );
  }

  const domain = ad?.url || "yourdomain.com";
  const industry = ad?.industry?.name || "your industry";
  const threat = c.threatLevel || "medium";
  const traffic = c.trafficMo ? fmtT(c.trafficMo) : c.traffic || "—";
  const oppBase = threat === "high" ? 74 : threat === "medium" ? 55 : 38;
  const oppScore = oppBase + Math.floor(blSeed(c.name || "") % 18);
  const threatColor = threat === "high" ? "#EF4444" : threat === "medium" ? "#F59E0B" : "#10B981";

  // ── 1. Exploit Weaknesses ──────────────────────────────────────────────────
  const weakCards: CardData[] = (c.suggestions || [
    "Competitor has weak personalisation in search ads",
    "Generic creative with low audience specificity",
    "No TikTok or Reels presence",
    "Over-indexed on branded keywords",
  ])
    .slice(0, 4)
    .map((s, i) => ({
      border: i < 2 ? "#EF4444" : "#F59E0B",
      badgeStyle: i < 2 ? { background: "#FEE2E2", color: "#991B1B" } : { background: "#FEF3C7", color: "#92400E" },
      badge: i < 2 ? "HIGH" : "MEDIUM",
      title: s.length > 70 ? s.slice(0, 70) + "…" : s,
      body: `${cName} leaves this gap unaddressed. A targeted counter-campaign ${c.topChannel ? "on " + c.topChannel : "on their primary channel"} can capture this audience now.`,
      buttons: [
        { label: "⚡ Launch Counter-Campaign", onClick: () => callWin("bpLC", idx, i), style: dangerStyle },
        { label: "✨ Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle },
      ],
    }));

  // ── 2. Keyword Attack ──────────────────────────────────────────────────────
  const kwCards: CardData[] = (c.topKeywords || [
    "competitor brand + alternative",
    "industry best tool",
    "vs competitor keyword",
    "top rated solution",
  ])
    .slice(0, 4)
    .map((kw, i) => {
      const vol = KW_VOLUMES[i % KW_VOLUMES.length];
      const cpc = (0.9 + (blSeed(kw) % 320) / 100).toFixed(2);
      const diff = KW_DIFFICULTIES[i % KW_DIFFICULTIES.length];
      const diffColor = diff === "Low" ? "#059669" : diff === "Medium" ? "#D97706" : "#EF4444";
      return {
        border: KW_COLORS[i],
        badgeStyle: { background: "#EFF6FF", color: "#1D4ED8" },
        badge: `${vol.toLocaleString()}/mo · CPC $${cpc}`,
        title: `"${kw}"`,
        body: `${cName} is actively bidding here with suboptimal relevance scores — you can capture traffic at <strong style="color:#059669">lower CPC</strong> with tighter ad groups. Difficulty: <span style="color:${diffColor};font-weight:700">${diff}</span>.`,
        buttons: [
          { label: "🔑 Build Google Ads", onClick: () => callWin("bpGA", idx, i), style: primaryStyle },
          { label: "📝 Build Content", onClick: () => callWin("bpBC", idx, i), style: ghostStyle },
        ],
      };
    });

  // ── 3. Creative Counter-Strategy ───────────────────────────────────────────
  const adItems = c.adCopy && c.adCopy.length > 0 ? c.adCopy.slice(0, 3) : null;
  const creativeCards: CardData[] = adItems
    ? adItems.map((acItem, i) => ({
        border: "#0f766e",
        badgeStyle: { background: "#F5F3FF", color: "#6D28D9" },
        badge: ANGLES[i] || "Creative Angle",
        title: `"${acItem.headline || "Counter Creative"}"`,
        body: (acItem.body || "").slice(0, 110),
        buttons: [{ label: "✨ Open Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle }],
      }))
    : (c.suggestions || ["Exploit their weak personalisation with hyper-targeted messaging"]).slice(0, 3).map((s, i) => ({
        border: "#0f766e",
        badgeStyle: { background: "#F5F3FF", color: "#6D28D9" },
        badge: ANGLES[i] || "Creative Angle",
        title: `Beat ${cName}: ${s.slice(0, 35)}${s.length > 35 ? "…" : ""}`,
        body: `Outperform ${cName} by addressing this gap with superior creative.`,
        buttons: [{ label: "✨ Open Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle }],
      }));

  // ── 4. Audience Gaps ───────────────────────────────────────────────────────
  const audCards: CardData[] = (c.audiences && c.audiences.length
    ? c.audiences
    : [
        { label: "High-Intent Buyers", pct: 38 },
        { label: "Decision Makers", pct: 24 },
        { label: "Mid-Market Segment", pct: 22 },
      ]
  )
    .slice(0, 3)
    .map((a, i) => {
      const aCh = AUD_CHANNELS[i % AUD_CHANNELS.length];
      return {
        border: "#0066FF",
        badgeStyle: { background: "#EFF6FF", color: "#1D4ED8" },
        badge: `${a.pct}% of market`,
        title: a.label || "Audience",
        body: `${AUD_GAPS[i % AUD_GAPS.length].replace("competitor", cName)}. Best capture channel: <strong>${aCh}</strong>.`,
        buttons: [
          { label: "🎯 Target This Audience", onClick: () => callWin("bpTA", idx, i), style: primaryStyle },
          { label: "👥 Audience Deep-Dive", onClick: () => goToView(router, "audience"), style: ghostStyle },
        ],
      };
    });

  // ── 5. Campaign Counter-Moves ──────────────────────────────────────────────
  const campCards: CardData[] = (c.campaigns || []).slice(0, 3).map((camp, i) => {
    const roasTarget = ((camp.roas || 0) * 1.2).toFixed(1);
    return {
      border: "#10B981",
      badgeStyle: camp.status === "Active" ? { background: "#D1FAE5", color: "#065F46" } : { background: "#FEF3C7", color: "#92400E" },
      badge: camp.status || "",
      title: `Counter: "${(camp.name || "Campaign").slice(0, 40)}"`,
      body: `${cName} runs this on <strong>${camp.channel}</strong> at ${camp.ctr} CTR / ${camp.roas}× ROAS. Launch a counter-campaign targeting the same audience with superior creative — target ROAS: <strong style="color:#059669">${roasTarget}×</strong>.`,
      buttons: [{ label: "📣 Launch Counter-Campaign", onClick: () => callWin("bpCC", idx, i), style: greenStyle }],
    };
  });

  // ── 6. Quick Wins ──────────────────────────────────────────────────────────
  const qwItems: { t: string; button: Btn }[] = [
    {
      t: c.estimatedROI || "+25% CTR improvement via tighter audience segmentation",
      button: { label: "⚡ Execute", onClick: () => callWin("bpQW", idx, 0), style: tealStyle },
    },
    {
      t: `Capture ${cName}'s branded search traffic with non-branded alternatives at lower CPC`,
      button: { label: "🔑 View Keywords", onClick: () => goToView(router, "intelligence"), style: tealStyle },
    },
    {
      t: `Expand to channels where ${cName} has minimal presence for uncontested reach`,
      button: { label: "📣 Plan Social", onClick: () => goToView(router, "social"), style: tealStyle },
    },
  ];
  const qwCards: CardData[] = qwItems.map((w) => ({
    border: "#00C9C8",
    badgeStyle: { background: "#ECFEFF", color: "#0E7490" },
    badge: "QUICK WIN",
    title: w.t.length > 80 ? w.t.slice(0, 80) + "…" : w.t,
    body: "Low effort, high impact. Act on this before competitors do.",
    buttons: [w.button],
  }));

  const topRows = (c.suggestions || []).slice(0, 3);
  const initial = (c.logo || (c.name || "?")[0]).toString()[0];

  return (
    <div style={{ background: "var(--ig-page)", minHeight: "100vh", paddingBottom: 40 }}>
      {/* Page Header */}
      <div
        data-bp-hero
        data-ig-light-hero="1"
        className="ig-panel-hero"
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 10% 15%, rgba(15,118,110,0.16), transparent 55%), radial-gradient(ellipse 55% 50% at 92% 85%, rgba(2,132,199,0.14), transparent 50%), linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 55%, #eef4ff 100%)",
          borderRadius: 18,
          margin: "18px 24px 6px",
          padding: "22px 28px",
          border: "1px solid rgba(15, 118, 110, 0.16)",
          boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
          position: "relative",
          overflow: "hidden",
          minHeight: 130,
          display: "flex",
          alignItems: "center",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -60,
            right: -40,
            width: 260,
            height: 260,
            background: "radial-gradient(circle,rgba(15,118,110,.08),transparent 70%)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            width: "100%",
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div>
            <div
              className="breadcrumb"
              style={{ fontSize: "0.65rem", fontWeight: 800, color: "#0f766e", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6 }}
            >
              <span className="bc-group">Analyse</span>
              <span className="bc-sep"> › </span>
              Battle Plan
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: "1.4rem" }} aria-hidden>⚔️</span>
              <h1
                className="view-title"
                style={{ fontFamily: "Sora,sans-serif", fontSize: "1.5rem", fontWeight: 900, color: "#0f172a", margin: 0 }}
              >
                Battle Plan
              </h1>
              <span
                className="hero-pill"
                style={{ background: "#FFFFFF", border: "1px solid rgba(15,118,110,.22)", padding: "3px 12px", borderRadius: 20, fontSize: "0.67rem", fontWeight: 800, color: "#1E3A8A", boxShadow: "0 1px 3px rgba(15,30,61,.10)" }}
              >
                AI-GENERATED
              </span>
            </div>
            <p className="view-sub" style={{ color: "#334155", fontSize: "0.88rem", fontWeight: 500, margin: 0 }}>
              {domain} · {industry} · {comps.length} competitors · Click any action card to execute directly
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => callWin("bpLC", idx, 0)}
              style={{ padding: "10px 20px", background: "linear-gradient(135deg,#EF4444,#DC2626)", border: "none", borderRadius: 10, fontSize: "0.8rem", fontWeight: 800, color: "#fff", cursor: "pointer", boxShadow: "0 4px 12px rgba(239,68,68,.35)" }}
            >
              ⚡ Execute Top Priority
            </button>
            <button
              onClick={() => goToView(router, "campaigns")}
              style={{ padding: "10px 20px", background: "#FFFFFF", border: "1px solid rgba(255,255,255,.6)", borderRadius: 10, fontSize: "0.8rem", fontWeight: 800, color: "#1E3A8A", cursor: "pointer", boxShadow: "0 2px 6px rgba(15,30,61,.08)" }}
            >
              📋 All Campaigns
            </button>
          </div>
        </div>
      </div>

      {/* Competitor Tabs */}
      <div style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", overflowX: "auto" }}>
        <div style={{ display: "flex", padding: "0 20px", maxWidth: 1200, margin: "0 auto" }}>
          {comps.map((comp, i) => {
            const t = comp.threatLevel || "medium";
            const dotColor = t === "high" ? "#EF4444" : t === "medium" ? "#F59E0B" : "#10B981";
            const active = i === idx;
            const cInit = (comp.logo || (comp.name || "?")[0]).toString()[0];
            return (
              <button
                key={i}
                onClick={() => switchComp(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 18px",
                  border: "none",
                  borderBottom: `3px solid ${active ? "#00A8A7" : "transparent"}`,
                  background: active ? "rgba(0,201,200,.10)" : "transparent",
                  cursor: "pointer",
                  color: active ? "#0F766E" : "#334155",
                  fontSize: "0.8rem",
                  fontWeight: active ? 700 : 600,
                  whiteSpace: "nowrap",
                  fontFamily: "'Inter',sans-serif",
                  transition: "all .15s",
                }}
              >
                <span style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg,#0066FF,#00C9C8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", fontWeight: 800, color: "white" }}>
                  {cInit}
                </span>
                {comp.name}
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Competitor Summary */}
      <div style={{ background: "#F0FDFA", borderBottom: "1px solid #CCFBF1", padding: "14px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0066FF,#00C9C8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "white", fontSize: "0.9rem" }}>
              {initial}
            </div>
            <div>
              <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.95rem" }}>{c.name}</div>
              <div style={{ fontSize: "0.68rem", color: "#64748B" }}>{c.url || ""}</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", gap: 24, flexWrap: "wrap" }}>
            {[
              { v: traffic, l: "Traffic/mo", color: "#0E7490" },
              { v: c.ctr || "—", l: "CTR", color: "#0E7490" },
              { v: `${c.roas || "—"}×`, l: "ROAS", color: "#0E7490" },
              { v: c.adSpend || "—", l: "Ad Spend", color: "#0E7490" },
              { v: c.topChannel || "—", l: "Top Channel", color: "#0E7490" },
              { v: threat.toUpperCase(), l: "Threat", color: threatColor },
            ].map((m, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: m.color }}>{m.v}</div>
                <div style={{ fontSize: "0.62rem", color: "#64748B", textTransform: "uppercase", letterSpacing: ".06em" }}>{m.l}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: "0.67rem", color: "#64748B", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".05em" }}>Opportunity Score</div>
            <div style={{ fontSize: "2rem", fontWeight: 900, fontFamily: "Sora,sans-serif", color: oppScore >= 70 ? "#059669" : oppScore >= 50 ? "#D97706" : "#2563EB", lineHeight: 1 }}>
              {oppScore}
            </div>
            <div style={{ fontSize: "0.62rem", color: "#94A3B8" }}>out of 100</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px" }}>
        {/* Priority Summary Banner */}
        <div style={{ background: "linear-gradient(135deg,rgba(239,68,68,.1),rgba(220,38,38,.04))", border: "1px solid rgba(239,68,68,.18)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#1E293B", marginBottom: 10 }}>🎯 Top Priority Actions vs {c.name}</div>
          {topRows.length > 0 ? (
            topRows.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(239,68,68,.12)" }}>
                <span style={{ fontSize: "0.62rem", fontWeight: 800, padding: "2px 8px", borderRadius: 5, flexShrink: 0, background: i === 0 ? "#FEE2E2" : "rgba(239,68,68,.12)", color: i === 0 ? "#EF4444" : "#B91C1C" }}>
                  #{i + 1}
                </span>
                <div style={{ fontSize: "0.8rem", color: "#374151", lineHeight: 1.45 }}>{s}</div>
              </div>
            ))
          ) : (
            <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>Run analysis for full recommendations</div>
          )}
        </div>

        {/* 2-Column Action Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(460px,1fr))", gap: 20 }}>
          <Section icon="🎯" title="Exploit Their Weaknesses" sub={`${(c.suggestions || []).length || 4} identified gaps in ${cName}&apos;s strategy`}>
            {weakCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="🔑" title="Keyword Attack Windows" sub={`Keywords ${cName} is over-bidding — steal their traffic at lower CPC`}>
            {kwCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="🎨" title="Creative Counter-Strategy" sub={`Ad angles that out-perform ${cName}&apos;s current creative`}>
            {creativeCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="👥" title="Untapped Audience Segments" sub={`Segments ${cName} is under-serving or ignoring`}>
            {audCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
          <Section icon="📣" title="Campaign Counter-Moves" sub={`Live ${cName} campaigns to counter right now`}>
            {campCards.length > 0 ? (
              campCards.map((d, i) => <Card key={i} data={d} />)
            ) : (
              <div style={{ color: "#94A3B8", fontSize: "0.82rem", padding: "12px 0" }}>
                No active campaigns detected — run full analysis for live campaign data.
              </div>
            )}
          </Section>
          <Section icon="💰" title="High-ROI Quick Wins" sub="Low effort, high impact — act before competitors do">
            {qwCards.map((d, i) => (
              <Card key={i} data={d} />
            ))}
          </Section>
        </div>

        {/* Bottom CTA */}
        <div className="bp-attack-cta" style={{ marginTop: 24, background: "linear-gradient(135deg,rgba(0,201,200,.1),rgba(0,102,255,.06))", border: "1px solid rgba(0,201,200,.2)", borderRadius: 14, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>🚀 Launch Full Attack Plan</div>
              <div style={{ fontSize: "0.8rem", color: "#475569" }}>
                GPT-4 generates a complete 8-week strategy — keywords, channels, content, budget &amp; weekly milestones
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: ".07em" }}>Select Competitor</label>
              <select
                id="attackPlanCompSelect"
                defaultValue={String(idx)}
                style={{ padding: "10px 14px", borderRadius: 9, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", width: "100%", appearance: "auto" }}
              >
                {comps.map((cc, i) => (
                  <option key={i} value={i}>
                    {cc.name || "Competitor " + (i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 18 }}>
              <button
                type="button"
                onClick={() => {
                  const sel = document.getElementById("attackPlanCompSelect") as HTMLSelectElement | null;
                  void generateAttackPlan(parseInt(sel?.value || String(idx), 10));
                }}
                style={{ padding: "11px 24px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 10, fontSize: "0.84rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,102,255,.4)" }}
              >
                🚀 Generate Attack Plan
              </button>
              <button
                type="button"
                className="bp-cta-secondary"
                onClick={() => goToView(router, "intelligence")}
              >
                📊 Deep Intelligence
              </button>
            </div>
          </div>
        </div>
      </div>
      <AttackPlanModal
        open={modalOpen}
        loading={modalLoading}
        error={modalError}
        competitor={planCompName}
        plan={attackPlan}
        sources={planSources}
        warning={planWarning}
        onClose={() => setModalOpen(false)}
        onExecute={() => { setModalOpen(false); callWin("bpLC", idx, 0); }}
      />
    </div>
  );
}
