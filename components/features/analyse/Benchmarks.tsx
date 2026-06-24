"use client";

// Native React port of the legacy `benchmarks` panel (was
// `window.buildBenchmarks` + `#view-benchmarks` in ig_moat_features.js).
// Compares your metrics to anonymised network medians via the existing Express
// API (`GET /api/benchmarks/config`, `POST /api/benchmarks/compare`,
// `POST /api/benchmarks/submit`, `GET /api/benchmarks/leaderboard`) through
// `lib/api`. See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface MetricDef {
  key: string;
  label: string;
  unit: string;
}
interface ConfigResponse {
  ok: boolean;
  verticals?: string[];
  regions?: string[];
  sizes?: string[];
  metrics?: MetricDef[];
}
interface BenchStat {
  p25?: number;
  median?: number;
  p75?: number;
  sample_count?: number;
}
interface Insight {
  metric?: string;
  status?: string;
  gap_pct?: number;
  action?: string;
  takeaway?: string;
}
interface CompareResponse {
  ok: boolean;
  error?: string;
  vertical?: string;
  your_metrics?: Record<string, number>;
  benchmarks?: Record<string, BenchStat>;
  ai_insights?: {
    summary?: string;
    biggest_opportunity?: string;
    insights?: Insight[];
  };
}
interface SubmitResponse {
  ok: boolean;
  error?: string;
  submitted?: number;
}
interface LeaderboardRow {
  vertical: string;
  metric_key: string;
  median: number;
  sample_count: number;
}
interface LeaderboardResponse {
  ok: boolean;
  leaderboard?: LeaderboardRow[];
}

