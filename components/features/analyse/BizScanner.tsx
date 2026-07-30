"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Opportunity {
  name?: string;
  category?: string;
  opportunity_score?: number;
  estimated_value?: string;
  why_interesting?: string;
  signals?: string[];
  action?: string;
}
interface ScanResults {
  market_summary?: string;
  top_pick?: string;
  opportunities?: Opportunity[];
  sector_trends?: string[];
}
interface ScanResponse {
  ok: boolean;
  error?: string;
  results?: ScanResults;
}
interface HistoryRun {
  industry?: string;
  region?: string;
  created_at?: string;
  results?: ScanResults;
}
interface HistoryResponse {
  ok: boolean;
  runs?: HistoryRun[];
}

const CAT_COLOUR: Record<string, string> = {
  struggling: "#ef4444",
  for_sale: "#3b82f6",
  growing: "#10b981",
  franchise: "#f59e0b",
};

const SCAN_TYPES = [
  { value: "all",        label: "Full Scan",      icon: "🔭", desc: "All opportunity types" },
  { value: "struggling", label: "Struggling",     icon: "📉", desc: "Weak competitors" },
  { value: "for_sale",   label: "For Sale",       icon: "🏷️", desc: "Businesses listed" },
  { value: "growing",    label: "Fast-Growing",   icon: "🚀", desc: "Rising sectors" },
  { value: "franchise",  label: "Franchise",      icon: "🏪", desc: "Franchise openings" },
];

const REGIONS = [
  "Global / All countries",
  "United States",
  "United Kingdom",
  "European Union",
  "Canada",
  "Australia",
  "Asia-Pacific",
  "Latin America",
  "Middle East & Africa",
];

function ScoreRing({ val, max = 100 }: { val: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, Math.round((val / max) * 100)));
  const col = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: `conic-gradient(${col} ${pct}%,#e5e7eb 0)`,
        fontSize: "1rem",
        fontWeight: 700,
        color: col,
      }}
    >
      {val}
    </div>
  );
}

