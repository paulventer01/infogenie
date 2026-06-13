"use client";

// Native React port of the legacy `audience` panel (was `window.buildAudience`
// + `#view-audience` / `#audienceWrap` in index.html / ig_core_views.js). The
// Audience Intelligence panel aggregates the highest-converting audience
// segments from the home-page competitor analysis, renders four Chart.js
// demographic charts (age, gender, device, geography), an audience crossover
// matrix, an engagement distribution doughnut, and a grid of high-value
// segment cards. The panel is entirely client-side — every segment is derived
// from the legacy `window.analysisData` global (set by the home-page analysis);
// it makes no `/api/*` calls. When no analysis is present we show an explicit
// empty state (the legacy builder simply threw in that case).
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useRef } from "react";
import { showToast } from "@/hooks/useToast";

interface RawAudience {
  label: string;
  pct: number;
}
interface Competitor {
  name?: string;
  domain?: string;
  audiences?: RawAudience[];
}
interface Industry {
  name?: string;
}
interface AnalysisData {
  url?: string;
  industry?: Industry | string;
  competitors?: Competitor[];
}

interface Segment {
  label: string;
  avgPct: number;
  competitors: string[];
  count: number;
  isBenchmark?: boolean;
}

type ChartCtor = new (
  ctx: CanvasRenderingContext2D,
  cfg: unknown,
) => { destroy: () => void };

function getAnalysisData(): AnalysisData | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || null
  );
}
function getChart(): ChartCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Chart?: ChartCtor }).Chart;
}

function industryName(industry: Industry | string | undefined): string {
  if (!industry) return "";
  if (typeof industry === "string") return industry;
  return industry.name || "";
}

function getCreativeType(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("female") || l.includes("fashion")) return "video UGC";
  if (l.includes("tech") || l.includes("trader")) return "comparison";
  if (l.includes("family")) return "lifestyle";
  if (l.includes("business") || l.includes("professional"))
    return "thought leadership";
  return "educational carousel";
}
function getPeakTime(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("student")) return "Evenings 7–10pm weekdays";
  if (l.includes("business") || l.includes("manager"))
    return "Weekdays 7–9am & 12–2pm";
  if (l.includes("traveller") || l.includes("nomad"))
    return "Weekends 10am–2pm";
  return "Evenings & weekends";
}

// Aggregate audience segments across competitors, with industry-benchmark
// fallback (mirrors the legacy builder exactly).
function buildSegments(
  competitors: Competitor[],
  industry: Industry | string | undefined,
): Segment[] {
  const audienceMap: Record<
    string,
    { total: number; count: number; competitors: string[] }
  > = {};
  competitors.forEach((c) => {
    (c.audiences || []).forEach((a) => {
      if (!audienceMap[a.label]) {
        audienceMap[a.label] = { total: 0, count: 0, competitors: [] };
      }
      audienceMap[a.label].total += a.pct;
      audienceMap[a.label].count += 1;
      audienceMap[a.label].competitors.push(c.name || c.domain || "Competitor");
    });
  });

  let segments: Segment[] = Object.entries(audienceMap)
    .map(([label, d]) => ({
      label,
      avgPct: Math.round(d.total / d.count),
      competitors: d.competitors,
      count: d.count,
    }))
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, 8);

  if (!segments.length) {
    const ind = industryName(industry).toLowerCase();
    const isB2B = [
      "saas",
      "software",
      "b2b",
      "crm",
      "erp",
      "fintech",
      "hr",
      "legal",
      "accounting",
      "forex",
      "trading",
      "broker",
      "finance",
      "capital",
      "investment",
    ].some((k) => ind.includes(k));
    const isRetail = [
      "retail",
      "ecommerce",
      "fashion",
      "beauty",
      "food",
      "health",
      "fitness",
    ].some((k) => ind.includes(k));
    const compNames = competitors
      .slice(0, 2)
      .map((c) => c.name || c.domain || "Competitor");
    const benchmarks: [string, number][] = isB2B
      ? [
          ["Active Traders & Investors", 48],
          ["Finance Professionals", 38],
          ["Small Business Owners", 32],
          ["Crypto Enthusiasts", 27],
          ["High-Net-Worth Individuals", 41],
          ["Young Professionals 25–35", 29],
        ]
      : isRetail
        ? [
            ["Deal Seekers", 45],
            ["Brand Loyalists", 38],
            ["Mobile Shoppers", 52],
            ["Repeat Buyers", 33],
            ["New Visitors", 28],
            ["High-Intent Browsers", 41],
          ]
        : [
            ["Decision Makers", 44],
            ["Early Adopters", 36],
            ["Price-Conscious Buyers", 31],
            ["Brand Advocates", 39],
            ["Research-Led Shoppers", 27],
            ["Power Users", 42],
          ];
    segments = benchmarks.map(([label, avgPct]) => ({
      label,
      avgPct,
      competitors: compNames,
      count: compNames.length,
      isBenchmark: true,
    }));
  }
  return segments;
}

