"use client";

// Native React port of the legacy `anomaly-detector` panel (was
// `window.buildAnomalyDetector` in `public/js/ig_brand24_suite.js` +
// `#view-anomaly-detector` in index.html). Reads/writes against the existing
// Express API:
//   GET   /api/anomaly-detector/history
//   POST  /api/anomaly-detector/scan
//   PATCH /api/anomaly-detector/:id/resolve
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

interface HistRow {
  id: number;
  brand: string;
  anomaly_type?: string;
  severity: string;
  spike_factor?: number;
  resolved?: boolean;
  created_at: string;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  rows?: HistRow[];
}
interface ScanResp {
  ok: boolean;
  error?: string;
  severity?: string;
  anomaly_type?: string;
  spike_factor?: number;
  ai_explanation?: string;
  recommended_action?: string;
  affected_channels?: string[];
}

function sevColor(s: string) {
  return s === "critical"
    ? "danger"
    : s === "high"
      ? "warning"
      : s === "medium"
        ? "info"
        : "secondary";
}

export default function AnomalyDetector() {
  const [rows, setRows] = useState<HistRow[]>([]);
  const [brand, setBrand] = useState("");
  const [result, setResult] = useState<ScanResp | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadHistory = useCallback(async () => {
    const hist = await apiGet<HistoryResp>("/api/anomaly-detector/history");
    setRows(hist.rows || []);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function resolve(id: number) {
    await apiPatch(`/api/anomaly-detector/${id}/resolve`);
    loadHistory();
  }

  async function run() {
    const b = brand.trim();
    if (!b) return;
    setRunning(true);
    setResult(null);
    setResultError(null);
    const d = await apiPost<ScanResp>("/api/anomaly-detector/scan", { brand: b });
    setRunning(false);
    if (!d.ok) {
      setResultError(d.error || "");
      return;
    }
    setResult(d);
    loadHistory();
  }

  const histRows = rows.filter((r) => r.severity !== "none");
  const openRows = rows.filter((r) => r.severity !== "none" && !r.resolved);

  const sev = result?.severity || "none";
  const sevCls =
    ({ critical: "danger", high: "warning", medium: "info", none: "success" } as Record<
      string,
      string
    >)[sev] || "secondary";

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
              <h2 className="view-title">🔍 AI Anomaly Detector</h2>
              <p className="view-sub">
                Automatically detect sudden spikes or drops in your brand&apos;s
                mention volume or sentiment — with AI explaining the cause and
                recommending your next move.
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
                <h5 className="card-title">Scan for Anomalies</h5>
                <p className="small text-muted">
                  Uses your Crisis Radar data to detect statistical spikes — AI
                  explains what caused it.
                </p>
                <label className="form-label fw-semibold">Brand Name</label>
                <input
                  className="form-control mb-3"
                  placeholder="e.g. Acme Corp"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
                <button
                  className="btn btn-primary w-100"
                  onClick={run}
                  disabled={running}
                >
                  🔍 Scan Now
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
                    <div className="mb-3">
                      <span className={`badge bg-${sevCls}`}>
                        {sev === "none" ? "✅ All Clear" : sev.toUpperCase()}
                      </span>
                      {sev !== "none" && (
                        <span className="small ms-2">
                          <span className="badge bg-light">
                            {(result.anomaly_type || "").replace(/_/g, " ")}
                          </span>
                        </span>
                      )}
                    </div>
                    {sev !== "none" && (
                      <div className="small mb-2">
                        <strong>Spike factor:</strong>{" "}
                        {result.spike_factor || 1}× baseline
                      </div>
                    )}
                    <p className="small">{result.ai_explanation}</p>
                    {result.recommended_action && (
                      <div className="alert alert-light small mt-2">
                        <strong>Action:</strong> {result.recommended_action}
                      </div>
                    )}
                    {result.affected_channels &&
                      result.affected_channels.length > 0 && (
                        <div className="small text-muted">
                          Channels flagged: {result.affected_channels.join(", ")}
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col-12 col-lg-7">
            {openRows.length > 0 && (
              <div className="alert alert-warning mb-3">
                <strong>
                  {openRows.length} open{" "}
                  {openRows.length > 1 ? "anomalies" : "anomaly"} detected
                </strong>
              </div>
            )}
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">Detection History</h5>
                <div>
                  {histRows.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <p>No history yet — run your first analysis above.</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0">
                        <thead>
                          <tr>
                            <th className="small">Brand</th>
                            <th className="small">Type</th>
                            <th className="small">Severity</th>
                            <th className="small">Spike</th>
                            <th className="small">Status</th>
                            <th className="small">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {histRows.map((r) => (
                            <tr key={r.id}>
                              <td className="small">{r.brand}</td>
                              <td className="small">
                                {(r.anomaly_type || "").replace(/_/g, " ")}
                              </td>
                              <td className="small">
                                <span className={`badge bg-${sevColor(r.severity)}`}>
                                  {r.severity}
                                </span>
                              </td>
                              <td className="small">{(r.spike_factor || 1)}x</td>
                              <td className="small">
                                {r.resolved ? (
                                  <span className="badge bg-success">Resolved</span>
                                ) : (
                                  <button
                                    className="btn btn-xs btn-outline-success btn-sm"
                                    onClick={() => resolve(r.id)}
                                  >
                                    Resolve
                                  </button>
                                )}
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