export default function BizScanner() {
  const [industry, setIndustry] = useState("SaaS");
  const [region, setRegion] = useState("United States");
  const [scanType, setScanType] = useState("all");
  const [budget, setBudget] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ScanResults | null>(null);
  const [runs, setRuns] = useState<HistoryRun[]>([]);

  async function loadHistory() {
    const d = await apiGet<HistoryResponse>("/api/biz-scanner/history");
    if (d.ok && Array.isArray(d.runs)) setRuns(d.runs);
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function run() {
    setRunning(true);
    const d = await apiPost<ScanResponse>("/api/biz-scanner/scan", {
      industry: industry || "SaaS",
      region: region || "United States",
      scan_type: scanType,
      budget_range: budget,
    });
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResults(d.results || {});
    void loadHistory();
  }

  const r = results;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Business Acquisition Scanner
              </div>
              <h2 className="view-title">🔭 Business Acquisition Scanner</h2>
              <p className="view-sub">
                AI scans for struggling competitors, businesses for sale,
                growing sectors, and franchise opportunities — then scores each
                one.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>

        {/* ── Modern scan form ── */}
        <div style={{
          maxWidth: 720,
          marginBottom: 28,
          background: "#fff",
          border: "1px solid #E8EFF8",
          borderRadius: 20,
          boxShadow: "0 4px 24px rgba(10,22,40,.07)",
          overflow: "hidden",
        }}>

          {/* Card header accent */}
          <div style={{
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            padding: "18px 24px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}>
            <div style={{
              width: 40, height: 40,
              background: "rgba(255,255,255,.12)",
              borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.2rem",
            }}>🔭</div>
            <div>
              <div style={{ color: "#0f172a", fontWeight: 700, fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
                Configure Scan
              </div>
              <div style={{ color: "#475569", fontSize: "0.75rem" }}>
                AI will scan the market and score every opportunity
              </div>
            </div>
          </div>

          {/* Form body */}
          <div style={{ padding: "24px 24px 20px" }}>

            {/* Row 1: Industry + Region */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                  Industry / Sector
                </label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem", pointerEvents: "none" }}>🏭</span>
                  <input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="e.g. SaaS, FinTech, Retail…"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "10px 12px 10px 36px",
                      border: "1.5px solid #E2E8F0",
                      borderRadius: 10,
                      fontSize: "0.88rem",
                      color: "#0A1628",
                      outline: "none",
                      background: "#F8FAFC",
                      fontFamily: "inherit",
                      transition: "border-color .15s",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#3B82F6")}
                    onBlur={e => (e.currentTarget.style.borderColor = "#E2E8F0")}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                  Region
                </label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem", pointerEvents: "none" }}>🌐</span>
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "10px 12px 10px 36px",
                      border: "1.5px solid #E2E8F0",
                      borderRadius: 10,
                      fontSize: "0.88rem",
                      color: "#0A1628",
                      outline: "none",
                      background: "#F8FAFC",
                      fontFamily: "inherit",
                      appearance: "auto",
                      cursor: "pointer",
                    }}
                  >
                    {REGIONS.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Row 2: Scan type pill chips */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                Scan Type
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SCAN_TYPES.map(t => {
                  const active = scanType === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => setScanType(t.value)}
                      title={t.desc}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: active ? "2px solid #2563EB" : "1.5px solid #E2E8F0",
                        background: active ? "#EFF6FF" : "#fff",
                        color: active ? "#1D4ED8" : "#374151",
                        fontWeight: active ? 700 : 500,
                        fontSize: "0.82rem",
                        cursor: "pointer",
                        transition: "all .15s",
                        fontFamily: "inherit",
                        boxShadow: active ? "0 0 0 3px rgba(37,99,235,.12)" : "none",
                      }}
                    >
                      <span>{t.icon}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row 3: Budget range */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                Budget Range{" "}
                <span style={{ color: "#9CA3AF", fontWeight: 400, textTransform: "none", fontSize: "0.7rem" }}>(optional)</span>
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem", pointerEvents: "none" }}>💰</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. $100K–$2M"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 12px 10px 36px",
                    border: "1.5px solid #E2E8F0",
                    borderRadius: 10,
                    fontSize: "0.88rem",
                    color: "#0A1628",
                    outline: "none",
                    background: "#F8FAFC",
                    fontFamily: "inherit",
                    transition: "border-color .15s",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "#3B82F6")}
                  onBlur={e => (e.currentTarget.style.borderColor = "#E2E8F0")}
                />
              </div>
            </div>

            {/* CTA button */}
            <button
              disabled={running}
              onClick={run}
              style={{
                width: "100%",
                padding: "13px 24px",
                background: running
                  ? "linear-gradient(135deg,#94A3B8,#64748B)"
                  : "linear-gradient(135deg,#1D4ED8 0%,#2563EB 50%,#0EA5E9 100%)",
                border: "none",
                borderRadius: 12,
                color: "#fff",
                fontWeight: 800,
                fontSize: "0.95rem",
                fontFamily: "Sora, sans-serif",
                cursor: running ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: running ? "none" : "0 4px 20px rgba(37,99,235,.35)",
                transition: "all .2s",
                letterSpacing: ".01em",
              }}
            >
              {running ? (
                <>
                  <span style={{
                    display: "inline-block",
                    width: 16, height: 16,
                    border: "2px solid rgba(255,255,255,.3)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "spin .7s linear infinite",
                  }} />
                  Scanning market…
                </>
              ) : (
                <>🔭 Run Acquisition Scan</>
              )}
            </button>

          </div>
        </div>

        {r && (
          <div>
            <div className="ig-card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 8 }}>
                Market Summary
              </div>
              <p style={{ color: "#374151" }}>{r.market_summary || ""}</p>
              {r.top_pick && (
                <div
                  style={{
                    background: "#f0fdf4",
                    borderRadius: 8,
                    padding: 10,
                    marginTop: 8,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "#10b981" }}>
                    🏆 Top Pick:{" "}
                  </span>
                  {r.top_pick}
                </div>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                gap: 16,
                marginBottom: 16,
              }}
            >
              {(r.opportunities || []).map((o, i) => {
                const col = CAT_COLOUR[o.category || ""] || "#6b7280";
                return (
                  <div key={i} className="ig-card" style={{ borderTop: `3px solid ${col}` }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{o.name}</div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <ScoreRing val={o.opportunity_score || 0} />
                        <span
                          style={{
                            fontSize: "0.7rem",
                            background: col,
                            color: "#fff",
                            borderRadius: 4,
                            padding: "1px 6px",
                          }}
                        >
                          {(o.category || "").replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: 6 }}>
                      {o.estimated_value || ""}
                    </div>
                    <p style={{ fontSize: "0.85rem", color: "#374151", marginBottom: 8 }}>
                      {o.why_interesting || ""}
                    </p>
                    {!!o.signals?.length && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                        {o.signals.map((s, si) => (
                          <span
                            key={si}
                            style={{
                              background: "#f3f4f6",
                              borderRadius: 4,
                              padding: "2px 8px",
                              fontSize: "0.75rem",
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        background: "#eff6ff",
                        borderRadius: 6,
                        padding: 8,
                        fontSize: "0.82rem",
                      }}
                    >
                      <span style={{ color: "#3b82f6", fontWeight: 600 }}>Next step:</span>{" "}
                      {o.action || ""}
                    </div>
                  </div>
                );
              })}
            </div>

            {!!r.sector_trends?.length && (
              <div className="ig-card">
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Sector Trends</div>
                <ul style={{ margin: 0, paddingLeft: 20, color: "#374151", fontSize: "0.9rem" }}>
                  {r.sector_trends.map((t, ti) => (
                    <li key={ti}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {runs.length > 0 && (
          <div>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#6b7280", margin: "16px 0 8px" }}>
              Previous Scans
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.map((run0, i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ padding: 12, cursor: "pointer" }}
                  onClick={() => setResults(run0.results || {})}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600 }}>
                      {run0.industry} · {run0.region}
                    </span>
                    <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                      {run0.created_at ? new Date(run0.created_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#374151", marginTop: 2 }}>
                    {run0.results?.opportunities?.length || 0} opportunities found
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
