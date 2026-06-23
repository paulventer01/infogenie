"use client";

// Native React port of the legacy `war-room` panel (was `window.buildWarRoom`
// in public/js/ig_advanced_features.js + `#view-war-room` in index.html).
// Predicts a competitor's next move from public signals against the existing
// Express API (`POST /api/war-room/analyse` and `GET /api/war-room/history`)
// via `lib/api`. Pre-fills the competitor picker from the legacy
// `window.analysisData` global. See `docs/react-panel-migration.md`.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
  url?: string;
  website?: string;
}
interface AnalysisData {
  competitors?: AnalysisCompetitor[];
}

interface SignalSummary {
  signal: string;
  weight: string | number;
  implication: string;
}
interface Prediction {
  confidence: number;
  timeframe: string;
  prediction: string;
  threat_level: string;
  move_type: string;
  rationale: string;
  recommended_counter: string;
  signals_summary: SignalSummary[];
}
interface RunResult {
  ok: boolean;
  error?: string;
  id?: string;
  competitor?: string;
  signals?: string[];
  prediction?: Prediction;
  created_at?: string;
}
interface HistoryRun {
  id: string;
  competitor: string;
  confidence: number;
  prediction: Prediction | string;
  created_at: string;
}
interface HistoryResult {
  ok: boolean;
  error?: string;
  runs?: HistoryRun[];
}

function norm(u: string): string {
  return String(u || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function threatColor(level: string): string {
  const l = String(level || "").toLowerCase();
  if (l === "high" || l === "critical") return "#EF4444";
  if (l === "medium" || l === "moderate") return "#F59E0B";
  return "#10B981";
}

export default function WarRoom() {
  const [competitor, setCompetitor] = useState("");
  const [domain, setDomain] = useState("");
  const [pick, setPick] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryRun[]>([]);

  const compRows = useMemo(() => {
    const ad = getAnalysisData();
    const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
    return comps
      .map((c) => {
        const d = norm(c.domain || c.url || c.website || "");
        const name = c.name || d;
        return name ? { name, d } : null;
      })
      .filter((r): r is { name: string; d: string } => !!r);
  }, []);

  async function loadHistory() {
    const r = await apiGet<HistoryResult>("/api/war-room/history");
    if (r.ok && Array.isArray(r.runs)) setHistory(r.runs);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  function onPick(v: string) {
    setPick(v);
    const row = compRows.find((r) => `${r.name}|${r.d}` === v);
    if (row) {
      setCompetitor(row.name);
      setDomain(row.d);
    }
  }

  async function runAnalyse() {
    const c = competitor.trim();
    if (!c) {
      setStatus("error");
      setError("Competitor name required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<RunResult>("/api/war-room/analyse", {
      competitor: c,
      domain: domain.trim(),
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Analysis failed");
      return;
    }
    setResult(r);
    setStatus("idle");
    loadHistory();
  }

  const p = result?.prediction;

  return (
    <div className="view-header-wrap">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .wr-ring{width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.6rem;color:#fff}
        .wr-card{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:20px;margin-bottom:16px}
        .wr-badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:0.72rem;font-weight:800;color:#fff;letter-spacing:.04em}
        .wr-sig-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #F1F5F9}
        .wr-sig-row:last-child{border-bottom:none}
        .wr-hist-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 14px;background:#fff;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:8px}
      `,
        }}
      />
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> War Room
              </div>
              <h2 className="view-title">⚔️ AI Competitor War Room</h2>
              <p className="view-sub">
                Feed in a competitor and InfoGenie predicts their next strategic
                move from public signals — with a recommended counter-play.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="wr-card">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {compRows.length > 0 && (
              <select
                value={pick}
                onChange={(e) => onPick(e.target.value)}
                style={{
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  background: "#fff",
                  minWidth: 200,
                }}
              >
                <option value="">⚡ Pick an analysed competitor…</option>
                {compRows.map((r) => (
                  <option key={`${r.name}|${r.d}`} value={`${r.name}|${r.d}`}>
                    {r.name}
                    {r.d ? ` — ${r.d}` : ""}
                  </option>
                ))}
              </select>
            )}
            <input
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder="Competitor name *"
              style={{ padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.88rem", flex: 1, minWidth: 160 }}
            />
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runAnalyse()}
              placeholder="competitor.com"
              style={{ padding: "9px 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontSize: "0.88rem", flex: 1, minWidth: 160 }}
            />
            <button
              onClick={runAnalyse}
              disabled={status === "loading"}
              style={{
                padding: "10px 22px",
                background: "#B91C1C",
                border: "2px solid #B91C1C",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              {status === "loading" ? "⏳ Analysing…" : "🔮 Predict next move"}
            </button>
          </div>
        </div>

        {status === "error" && (
          <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {status === "idle" && p && (
          <div className="wr-card">
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
              <div className="wr-ring" style={{ background: threatColor(p.threat_level) }}>
                {p.confidence}%
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900, fontSize: "1.15rem", color: "#0A1628" }}>
                    {result?.competitor}
                  </span>
                  <span className="wr-badge" style={{ background: threatColor(p.threat_level) }}>
                    {String(p.threat_level || "").toUpperCase()} THREAT
                  </span>
                  <span className="wr-badge" style={{ background: "#1E3A8A" }}>{p.move_type}</span>
                  <span style={{ fontSize: "0.78rem", color: "#6B7280", fontWeight: 700 }}>⏱ {p.timeframe}</span>
                </div>
                <div style={{ fontSize: "0.92rem", color: "#0A1628", lineHeight: 1.55 }}>{p.prediction}</div>
              </div>
            </div>

            {p.rationale && (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: "0.84rem", color: "#475569", lineHeight: 1.55 }}>
                <strong>🧠 Rationale:</strong> {p.rationale}
              </div>
            )}

            {p.recommended_counter && (
              <div style={{ background: "linear-gradient(135deg,#EFF6FF,#F5F3FF)", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: "0.86rem", color: "#1D4ED8", lineHeight: 1.55 }}>
                <strong>💡 Recommended counter:</strong> {p.recommended_counter}
              </div>
            )}

            {Array.isArray(p.signals_summary) && p.signals_summary.length > 0 && (
              <div>
                <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>📡 Signal breakdown</div>
                {p.signals_summary.map((s, i) => (
                  <div key={i} className="wr-sig-row">
                    <span style={{ background: "#1E3A5F", color: "#fff", padding: "3px 9px", borderRadius: 6, fontSize: "0.68rem", fontWeight: 800, flexShrink: 0 }}>
                      {String(s.weight)}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, color: "#0A1628", fontSize: "0.84rem" }}>{s.signal}</div>
                      <div style={{ color: "#6B7280", fontSize: "0.8rem", marginTop: 2 }}>{s.implication}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="wr-card">
            <div style={{ fontWeight: 800, color: "#0A1628", marginBottom: 12 }}>🗂 Recent predictions</div>
            {history.map((h) => (
              <div key={h.id} className="wr-hist-item">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#0A1628" }}>{h.competitor}</div>
                  <div style={{ fontSize: "0.78rem", color: "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {typeof h.prediction === "object" && h.prediction !== null
                      ? (h.prediction as Prediction).prediction
                      : String(h.prediction || "")}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 900, color: "#0066FF" }}>{h.confidence}%</div>
                  <div style={{ fontSize: "0.68rem", color: "#9CA3AF" }}>
                    {h.created_at ? new Date(h.created_at).toLocaleDateString() : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
