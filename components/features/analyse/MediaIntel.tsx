"use client";

// Native React port of the legacy `media-intel` panel (was
// `window.buildMediaIntel` + `#view-media-intel` in index.html). Tracks press
// coverage, rising narratives, journalist targets and PR opportunities for a
// brand + competitors via the existing Express API:
//   GET  /api/media-intel/history
//   POST /api/media-intel/scan
//   GET  /api/media-intel/scan/:id
// through `lib/api`. Pre-fills the brand from the legacy `window.analysisData`
// global.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Narrative {
  narrative?: string;
  opportunity?: string;
  momentum?: number;
}
interface Story {
  category?: string;
  headline?: string;
  published?: string;
  publication?: string;
  journalist?: string;
  summary?: string;
  momentum?: number;
}
interface Journalist {
  name?: string;
  publication?: string;
  beat?: string;
  recent_angle?: string;
  twitter?: string;
}
interface Opportunity {
  type?: string;
  headline?: string;
  outlet?: string;
  urgency?: string;
}
interface ScanResult {
  ok: boolean;
  error?: string;
  rising_narratives?: Narrative[];
  stories?: Story[];
  journalist_watchlist?: Journalist[];
  media_opportunities?: Opportunity[];
}
interface HistoryRow {
  id: string;
  brand?: string;
  created_at?: string;
  summary?: string;
}
interface HistoryResult {
  ok: boolean;
  history?: HistoryRow[];
}
interface AnalysisData {
  name?: string;
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}

const CAT_COLOR: Record<string, string> = {
  product_launch: "#3B82F6",
  funding: "#10B981",
  controversy: "#EF4444",
  partnership: "#F59E0B",
  hiring: "#8B5CF6",
  award: "#F59E0B",
  regulation: "#6B7280",
  market_trend: "#0EA5E9",
};
const URG_COLOR: Record<string, string> = {
  now: "#EF4444",
  this_week: "#F59E0B",
  this_month: "#6B7280",
};

function MomBar({ m }: { m: number }) {
  return (
    <div
      style={{
        height: 4,
        background: "#E5E7EB",
        borderRadius: 2,
        marginTop: 6,
      }}
    >
      <div
        style={{
          height: 4,
          background: m > 70 ? "#EF4444" : m > 40 ? "#F59E0B" : "#10B981",
          width: `${m}%`,
          borderRadius: 2,
          transition: "width .4s",
        }}
      />
    </div>
  );
}

