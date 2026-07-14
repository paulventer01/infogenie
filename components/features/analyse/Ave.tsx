"use client";

// Native React port of the legacy `ave` panel (was `window.buildAve` in
// `public/js/ig_brand24_suite.js` + `#view-ave` in index.html). Reads/writes
// against the existing Express API:
//   GET  /api/ave/history
//   POST /api/ave/calculate
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface HistRow {
  id: number;
  brand: string;
  period: string;
  total_ave_usd: number;
  total_mentions: number;
  created_at: string;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  rows?: HistRow[];
}
interface ChannelValue {
  mentions?: number;
  ave_usd?: number;
}
interface CalcResp {
  ok: boolean;
  error?: string;
  total_ave_usd: number;
  total_mentions: number;
  channels?: Record<string, ChannelValue>;
  methodology?: string;
}

function fmtMoney(n: number) {
  return "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtNum(n: number) {
  return Number(n || 0).toLocaleString("en-US");
}

export default function Ave() {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [brand, setBrand] = useState("");
  const [period, setPeriod] = useState("30d");
  const [industry, setIndustry] = useState("technology");
  const [result, setResult] = useState<CalcResp | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadHistory = useCallback(async () => {
    const hist = await apiGet<HistoryResp>("/api/ave/history");
    setRows(hist.rows || []);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function run() {
    const b = brand.trim();
    if (!b) return;
    const ind = industry.trim() || "technology";
    setRunning(true);
    setResult(null);
    setResultError(null);
    const d = await apiPost<CalcResp>("/api/ave/calculate", {
      brand: b,
      period,
      industry: ind,
    });
    setRunning(false);
    if (!d.ok) {
      setResultError(d.error || "");
      return;
    }
    setResult(d);
    loadHistory();
  }

  const chs = result?.channels || {};

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
              <h2 className="view-title">💵 Media Value (AVE)</h2>
              <p className="view-sub">
                Advertising Value Equivalency — estimate the dollar value of your
                earned media coverage by comparing it to what equivalent paid
                advertising would cost.
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
                <h5 className="card-title">Calculate Media Value</h5>
                <label className="form-label fw-semibold">Brand Name</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. Stripe"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <label className="form-label fw-semibold">Period</label>
                <select
                  className="form-select mb-3"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                </select>
                <label className="form-label fw-semibold">Industry</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. fintech"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  💵 Calculate AVE
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
                    <div className="text-center mb-4">
                      <div
                        style={{
                          fontSize: "2.6rem",
                          fontWeight: 700,
                          color: "#22c55e",
                        }}
                      >
                        {fmtMoney(result.total_ave_usd)}
                      </div>
                      <div className="text-muted small">
                        Advertising Value Equivalent —{" "}
                        {fmtNum(result.total_mentions)} media mentions
                      </div>
                    </div>
                    <h6>By Channel</h6>
                    {Object.entries(chs).map(([ch, v]) => (
                      <div
                        key={ch}
                        className="d-flex justify-content-between align-items-center py-2 border-bottom small"
                      >
                        <span className="text-capitalize">
                          {ch.replace(/_/g, " ")}
                        </span>
                        <span>
                          {v.mentions || 0} mentions →{" "}
                          <strong>{fmtMoney(v.ave_usd || 0)}</strong>
                        </span>
                      </div>
                    ))}
                    {result.methodology && (
                      <p className="small text-muted mt-3">{result.methodology}</p>
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
                            <th className="small">Period</th>
                            <th className="small">Total AVE</th>
                            <th className="small">Mentions</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td className="small">{r.brand}</td>
                              <td className="small">{r.period}</td>
                              <td className="small">
                                <strong>{fmtMoney(r.total_ave_usd)}</strong>
                              </td>
                              <td className="small">{fmtNum(r.total_mentions)}</td>
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
