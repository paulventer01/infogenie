"use client";

// Native React port of the legacy `presence-score` panel (was
// `window.buildPresenceScore` in `public/js/ig_brand24_suite.js` +
// `#view-presence-score` in index.html). Reads/writes against the existing
// Express API:
//   GET  /api/presence-score/history
//   POST /api/presence-score/calculate
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface HistRow {
  id: number;
  brand: string;
  overall_score: number;
  search_presence: number;
  social_presence: number;
  news_presence: number;
  created_at: string;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  rows?: HistRow[];
}
interface CompetitorScore {
  brand: string;
  overall_score: number;
}
interface CalcResp {
  ok: boolean;
  error?: string;
  overall_score: number;
  search_presence: number;
  social_presence: number;
  news_presence: number;
  community_presence: number;
  influencer_presence: number;
  insights?: string[];
  vs_competitors?: CompetitorScore[];
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

export default function PresenceScore() {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [brand, setBrand] = useState("");
  const [comps, setComps] = useState("");
  const [result, setResult] = useState<CalcResp | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadHistory = useCallback(async () => {
    const hist = await apiGet<HistoryResp>("/api/presence-score/history");
    setRows(hist.rows || []);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function run() {
    const b = brand.trim();
    if (!b) return;
    const competitors = comps
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setRunning(true);
    setResult(null);
    setResultError(null);
    const d = await apiPost<CalcResp>("/api/presence-score/calculate", {
      brand: b,
      competitors,
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
              <h2 className="view-title">📡 Presence Score</h2>
              <p className="view-sub">
                Measure how prominent your brand is online across search, social
                media, news, communities, and influencer channels — scored out
                of 100 in each dimension.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="row g-4">
          <div className="col-12 col-lg-5">
            <div className="card mb-4">
              <div className="card-body">
                <h5 className="card-title">Calculate Presence Score</h5>
                <label className="form-label fw-semibold">Brand Name</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. HubSpot"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <label className="form-label fw-semibold">
                  Competitors (optional)
                </label>
                <input
                  className="form-control mb-3"
                  placeholder="Salesforce, Pipedrive"
                  value={comps}
                  onChange={(e) => setComps(e.target.value)}
                />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  📡 Calculate Presence
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
                    <ScoreGauge score={result.overall_score} label="Presence Score" />
                    <Bar label="Search Presence" val={result.search_presence} />
                    <Bar label="Social Media" val={result.social_presence} />
                    <Bar label="News Coverage" val={result.news_presence} />
                    <Bar label="Community" val={result.community_presence} />
                    <Bar label="Influencer" val={result.influencer_presence} />
                    {result.insights && result.insights.length > 0 && (
                      <>
                        <h6 className="mt-3">Insights</h6>
                        <ul className="small">
                          {result.insights.map((i, idx) => (
                            <li key={idx}>{i}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {result.vs_competitors && result.vs_competitors.length > 0 && (
                      <>
                        <h6 className="mt-3">vs Competitors</h6>
                        {result.vs_competitors.map((c, idx) => (
                          <div
                            key={idx}
                            className="d-flex justify-content-between small py-1 border-bottom"
                          >
                            <span>{c.brand}</span>
                            <strong>{c.overall_score}</strong>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col-12 col-lg-7">
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
                            <th className="small">Search</th>
                            <th className="small">Social</th>
                            <th className="small">News</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td className="small">{r.brand}</td>
                              <td className="small">
                                <strong>{r.overall_score}/100</strong>
                              </td>
                              <td className="small">{r.search_presence}</td>
                              <td className="small">{r.social_presence}</td>
                              <td className="small">{r.news_presence}</td>
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
