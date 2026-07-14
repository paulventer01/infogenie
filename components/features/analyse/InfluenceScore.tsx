"use client";

// Native React port of the legacy `influence-score` panel (was
// `window.buildInfluenceScore` + `#view-influence-score` in index.html /
// public/js/ig_brand24_suite.js). Ranks the sources mentioning a brand by
// authority, follower count and engagement against the existing Express API
// (`GET /api/influence-score/history`, `POST /api/influence-score/analyse`) via
// lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiResult } from "@/lib/api";

interface HistoryRow {
  brand?: string;
  top_source?: string;
  top_source_score?: number;
  total_potential_reach?: number;
  created_at?: string;
}
interface HistoryResult {
  rows?: HistoryRow[];
}
interface Source {
  name?: string;
  platform?: string;
  type?: string;
  influence_score?: number;
  estimated_reach?: number;
}
interface AnalyseResult extends ApiResult {
  total_potential_reach?: number;
  insight?: string;
  sources?: Source[];
}

function fmtNum(n: unknown) {
  return Number(n || 0).toLocaleString("en-US");
}

export default function InfluenceScore() {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [brand, setBrand] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyseResult | null>(null);
  const [error, setError] = useState("");

  async function loadHistory() {
    const h = await apiGet<HistoryResult>("/api/influence-score/history");
    setHistory(h.rows || []);
  }

  useEffect(() => {
    (async () => {
      await loadHistory();
      setLoading(false);
    })();
  }, []);

  async function run() {
    const b = brand.trim();
    if (!b) return;
    setRunning(true);
    setError("");
    setResult(null);
    const d = await apiPost<AnalyseResult>("/api/influence-score/analyse", {
      brand: b,
    });
    setRunning(false);
    if (!d.ok) {
      setError(d.error || "Failed");
      return;
    }
    setResult(d);
    loadHistory();
  }

  const sortedSources = (result?.sources || [])
    .slice()
    .sort((a, b) => (b.influence_score || 0) - (a.influence_score || 0));

  return (
    <div id="influenceScoreWrap">
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary"></div>
          <p className="mt-2 text-muted">Analysing with AI…</p>
        </div>
      ) : (
        <div className="row g-4">
          <div className="col-12 col-lg-5">
            <div className="card mb-4">
              <div className="card-body">
                <h5 className="card-title">Score Mention Sources</h5>
                <p className="small text-muted">
                  Ranks every source mentioning your brand by authority, follower
                  count, and engagement.
                </p>
                <label className="form-label fw-semibold">Brand Name</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. Linear"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  🏆 Score Sources
                </button>
              </div>
            </div>
            <div>
              {running ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary"></div>
                  <p className="mt-2 text-muted">Analysing with AI…</p>
                </div>
              ) : error ? (
                <div className="alert alert-danger">{error}</div>
              ) : result ? (
                <div className="card">
                  <div className="card-body">
                    <div className="small mb-2">
                      <strong>Total potential reach: </strong>
                      {fmtNum(result.total_potential_reach)}
                    </div>
                    {result.insight ? (
                      <p className="small text-muted mb-3">{result.insight}</p>
                    ) : null}
                    <div className="table-responsive">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Source</th>
                            <th>Type</th>
                            <th>Score</th>
                            <th>Reach</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedSources.map((s, idx) => (
                            <tr key={idx}>
                              <td>
                                <strong>{s.name || ""}</strong>
                                <br />
                                <span className="small text-muted">
                                  {s.platform || ""}
                                </span>
                              </td>
                              <td>
                                <span className="badge bg-secondary">
                                  {s.type || ""}
                                </span>
                              </td>
                              <td>
                                <div className="d-flex align-items-center gap-2 small">
                                  <div
                                    className="progress flex-grow-1"
                                    style={{ height: 6, minWidth: 50 }}
                                  >
                                    <div
                                      className="progress-bar bg-primary"
                                      style={{
                                        width: (s.influence_score || 0) + "%",
                                      }}
                                    ></div>
                                  </div>
                                  <strong>{s.influence_score || 0}</strong>
                                </div>
                              </td>
                              <td className="small">
                                {fmtNum(s.estimated_reach)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="col-12 col-lg-7">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">History</h5>
                <div>
                  {history.length ? (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0">
                        <thead>
                          <tr>
                            <th className="small">Brand</th>
                            <th className="small">Top Source</th>
                            <th className="small">Score</th>
                            <th className="small">Total Reach</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((r, idx) => (
                            <tr key={idx}>
                              <td className="small">{r.brand ?? ""}</td>
                              <td className="small">{r.top_source ?? ""}</td>
                              <td className="small">
                                <strong>{r.top_source_score}/100</strong>
                              </td>
                              <td className="small">
                                {fmtNum(r.total_potential_reach)}
                              </td>
                              <td className="small">
                                {r.created_at
                                  ? new Date(r.created_at).toLocaleDateString()
                                  : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-5 text-muted">
                      <p>No history yet — run your first analysis above.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
