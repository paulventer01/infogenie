"use client";

// Native React port of the legacy `benchmarks` panel (was
// `window.buildBenchmarks` + `#view-benchmarks` in ig_moat_features.js).
// Compares your metrics to anonymised network medians via the existing Express
// API (`GET /api/benchmarks/config`, `POST /api/benchmarks/compare`,
// `POST /api/benchmarks/submit`, `GET /api/benchmarks/leaderboard`) through
// `lib/api`. See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface MetricDef {
  key: string;
  label: string;
  unit: string;
}
interface ConfigResponse {
  ok: boolean;
  verticals?: string[];
  regions?: string[];
  sizes?: string[];
  metrics?: MetricDef[];
}
interface BenchStat {
  p25?: number;
  median?: number;
  p75?: number;
  sample_count?: number;
}
interface Insight {
  metric?: string;
  status?: string;
  gap_pct?: number;
  action?: string;
  takeaway?: string;
}
interface CompareResponse {
  ok: boolean;
  error?: string;
  vertical?: string;
  your_metrics?: Record<string, number>;
  benchmarks?: Record<string, BenchStat>;
  ai_insights?: {
    summary?: string;
    biggest_opportunity?: string;
    insights?: Insight[];
  };
}
interface SubmitResponse {
  ok: boolean;
  error?: string;
  submitted?: number;
}
interface LeaderboardRow {
  vertical: string;
  metric_key: string;
  median: number;
  sample_count: number;
}
interface LeaderboardResponse {
  ok: boolean;
  leaderboard?: LeaderboardRow[];
}

const METRIC_META: Record<string, { icon: string; color: string; bg: string }> = {
  cac:     { icon: "💰", color: "#DC2626", bg: "#FEF2F2" },
  cpa:     { icon: "🎯", color: "#D97706", bg: "#FFFBEB" },
  roas:    { icon: "📈", color: "#059669", bg: "#F0FDF4" },
  ctr:     { icon: "👆", color: "#0066FF", bg: "#EFF6FF" },
  cvr:     { icon: "✅", color: "#7C3AED", bg: "#F5F3FF" },
  cpm:     { icon: "👁",  color: "#0891B2", bg: "#ECFEFF" },
  email_open:   { icon: "📧", color: "#0066FF", bg: "#EFF6FF" },
  email_click:  { icon: "🖱",  color: "#7C3AED", bg: "#F5F3FF" },
  ltv:     { icon: "♾️", color: "#059669", bg: "#F0FDF4" },
  ltv_cac: { icon: "⚖️", color: "#D97706", bg: "#FFFBEB" },
  monthly_ad_spend:  { icon: "💳", color: "#DC2626", bg: "#FEF2F2" },
  organic_traffic:   { icon: "🌱", color: "#059669", bg: "#F0FDF4" },
};

function metaMeta(key: string) {
  return METRIC_META[key] || { icon: "📊", color: "#6B7280", bg: "#F9FAFB" };
}