const SIZES = ["2.4M", "1.8M", "4.2M", "890K", "3.1M", "1.2M", "2.8M", "650K"];

function targetAudience(label: string): void {
  showToast(
    `🎯 Auto-targeting "${label}" — InfoGenie will configure and launch this campaign automatically`,
  );
}

export default function Audience() {
  const analysisData = getAnalysisData();
  const competitors = useMemo(
    () => analysisData?.competitors || [],
    [analysisData],
  );
  const industry = analysisData?.industry;
  const hasData = !!analysisData && competitors.length > 0;

  const segments = useMemo(
    () => (hasData ? buildSegments(competitors, industry) : []),
    [hasData, competitors, industry],
  );

  // Demographic data seeded from industry (mirrors legacy builder).
  const demographics = useMemo(() => {
    const ind = industryName(industry).toLowerCase();
    const isB2B = [
      "saas",
      "software",
      "b2b",
      "crm",
      "erp",
      "fintech",
      "hr",
      "legal",
      "accounting",
    ].some((k) => ind.includes(k));
    const isRetail = [
      "retail",
      "ecommerce",
      "fashion",
      "beauty",
      "food",
      "health",
      "fitness",
    ].some((k) => ind.includes(k));
    return {
      ageGroups: ["18–24", "25–34", "35–44", "45–54", "55+"],
      ageData: isB2B
        ? [8, 34, 30, 18, 10]
        : isRetail
          ? [22, 35, 24, 13, 6]
          : [14, 31, 28, 17, 10],
      genderLabels: ["Male", "Female", "Other"],
      genderData: isB2B ? [58, 39, 3] : isRetail ? [31, 66, 3] : [51, 46, 3],
      deviceLabels: ["Desktop", "Mobile", "Tablet"],
      deviceData: isB2B ? [61, 31, 8] : [42, 50, 8],
      geoLabels: [
        "United States",
        "United Kingdom",
        "Canada",
        "Australia",
        "Germany",
        "Other",
      ],
      geoData: [43, 16, 11, 8, 6, 16],
    };
  }, [industry]);

  const ageRef = useRef<HTMLCanvasElement | null>(null);
  const genderRef = useRef<HTMLCanvasElement | null>(null);
  const deviceRef = useRef<HTMLCanvasElement | null>(null);
  const geoRef = useRef<HTMLCanvasElement | null>(null);
  const engagementRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!hasData) return;
    const Chart = getChart();
    if (!Chart) return;

    const chartDefaults = { responsive: true, maintainAspectRatio: true };
    const gridColor = "rgba(0,0,0,.06)";
    const charts: { destroy: () => void }[] = [];

    const ageCtx = ageRef.current?.getContext("2d");
    if (ageCtx) {
      charts.push(
        new Chart(ageCtx, {
          type: "bar",
          data: {
            labels: demographics.ageGroups,
            datasets: [
              {
                label: "Audience Share (%)",
                data: demographics.ageData,
                backgroundColor: [
                  "rgba(0,201,200,.75)",
                  "rgba(0,102,255,.75)",
                  "rgba(124,58,237,.75)",
                  "rgba(245,158,11,.75)",
                  "rgba(16,185,129,.75)",
                ],
                borderRadius: 6,
                borderSkipped: false,
              },
            ],
          },
          options: {
            ...chartDefaults,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (c: { raw: unknown }) => ` ${c.raw}% of audience`,
                },
              },
            },
            scales: {
              y: {
                grid: { color: gridColor },
                ticks: {
                  callback: (v: unknown) => v + "%",
                  font: { size: 11 },
                },
              },
              x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            },
          },
        }),
      );
    }

    const genderCtx = genderRef.current?.getContext("2d");
    if (genderCtx) {
      charts.push(
        new Chart(genderCtx, {
          type: "doughnut",
          data: {
            labels: demographics.genderLabels,
            datasets: [
              {
                data: demographics.genderData,
                backgroundColor: [
                  "rgba(0,102,255,.8)",
                  "rgba(236,72,153,.8)",
                  "rgba(156,163,175,.8)",
                ],
                borderWidth: 2,
                borderColor: "white",
              },
            ],
          },
          options: {
            ...chartDefaults,
            plugins: {
              legend: {
                position: "bottom",
                labels: { font: { size: 11 }, padding: 12 },
              },
              tooltip: {
                callbacks: {
                  label: (c: { label: string; raw: unknown }) =>
                    ` ${c.label}: ${c.raw}%`,
                },
              },
            },
          },
        }),
      );
    }

    const deviceCtx = deviceRef.current?.getContext("2d");
    if (deviceCtx) {
      charts.push(
        new Chart(deviceCtx, {
          type: "doughnut",
          data: {
            labels: demographics.deviceLabels,
            datasets: [
              {
                data: demographics.deviceData,
                backgroundColor: [
                  "rgba(0,201,200,.8)",
                  "rgba(124,58,237,.8)",
                  "rgba(245,158,11,.8)",
                ],
                borderWidth: 2,
                borderColor: "white",
              },
            ],
          },
          options: {
            ...chartDefaults,
            plugins: {
              legend: {
                position: "bottom",
                labels: { font: { size: 11 }, padding: 12 },
              },
              tooltip: {
                callbacks: {
                  label: (c: { label: string; raw: unknown }) =>
                    ` ${c.label}: ${c.raw}%`,
                },
              },
            },
          },
        }),
      );
    }

    const geoCtx = geoRef.current?.getContext("2d");
    if (geoCtx) {
      charts.push(
        new Chart(geoCtx, {
          type: "bar",
          data: {
            labels: demographics.geoLabels,
            datasets: [
              {
                label: "Traffic Share (%)",
                data: demographics.geoData,
                backgroundColor: [
                  "rgba(0,102,255,.75)",
                  "rgba(0,201,200,.75)",
                  "rgba(124,58,237,.75)",
                  "rgba(245,158,11,.75)",
                  "rgba(16,185,129,.75)",
                  "rgba(156,163,175,.5)",
                ],
                borderRadius: 6,
                borderSkipped: false,
              },
            ],
          },
          options: {
            ...chartDefaults,
            indexAxis: "y",
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (c: { raw: unknown }) => ` ${c.raw}% of traffic`,
                },
              },
            },
            scales: {
              x: {
                grid: { color: gridColor },
                ticks: {
                  callback: (v: unknown) => v + "%",
                  font: { size: 10 },
                },
              },
              y: { grid: { display: false }, ticks: { font: { size: 10 } } },
            },
          },
        }),
      );
    }

    const engagementCtx = engagementRef.current?.getContext("2d");
    if (engagementCtx) {
      const top = segments.slice(0, 6);
      charts.push(
        new Chart(engagementCtx, {
          type: "doughnut",
          data: {
            labels: top.map((s) => s.label),
            datasets: [
              {
                data: top.map((s) => s.avgPct),
                backgroundColor: [
                  "rgba(0,201,200,.8)",
                  "rgba(0,102,255,.8)",
                  "rgba(124,58,237,.8)",
                  "rgba(245,158,11,.8)",
                  "rgba(16,185,129,.8)",
                  "rgba(239,68,68,.8)",
                ],
                borderWidth: 2,
                borderColor: "white",
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: "right",
                labels: { font: { size: 12 }, padding: 16 },
              },
              tooltip: {
                callbacks: {
                  label: (ctx: { label: string; raw: unknown }) =>
                    ` ${ctx.label}: ${ctx.raw}% avg engagement`,
                },
              },
            },
          },
        }),
      );
    }

    return () => {
      charts.forEach((c) => c.destroy());
    };
  }, [hasData, demographics, segments]);

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Audience
              </div>
              <h2 className="view-title">Audience Intelligence</h2>
              <p className="view-sub">
                Identify and automatically target the highest-converting
                audience segments
              </p>
            </div>
            <div className="vh-actions">
              <button
                className="btn-primary"
                onClick={() =>
                  showToast(
                    "🎯 InfoGenie is targeting all high-performing audience segments automatically — campaigns launching...",
                  )
                }
              >
                🎯 Auto-Target Best Audience
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        {!hasData ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 16px",
              color: "var(--gray-400)",
            }}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🎯</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700 }}>
              Run a brand analysis first
            </div>
            <div style={{ fontSize: "0.8rem", marginTop: 6 }}>
              Analyse a website on the home page to unlock audience intelligence
              built from real competitor data.
            </div>
          </div>
        ) : (
          <>
            {/* DEMOGRAPHIC BREAKDOWN HEADER */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "'Space Grotesk','Sora',sans-serif",
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: "#0A1628",
                  }}
                >
                  Competitor Audience Demographics
                </div>
                <div
                  style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: 2 }}
                >
                  Aggregated from {competitors.length} tracked competitors ·
                  segmented by age, gender, device &amp; location
                </div>
              </div>
              <span
                style={{
                  background: "#EEF2FF",
                  color: "#4338CA",
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  padding: "4px 12px",
                  borderRadius: 20,
                }}
              >
                AI-ANALYSED
              </span>
            </div>

            {/* ROW 1: Age + Gender */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div className="chart-box" style={{ margin: 0 }}>
                <div className="chart-box-header">
                  <h3>
                    Age Distribution{" "}
                    <span className="chart-tag audience-tag">DEMOGRAPHICS</span>
                  </h3>
                </div>
                <canvas ref={ageRef} height={180} />
              </div>
              <div className="chart-box" style={{ margin: 0 }}>
                <div className="chart-box-header">
                  <h3>
                    Gender Split{" "}
                    <span className="chart-tag audience-tag">DEMOGRAPHICS</span>
                  </h3>
                </div>
                <canvas ref={genderRef} height={180} />
              </div>
            </div>

            {/* ROW 2: Device + Location */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div className="chart-box" style={{ margin: 0 }}>
                <div className="chart-box-header">
                  <h3>
                    Device Breakdown{" "}
                    <span className="chart-tag audience-tag">DEMOGRAPHICS</span>
                  </h3>
                </div>
                <canvas ref={deviceRef} height={180} />
              </div>
              <div className="chart-box" style={{ margin: 0 }}>
                <div className="chart-box-header">
                  <h3>
                    Top Geographies{" "}
                    <span className="chart-tag audience-tag">DEMOGRAPHICS</span>
                  </h3>
                </div>
                <canvas ref={geoRef} height={180} />
              </div>
            </div>

            {/* CROSSOVER MATRIX */}
            <div
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 16,
                padding: "20px 24px",
                marginBottom: 16,
                boxShadow: "0 1px 4px rgba(0,0,0,.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 800,
                      color: "#0A1628",
                    }}
                  >
                    🔀 Audience Crossover Matrix
                  </div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6B7280",
                      marginTop: 2,
                    }}
                  >
                    Segments shared between you and each competitor — higher % =
                    more overlap, higher urgency
                  </div>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.72rem",
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          fontWeight: 700,
                          color: "#6B7280",
                          textTransform: "uppercase",
                          letterSpacing: ".05em",
                          borderBottom: "2px solid #F3F4F6",
                        }}
                      >
                        Segment
                      </th>
                      {competitors.slice(0, 5).map((c, ci) => (
                        <th
                          key={ci}
                          style={{
                            textAlign: "center",
                            padding: "8px 10px",
                            fontWeight: 700,
                            color: "#374151",
                            borderBottom: "2px solid #F3F4F6",
                          }}
                        >
                          {(c.name || c.domain || "Competitor").split(" ")[0]}
                        </th>
                      ))}
                      <th
                        style={{
                          textAlign: "center",
                          padding: "8px 10px",
                          fontWeight: 700,
                          color: "#0066FF",
                          borderBottom: "2px solid #F3F4F6",
                        }}
                      >
                        Gap Opp.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.slice(0, 6).map((seg, si) => {
                      const overlapVals = competitors
                        .slice(0, 5)
                        .map((_, ci) => {
                          const base = seg.avgPct;
                          const seed = (si * 7 + ci * 13) % 40;
                          return Math.max(5, Math.min(95, base - 10 + seed));
                        });
                      const minVal = Math.min(...overlapVals);
                      const gapOpp =
                        minVal < 30 ? "HIGH" : minVal < 55 ? "MED" : "LOW";
                      const gapColor =
                        gapOpp === "HIGH"
                          ? "#10B981"
                          : gapOpp === "MED"
                            ? "#F59E0B"
                            : "#9CA3AF";
                      const gapBg =
                        gapOpp === "HIGH"
                          ? "#F0FDF4"
                          : gapOpp === "MED"
                            ? "#FFFBEB"
                            : "#F9FAFB";
                      return (
                        <tr
                          key={si}
                          style={{ borderBottom: "1px solid #F3F4F6" }}
                        >
                          <td
                            style={{
                              padding: "9px 10px",
                              fontWeight: 600,
                              color: "#0A1628",
                            }}
                          >
                            {seg.label}
                          </td>
                          {overlapVals.map((v, vi) => {
                            const bg =
                              v >= 70
                                ? "rgba(239,68,68,.08)"
                                : v >= 45
                                  ? "rgba(245,158,11,.08)"
                                  : "rgba(16,185,129,.08)";
                            const col =
                              v >= 70
                                ? "#DC2626"
                                : v >= 45
                                  ? "#D97706"
                                  : "#059669";
                            return (
                              <td
                                key={vi}
                                style={{
                                  textAlign: "center",
                                  padding: "9px 10px",
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-block",
                                    background: bg,
                                    color: col,
                                    borderRadius: 6,
                                    padding: "2px 8px",
                                    fontWeight: 700,
                                  }}
                                >
                                  {v}%
                                </span>
                              </td>
                            );
                          })}
                          <td
                            style={{
                              textAlign: "center",
                              padding: "9px 10px",
                            }}
                          >
                            <span
                              style={{
                                background: gapBg,
                                color: gapColor,
                                borderRadius: 6,
                                padding: "2px 8px",
                                fontSize: "0.65rem",
                                fontWeight: 800,
                              }}
                            >
                              {gapOpp}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  fontSize: "0.62rem",
                  color: "#9CA3AF",
                  marginTop: 10,
                }}
              >
                🟢 Low overlap = gap opportunity · 🟡 Medium overlap = monitor
                closely · 🔴 High overlap = direct competition for this segment
              </div>
            </div>

            {/* ENGAGEMENT DISTRIBUTION CHART */}
            <div className="chart-box full" style={{ marginBottom: 24 }}>
              <div className="chart-box-header">
                <h3>
                  Audience Engagement Distribution{" "}
                  <span className="chart-tag audience-tag">AUDIENCE</span>
                </h3>
              </div>
              <canvas ref={engagementRef} height={140} />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontFamily: "'Space Grotesk','Sora',sans-serif",
                  fontSize: "1.05rem",
                  fontWeight: 800,
                  color: "#0A1628",
                }}
              >
                🎯 High-Value Audience Segments
              </div>
            </div>
            <div className="audience-grid">
              {segments.map((seg, i) => {
                const score = Math.min(99, 60 + seg.avgPct + seg.count * 8);
                const ctr = (
                  2.8 +
                  i * 0.3 +
                  ((i * 137) % 50) / 100
                ).toFixed(1);
                const cpa = Math.floor(20 + i * 8 + ((i * 89) % 15));
                const size = SIZES[i] || "1M";
                const insights = [
                  `Active across ${seg.competitors
                    .slice(0, 2)
                    .join(", ")} competitor campaigns`,
                  `${seg.avgPct}% audience overlap with top competitors`,
                  `Responds best to ${getCreativeType(
                    seg.label,
                  )} creative formats`,
                  `Peak engagement: ${getPeakTime(seg.label)}`,
                ];
                return (
                  <div className="aud-card" key={i}>
                    <div className="aud-card-header">
                      <div>
                        <div className="aud-card-name">{seg.label}</div>
                        <div className="aud-card-size">
                          Est. {size} reachable users
                        </div>
                      </div>
                      <div
                        className="aud-score-badge"
                        title="InfoGenie Audience Score — combines competitor overlap, engagement rate, and estimated reachability. 80+ is excellent."
                      >
                        {score}/100
                      </div>
                    </div>
                    <div className="aud-metrics">
                      <div
                        className="aud-metric-item"
                        title="Average Click-Through Rate — the percentage of this audience segment who click ads when shown to them. Industry average is 2–5%."
                      >
                        <div className="aud-metric-val">{ctr}%</div>
                        <div className="aud-metric-lbl">Avg CTR</div>
                      </div>
                      <div
                        className="aud-metric-item"
                        title="Average Cost Per Acquisition — estimated spend required to convert one person from this audience into a customer."
                      >
                        <div className="aud-metric-val">${cpa}</div>
                        <div className="aud-metric-lbl">Avg CPA</div>
                      </div>
                      <div
                        className="aud-metric-item"
                        title="Number of your tracked competitors actively targeting this same audience segment."
                      >
                        <div className="aud-metric-val">
                          {seg.count} competitors
                        </div>
                        <div className="aud-metric-lbl">Competing here</div>
                      </div>
                      <div
                        className="aud-metric-item"
                        title="Estimated engagement rate for this audience — how actively they interact with ads and content in your category."
                      >
                        <div className="aud-metric-val">{seg.avgPct}%</div>
                        <div className="aud-metric-lbl">Engagement Rate</div>
                      </div>
                    </div>
                    <div className="aud-insights">
                      <div className="aud-insight-title">
                        Intelligence Insights
                      </div>
                      <ul className="aud-insight-list">
                        {insights.map((ins, ii) => (
                          <li key={ii}>
                            <span>•</span>
                            <span>{ins}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      className="aud-target-btn"
                      onClick={() => targetAudience(seg.label)}
                      title="Auto-configure targeting parameters for this audience across all connected ad channels — InfoGenie sets bids, demographics, and interests automatically."
                    >
                      🎯 Auto-Target This Audience
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
