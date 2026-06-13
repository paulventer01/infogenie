"use client";

// Native React port of the legacy `biz-scanner` panel (was
// `window.buildBizscanner` + `#view-biz-scanner` in ig_advanced_features.js).
// Scans for acquisition opportunities and scores each one against the existing
// Express API (`POST /api/biz-scanner/scan`, `GET /api/biz-scanner/history`)
// via `lib/api`. See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Opportunity {
  name?: string;
  category?: string;
  opportunity_score?: number;
  estimated_value?: string;
  why_interesting?: string;
  signals?: string[];
  action?: string;
}
interface ScanResults {
  market_summary?: string;
  top_pick?: string;
  opportunities?: Opportunity[];
  sector_trends?: string[];
}
interface ScanResponse {
  ok: boolean;
  error?: string;
  results?: ScanResults;
}
interface HistoryRun {
  industry?: string;
  region?: string;
  created_at?: string;
  results?: ScanResults;
}
interface HistoryResponse {
  ok: boolean;
  runs?: HistoryRun[];
}

const CAT_COLOUR: Record<string, string> = {
  struggling: "#ef4444",
  for_sale: "#3b82f6",
  growing: "#10b981",
  franchise: "#f59e0b",
};

function ScoreRing({ val, max = 100 }: { val: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, Math.round((val / max) * 100)));
  const col = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: `conic-gradient(${col} ${pct}%,#e5e7eb 0)`,
        fontSize: "1rem",
        fontWeight: 700,
        color: col,
      }}
    >
      {val}
    </div>
  );
}

export default function BizScanner() {
  const [industry, setIndustry] = useState("SaaS");
  const [region, setRegion] = useState("United States");
  const [scanType, setScanType] = useState("all");
  const [budget, setBudget] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ScanResults | null>(null);
  const [runs, setRuns] = useState<HistoryRun[]>([]);

  async function loadHistory() {
    const d = await apiGet<HistoryResponse>("/api/biz-scanner/history");
    if (d.ok && Array.isArray(d.runs)) setRuns(d.runs);
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function run() {
    setRunning(true);
    const d = await apiPost<ScanResponse>("/api/biz-scanner/scan", {
      industry: industry || "SaaS",
      region: region || "United States",
      scan_type: scanType,
      budget_range: budget,
    });
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResults(d.results || {});
    void loadHistory();
  }

  const r = results;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Business Acquisition Scanner
              </div>
              <h2 className="view-title">🔭 Business Acquisition Scanner</h2>
              <p className="view-sub">
                AI scans for struggling competitors, businesses for sale,
                growing sectors, and franchise opportunities — then scores each
                one.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          className="ig-card"
          style={{ maxWidth: 680, marginBottom: 24 }}
        >
          <div
            className="form-grid"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            <div className="form-group">
              <label>Industry / Sector</label>
              <input
                className="form-control"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Region</label>
              <input
                className="form-control"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Scan Type</label>
              <select
                className="form-control"
                value={scanType}
                onChange={(e) => setScanType(e.target.value)}
              >
                <option value="all">Full Scan (all types)</option>
                <option value="struggling">Struggling Competitors</option>
                <option value="for_sale">Businesses for Sale</option>
                <option value="growing">Fast-Growing Sectors</option>
                <option value="franchise">Franchise Opportunities</option>
              </select>
            </div>
            <div className="form-group">
              <label>Budget Range (optional)</label>
              <input
                className="form-control"
                placeholder="e.g. $100K–$2M"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={running}
            onClick={run}
          >
            {running ? "Scanning market…" : "🔭 Run Acquisition Scan"}
          </button>
        </div>

        {r && (
          <div>
            <div className="ig-card" style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: "1rem",
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Market Summary
              </div>
              <p style={{ color: "#374151" }}>{r.market_summary || ""}</p>
              {r.top_pick && (
                <div
                  style={{
                    background: "#f0fdf4",
                    borderRadius: 8,
                    padding: 10,
                    marginTop: 8,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "#10b981" }}>
                    🏆 Top Pick:{" "}
                  </span>
                  {r.top_pick}
                </div>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                gap: 16,
                marginBottom: 16,
              }}
            >
              {(r.opportunities || []).map((o, i) => {
                const col = CAT_COLOUR[o.category || ""] || "#6b7280";
                return (
                  <div
                    key={i}
                    className="ig-card"
                    style={{ borderTop: `3px solid ${col}` }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{o.name}</div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 4,
                        }}
                      >
                        <ScoreRing val={o.opportunity_score || 0} />
                        <span
                          style={{
                            fontSize: "0.7rem",
                            background: col,
                            color: "#fff",
                            borderRadius: 4,
                            padding: "1px 6px",
                          }}
                        >
                          {(o.category || "").replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#6b7280",
                        marginBottom: 6,
                      }}
                    >
                      {o.estimated_value || ""}
                    </div>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "#374151",
                        marginBottom: 8,
                      }}
                    >
                      {o.why_interesting || ""}
                    </p>
                    {!!o.signals?.length && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                          marginBottom: 8,
                        }}
                      >
                        {o.signals.map((s, si) => (
                          <span
                            key={si}
                            style={{
                              background: "#f3f4f6",
                              borderRadius: 4,
                              padding: "2px 8px",
                              fontSize: "0.75rem",
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      style={{
                        background: "#eff6ff",
                        borderRadius: 6,
                        padding: 8,
                        fontSize: "0.82rem",
                      }}
                    >
                      <span style={{ color: "#3b82f6", fontWeight: 600 }}>
                        Next step:
                      </span>{" "}
                      {o.action || ""}
                    </div>
                  </div>
                );
              })}
            </div>

            {!!r.sector_trends?.length && (
              <div className="ig-card">
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  Sector Trends
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    color: "#374151",
                    fontSize: "0.9rem",
                  }}
                >
                  {r.sector_trends.map((t, ti) => (
                    <li key={ti}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {runs.length > 0 && (
          <div>
            <h3
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "#6b7280",
                margin: "16px 0 8px",
              }}
            >
              Previous Scans
            </h3>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {runs.map((run0, i) => (
                <div
                  key={i}
                  className="ig-card"
                  style={{ padding: 12, cursor: "pointer" }}
                  onClick={() => setResults(run0.results || {})}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {run0.industry} · {run0.region}
                    </span>
                    <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                      {run0.created_at
                        ? new Date(run0.created_at).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "#374151",
                      marginTop: 2,
                    }}
                  >
                    {run0.results?.opportunities?.length || 0} opportunities
                    found
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
