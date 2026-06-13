"use client";

// Native React port of the legacy `sov-tracker` panel (was
// `window.buildSovTracker` + `_sov*` helpers in app.js and
// `#view-sov-tracker` in index.html). Charts time-series share of media
// mentions vs competitors against the existing Express API:
//   GET  /api/sov/targets
//   GET  /api/sov/series?brand=&days=
//   POST /api/openai            (AI Suggest)
// Renders the line chart through the legacy `window.Chart` (Chart.js loaded by
// the SPA shell) and cross-links to Crisis Radar via `lib/nav`. Pre-fills the
// preferred target from `window.analysisData` / localStorage.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

const PALETTE = ["#7C3AED", "#0891B2", "#F59E0B", "#15803D", "#B91C1C", "#1E40AF"];

interface Target {
  target_brand: string;
  snapshots: number;
}
interface TargetsResp {
  ok?: boolean;
  error?: string;
  targets?: Target[];
}
interface SeriesPoint {
  t: string;
  mentions: number;
}
interface Series {
  brand: string;
  points: SeriesPoint[];
}
interface SovRow {
  brand: string;
  total: number;
  share: number;
}
interface SeriesResp {
  ok?: boolean;
  error?: string;
  series?: Series[];
  snapshots?: number;
  sov?: SovRow[];
}
interface OpenAiResp {
  choices?: { message?: { content?: string } }[];
}

interface AnalysisData {
  url?: string;
}