export default function Benchmarks() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [vert, setVert] = useState("");
  const [region, setRegion] = useState("");
  const [size, setSize] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);

  async function loadLeaderboard() {
    const d = await apiGet<LeaderboardResponse>("/api/benchmarks/leaderboard");
    if (d.ok && Array.isArray(d.leaderboard)) setLeaderboard(d.leaderboard);
  }

  useEffect(() => {
    void (async () => {
      const d = await apiGet<ConfigResponse>("/api/benchmarks/config");
      if (d.ok) {
        setConfig(d);
        if (d.verticals?.length) setVert(d.verticals[0]);
      }
      await loadLeaderboard();
    })();
  }, []);

  function collectMetrics(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of config?.metrics || []) {
      const v = values[m.key];
      if (v !== undefined && v !== "") out[m.key] = +v;
    }
    return out;
  }

  async function compare() {
    if (!vert) {
      alert("Select a vertical.");
      return;
    }
    setComparing(true);
    const d = await apiPost<CompareResponse>("/api/benchmarks/compare", {
      vertical: vert,
      region: region || null,
      company_size: size || null,
      your_metrics: collectMetrics(),
    });
    setComparing(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResult(d);
  }

  async function submit() {
    if (!vert) {
      alert("Select a vertical.");
      return;
    }
    const metrics = collectMetrics();
    if (!Object.keys(metrics).length) {
      alert("Enter at least one metric to contribute.");
      return;
    }
    const d = await apiPost<SubmitResponse>("/api/benchmarks/submit", {
      vertical: vert,
      region: region || null,
      company_size: size || null,
      metrics,
    });
    if (d.ok)
      alert(`✅ Contributed ${d.submitted} metric(s) anonymously. Thank you!`);
  }

  const grouped = useMemo(() => {
    const g: Record<string, Record<string, LeaderboardRow>> = {};
    for (const r of leaderboard) {
      if (!g[r.vertical]) g[r.vertical] = {};
      g[r.vertical][r.metric_key] = r;
    }
    return g;
  }, [leaderboard]);

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Benchmark Intelligence
              </div>
              <h2 className="view-title">📊 Benchmark Intelligence</h2>
              <p className="view-sub">
                See how your metrics compare to anonymised InfoGenie network
                medians for your industry, region, and company size.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <div className="ig-card" style={{ flex: 1, minWidth: 300 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 16 }}>
              Compare Your Metrics
            </h3>
            <div
              className="form-grid"
              style={{ gridTemplateColumns: "1fr 1fr" }}
            >
              <div className="form-group">
                <label>Vertical</label>
                <select
                  className="form-control"
                  value={vert}
                  onChange={(e) => setVert(e.target.value)}
                >
                  {(config?.verticals || []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Region</label>
                <select
                  className="form-control"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="">Any region</option>
                  {(config?.regions || []).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Company Size</label>
                <select
                  className="form-control"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                >
                  <option value="">Any size</option>
                  {(config?.sizes || []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 16,
              }}
            >
              {(config?.metrics || []).map((m) => (
                <div
                  key={m.key}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <label
                    style={{
                      width: 200,
                      fontSize: "0.82rem",
                      color: "#374151",
                      flexShrink: 0,
                    }}
                  >
                    {m.label}
                  </label>
                  <input
                    className="form-control"
                    style={{ maxWidth: 140 }}
                    type="number"
                    step="any"
                    placeholder={`${m.unit === "percent" ? "%" : m.unit === "multiplier" ? "x" : "$"}0`}
                    value={values[m.key] ?? ""}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [m.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={comparing}
                onClick={compare}
              >
                {comparing ? "Comparing…" : "📊 Compare vs Network"}
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: 1 }}
                title="Contribute your metrics anonymously"
                onClick={submit}
              >
                📤 Submit Metrics
              </button>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            {leaderboard.length === 0 ? (
              <div
                className="ig-card"
                style={{
                  padding: 20,
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>📊</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Building the benchmark pool
                </div>
                <div style={{ fontSize: "0.85rem" }}>
                  Be among the first to submit your metrics and gain access to
                  anonymised network benchmarks.
                </div>
              </div>
            ) : (
              <>
                <h3 style={{ fontWeight: 600, marginBottom: 8 }}>
                  Network Medians
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {Object.entries(grouped)
                    .slice(0, 5)
                    .map(([v, ms]) => (
                      <div key={v} className="ig-card" style={{ padding: 12 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            textTransform: "capitalize",
                            marginBottom: 8,
                          }}
                        >
                          {v}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 4,
                            fontSize: "0.8rem",
                          }}
                        >
                          {Object.entries(ms)
                            .slice(0, 4)
                            .filter(([, m]) => m.median != null)
                            .map(([k, m]) => (
                              <div key={k}>
                                <span style={{ color: "#6b7280" }}>
                                  {k.replace(/_/g, " ")}:{" "}
                                </span>
                                <span style={{ fontWeight: 600 }}>
                                  {+Number(m.median).toFixed(2)}
                                </span>{" "}
                                <span style={{ color: "#9ca3af" }}>
                                  (n={m.sample_count})
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>

        {result && <BenchmarkResult result={result} />}
      </div>
    </div>
  );
}

function BenchmarkResult({ result }: { result: CompareResponse }) {
  const ai = result.ai_insights || {};
  const bm = result.benchmarks || {};
  const ym = result.your_metrics || {};
  const insights = ai.insights || [];
  const keys = Object.keys({ ...ym, ...bm }).filter(
    (k, i, a) => a.indexOf(k) === i,
  );
  const sampleCount = Object.values(bm)[0]?.sample_count || 0;

  return (
    <div className="ig-card" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 8 }}>
        Network Summary — {result.vertical}
      </div>
      <p style={{ color: "#374151", marginBottom: 16 }}>{ai.summary || ""}</p>
      {ai.biggest_opportunity && (
        <div
          style={{
            background: "#eff6ff",
            borderRadius: 8,
            padding: 10,
            marginBottom: 16,
          }}
        >
          <span style={{ fontWeight: 600, color: "#3b82f6" }}>
            🏆 Biggest opportunity:{" "}
          </span>
          {ai.biggest_opportunity}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
          }}
        >
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {[
                "Metric",
                "Your Value",
                "Network P25",
                "Median",
                "P75",
                "Status",
                "Action",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    color: "#6b7280",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const b = bm[k] || {};
              const yv = ym[k];
              const ins = insights.find((i) => i.metric === k);
              const col =
                ins?.status === "above"
                  ? "#10b981"
                  : ins?.status === "below"
                    ? "#ef4444"
                    : "#6b7280";
              const arrow =
                ins?.status === "above"
                  ? "↑"
                  : ins?.status === "below"
                    ? "↓"
                    : "→";
              return (
                <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                    {k.replace(/_/g, " ")}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontWeight: 700,
                      color: col,
                    }}
                  >
                    {yv != null ? yv : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#6b7280" }}>
                    {b.p25 != null ? +Number(b.p25).toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>
                    {b.median != null ? +Number(b.median).toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#6b7280" }}>
                    {b.p75 != null ? +Number(b.p75).toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ color: col, fontWeight: 700 }}>
                      {arrow} {ins?.status || "—"}
                    </span>
                    {ins?.gap_pct ? (
                      <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        {" "}
                        ({ins.gap_pct > 0 ? "+" : ""}
                        {ins.gap_pct}%)
                      </span>
                    ) : null}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontSize: "0.8rem",
                      color: "#374151",
                      maxWidth: 200,
                    }}
                  >
                    {ins?.action || ins?.takeaway || ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sampleCount > 0 && (
        <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 8 }}>
          Based on {sampleCount} network submissions for this vertical.
        </div>
      )}
    </div>
  );
}
