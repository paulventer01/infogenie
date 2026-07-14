"use client";

// Native React port of the legacy `intent-radar` panel (was
// `window.buildIntentRadar` in `public/js/ig_brand24_suite.js` +
// `#view-intent-radar` in index.html). Reads/writes against the existing
// Express API:
//   GET  /api/intent-radar/history
//   POST /api/intent-radar/scan
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface HistRow {
  id: number;
  brand: string;
  total_signals: number;
  ready_to_buy: number;
  comparing: number;
  churned: number;
  created_at: string;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  rows?: HistRow[];
}
interface Signal {
  intent_stage?: string;
  platform?: string;
  excerpt?: string;
  opportunity?: string;
}
interface ScanResp {
  ok: boolean;
  error?: string;
  total_signals?: number;
  early_research?: number;
  comparing?: number;
  ready_to_buy?: number;
  churned?: number;
  top_opportunity?: string;
  signals?: Signal[];
}

function Bar({ label, val, max }: { label: string; val: number; max: number }) {
  const pct = Math.min(100, Math.round((val / max) * 100));
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

function stagePill(stage: string) {
  const cls =
    stage === "ready_to_buy"
      ? "success"
      : stage === "churned"
        ? "danger"
        : "warning";
  return <span className={`badge bg-${cls}`}>{stage.replace(/_/g, " ")}</span>;
}

export default function IntentRadar() {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [brand, setBrand] = useState("");
  const [comps, setComps] = useState("");
  const [result, setResult] = useState<ScanResp | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadHistory = useCallback(async () => {
    const hist = await apiGet<HistoryResp>("/api/intent-radar/history");
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
    const d = await apiPost<ScanResp>("/api/intent-radar/scan", {
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

  const total = result?.total_signals || 0;
  const barMax = Math.max(1, total);

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Monitor</span>{" "}
                <span className="bc-sep">›</span> Brand Intelligence
              </div>
              <h2 className="view-title">🎯 Intent Radar</h2>
              <p className="view-sub">
                Scan online conversations to find people showing purchase intent
                for your brand or category — from early research to ready-to-buy
                signals.
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
                <h5 className="card-title">Scan Intent Signals</h5>
                <p className="small text-muted">
                  Scans online forums, Reddit, and social media to find people
                  actively researching or about to buy.
                </p>
                <label className="form-label fw-semibold">Your Brand</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. Notion"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <label className="form-label fw-semibold">
                  Competitors (optional)
                </label>
                <input
                  className="form-control mb-3"
                  placeholder="Obsidian, Roam Research"
                  value={comps}
                  onChange={(e) => setComps(e.target.value)}
                />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  🎯 Scan Intent Signals
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
                    <div className="small mb-3">
                      <strong>{result.total_signals || 0}</strong> intent signals
                      found
                    </div>
                    <Bar label="Early Research" val={result.early_research || 0} max={barMax} />
                    <Bar label="Comparing Options" val={result.comparing || 0} max={barMax} />
                    <Bar label="Ready to Buy" val={result.ready_to_buy || 0} max={barMax} />
                    <Bar label="At Risk / Churning" val={result.churned || 0} max={barMax} />
                    {result.top_opportunity && (
                      <div className="alert alert-info mt-3 small">
                        <strong>Top Opportunity:</strong> {result.top_opportunity}
                      </div>
                    )}
                    {result.signals && result.signals.length > 0 && (
                      <>
                        <h6 className="mt-3">Signal Feed</h6>
                        {result.signals.slice(0, 5).map((s, idx) => (
                          <div key={idx} className="border rounded p-2 mb-2 small">
                            {stagePill(s.intent_stage || "")}{" "}
                            <span className="badge bg-secondary">
                              {s.platform || ""}
                            </span>
                            <p className="mt-1 mb-0">{s.excerpt || ""}</p>
                            {s.opportunity && (
                              <em className="text-muted">{s.opportunity}</em>
                            )}
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
                            <th className="small">Signals</th>
                            <th className="small">Ready to Buy</th>
                            <th className="small">Comparing</th>
                            <th className="small">At Risk</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td className="small">{r.brand}</td>
                              <td className="small">{r.total_signals}</td>
                              <td className="small">
                                <strong className="text-success">
                                  {r.ready_to_buy}
                                </strong>
                              </td>
                              <td className="small">{r.comparing}</td>
                              <td className="small">
                                <span className="text-danger">{r.churned}</span>
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
