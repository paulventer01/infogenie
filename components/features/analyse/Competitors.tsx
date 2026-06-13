"use client";

// Native React port of the legacy `competitors` panel (was `window.buildCompetitors`
// + `#view-competitors` in public/js/ig_compete.js / index.html). Renders the
// Competitive Intelligence Engine hero, live/benchmark tiles and per-competitor
// cards directly from the legacy `window.analysisData` global (set by the
// home-page competitor analysis). Links into the Battle Plan / Tech Stack via
// `goToView`. See `docs/react-panel-migration.md`.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { goToView } from "@/lib/nav";

interface Competitor {
  name?: string;
  url?: string;
  domain?: string;
  traffic?: string;
  _realTraffic?: string;
  _dataSource?: string;
  realData?: boolean;
  aiDetected?: boolean;
  ctr?: string;
  roas?: string | number;
  adSpend?: string;
  topChannel?: string;
  threatLevel?: string;
  suggestions?: string[];
}
interface AnalysisData {
  url?: string;
  industry?: { name?: string };
  competitors?: Competitor[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function threatColor(level?: string): string {
  const l = String(level || "").toLowerCase();
  if (l === "high") return "#EF4444";
  if (l === "medium") return "#F59E0B";
  return "#10B981";
}

export default function Competitors() {
  const router = useRouter();
  const ad = useMemo(getAnalysisData, []);
  const competitors = useMemo(
    () => (Array.isArray(ad.competitors) ? ad.competitors : []),
    [ad],
  );
  const [filter, setFilter] = useState("all");

  const liveCount = competitors.filter((c) => c._dataSource === "DataForSEO" || c._realTraffic).length;
  const aiCount = competitors.filter((c) => c.aiDetected).length;

  const shown = filter === "all" ? competitors : competitors.filter((c) => c.url === filter);

  const heroStat = (id: string, value: number | string, label: string, minWidth = 118) => (
    <div
      key={id}
      style={{ background: "#FFFFFF", border: "1px solid rgba(255,255,255,.6)", borderRadius: 14, padding: "14px 20px", textAlign: "center", minWidth, boxShadow: "0 2px 6px rgba(15,30,61,.12)" }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0A1628", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#0A1628", marginTop: 6, letterSpacing: ".02em", whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );

  return (
    <div className="view-header-wrap">
      <div className="container" style={{ paddingTop: 24 }}>
        <div
          className="comp-hero"
          style={{ background: "linear-gradient(110deg,#1E40AF 0%,#2563EB 50%,#3B82F6 100%)", borderRadius: 18, padding: "26px 30px", marginBottom: 20, position: "relative", overflow: "hidden", boxShadow: "0 8px 28px rgba(37,99,235,.18)" }}
        >
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: "0.65rem", fontWeight: 800, color: "#BFDBFE", opacity: 0.9, letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 6 }}>
                Analyse › Intelligence Hub
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: "1.4rem" }}>⚡</span>
                <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#FFFFFF", lineHeight: 1.2, margin: 0, textShadow: "0 1px 2px rgba(15,30,61,.20)" }}>
                  Competitive Intelligence Engine
                </h1>
              </div>
              <div style={{ fontSize: "0.88rem", color: "#E0E7FF", maxWidth: 680, lineHeight: 1.5, fontWeight: 500, opacity: 0.95, textShadow: "0 1px 2px rgba(15,30,61,.18)" }}>
                Exclusive InfoGenie capabilities — real-time signals, predictive moves, keyword gaps, and your 90-day category domination roadmap
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              {heroStat("total", competitors.length, "🎯 Tracked")}
              {heroStat("live", liveCount, "📡 Live")}
              {heroStat("ai", aiCount, "🤖 AI-detected", 128)}
              {competitors.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginLeft: 8 }}>
                  <label style={{ fontSize: "0.66rem", fontWeight: 800, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6, textShadow: "0 1px 2px rgba(15,30,61,.25)" }}>
                    Filter
                  </label>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{ background: "#FFFFFF", color: "#0F4C4A", border: "1px solid rgba(15,76,74,.18)", borderRadius: 10, padding: "10px 32px", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", minWidth: 200, textAlign: "center", boxShadow: "0 2px 6px rgba(15,30,61,.12)", height: 54 }}
                  >
                    <option value="all">All Competitors</option>
                    {competitors.map((c, i) => (
                      <option key={i} value={c.url}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 56 }}>
        {competitors.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 48, textAlign: "center", color: "#6B7280" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>⚡</div>
            <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>No competitors analysed yet</div>
            <div style={{ fontSize: "0.88rem", marginBottom: 16 }}>
              Run a competitor analysis from the home page to populate the
              Intelligence Engine.
            </div>
            <button className="btn-primary" onClick={() => goToView(router, "home")}>
              Run Analysis →
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 16 }}>
            {shown.map((c, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0A1628" }}>{c.name}</div>
                    <div style={{ fontSize: "0.74rem", color: "#9CA3AF" }}>{c.url || c.domain}</div>
                  </div>
                  <span style={{ background: threatColor(c.threatLevel), color: "#fff", padding: "3px 10px", borderRadius: 999, fontSize: "0.66rem", fontWeight: 800, flexShrink: 0 }}>
                    {String(c.threatLevel || "medium").toUpperCase()}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                  {[
                    ["Traffic/mo", c._realTraffic || c.traffic || "—"],
                    ["CTR", c.ctr || "—"],
                    ["ROAS", c.roas != null ? `${c.roas}×` : "—"],
                    ["Ad Spend", c.adSpend || "—"],
                    ["Top Channel", c.topChannel || "—"],
                    ["Source", c._dataSource === "DataForSEO" ? "📡 Live" : "📊 Benchmark"],
                  ].map(([label, val], k) => (
                    <div key={k} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: "0.62rem", color: "#94A3B8", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
                      <div style={{ fontSize: "0.86rem", fontWeight: 800, color: "#0A1628" }}>{val}</div>
                    </div>
                  ))}
                </div>

                {Array.isArray(c.suggestions) && c.suggestions.length > 0 && (
                  <div>
                    <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#6D28D9", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                      💡 Exploitable gaps
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: "#374151", lineHeight: 1.5 }}>
                      {c.suggestions.slice(0, 3).map((s, k) => (
                        <li key={k} style={{ marginBottom: 3 }}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 6 }}>
                  <button onClick={() => goToView(router, "battleplan")} style={{ flex: 1, background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer" }}>
                    ⚔️ Battle Plan
                  </button>
                  <button onClick={() => goToView(router, "tech-stack")} style={{ flex: 1, background: "#F3F4F6", color: "#374151", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 12px", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer" }}>
                    🧱 Tech Stack
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