export default function MediaIntel() {
  const [brand, setBrand] = useState("");
  const [comps, setComps] = useState("");
  const [industry, setIndustry] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState<"empty" | "loading" | "error" | "idle">(
    "empty",
  );
  const [error, setError] = useState("");
  const [data, setData] = useState<ScanResult | null>(null);

  useEffect(() => {
    setBrand(getAnalysisData().name || "");
    (async () => {
      const r = await apiGet<HistoryResult>("/api/media-intel/history");
      if (r.ok) setHistory(r.history || []);
    })();
  }, []);

  async function refreshHistory() {
    const r = await apiGet<HistoryResult>("/api/media-intel/history");
    if (r.ok) setHistory(r.history || []);
  }

  async function runScan() {
    const b = brand.trim();
    if (!b) {
      setStatus("error");
      setError("Enter your brand name.");
      return;
    }
    const competitors = comps
      ? comps.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    setStatus("loading");
    setError("");
    setData(null);
    const r = await apiPost<ScanResult>("/api/media-intel/scan", {
      brand: b,
      competitors,
      industry: industry.trim(),
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setData(r);
    setStatus("idle");
    refreshHistory();
  }

  async function loadScan(id: string) {
    setStatus("loading");
    setError("");
    setData(null);
    const r = await apiGet<ScanResult>(`/api/media-intel/scan/${id}`);
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setData(r);
    setStatus("idle");
  }

  const darkInput: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    border: "1.5px solid rgba(255,255,255,.2)",
    borderRadius: 8,
    fontSize: "0.84rem",
    background: "rgba(255,255,255,.1)",
    color: "#fff",
    marginBottom: 8,
  };
  const darkLabel: React.CSSProperties = {
    fontSize: "0.72rem",
    fontWeight: 700,
    opacity: 0.75,
    display: "block",
    marginBottom: 4,
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Media Intelligence
              </div>
              <h2 className="view-title">📰 Media Intelligence</h2>
              <p className="view-sub">
                Real-time tracking of press coverage for your brand and
                competitors — journalists writing about your space, stories
                gaining momentum before they peak, and media opportunities to
                pitch, newsjack, or respond to before the window closes.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 20,
            maxWidth: 1100,
          }}
        >
          <div>
            <div
              style={{
                background:
                  "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
                borderRadius: 14,
                padding: 22,
                color: '#0f172a',
                marginBottom: 16,
              }}
            >
              <h3
                style={{
                  margin: "0 0 4px",
                  fontSize: "1.05rem",
                  fontWeight: 800,
                }}
              >
                📰 Media Intel Scan
              </h3>
              <p
                style={{
                  margin: "0 0 14px",
                  fontSize: "0.8rem",
                  opacity: 0.75,
                }}
              >
                Journalists, rising stories &amp; PR opportunities
              </p>
              <label style={darkLabel}>YOUR BRAND</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Acme Corp"
                style={darkInput}
              />
              <label style={darkLabel}>COMPETITORS (comma-separated)</label>
              <input
                value={comps}
                onChange={(e) => setComps(e.target.value)}
                placeholder="Competitor A, Competitor B"
                style={darkInput}
              />
              <label style={darkLabel}>INDUSTRY</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. SaaS, Fintech, eCommerce"
                style={{ ...darkInput, marginBottom: 14 }}
              />
              <button
                onClick={runScan}
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  padding: 11,
                  background: "#6D28D9",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                🔎 Run Media Scan
              </button>
            </div>
            <div
              style={{
                background: "#fff",
                border: "1.5px solid #E5E7EB",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#374151",
                  marginBottom: 10,
                }}
              >
                📋 Recent Scans
              </div>
              {!history.length ? (
                <div style={{ fontSize: "0.8rem", color: "#9CA3AF" }}>
                  No scans yet
                </div>
              ) : (
                history.slice(0, 6).map((h) => (
                  <div
                    key={h.id}
                    onClick={() => loadScan(h.id)}
                    style={{
                      padding: 9,
                      borderRadius: 8,
                      cursor: "pointer",
                      borderBottom: "1px solid #F3F4F6",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "#111",
                      }}
                    >
                      {h.brand}
                    </div>
                    <div
                      style={{ fontSize: "0.73rem", color: "#9CA3AF" }}
                    >
                      {h.created_at
                        ? new Date(h.created_at).toLocaleDateString()
                        : ""}{" "}
                      · {h.summary || ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            {status === "empty" && (
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 20px",
                  color: "#9CA3AF",
                  background: "#F9FAFB",
                  borderRadius: 14,
                  border: "2px dashed #E5E7EB",
                }}
              >
                <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📰</div>
                <div
                  style={{
                    fontWeight: 700,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  Run a media scan
                </div>
                <div style={{ fontSize: "0.82rem" }}>
                  Enter your brand name and hit scan to see press coverage,
                  journalist targets, and PR opportunities in real time
                </div>
              </div>
            )}
            {status === "loading" && (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  background: "#F8FAFC",
                  borderRadius: 12,
                  color: "#64748B",
                }}
              >
                <div style={{ fontSize: "1.8rem", marginBottom: 10 }}>⏳</div>
                <div style={{ fontSize: "0.85rem" }}>
                  Scanning news, publications and press mentions…
                  <br />
                  <span style={{ opacity: 0.7 }}>
                    Powered by Perplexity Sonar · 15–25s
                  </span>
                </div>
              </div>
            )}
            {status === "error" && (
              <div
                style={{
                  padding: 18,
                  background: "#FEE2E2",
                  color: "#B91C1C",
                  borderRadius: 10,
                }}
              >
                {error}
              </div>
            )}
            {status === "idle" && data && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                {(data.rising_narratives || []).length > 0 && (
                  <div
                    style={{
                      background: "#FEF3C7",
                      border: "1.5px solid #FDE68A",
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "#92400E",
                        textTransform: "uppercase",
                        marginBottom: 8,
                      }}
                    >
                      🔥 Rising Narratives
                    </div>
                    {(data.rising_narratives || []).map((nrt, i) => (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            color: "#78350F",
                          }}
                        >
                          {nrt.narrative}
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#92400E",
                            marginTop: 2,
                          }}
                        >
                          → {nrt.opportunity}
                        </div>
                        <MomBar m={nrt.momentum || 50} />
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    background: "#fff",
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    📰 Recent Coverage ({(data.stories || []).length} stories)
                  </div>
                  {(data.stories || []).map((s, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "10px 0",
                        borderBottom: "1px solid #F3F4F6",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                          marginBottom: 4,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              background: CAT_COLOR[s.category || ""] || "#6B7280",
                              color: "#fff",
                              padding: "1px 7px",
                              borderRadius: 3,
                              fontSize: "0.64rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              marginRight: 6,
                            }}
                          >
                            {(s.category || "").replace(/_/g, " ")}
                          </span>
                          <span
                            style={{
                              fontSize: "0.83rem",
                              fontWeight: 700,
                              color: "#111",
                            }}
                          >
                            {s.headline || ""}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#9CA3AF",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {s.published || ""}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#6B7280",
                          marginBottom: 4,
                        }}
                      >
                        <strong>{s.publication || ""}</strong>
                        {s.journalist ? ` · ${s.journalist}` : ""}
                      </div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "#374151",
                          lineHeight: 1.5,
                        }}
                      >
                        {s.summary || ""}
                      </div>
                      <MomBar m={s.momentum || 30} />
                    </div>
                  ))}
                </div>

                {(data.journalist_watchlist || []).length > 0 && (
                  <div
                    style={{
                      background: "#F5F3FF",
                      border: "1.5px solid #DDD6FE",
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "#6D28D9",
                        textTransform: "uppercase",
                        marginBottom: 10,
                      }}
                    >
                      📋 Journalist Watchlist
                    </div>
                    {(data.journalist_watchlist || []).map((j, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                          padding: "8px 0",
                          borderBottom: "1px solid #EDE9FE",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <div
                            style={{
                              fontSize: "0.85rem",
                              fontWeight: 700,
                              color: "#4C1D95",
                            }}
                          >
                            {j.name}{" "}
                            <span style={{ fontWeight: 400, color: "#7C3AED" }}>
                              @ {j.publication}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.77rem",
                              color: "#6D28D9",
                              marginTop: 2,
                            }}
                          >
                            Beat: {j.beat || ""}
                            {j.recent_angle ? ` · ${j.recent_angle}` : ""}
                          </div>
                        </div>
                        {j.twitter && (
                          <button
                            onClick={() => {
                              if (j.twitter)
                                navigator.clipboard.writeText(j.twitter);
                            }}
                            style={{
                              padding: "5px 10px",
                              background: "#EDE9FE",
                              color: "#6D28D9",
                              border: "1px solid #DDD6FE",
                              borderRadius: 6,
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            📋 {j.twitter}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {(data.media_opportunities || []).length > 0 && (
                  <div
                    style={{
                      background: "#F0FDF4",
                      border: "1.5px solid #BBF7D0",
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "#166534",
                        textTransform: "uppercase",
                        marginBottom: 10,
                      }}
                    >
                      🎯 Media Opportunities
                    </div>
                    {(data.media_opportunities || []).map((o, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 0",
                          borderBottom: "1px solid #DCFCE7",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 180 }}>
                          <span
                            style={{
                              background: "#DCFCE7",
                              color: "#166534",
                              padding: "1px 7px",
                              borderRadius: 3,
                              fontSize: "0.64rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              marginRight: 6,
                            }}
                          >
                            {o.type || ""}
                          </span>
                          <span
                            style={{
                              fontSize: "0.83rem",
                              fontWeight: 700,
                              color: "#111",
                            }}
                          >
                            {o.headline || ""}
                          </span>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "#6B7280",
                              marginTop: 2,
                            }}
                          >
                            {o.outlet || ""}
                          </div>
                        </div>
                        <span
                          style={{
                            background: URG_COLOR[o.urgency || ""] || "#6B7280",
                            color: "#fff",
                            padding: "3px 10px",
                            borderRadius: 6,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {(o.urgency || "").replace(/_/g, " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