type ChartCtor = new (
  ctx: CanvasRenderingContext2D,
  cfg: unknown,
) => { destroy: () => void };

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}
function getChart(): ChartCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Chart?: ChartCtor }).Chart;
}
function myDomain(): string {
  const ad = getAnalysisData();
  const raw =
    ad.url ||
    (typeof window !== "undefined" ? localStorage.getItem("ig-domain") : "") ||
    "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

export default function SovTracker() {
  const router = useRouter();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [days, setDays] = useState("30");
  const [series, setSeries] = useState<SeriesResp | null>(null);
  const [chartStatus, setChartStatus] = useState<
    "idle" | "loading" | "empty" | "error"
  >("idle");
  const [chartError, setChartError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);

  const loadSeries = useCallback(async (t: string, d: string) => {
    if (!t) return;
    setChartStatus("loading");
    setChartError("");
    setSeries(null);
    const r = await apiGet<SeriesResp>(
      `/api/sov/series?brand=${encodeURIComponent(t)}&days=${d}`,
    );
    if (!r.ok) {
      setChartStatus("error");
      setChartError(r.error || "failed");
      return;
    }
    if (!r.series || !r.series.length) {
      setSeries(r);
      setChartStatus("empty");
      return;
    }
    setSeries(r);
    setChartStatus("idle");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const t = await apiGet<TargetsResp>("/api/sov/targets");
    if (t.ok === false) {
      setError(t.error || "Failed to load Share of Voice");
      setLoading(false);
      return;
    }
    const list = t.targets || [];
    setTargets(list);
    const dom = myDomain();
    const root = dom.split(".")[0];
    const preferred = root
      ? list.find((x) => {
          const tn = x.target_brand.toLowerCase();
          return (
            tn === dom || tn.includes(root) || dom.includes(tn.split(".")[0])
          );
        })?.target_brand || ""
      : "";
    const initial = preferred || list[0]?.target_brand || "";
    setTarget(initial);
    setLoading(false);
    if (initial) loadSeries(initial, "30");
  }, [loadSeries]);

  useEffect(() => {
    load();
  }, [load]);

  // Render / destroy the Chart.js instance whenever series data changes.
  useEffect(() => {
    if (chartStatus !== "idle" || !series || !series.series || !canvasRef.current)
      return;
    const Chart = getChart();
    if (!Chart) return;

    const tsSet = new Set<string>();
    series.series.forEach((s) => s.points.forEach((p) => tsSet.add(p.t)));
    const labels = Array.from(tsSet).sort();
    const datasets = series.series.map((s, i) => {
      const map: Record<string, number> = {};
      s.points.forEach((p) => {
        map[p.t] = p.mentions;
      });
      return {
        label: s.brand,
        data: labels.map((l) => map[l] || 0),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length] + "33",
        fill: true,
        tension: 0.3,
        borderWidth: 2,
      };
    });

    if (chartRef.current) {
      try {
        chartRef.current.destroy();
      } catch {
        /* noop */
      }
    }
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels.map((l) =>
          new Date(l).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
          }),
        ),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: "Mentions per snapshot" },
          },
        },
        elements: { point: { radius: 2 } },
      },
    });

    return () => {
      if (chartRef.current) {
        try {
          chartRef.current.destroy();
        } catch {
          /* noop */
        }
        chartRef.current = null;
      }
    };
  }, [series, chartStatus]);

  async function aiSuggest() {
    const brands = targets.map((t) => t.target_brand).filter(Boolean);
    if (!brands.length) {
      window.alert("No tracked brands yet — add competitors in Crisis Radar first.");
      return;
    }
    const dom = myDomain() || "your brand";
    setAiBusy(true);
    const r = await apiPost<OpenAiResp>("/api/openai", {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `I am reviewing Share of Voice data for "${dom}". The following competitor brands are being tracked: ${brands.join(", ")}. Which single brand from this list is the most strategically important to monitor for share of voice against ${dom}? Consider factors like market overlap, brand similarity, and competitive threat. Reply with ONLY the exact brand string from the list — no explanation, no punctuation, just the domain.`,
        },
      ],
    });
    const raw = (r.choices?.[0]?.message?.content || "")
      .trim()
      .replace(/^["'.]+|["'.]+$/g, "");
    const match =
      brands.find((b) => b === raw) ||
      brands.find((b) => raw.includes(b) || b.includes(raw));
    setAiBusy(false);
    if (match) {
      setTarget(match);
      loadSeries(match, days);
    } else {
      window.alert(
        'AI suggested "' +
          raw +
          "\" but it didn't match any tracked brand. Try picking manually.",
      );
    }
  }

  const dom = useMemo(() => myDomain(), []);
  const domRoot = dom.split(".")[0];
  const isYou = useCallback(
    (b: string) => {
      if (!domRoot) return b === target;
      const bn = b.toLowerCase().replace(/^www\./, "");
      return (
        bn === dom ||
        (domRoot.length >= 3 &&
          (bn.includes(domRoot) || domRoot.includes(bn.split(".")[0])))
      );
    },
    [dom, domRoot, target],
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Share of Voice
              </div>
              <h2 className="view-title">📈 Share of Voice Tracker</h2>
              <p className="view-sub">
                Time-series share of media mentions vs your competitors.
                Snapshots are captured every 6 hours by Crisis Radar — add brands
                there to populate this chart.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>
            Loading…
          </div>
        )}
        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#B91C1C",
              padding: 16,
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && (
          <>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                marginBottom: 18,
                display: "flex",
                gap: 12,
                alignItems: "end",
                flexWrap: "wrap",
              }}
            >
              <label>
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    color: "#6B7280",
                    marginBottom: 3,
                  }}
                >
                  Tracked brand
                  <span style={{ fontWeight: 400, color: "#9CA3AF", marginLeft: 4 }}>
                    — whose media share to chart
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    style={{
                      padding: "8px 11px",
                      border: "1.5px solid #E5E7EB",
                      borderRadius: 6,
                      fontSize: "0.84rem",
                      minWidth: 200,
                    }}
                  >
                    {targets.length === 0 ? (
                      <option value="">
                        No data yet — add a brand in Crisis Radar
                      </option>
                    ) : (
                      targets.map((t) => (
                        <option key={t.target_brand} value={t.target_brand}>
                          {t.target_brand} ({t.snapshots} snapshots)
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    onClick={aiSuggest}
                    disabled={aiBusy}
                    title="Let AI pick the most strategically important competitor to focus on based on your brand"
                    style={{
                      padding: "8px 13px",
                      background: "#7C3AED",
                      border: "2px solid #7C3AED",
                      borderRadius: 6,
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      color: "#fff",
                      WebkitTextFillColor: "#fff",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textShadow: "0 1px 2px rgba(0,0,0,.4)",
                    }}
                  >
                    {aiBusy ? "⏳ Thinking…" : "✨ AI Suggest"}
                  </button>
                </div>
              </label>
              <label>
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    color: "#6B7280",
                    marginBottom: 3,
                  }}
                >
                  Window
                  <span style={{ fontWeight: 400, color: "#9CA3AF", marginLeft: 4 }}>
                    — how far back to look
                  </span>
                </div>
                <select
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  style={{
                    padding: "8px 11px",
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 6,
                    fontSize: "0.84rem",
                  }}
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </label>
              <button
                onClick={() => loadSeries(target, days)}
                style={{
                  padding: "9px 18px",
                  background: "#0891B2",
                  border: "2px solid #0891B2",
                  borderRadius: 6,
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  color: "#fff",
                  WebkitTextFillColor: "#fff",
                  cursor: "pointer",
                  textShadow: "0 1px 2px rgba(0,0,0,.5)",
                }}
              >
                📈 Load chart
              </button>
            </div>

            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 18,
                minHeight: 380,
              }}
            >
              {!target && (
                <div
                  style={{
                    textAlign: "center",
                    padding: 60,
                    color: "#9CA3AF",
                    fontSize: "0.88rem",
                  }}
                >
                  No snapshots yet. Add a brand + competitors in{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      goToView(router, "crisis-radar");
                    }}
                    style={{ color: "#7C3AED", fontWeight: 700 }}
                  >
                    Crisis Radar
                  </a>{" "}
                  and click <strong>▶ Run scan now</strong> — every scan also
                  records a Share-of-Voice snapshot.
                </div>
              )}
              {target && chartStatus === "loading" && (
                <div
                  style={{ textAlign: "center", padding: 30, color: "#6B7280" }}
                >
                  Loading…
                </div>
              )}
              {target && chartStatus === "error" && (
                <div
                  style={{
                    background: "#FEE2E2",
                    color: "#B91C1C",
                    padding: 16,
                    borderRadius: 10,
                  }}
                >
                  {chartError}
                </div>
              )}
              {target && chartStatus === "empty" && (
                <div
                  style={{ textAlign: "center", padding: 60, color: "#9CA3AF" }}
                >
                  No snapshots yet for {target}.
                </div>
              )}
              {target && chartStatus === "idle" && series && (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "Sora,sans-serif",
                        fontWeight: 800,
                      }}
                    >
                      {target} vs competitors · {series.snapshots} snapshots
                    </div>
                  </div>
                  <div
                    style={{ position: "relative", height: 360, width: "100%" }}
                  >
                    <canvas ref={canvasRef} />
                  </div>
                </>
              )}
            </div>

            {target && chartStatus === "idle" && series && series.sov && (
              <div style={{ marginTop: 18 }}>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "Sora,sans-serif",
                      fontWeight: 800,
                      marginBottom: 10,
                    }}
                  >
                    Share of Voice ({days}d)
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.86rem",
                    }}
                  >
                    <thead
                      style={{
                        background: "#F9FAFB",
                        color: "#6B7280",
                        textTransform: "uppercase",
                        fontSize: "0.62rem",
                      }}
                    >
                      <tr>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>
                          Brand
                        </th>
                        <th style={{ padding: 8, textAlign: "right" }}>
                          Mentions
                        </th>
                        <th style={{ padding: 8, textAlign: "right" }}>Share</th>
                        <th style={{ padding: 8 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {series.sov.map((s, i) => (
                        <tr
                          key={s.brand}
                          style={{ borderTop: "1px solid #F3F4F6" }}
                        >
                          <td style={{ padding: "8px 10px", fontWeight: 700 }}>
                            <span
                              style={{
                                display: "inline-block",
                                width: 12,
                                height: 12,
                                background: PALETTE[i % PALETTE.length],
                                borderRadius: 3,
                                marginRight: 6,
                                verticalAlign: "middle",
                              }}
                            />
                            {s.brand}
                            {isYou(s.brand) && (
                              <span
                                style={{
                                  background: "#0891B2",
                                  color: "#fff",
                                  fontSize: "0.6rem",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  marginLeft: 4,
                                }}
                              >
                                YOU
                              </span>
                            )}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {s.total}
                          </td>
                          <td
                            style={{
                              padding: 8,
                              textAlign: "right",
                              fontWeight: 800,
                              color: s.brand === target ? "#0891B2" : "#0A1628",
                            }}
                          >
                            {(s.share * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: "4px 10px" }}>
                            <div
                              style={{
                                background: "#F3F4F6",
                                borderRadius: 3,
                                height: 8,
                                width: 160,
                                marginLeft: "auto",
                              }}
                            >
                              <div
                                style={{
                                  background: PALETTE[i % PALETTE.length],
                                  height: "100%",
                                  borderRadius: 3,
                                  width: `${(s.share * 100).toFixed(1)}%`,
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
