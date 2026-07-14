"use client";

// Native React port of the legacy `geo-insights` panel (was
// `window.buildGeoInsights` + `#view-geo-insights` in index.html /
// public/js/ig_brand24_suite.js). Analyses regional mention share, sentiment and
// trends for a brand against the existing Express API
// (`GET /api/geo-insights/history`, `POST /api/geo-insights/scan`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiResult } from "@/lib/api";

interface HistoryRow {
  brand?: string;
  top_region?: string;
  top_region_sentiment?: string;
  created_at?: string;
}
interface HistoryResult {
  rows?: HistoryRow[];
}
interface Breakdown {
  region?: string;
  mention_share_pct?: number;
  sentiment?: string;
  trend?: string;
  key_topics?: string[];
}
interface ScanResult extends ApiResult {
  top_region?: string;
  top_region_sentiment?: string;
  breakdown?: Breakdown[];
  strategic_notes?: string[];
}

function sentColor(s?: string) {
  return s === "positive"
    ? "success"
    : s === "negative"
      ? "danger"
      : "secondary";
}
function Pill({ label, cls }: { label: string; cls: string }) {
  return <span className={"badge bg-" + cls}>{label}</span>;
}

export default function GeoInsights() {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [brand, setBrand] = useState("");
  const [regions, setRegions] = useState(
    "United States, United Kingdom, Canada, Australia, Germany, India, Brazil",
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  async function loadHistory() {
    const h = await apiGet<HistoryResult>("/api/geo-insights/history");
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
    const regionList = regions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setRunning(true);
    setError("");
    setResult(null);
    const d = await apiPost<ScanResult>("/api/geo-insights/scan", {
      brand: b,
      regions: regionList,
    });
    setRunning(false);
    if (!d.ok) {
      setError(d.error || "Failed");
      return;
    }
    setResult(d);
    loadHistory();
  }

  const bd = result?.breakdown || [];

  function HistoryTable() {
    if (!history.length) {
      return (
        <div className="text-center py-5 text-muted">
          <p>No history yet — run your first analysis above.</p>
        </div>
      );
    }
    return (
      <div className="table-responsive">
        <table className="table table-sm table-hover mb-0">
          <thead>
            <tr>
              <th className="small">Brand</th>
              <th className="small">Top Region</th>
              <th className="small">Sentiment</th>
              <th className="small">Date</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r, idx) => (
              <tr key={idx}>
                <td className="small">{r.brand ?? ""}</td>
                <td className="small">{r.top_region ?? ""}</td>
                <td className="small">
                  <Pill
                    label={r.top_region_sentiment || ""}
                    cls={sentColor(r.top_region_sentiment)}
                  />
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
    );
  }

  return (
    <div id="geoInsightsWrap">
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary"></div>
          <p className="mt-2 text-muted">Analysing with AI…</p>
        </div>
      ) : (
        <>
          <div className="row g-4">
            <div className="col-12 col-lg-4">
              <div className="card mb-4">
                <div className="card-body">
                  <h5 className="card-title">Geolocation Insights</h5>
                  <label className="form-label fw-semibold">Brand Name</label>
                  <input
                    className="form-control mb-3"
                    placeholder="e.g. Figma"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                  />
                  <label className="form-label fw-semibold">Regions</label>
                  <input
                    className="form-control mb-3"
                    placeholder="US, UK, Germany…"
                    value={regions}
                    onChange={(e) => setRegions(e.target.value)}
                  />
                  <button
                    className="btn btn-primary w-100"
                    onClick={run}
                    disabled={running}
                  >
                    🌍 Analyse Regions
                  </button>
                </div>
              </div>
            </div>
            <div className="col-12 col-lg-8">
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
                      {result.top_region ? (
                        <div className="mb-3 small">
                          <strong>{result.top_region}</strong> leads ·{" "}
                          <Pill
                            label={result.top_region_sentiment || ""}
                            cls={sentColor(result.top_region_sentiment)}
                          />{" "}
                          sentiment
                        </div>
                      ) : null}
                      <div className="table-responsive">
                        <table className="table table-sm table-hover">
                          <thead>
                            <tr>
                              <th>Region</th>
                              <th>Mention Share</th>
                              <th>Sentiment</th>
                              <th>Trend</th>
                              <th>Key Topics</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bd.map((r, idx) => (
                              <tr key={idx}>
                                <td>
                                  <strong>{r.region}</strong>
                                </td>
                                <td className="small">
                                  <div className="d-flex align-items-center gap-2">
                                    <div
                                      className="progress"
                                      style={{ height: 6, width: 60 }}
                                    >
                                      <div
                                        className="progress-bar"
                                        style={{
                                          width:
                                            Math.min(
                                              100,
                                              (r.mention_share_pct || 0) * 2,
                                            ) + "%",
                                          background: "#6366f1",
                                        }}
                                      ></div>
                                    </div>
                                    {r.mention_share_pct || 0}%
                                  </div>
                                </td>
                                <td>
                                  <Pill
                                    label={r.sentiment || "neutral"}
                                    cls={sentColor(r.sentiment)}
                                  />
                                </td>
                                <td className="small">
                                  {r.trend === "growing"
                                    ? "📈"
                                    : r.trend === "declining"
                                      ? "📉"
                                      : "→"}{" "}
                                  {r.trend || ""}
                                </td>
                                <td className="small">
                                  {(r.key_topics || []).slice(0, 3).join(", ")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {result.strategic_notes &&
                      result.strategic_notes.length ? (
                        <>
                          <h6 className="mt-3">Strategic Notes</h6>
                          <ul className="small">
                            {result.strategic_notes.map((n, idx) => (
                              <li key={idx}>{n}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-5 text-muted">
                    <p>Enter a brand and click Analyse Regions.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="card mt-4">
            <div className="card-body">
              <h5 className="card-title">History</h5>
              <div>
                <HistoryTable />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