export default function Benchmarks() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [vert, setVert] = useState("");
  const [region, setRegion] = useState("");
  const [size, setSize] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [comparing, setComparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [activeLeadVert, setActiveLeadVert] = useState<string | null>(null);

  async function loadLeaderboard() {
    const d = await apiGet<LeaderboardResponse>("/api/benchmarks/leaderboard");
    if (d.ok && Array.isArray(d.leaderboard)) {
      setLeaderboard(d.leaderboard);
    }
  }

  useEffect(() => {
    void (async () => {
      const d = await apiGet<ConfigResponse>("/api/benchmarks/config");
      if (d.ok) {
        setConfig(d);
        if (d.verticals?.length) setVert(d.verticals[0]);
      }
      await loadLeaderboard();
    })();
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, Record<string, LeaderboardRow>> = {};
    for (const r of leaderboard) {
      if (!g[r.vertical]) g[r.vertical] = {};
      g[r.vertical][r.metric_key] = r;
    }
    return g;
  }, [leaderboard]);

  useEffect(() => {
    if (leaderboard.length && !activeLeadVert) {
      const verts = [...new Set(leaderboard.map((r) => r.vertical))];
      if (verts.length) setActiveLeadVert(verts[0]);
    }
  }, [leaderboard, activeLeadVert]);

  function collectMetrics(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of config?.metrics || []) {
      const v = values[m.key];
      if (v !== undefined && v !== "") out[m.key] = +v;
    }
    return out;
  }

  async function compare() {
    if (!vert) { alert("Select a vertical."); return; }
    setComparing(true);
    setResult(null);
    const d = await apiPost<CompareResponse>("/api/benchmarks/compare", {
      vertical: vert,
      region: region || null,
      company_size: size || null,
      your_metrics: collectMetrics(),
    });
    setComparing(false);
    if (!d.ok) { alert(d.error || "Error"); return; }
    setResult(d);
  }

  async function submit() {
    if (!vert) { alert("Select a vertical."); return; }
    const metrics = collectMetrics();
    if (!Object.keys(metrics).length) {
      alert("Enter at least one metric to contribute.");
      return;
    }
    setSubmitting(true);
    const d = await apiPost<SubmitResponse>("/api/benchmarks/submit", {
      vertical: vert,
      region: region || null,
      company_size: size || null,
      metrics,
    });
    setSubmitting(false);
    if (d.ok) alert(`✅ Contributed ${d.submitted} metric(s) anonymously. Thank you!`);
  }

  async function aiSuggest() {
    setSuggesting(true);
    setSuggestError(null);
    const d = await apiPost<{ ok: boolean; error?: string; suggested?: Record<string, number> }>(
      "/api/benchmarks/ai-suggest",
      {}
    );
    setSuggesting(false);
    if (!d.ok) {
      setSuggestError(d.error || "AI suggestion failed. Please fill in your Brand Foundation first.");
      return;
    }
    setSuggestError(null);
    if (d.suggested) {
      setValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(d.suggested!)) {
          if (v != null && v > 0) next[k] = String(v);
        }
        return next;
      });
    }
  }

  const filledCount = Object.values(values).filter((v) => v !== "").length;
  const totalMetrics = (config?.metrics || []).length;

  return (
    <div className="view-header-wrap">
      {/* ── Hero Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
          padding: "32px 28px 28px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute", inset: 0, opacity: 0.07,
            backgroundImage:
              "radial-gradient(circle at 20% 50%, #00E5FF 0%, transparent 50%), radial-gradient(circle at 80% 20%, #7C3AED 0%, transparent 45%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ maxWidth: 1200, margin: "0 auto", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: "0.65rem", fontWeight: 800, background: "rgba(255,255,255,.15)", color: '#334155', padding: "3px 10px", borderRadius: 20, letterSpacing: ".07em", textTransform: "uppercase" }}>
                  ANALYSE
                </span>
                <span style={{ color: '#94a3b8', fontSize: "0.65rem" }}>›</span>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".07em" }}>
                  Benchmark Intelligence
                </span>
              </div>
              <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#FFFFFF", lineHeight: 1.2 }}>
                📊 Benchmark Intelligence
              </h2>
              <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,.7)", fontSize: "0.88rem", maxWidth: 520, lineHeight: 1.6 }}>
                Compare your marketing metrics against anonymised network medians from real companies in your vertical — instantly spot where you&apos;re leading or lagging.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "Verticals", value: (config?.verticals || []).length || "—", color: "#93C5FD" },
                { label: "Network size", value: leaderboard.length ? leaderboard.reduce((s, r) => Math.max(s, r.sample_count || 0), 0) + "+" : "—", color: "#6EE7B7" },
                { label: "Metrics tracked", value: totalMetrics || "—", color: "#C4B5FD" },
              ].map((stat) => (
                <div key={stat.label} style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "10px 16px", textAlign: "center", minWidth: 80 }}>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: stat.color, fontFamily: "Sora, sans-serif" }}>{stat.value}</div>
                  <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.55)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px 56px" }}>

        {/* ── Filter Row ───────────────────────────────────────────────────── */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8EEF8", borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", boxShadow: "0 2px 8px rgba(10,20,50,.05)" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: "#7A92B4", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Industry Vertical</label>
            <select
              style={{ width: "100%", padding: "9px 12px", background: "#F8FAFF", border: "1.5px solid #D0DDEF", borderRadius: 9, fontSize: "0.85rem", color: "#0A1628", fontWeight: 600, cursor: "pointer" }}
              value={vert}
              onChange={(e) => setVert(e.target.value)}
            >
              {(config?.verticals || []).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: "#7A92B4", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Region</label>
            <select
              style={{ width: "100%", padding: "9px 12px", background: "#F8FAFF", border: "1.5px solid #D0DDEF", borderRadius: 9, fontSize: "0.85rem", color: "#0A1628", fontWeight: 600, cursor: "pointer" }}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">Any region</option>
              {(config?.regions || []).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: "#7A92B4", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Company Size</label>
            <select
              style={{ width: "100%", padding: "9px 12px", background: "#F8FAFF", border: "1.5px solid #D0DDEF", borderRadius: 9, fontSize: "0.85rem", color: "#0A1628", fontWeight: 600, cursor: "pointer" }}
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="">Any size</option>
              {(config?.sizes || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {filledCount > 0 && (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "9px 14px", fontSize: "0.78rem", color: "#1D4ED8", fontWeight: 700, whiteSpace: "nowrap" }}>
              {filledCount}/{totalMetrics} filled
            </div>
          )}
        </div>

        {/* ── Main Two-Column Layout ────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>

          {/* Left: Metric inputs */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E8EEF8", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(10,20,50,.06)" }}>
            <div style={{ background: "linear-gradient(135deg, #F8FAFF, #EFF4FF)", padding: "16px 20px", borderBottom: "1px solid #E8EEF8", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "Sora, sans-serif", fontSize: "0.9rem", fontWeight: 800, color: "#0A1628" }}>Enter Your Metrics</div>
                <div style={{ fontSize: "0.72rem", color: "#6B88B0", marginTop: 2 }}>Fill in any metrics you have — leave others blank</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={aiSuggest}
                  disabled={suggesting}
                  title="Uses your Brand Foundation profile to estimate realistic metrics with AI"
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "7px 14px",
                    background: suggesting ? "#F3F4F6" : "linear-gradient(135deg, #7C3AED, #6D28D9)",
                    border: "none",
                    borderRadius: 20,
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: suggesting ? "#9BADC8" : "#FFFFFF",
                    cursor: suggesting ? "not-allowed" : "pointer",
                    boxShadow: suggesting ? "none" : "0 2px 8px rgba(124,58,237,.35)",
                    transition: "opacity .15s",
                    whiteSpace: "nowrap",
                  }}
                >
                  {suggesting ? (
                    <>
                      <span style={{ display: "inline-block", width: 11, height: 11, border: "1.5px solid #CBD5E1", borderTopColor: "#6D28D9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      Generating…
                    </>
                  ) : (
                    <>✨ AI Suggest</>
                  )}
                </button>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, background: "#EFF6FF", color: "#3B5BDB", border: "1px solid #C7D2FE", borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>
                  Anonymous comparison
                </span>
              </div>
            </div>
            {suggestError && (
              <div style={{
                margin: "0 16px 0",
                padding: "10px 14px",
                background: "#FFF7ED",
                border: "1px solid #FED7AA",
                borderRadius: 10,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: "0.78rem",
                color: "#92400E",
              }}>
                <span style={{ fontSize: "1rem", lineHeight: 1.3 }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <span>{suggestError.includes("Brand Foundation")
                    ? "Your Brand Foundation is empty — AI Suggest needs it to estimate your metrics."
                    : suggestError}
                  </span>
                  {suggestError.includes("Brand Foundation") && (
                    <button
                      onClick={() => {
                        setSuggestError(null);
                        try { (window as unknown as Record<string, (v: string) => void>).navigateTo?.("brand-foundation"); } catch { /* noop */ }
                      }}
                      style={{
                        display: "inline-block",
                        marginLeft: 10,
                        padding: "2px 10px",
                        background: "#7C3AED",
                        color: "#fff",
                        border: "none",
                        borderRadius: 12,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Set up Brand Foundation →
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setSuggestError(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#B45309", fontSize: "0.85rem", padding: 0, lineHeight: 1 }}
                >✕</button>
              </div>
            )}
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {(config?.metrics || []).map((m) => {
                  const meta = metaMeta(m.key);
                  const filled = values[m.key] !== undefined && values[m.key] !== "";
                  return (
                    <div
                      key={m.key}
                      style={{
                        background: filled ? meta.bg : "#F8FAFF",
                        border: `1.5px solid ${filled ? meta.color + "40" : "#E8EEF8"}`,
                        borderRadius: 10,
                        padding: "10px 12px",
                        transition: "border-color .15s, background .15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: "0.9rem" }}>{meta.icon}</span>
                        <label style={{ fontSize: "0.73rem", fontWeight: 700, color: filled ? meta.color : "#5A7090" }}>
                          {m.label}
                        </label>
                      </div>
                      <input
                        type="number"
                        step="any"
                        placeholder={`${m.unit === "percent" ? "%" : m.unit === "multiplier" ? "×" : "$"}0`}
                        value={values[m.key] ?? ""}
                        onChange={(e) => setValues((p) => ({ ...p, [m.key]: e.target.value }))}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "7px 10px",
                          border: `1px solid ${filled ? meta.color + "60" : "#D0DDEF"}`,
                          borderRadius: 7,
                          fontSize: "0.88rem",
                          fontWeight: 700,
                          color: filled ? meta.color : "#374B6E",
                          background: "#FFFFFF",
                          outline: "none",
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* CTA Buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                <button
                  onClick={compare}
                  disabled={comparing}
                  style={{
                    padding: "13px 16px",
                    background: comparing ? "#93C5FD" : "linear-gradient(135deg, #0055DD, #0066FF, #00C9C8)",
                    border: "none",
                    borderRadius: 10,
                    fontSize: "0.88rem",
                    fontWeight: 800,
                    color: "#FFFFFF",
                    cursor: comparing ? "not-allowed" : "pointer",
                    boxShadow: comparing ? "none" : "0 4px 14px rgba(0,102,255,.35)",
                    letterSpacing: ".02em",
                    transition: "opacity .15s",
                  }}
                >
                  {comparing ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      Comparing…
                    </span>
                  ) : "📊 Compare vs Network"}
                </button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  style={{
                    padding: "13px 16px",
                    background: "#FFFFFF",
                    border: "1.5px solid #D0DDEF",
                    borderRadius: 10,
                    fontSize: "0.88rem",
                    fontWeight: 700,
                    color: "#374B6E",
                    cursor: submitting ? "not-allowed" : "pointer",
                    transition: "border-color .15s",
                  }}
                  title="Contribute your metrics anonymously to help grow the benchmark pool"
                >
                  {submitting ? "Submitting…" : "📤 Submit Metrics"}
                </button>
              </div>
              <div style={{ fontSize: "0.68rem", color: "#9BADC8", marginTop: 8, textAlign: "center" }}>
                📤 Submit shares your data anonymously · 📊 Compare keeps it private
              </div>
            </div>
          </div>

          {/* Right: Network Medians */}
          <div>
            {leaderboard.length === 0 ? (
              <div style={{ background: "#FFFFFF", border: "1px solid #E8EEF8", borderRadius: 16, padding: "28px 20px", textAlign: "center", boxShadow: "0 2px 8px rgba(10,20,50,.05)" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>🌱</div>
                <div style={{ fontFamily: "Sora, sans-serif", fontSize: "0.95rem", fontWeight: 800, color: "#0A1628", marginBottom: 6 }}>
                  Building the benchmark pool
                </div>
                <div style={{ fontSize: "0.8rem", color: "#6B88B0", lineHeight: 1.6 }}>
                  Be among the first to submit your metrics and gain access to anonymised network benchmarks.
                </div>
                <div style={{ marginTop: 14, padding: "10px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, fontSize: "0.78rem", color: "#1D4ED8", fontWeight: 600 }}>
                  🎁 Early contributors get prioritised access
                </div>
              </div>
            ) : (
              <div style={{ background: "#FFFFFF", border: "1px solid #E8EEF8", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(10,20,50,.06)" }}>
                <div style={{ background: "linear-gradient(135deg, #F8FAFF, #EFF4FF)", padding: "14px 18px", borderBottom: "1px solid #E8EEF8" }}>
                  <div style={{ fontFamily: "Sora, sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628" }}>Network Medians</div>
                  <div style={{ fontSize: "0.68rem", color: "#6B88B0", marginTop: 2 }}>Live anonymous submissions</div>
                </div>
                {/* Vertical tabs */}
                <div style={{ display: "flex", overflowX: "auto", borderBottom: "1px solid #E8EEF8", padding: "0 8px" }}>
                  {Object.keys(grouped).slice(0, 6).map((v) => (
                    <button
                      key={v}
                      onClick={() => setActiveLeadVert(v)}
                      style={{
                        padding: "9px 14px",
                        border: "none",
                        borderBottom: `2.5px solid ${activeLeadVert === v ? "#0066FF" : "transparent"}`,
                        background: "transparent",
                        fontSize: "0.75rem",
                        fontWeight: activeLeadVert === v ? 700 : 500,
                        color: activeLeadVert === v ? "#0066FF" : "#6B88B0",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        textTransform: "capitalize",
                        transition: "color .12s",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div style={{ padding: "14px 16px" }}>
                  {activeLeadVert && grouped[activeLeadVert] &&
                    Object.entries(grouped[activeLeadVert])
                      .filter(([, m]) => m.median != null)
                      .slice(0, 6)
                      .map(([k, m]) => {
                        const meta = metaMeta(k);
                        return (
                          <div
                            key={k}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #F3F4F6" }}
                          >
                            <span style={{ width: 30, height: 30, borderRadius: 8, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", flexShrink: 0 }}>
                              {meta.icon}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "0.73rem", color: "#5A7090", textTransform: "capitalize" }}>
                                {k.replace(/_/g, " ")}
                              </div>
                              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: meta.color }}>
                                {+Number(m.median).toFixed(2)}
                              </div>
                            </div>
                            <div style={{ fontSize: "0.65rem", color: "#9BADC8", background: "#F3F6FF", borderRadius: 6, padding: "2px 6px" }}>
                              n={m.sample_count}
                            </div>
                          </div>
                        );
                      })
                  }
                  {!activeLeadVert && (
                    <div style={{ textAlign: "center", color: "#9BADC8", fontSize: "0.82rem", padding: "12px 0" }}>
                      Select a vertical above
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {result && <BenchmarkResult result={result} />}
      </div>
    </div>
  );
}

function BenchmarkResult({ result }: { result: CompareResponse }) {
  const ai = result.ai_insights || {};
  const bm = result.benchmarks || {};
  const ym = result.your_metrics || {};
  const insights = ai.insights || [];
  const keys = Object.keys({ ...ym, ...bm }).filter((k, i, a) => a.indexOf(k) === i);
  const sampleCount = Object.values(bm)[0]?.sample_count || 0;
  const above = insights.filter((i) => i.status === "above").length;
  const below = insights.filter((i) => i.status === "below").length;

  return (
    <div style={{ marginTop: 20 }}>
      {/* Summary Banner */}
      <div style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", borderRadius: 16, padding: "20px 24px", marginBottom: 16, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "Sora, sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>
            📊 Network Summary — {result.vertical}
          </div>
          <p style={{ margin: 0, color: '#475569', fontSize: "0.82rem", lineHeight: 1.6 }}>
            {ai.summary || ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <div style={{ background: "rgba(16,185,129,.2)", border: "1px solid rgba(16,185,129,.4)", borderRadius: 10, padding: "8px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#34D399", fontFamily: "Sora, sans-serif" }}>{above}</div>
            <div style={{ fontSize: "0.62rem", color: "#475569", textTransform: "uppercase" }}>Above median</div>
          </div>
          <div style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 10, padding: "8px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#F87171", fontFamily: "Sora, sans-serif" }}>{below}</div>
            <div style={{ fontSize: "0.62rem", color: "#475569", textTransform: "uppercase" }}>Below median</div>
          </div>
        </div>
      </div>

      {ai.biggest_opportunity && (
        <div style={{ background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderLeft: "4px solid #10B981", borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: "1.1rem" }}>🏆</span>
          <div>
            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#065F46", marginBottom: 3 }}>Biggest Opportunity</div>
            <div style={{ fontSize: "0.85rem", color: "#047857", lineHeight: 1.5 }}>{ai.biggest_opportunity}</div>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginBottom: 16 }}>
        {keys.map((k) => {
          const b = bm[k] || {};
          const yv = ym[k];
          const ins = insights.find((i) => i.metric === k);
          const meta = metaMeta(k);
          const statusColor = ins?.status === "above" ? "#059669" : ins?.status === "below" ? "#DC2626" : "#6B7280";
          const statusBg = ins?.status === "above" ? "#F0FDF4" : ins?.status === "below" ? "#FEF2F2" : "#F9FAFB";
          const arrow = ins?.status === "above" ? "↑" : ins?.status === "below" ? "↓" : "→";

          return (
            <div key={k} style={{ background: "#FFFFFF", border: `1px solid ${statusColor}25`, borderLeft: `3.5px solid ${statusColor}`, borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 6px rgba(10,20,50,.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 28, height: 28, background: meta.bg, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem" }}>{meta.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#0A1628", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</div>
                </div>
                <span style={{ background: statusBg, color: statusColor, fontSize: "0.68rem", fontWeight: 800, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase" }}>
                  {arrow} {ins?.status || "—"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginBottom: ins?.action || ins?.takeaway ? 10 : 0 }}>
                {[
                  { label: "You", val: yv != null ? String(yv) : "—", highlight: true },
                  { label: "P25", val: b.p25 != null ? String(+Number(b.p25).toFixed(2)) : "—", highlight: false },
                  { label: "Median", val: b.median != null ? String(+Number(b.median).toFixed(2)) : "—", highlight: false },
                  { label: "P75", val: b.p75 != null ? String(+Number(b.p75).toFixed(2)) : "—", highlight: false },
                ].map((cell) => (
                  <div key={cell.label} style={{ background: cell.highlight ? meta.bg : "#F8FAFF", borderRadius: 7, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.62rem", color: "#9BADC8", textTransform: "uppercase", letterSpacing: ".04em" }}>{cell.label}</div>
                    <div style={{ fontSize: "0.85rem", fontWeight: cell.highlight ? 800 : 600, color: cell.highlight ? meta.color : "#374B6E", marginTop: 2 }}>{cell.val}</div>
                  </div>
                ))}
              </div>

              {(ins?.action || ins?.takeaway) && (
                <div style={{ fontSize: "0.72rem", color: "#5A7090", background: "#F8FAFF", borderRadius: 7, padding: "7px 10px", lineHeight: 1.5 }}>
                  💡 {ins?.action || ins?.takeaway}
                </div>
              )}
              {ins?.gap_pct != null && (
                <div style={{ fontSize: "0.68rem", color: statusColor, fontWeight: 700, marginTop: 6 }}>
                  Gap: {ins.gap_pct > 0 ? "+" : ""}{ins.gap_pct}% vs median
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sampleCount > 0 && (
        <div style={{ fontSize: "0.72rem", color: "#9BADC8", textAlign: "center", padding: "8px 0" }}>
          Based on {sampleCount} anonymous network submissions for this vertical.
        </div>
      )}
    </div>
  );
}
