"use client";

// Native React port of the legacy `reputation-score` panel (was
// `window.buildReputationScore` in `public/js/ig_brand24_suite.js` +
// `#view-reputation-score` in index.html). Reads/writes against the existing
// Express API:
//   GET  /api/reputation-score/history
//   POST /api/reputation-score/calculate
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface HistRow {
  id: number;
  brand: string;
  overall_score: number;
  grade: string;
  trend: string;
  created_at: string;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  rows?: HistRow[];
}
interface CalcResp {
  ok: boolean;
  error?: string;
  overall_score: number;
  grade: string;
  trend: string;
  sentiment_score: number;
  volume_score: number;
  sov_score: number;
  crisis_score: number;
  reach_score: number;
  summary?: string;
  recommendations?: string[];
}

function gradeColor(g: string) {
  return g === "A"
    ? "success"
    : g === "B"
      ? "info"
      : g === "C"
        ? "warning"
        : "danger";
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444";
  const circ = 2 * Math.PI * 66;
  const off = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  return (
    <div className="text-center mb-4">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="66" fill="none" stroke="#e5e7eb" strokeWidth="14" />
        <circle
          cx="80"
          cy="80"
          r="66"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeDasharray={circ}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90 80 80)"
        />
        <text x="80" y="76" textAnchor="middle" fontSize="34" fontWeight="700" fill={color}>
          {Math.round(score)}
        </text>
        <text x="80" y="98" textAnchor="middle" fontSize="13" fill="#6b7280">
          / 100
        </text>
      </svg>
      <div className="fw-semibold">{label}</div>
    </div>
  );
}

function Bar({ label, val }: { label: string; val: number }) {
  const pct = Math.min(100, Math.round((val / 100) * 100));
  const col = pct >= 70 ? "#22c55e" : pct >= 45 ? "#f59e0b" : "#ef4444";
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between mb-1 small">
        <span>{label}</span>
        <strong>{pct}</strong>
      </div>
      <div className="progress" style={{ height: 8 }}>
        <div className="progress-bar" style={{ width: `${pct}%`, background: col }} />
      </div>
    </div>
  );
}

export default function ReputationScore() {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [brand, setBrand] = useState("");
  const [result, setResult] = useState<CalcResp | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [initialised, setInitialised] = useState(false);

  const loadHistory = useCallback(async () => {
    const hist = await apiGet<HistoryResp>("/api/reputation-score/history");
    setRows(hist.rows || []);
    return hist.rows || [];
  }, []);

  useEffect(() => {
    (async () => {
      const r = await loadHistory();
      if (r[0] && !initialised) setBrand(r[0].brand);
      setInitialised(true);
    })();
  }, [loadHistory, initialised]);

  async function run() {
    const b = brand.trim();
    if (!b) return;
    setRunning(true);
    setResult(null);
    setResultError(null);
    const d = await apiPost<CalcResp>("/api/reputation-score/calculate", {
      brand: b,
    });
    setRunning(false);
    if (!d.ok) {
      setResultError(d.error || "");
      return;
    }
    setResult(d);
    loadHistory();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Monitor</span>{" "}
                <span className="bc-sep">›</span> Brand Intelligence
              </div>
              <h2 className="view-title">⭐ Reputation Score</h2>
              <p className="view-sub">
                A single 0–100 composite score rolling up sentiment, mention
                volume, share of voice, and crisis history into one brand health
                number.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="row g-4">
          <div className="col-12 col-lg-6">
            <div className="card mb-4">
              <div className="card-body">
                <h5 className="card-title">Calculate Reputation Score</h5>
                <p className="text-muted small">
                  Aggregates your Crisis Radar sentiment, Share of Voice, and
                  crisis incident data into a single brand health number.
                </p>
                <label className="form-label fw-semibold">Brand Name</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. Notion"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  ⭐ Calculate Score
                </button>
              </div>
            </div>
            <div>
              {running && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" />
                  <p className="mt-2 text-muted">Analysing with AI…</p>
                </div>
              )}
              {resultError && (
                <div className="alert alert-danger">{resultError}</div>
              )}
              {result && (
                <div className="card">
                  <div className="card-body">
                    <ScoreGauge score={result.overall_score} label="Reputation Score" />
                    <div className="text-center mb-3">
                      <span className={`badge bg-${gradeColor(result.grade)}`}>
                        {result.grade}
                      </span>{" "}
                      <span className="small text-muted ms-1">
                        Trend:{" "}
                        {result.trend === "up"
                          ? "📈 Improving"
                          : result.trend === "down"
                            ? "📉 Declining"
                            : "→ Stable"}
                      </span>
                    </div>
                    <Bar label="Sentiment" val={result.sentiment_score} />
                    <Bar label="Volume Trend" val={result.volume_score} />
                    <Bar label="Share of Voice" val={result.sov_score} />
                    <Bar label="Crisis Health" val={result.crisis_score} />
                    <Bar label="Reach" val={result.reach_score} />
                    {result.summary && (
                      <p className="small text-muted mt-3">
                        {result.summary.slice(0, 400)}
                      </p>
                    )}
                    {result.recommendations && result.recommendations.length > 0 && (
                      <>
                        <h6 className="mt-3">Recommendations</h6>
                        <ul className="small">
                          {result.recommendations.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col-12 col-lg-6">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">History</h5>
                <div>
                  {rows.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <p>No history yet — run your first analysis above.</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0">
                        <thead>
                          <tr>
                            <th className="small">Brand</th>
                            <th className="small">Score</th>
                            <th className="small">Grade</th>
                            <th className="small">Trend</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td className="small">{r.brand}</td>
                              <td className="small">
                                <strong
                                  style={{
                                    color:
                                      r.overall_score >= 70
                                        ? "#22c55e"
                                        : r.overall_score >= 45
                                          ? "#f59e0b"
                                          : "#ef4444",
                                  }}
                                >
                                  {r.overall_score}
                                </strong>
                              </td>
                              <td className="small">
                                <span className={`badge bg-${gradeColor(r.grade)}`}>
                                  {r.grade}
                                </span>
                              </td>
                              <td className="small">
                                {r.trend === "up"
                                  ? "📈"
                                  : r.trend === "down"
                                    ? "📉"
                                    : "→"}
                              </td>
                              <td className="small">
                                {new Date(r.created_at).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
