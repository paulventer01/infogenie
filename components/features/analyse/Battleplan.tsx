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

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

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
    } catch {
      /* legacy handler not available */
    }
  }
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
const KW_COLORS = ["#0066FF", "#7C3AED", "#059669", "#D97706"];
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
const purpleStyle: CSSProperties = { ...btnBase, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", color: "#fff" };
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
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{icon}</span>
        <div>
          <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.9rem", fontWeight: 800, color: "white" }} dangerouslySetInnerHTML={{ __html: title }} />
          <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,.4)", marginTop: 2 }} dangerouslySetInnerHTML={{ __html: sub }} />
        </div>
      </div>
      {children}
    </div>
  );
}

export default function Battleplan() {
  const router = useRouter();
  const ad = useMemo(getAnalysisData, []);
  const comps = useMemo(() => (ad && Array.isArray(ad.competitors) ? ad.competitors : []), [ad]);
  const [idxState, setIdxState] = useState(0);

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

  if (!hasData || !c) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "70vh",
          textAlign: "center",
          gap: 20,
          padding: 40,
        }}
      >
        <div style={{ fontSize: "3.5rem" }}>⚔️</div>
        <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.5rem", fontWeight: 900, color: "white" }}>No Analysis Yet</div>
        <div style={{ color: "rgba(255,255,255,.5)", maxWidth: 420, fontSize: "0.9rem", lineHeight: 1.6 }}>
          Run a competitor analysis first to generate your personalised Battle Plan — with actions you can take directly from this page.
        </div>
        <button
          onClick={() => goToView(router, "home")}
          style={{
            padding: "13px 30px",
            background: "linear-gradient(135deg,#0066FF,#00C9C8)",
            border: "none",
            borderRadius: 12,
            color: "white",
            fontWeight: 700,
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          Run Analysis →
        </button>
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
        border: "#7C3AED",
        badgeStyle: { background: "#F5F3FF", color: "#6D28D9" },
        badge: ANGLES[i] || "Creative Angle",
        title: `"${acItem.headline || "Counter Creative"}"`,
        body: (acItem.body || "").slice(0, 110),
        buttons: [{ label: "✨ Open Creative Studio", onClick: () => callWin("bpCS", idx, i), style: purpleStyle }],
      }))
    : (c.suggestions || ["Exploit their weak personalisation with hyper-targeted messaging"]).slice(0, 3).map((s, i) => ({
        border: "#7C3AED",
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
        style={{
          background: "linear-gradient(110deg,#1E40AF 0%,#2563EB 50%,#3B82F6 100%)",
          borderRadius: 18,
          margin: "18px 24px 6px",
          padding: "22px 28px",
          boxShadow: "0 8px 28px rgba(37,99,235,.18)",
          position: "relative",
          overflow: "hidden",
          minHeight: 130,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -60,
            right: -40,
            width: 260,
            height: 260,
            background: "radial-gradient(circle,rgba(255,255,255,.25),transparent 70%)",
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
            <div style={{ fontSize: "0.65rem", fontWeight: 800, color: "#BFDBFE", opacity: 0.9, letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6 }}>
              Analyse › Battle Plan
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: "1.4rem" }}>⚔️</span>
              <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.5rem", fontWeight: 900, color: "#FFFFFF", margin: 0, textShadow: "0 1px 2px rgba(15,30,61,.20)" }}>
                Battle Plan
              </h1>
              <span
                className="hero-pill"
                style={{ background: "#FFFFFF", border: "1px solid rgba(255,255,255,.6)", padding: "3px 12px", borderRadius: 20, fontSize: "0.67rem", fontWeight: 800, color: "#1E3A8A", boxShadow: "0 1px 3px rgba(15,30,61,.10)" }}
              >
                AI-GENERATED
              </span>
            </div>
            <div style={{ color: "#E0E7FF", opacity: 0.95, fontSize: "0.88rem", fontWeight: 500, textShadow: "0 1px 2px rgba(15,30,61,.18)" }}>
              {domain} · {industry} · {comps.length} competitors · Click any action card to execute directly
            </div>
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
      <div style={{ background: "rgba(255,255,255,.02)", borderBottom: "1px solid rgba(255,255,255,.07)", overflowX: "auto" }}>
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
                  borderBottom: `3px solid ${active ? "#00C9C8" : "transparent"}`,
                  background: active ? "rgba(0,201,200,.08)" : "transparent",
                  cursor: "pointer",
                  color: active ? "#00C9C8" : "rgba(255,255,255,.5)",
                  fontSize: "0.8rem",
                  fontWeight: active ? 700 : 500,
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
      <div style={{ background: "rgba(0,201,200,.06)", borderBottom: "1px solid rgba(0,201,200,.12)", padding: "14px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#0066FF,#00C9C8)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "white", fontSize: "0.9rem" }}>
              {initial}
            </div>
            <div>
              <div style={{ fontWeight: 800, color: "white", fontSize: "0.95rem" }}>{c.name}</div>
              <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,.4)" }}>{c.url || ""}</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", gap: 24, flexWrap: "wrap" }}>
            {[
              { v: traffic, l: "Traffic/mo", color: "#00E5FF" },
              { v: c.ctr || "—", l: "CTR", color: "#00E5FF" },
              { v: `${c.roas || "—"}×`, l: "ROAS", color: "#00E5FF" },
              { v: c.adSpend || "—", l: "Ad Spend", color: "#00E5FF" },
              { v: c.topChannel || "—", l: "Top Channel", color: "#00E5FF" },
              { v: threat.toUpperCase(), l: "Threat", color: threatColor },
            ].map((m, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.92rem", fontWeight: 800, color: m.color }}>{m.v}</div>
                <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.4)", textTransform: "uppercase", letterSpacing: ".06em" }}>{m.l}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: "0.67rem", color: "rgba(255,255,255,.4)", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".05em" }}>Opportunity Score</div>
            <div style={{ fontSize: "2rem", fontWeight: 900, fontFamily: "Sora,sans-serif", color: oppScore >= 70 ? "#10B981" : oppScore >= 50 ? "#F59E0B" : "#60A5FA", lineHeight: 1 }}>
              {oppScore}
            </div>
            <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.3)" }}>out of 100</div>
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
              <div style={{ color: "rgba(255,255,255,.4)", fontSize: "0.82rem", padding: "12px 0" }}>
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
        <div style={{ marginTop: 24, background: "linear-gradient(135deg,rgba(0,201,200,.1),rgba(0,102,255,.06))", border: "1px solid rgba(0,201,200,.2)", borderRadius: 14, padding: "20px 24px" }}>
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
                style={{ padding: "10px 14px", background: "#1A2E4A", border: "1px solid rgba(0,201,200,.3)", borderRadius: 9, fontSize: "0.82rem", fontWeight: 600, color: "white", cursor: "pointer", width: "100%", appearance: "auto" }}
              >
                {comps.map((cc, i) => (
                  <option key={i} value={i} style={{ background: "#1A2E4A", color: "white" }}>
                    {cc.name || "Competitor " + (i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 18 }}>
              <button
                onClick={() => {
                  const sel = document.getElementById("attackPlanCompSelect") as HTMLSelectElement | null;
                  callWin("openFullAttackPlanModal", parseInt(sel?.value || String(idx), 10));
                }}
                style={{ padding: "11px 24px", background: "linear-gradient(135deg,#0066FF,#00C9C8)", border: "none", borderRadius: 10, fontSize: "0.84rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,102,255,.4)" }}
              >
                🚀 Generate Attack Plan
              </button>
              <button
                onClick={() => goToView(router, "intelligence")}
                style={{ padding: "11px 20px", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, fontSize: "0.82rem", fontWeight: 600, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                📊 Deep Intelligence
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
