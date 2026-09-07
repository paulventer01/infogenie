"use client";

// Native React port of the legacy `social-listening` panel (was
// `window.buildSocialListening` + `#view-social-listening` in index.html). Scans
// a unified feed of brand mentions, competitor conversations and industry
// sentiment across Twitter, Reddit, LinkedIn, news and forums via the existing
// Express API (`POST /api/social-listening/feed`) through `lib/api`. Pre-fills
// the brand from the legacy `window.analysisData` global and auto-scans on load.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";

interface Mention {
  source?: string;
  author?: string;
  time_ago?: string;
  sentiment?: string;
  reach?: string;
  content?: string;
  url?: string;
}
interface Alert {
  type?: string;
  message?: string;
}
interface FeedResult {
  ok: boolean;
  error?: string;
  mentions?: Mention[];
  sentiment_summary?: { positive?: number; neutral?: number; negative?: number };
  trending_keywords?: string[];
  top_topics?: string[];
  alerts?: Alert[];
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
function safeUrl(u?: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

const SENT_COLOR: Record<string, string> = {
  positive: "#10B981",
  neutral: "#6B7280",
  negative: "#EF4444",
};
const SRC_COLOR: Record<string, string> = {
  twitter: "#1DA1F2",
  reddit: "#FF4500",
  news: "#F59E0B",
  blog: "#0284c7",
  linkedin: "#0A66C2",
  forum: "#10B981",
};

function SentBadge({ s }: { s?: string }) {
  const key = s || "neutral";
  return (
    <span
      style={{
        background:
          key === "positive"
            ? "#D1FAE5"
            : key === "negative"
              ? "#FEE2E2"
              : "#F3F4F6",
        color:
          key === "positive"
            ? "#065F46"
            : key === "negative"
              ? "#991B1B"
              : "#374151",
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: "0.68rem",
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      {key}
    </span>
  );
}

export default function SocialListening() {
  const [brand, setBrand] = useState("");
  const [keywords, setKeywords] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">(
    "empty",
  );
  const [error, setError] = useState("");
  const [data, setData] = useState<FeedResult | null>(null);
  const didAuto = useRef(false);

  async function scan(brandValue: string, kwValue: string) {
    const b = brandValue.trim();
    if (!b) {
      setStatus("error");
      setError("Enter your brand name.");
      return;
    }
    const kws = kwValue
      ? kwValue.split(",").map((k) => k.trim()).filter(Boolean)
      : [];
    setStatus("loading");
    setError("");
    setData(null);
    const r = await apiPost<FeedResult>("/api/social-listening/feed", {
      brand: b,
      keywords: kws,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setData(r);
    setStatus("idle");
  }

  useEffect(() => {
    if (didAuto.current) return;
    didAuto.current = true;
    const saved = getAnalysisData().name || "";
    if (saved) {
      setBrand(saved);
      scan(saved, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sum = data?.sentiment_summary || {};
  const sentTotal =
    (sum.positive || 0) + (sum.neutral || 0) + (sum.negative || 0) || 1;
  const pct = (s: "positive" | "neutral" | "negative") =>
    Math.round(((sum[s] || 0) / sentTotal) * 100);

  const darkInput: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    border: "1.5px solid rgba(255,255,255,.2)",
    borderRadius: 8,
    fontSize: "0.85rem",
    background: "rgba(255,255,255,.1)",
    color: "#fff",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Social Listening
              </div>
              <h2 className="view-title">👂 Social Listening</h2>
              <p className="view-sub">
                A unified feed of brand mentions, competitor conversations, and
                industry sentiment across Twitter, Reddit, LinkedIn, news, and
                forums — all in one real-time dashboard with sentiment scoring
                and trending keyword alerts.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            borderRadius: 14,
            padding: "22px 24px",
            marginBottom: 24,
            color: '#0f172a',
          }}
        >
          <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontWeight: 800 }}>
            👂 What&apos;s being said right now
          </h3>
          <p style={{ margin: "0 0 16px", fontSize: "0.82rem", opacity: 0.75 }}>
            Live sentiment monitoring across Twitter, Reddit, LinkedIn, news and
            forums
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  opacity: 0.75,
                  display: "block",
                  marginBottom: 5,
                }}
              >
                YOUR BRAND
              </label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Acme Corp"
                style={darkInput}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  opacity: 0.75,
                  display: "block",
                  marginBottom: 5,
                }}
              >
                KEYWORDS / COMPETITORS
              </label>
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && scan(brand, keywords)}
                placeholder="e.g. competitor, product name"
                style={darkInput}
              />
            </div>
            <button
              onClick={() => scan(brand, keywords)}
              disabled={status === "loading"}
              style={{
                padding: "10px 22px",
                background: "#3B82F6",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              🔍 Scan
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 24,
                background: "#F8FAFC",
                borderRadius: 12,
                color: "#64748B",
              }}
            >
              <span style={{ fontSize: "1.5rem" }}>⏳</span>
              <span>Scanning social channels… (10–20s)</span>
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
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderTop: "3px solid #3B82F6",
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                    }}
                  >
                    Mentions
                  </div>
                  <div
                    style={{
                      fontSize: "1.6rem",
                      fontWeight: 800,
                      color: "#111",
                      marginTop: 3,
                    }}
                  >
                    {(data.mentions || []).length}
                  </div>
                </div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderTop: "3px solid #10B981",
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                    }}
                  >
                    Positive
                  </div>
                  <div
                    style={{
                      fontSize: "1.6rem",
                      fontWeight: 800,
                      color: "#10B981",
                      marginTop: 3,
                    }}
                  >
                    {pct("positive")}%
                  </div>
                </div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderTop: "3px solid #EF4444",
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                    }}
                  >
                    Negative
                  </div>
                  <div
                    style={{
                      fontSize: "1.6rem",
                      fontWeight: 800,
                      color: "#EF4444",
                      marginTop: 3,
                    }}
                  >
                    {pct("negative")}%
                  </div>
                </div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderTop: "3px solid #F59E0B",
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      textTransform: "uppercase",
                    }}
                  >
                    Trending
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      color: "#92400E",
                      marginTop: 5,
                      lineHeight: 1.5,
                    }}
                  >
                    {(data.trending_keywords || []).slice(0, 3).join(" · ")}
                  </div>
                </div>
              </div>

              {(data.alerts || []).length > 0 && (
                <div
                  style={{
                    marginBottom: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {(data.alerts || []).map((a, i) => (
                    <div
                      key={i}
                      style={{
                        background: a.type === "crisis" ? "#FEF2F2" : "#FEF3C7",
                        borderLeft: `4px solid ${
                          a.type === "crisis" ? "#EF4444" : "#F59E0B"
                        }`,
                        borderRadius: 8,
                        padding: "10px 14px",
                        fontSize: "0.83rem",
                        fontWeight: 600,
                        color: a.type === "crisis" ? "#991B1B" : "#92400E",
                      }}
                    >
                      ⚡ {a.message}
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
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
                    Top Topics
                  </div>
                  {(data.top_topics || []).map((t, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          background: "#3B82F6",
                          borderRadius: "50%",
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: "0.82rem", color: "#374151" }}>
                        {t}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
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
                    Trending Keywords
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(data.trending_keywords || []).map((k, i) => (
                      <span
                        key={i}
                        style={{
                          background: "#EFF6FF",
                          color: "#1D4ED8",
                          padding: "3px 10px",
                          borderRadius: 10,
                          fontSize: "0.78rem",
                          fontWeight: 600,
                        }}
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {(data.mentions || []).map((m, i) => {
                  const url = safeUrl(m.url);
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: `4px solid ${
                          SENT_COLOR[m.sentiment || ""] || "#E5E7EB"
                        }`,
                        borderRadius: 10,
                        padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                          marginBottom: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              background: SRC_COLOR[m.source || ""] || "#6B7280",
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            {m.source}
                          </span>
                          <span
                            style={{
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              color: "#374151",
                            }}
                          >
                            {m.author || "—"}
                          </span>
                          <span
                            style={{ fontSize: "0.72rem", color: "#9CA3AF" }}
                          >
                            {m.time_ago || ""}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <SentBadge s={m.sentiment} />
                          {m.reach === "high" && (
                            <span
                              style={{
                                background: "#FEF3C7",
                                color: "#92400E",
                                padding: "2px 7px",
                                borderRadius: 4,
                                fontSize: "0.68rem",
                                fontWeight: 700,
                              }}
                            >
                              HIGH REACH
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: "0.84rem",
                          color: "#374151",
                          lineHeight: 1.5,
                        }}
                      >
                        {m.content || ""}
                      </div>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "0.75rem",
                            color: "#3B82F6",
                            textDecoration: "none",
                            marginTop: 4,
                            display: "inline-block",
                          }}
                        >
                          View post ↗
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
