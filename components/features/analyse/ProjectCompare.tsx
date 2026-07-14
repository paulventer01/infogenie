"use client";

// Native React port of the legacy `project-compare` panel (was
// `window.buildProjectCompare` + `#view-project-compare` in index.html /
// public/js/ig_brand24_suite.js). Compares 2–5 brands across traffic, social,
// sentiment, mentions, SoV and authority against the existing Express API
// (`GET /api/project-compare/history`, `POST /api/project-compare/run`) via
// lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, type ApiResult } from "@/lib/api";

interface HistoryRow {
  brands?: string[];
  winner?: string;
  summary?: string;
  created_at?: string;
}
interface HistoryResult {
  rows?: HistoryRow[];
}
interface CompareRow {
  brand?: string;
  monthly_traffic?: number;
  social_following?: number;
  sentiment_positive?: number;
  brand_mentions?: number;
  sov_pct?: number;
  domain_authority?: number;
  overall_score?: number;
  [key: string]: unknown;
}
interface RunResult extends ApiResult {
  winner?: string;
  summary?: string;
  results?: CompareRow[];
}

function fmtNum(n: unknown) {
  return Number(n || 0).toLocaleString("en-US");
}

const METRIC_ROWS: {
  l: string;
  k: string;
  f: (v: number) => React.ReactNode;
}[] = [
  { l: "Monthly Traffic", k: "monthly_traffic", f: (v) => fmtNum(v) },
  { l: "Social Following", k: "social_following", f: (v) => fmtNum(v) },
  { l: "Positive Sentiment", k: "sentiment_positive", f: (v) => v + "%" },
  { l: "Brand Mentions/mo", k: "brand_mentions", f: (v) => fmtNum(v) },
  { l: "Share of Voice", k: "sov_pct", f: (v) => v + "%" },
  { l: "Domain Authority", k: "domain_authority", f: (v) => v + "/100" },
  {
    l: "Overall Score",
    k: "overall_score",
    f: (v) => <strong>{v}/100</strong>,
  },
];

export default function ProjectCompare() {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [inputs, setInputs] = useState<string[]>(["", "", ""]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");

  const placeholders = ["Your brand", "Competitor 1", "Competitor 2 (optional)"];

  async function loadHistory() {
    const h = await apiGet<HistoryResult>("/api/project-compare/history");
    setHistory(h.rows || []);
  }

  useEffect(() => {
    (async () => {
      await loadHistory();
      setLoading(false);
    })();
  }, []);

  function setInput(i: number, v: string) {
    setInputs((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  }

  function addBrand() {
    setInputs((prev) => [...prev, ""]);
  }

  async function run() {
    const brands = inputs.map((i) => i.trim()).filter(Boolean);
    if (brands.length < 2) {
      alert("Enter at least 2 brands");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    const d = await apiPost<RunResult>("/api/project-compare/run", { brands });
    setRunning(false);
    if (!d.ok) {
      setError(d.error || "Failed");
      return;
    }
    setResult(d);
    loadHistory();
  }

  const results = result?.results || [];

  return (
    <div id="projectCompareWrap">
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary"></div>
          <p className="mt-2 text-muted">Analysing with AI…</p>
        </div>
      ) : (
        <div className="row g-4">
          <div className="col-12 col-lg-4">
            <div className="card mb-4">
              <div className="card-body">
                <h5 className="card-title">Compare Brands</h5>
                <p className="small text-muted">
                  Enter 2–5 brands. We compare traffic, social, sentiment,
                  mentions, SoV, and authority side-by-side.
                </p>
                <div>
                  {inputs.map((v, i) => (
                    <input
                      key={i}
                      className="form-control mb-2 pc-in"
                      placeholder={
                        placeholders[i] || "Brand " + (i + 1)
                      }
                      value={v}
                      onChange={(e) => setInput(i, e.target.value)}
                    />
                  ))}
                </div>
                <button
                  className="btn btn-sm btn-outline-secondary mb-3"
                  onClick={addBrand}
                >
                  + Add Brand
                </button>
                <br />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  ⚖️ Compare
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
                    {result.winner ? (
                      <div className="alert alert-success mb-3">
                        <strong>🏆 Winner: {result.winner}</strong>
                        {result.summary ? (
                          <>
                            <br />
                            <span className="small">{result.summary}</span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="table-responsive">
                      <table className="table table-sm table-bordered">
                        <thead>
                          <tr>
                            <th>Metric</th>
                            {results.map((r, idx) => (
                              <th
                                key={idx}
                                className={
                                  "text-center" +
                                  (r.brand === result.winner
                                    ? " table-success"
                                    : "")
                                }
                              >
                                {r.brand}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {METRIC_ROWS.map((row) => (
                            <tr key={row.k}>
                              <td className="small fw-semibold">{row.l}</td>
                              {results.map((r, idx) => (
                                <td key={idx} className="text-center small">
                                  {row.f((r[row.k] as number) || 0)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-5 text-muted">
                  <p>Enter brands and click Compare.</p>
                </div>
              )}
            </div>
            <div className="card mt-4">
              <div className="card-body">
                <h5 className="card-title">History</h5>
                <div>
                  {history.length ? (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0">
                        <thead>
                          <tr>
                            <th className="small">Brands</th>
                            <th className="small">Winner</th>
                            <th className="small">Summary</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((r, idx) => (
                            <tr key={idx}>
                              <td className="small">
                                {(r.brands || []).join(" vs ")}
                              </td>
                              <td className="small">
                                <strong>{r.winner || ""}</strong>
                              </td>
                              <td className="small">
                                {r.summary ? (
                                  <span className="small">
                                    {(r.summary || "").slice(0, 80)}…
                                  </span>
                                ) : (
                                  ""
                                )}
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
