"use client";

// Native React port of the legacy `content-score` panel (was
// `window.buildContentScore` + `#view-content-score` in index.html, originally
// in public/js/ig_content_traffic.js). Scores any page across 8 on-page signals
// and generates AI fixes for failing subscores against the existing Express API
// (`POST /api/content-score/score`, `/api/content-score/auto-optimize`,
// `/api/content-score/fix`) via `lib/api`. Pre-fills the URL from the legacy
// `window._currentAnalysis` / `window.analysisData` SPA globals.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";

interface Subscore {
  score: number;
  max: number;
  status: "pass" | "warn" | "fail";
  label: string;
  detail?: string;
  fix?: string;
}

interface ScoreResult {
  ok: boolean;
  error?: string;
  score: number;
  url: string;
  keyword?: string;
  signals?: {
    wordCount?: number;
    h1Count?: number;
    h2Count?: number;
    schemaTypes?: string[];
  };
  breakdown: Record<string, Subscore>;
}

interface FixResult {
  ok: boolean;
  error?: string;
  suggestion?: string;
  example?: string;
}

interface AutoOptFix {
  label: string;
  suggestion: string;
  example?: string;
}
interface AutoOptResult {
  ok: boolean;
  error?: string;
  fixes?: Record<string, AutoOptFix>;
}

const SUBSCORE_ORDER = [
  "keyTerms",
  "metaTags",
  "contentDepth",
  "headings",
  "featuredSnippet",
  "schema",
  "links",
  "images",
];
const STATUS_ICON: Record<string, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
};

function statusColor(s: string): string {
  return s === "pass" ? "#10B981" : s === "warn" ? "#F59E0B" : "#EF4444";
}

function getPrefillUrl(): string {
  if (typeof window === "undefined") return "";
  const w = window as unknown as {
    _currentAnalysis?: { url?: string };
    analysisData?: { url?: string };
  };
  return (w._currentAnalysis?.url || w.analysisData?.url || "").trim();
}

export default function ContentScore() {
  const [url, setUrl] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  // Per-subscore "Fix It" panels.
  const [fixes, setFixes] = useState<Record<string, string>>({});
  // Auto-Optimize report.
  const [autoOpt, setAutoOpt] = useState<AutoOptResult | null>(null);
  const [autoOptStatus, setAutoOptStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [autoOptError, setAutoOptError] = useState("");

  useEffect(() => {
    const pre = getPrefillUrl();
    if (pre) {
      setUrl(pre);
      setPrefilled(true);
    }
  }, []);

  async function analyze() {
    const u = url.trim();
    if (!u) {
      setStatus("error");
      setError("⚠ URL is required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    setFixes({});
    setAutoOpt(null);
    setAutoOptStatus("idle");
    const r = await apiPost<ScoreResult>("/api/content-score/score", {
      url: u,
      keyword: keyword.trim(),
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  async function fixIt(key: string) {
    if (!result) return;
    const b = result.breakdown[key];
    if (!b) return;
    setFixes((f) => ({ ...f, [key]: "⏳ Generating AI fix…" }));
    const res = await apiPost<FixResult>("/api/content-score/fix", {
      subscore: b.label,
      detail: b.detail,
      keyword: result.keyword,
      pageTitle: "",
    });
    if (!res.ok || !res.suggestion) {
      setFixes((f) => ({
        ...f,
        [key]: b.fix || "No AI suggestion available",
      }));
      return;
    }
    const text = res.example
      ? `AI Suggestion: ${res.suggestion}\n\n${res.example}`
      : `AI Suggestion: ${res.suggestion}`;
    setFixes((f) => ({ ...f, [key]: text }));
  }

  async function autoOptimize() {
    if (!result) return;
    setAutoOptStatus("loading");
    setAutoOptError("");
    setAutoOpt(null);
    const res = await apiPost<AutoOptResult>(
      "/api/content-score/auto-optimize",
      { url: url.trim() || result.url, keyword: result.keyword },
    );
    if (!res.ok) {
      setAutoOptStatus("error");
      setAutoOptError(res.error || "failed");
      return;
    }
    setAutoOpt(res);
    setAutoOptStatus("idle");
  }

  const score = result?.score || 0;
  const scoreColor = score >= 80 ? "#10B981" : score >= 55 ? "#F59E0B" : "#EF4444";
  const scoreBg = score >= 80 ? "#ECFDF5" : score >= 55 ? "#FFFBEB" : "#FEF2F2";

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Content Score
              </div>
              <h2 className="view-title">📊 Content Score Auto-Optimize</h2>
              <p className="view-sub">
                Score any page across 8 on-page signals — keyword usage, meta
                tags, content depth, headings, featured-snippet eligibility,
                schema, links and images — then let AI generate a precise fix for
                every failing subscore in one click.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <h3
            style={{
              margin: "0 0 12px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            📊 Content Score Analyzer
          </h3>
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
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                PAGE URL
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
                placeholder="https://yoursite.com/blog/post"
                style={{
                  width: "100%",
                  padding: 8,
                  border: "1.5px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  boxSizing: "border-box",
                  background: prefilled ? "#F0FDF4" : "#fff",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                TARGET KEYWORD{" "}
                <span style={{ color: "#9CA3AF", fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
                placeholder="e.g. email marketing software"
                style={{
                  width: "100%",
                  padding: 8,
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={analyze}
              disabled={status === "loading"}
              style={{
                padding: "9px 20px",
                background: "linear-gradient(135deg,#7C3AED,#0EA5E9)",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Analyze
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF", padding: "20px 0" }}>
              ⏳ Fetching page and scoring…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                borderRadius: 8,
                padding: 14,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ textAlign: "center", minWidth: 90 }}>
                    <div
                      style={{
                        fontSize: "2.8rem",
                        fontWeight: 900,
                        color: scoreColor,
                        lineHeight: 1,
                      }}
                    >
                      {score}
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "#6B7280",
                        fontWeight: 700,
                        marginTop: 2,
                      }}
                    >
                      / 100
                    </div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 800,
                        padding: "2px 10px",
                        borderRadius: 10,
                        background: scoreBg,
                        color: scoreColor,
                        marginTop: 4,
                      }}
                    >
                      {score >= 80
                        ? "STRONG"
                        : score >= 55
                          ? "NEEDS WORK"
                          : "CRITICAL"}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div
                      style={{
                        height: 10,
                        background: "#E5E7EB",
                        borderRadius: 10,
                        overflow: "hidden",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${score}%`,
                          background: scoreColor,
                          borderRadius: 10,
                          transition: "width .4s",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#374151" }}>
                      Signals: {result.signals?.wordCount || 0} words ·{" "}
                      {result.signals?.h1Count || 0}×H1 ·{" "}
                      {result.signals?.h2Count || 0}×H2 · Schema:{" "}
                      {(result.signals?.schemaTypes || []).length} types
                    </div>
                    {result.keyword && (
                      <div
                        style={{
                          fontSize: "0.72rem",
                          color: "#6B7280",
                          marginTop: 3,
                        }}
                      >
                        Keyword: <strong>&quot;{result.keyword}&quot;</strong>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={autoOptimize}
                    disabled={autoOptStatus === "loading"}
                    style={{
                      padding: "9px 18px",
                      background: "linear-gradient(135deg,#10B981,#0EA5E9)",
                      border: "none",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: "0.82rem",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {autoOptStatus === "loading"
                      ? "⏳ Optimizing…"
                      : "⚡ Auto-Optimize All"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {SUBSCORE_ORDER.map((k) => {
                  const b = result.breakdown[k];
                  if (!b) return null;
                  const pct = Math.round((b.score / b.max) * 100);
                  const c = statusColor(b.status);
                  return (
                    <div
                      key={k}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 9,
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: "1rem" }}>
                          {STATUS_ICON[b.status] || "⚪"}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: "0.84rem",
                                fontWeight: 700,
                                color: "#0A1628",
                              }}
                            >
                              {b.label}
                            </span>
                            <span
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 800,
                                color: c,
                              }}
                            >
                              {b.score}/{b.max}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 5,
                              background: "#F3F4F6",
                              borderRadius: 5,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${pct}%`,
                                background: c,
                                borderRadius: 5,
                              }}
                            />
                          </div>
                          {b.detail && (
                            <div
                              style={{
                                fontSize: "0.72rem",
                                color: "#6B7280",
                                marginTop: 4,
                              }}
                            >
                              {b.detail}
                            </div>
                          )}
                        </div>
                        {b.status !== "pass" && (
                          <button
                            onClick={() => fixIt(k)}
                            style={{
                              flexShrink: 0,
                              padding: "5px 12px",
                              background: "#EDE9FE",
                              border: "none",
                              borderRadius: 5,
                              color: "#7C3AED",
                              fontSize: "0.7rem",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            🔧 Fix It
                          </button>
                        )}
                      </div>
                      {fixes[k] && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: 10,
                            background: "#F9FAFB",
                            border: "1px solid #E5E7EB",
                            borderRadius: 7,
                            fontSize: "0.78rem",
                            color: "#374151",
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {fixes[k]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 14 }}>
                {autoOptStatus === "loading" && (
                  <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>
                    ⏳ Running AI fixes on all failing subscores…
                  </div>
                )}
                {autoOptStatus === "error" && (
                  <div style={{ color: "#991B1B" }}>{autoOptError}</div>
                )}
                {autoOptStatus === "idle" &&
                  autoOpt &&
                  (Object.entries(autoOpt.fixes || {}).length === 0 ? (
                    <div style={{ color: "#10B981", fontSize: "0.82rem" }}>
                      ✅ All subscores passing — nothing to fix!
                    </div>
                  ) : (
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
                          fontSize: "0.86rem",
                          fontWeight: 800,
                          color: "#0A1628",
                          marginBottom: 12,
                        }}
                      >
                        ⚡ Auto-Optimization Report
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {Object.entries(autoOpt.fixes || {}).map(([k, f]) => (
                          <div
                            key={k}
                            style={{
                              border: "1px solid #E5E7EB",
                              borderRadius: 8,
                              padding: "10px 12px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 800,
                                color: "#7C3AED",
                                marginBottom: 5,
                              }}
                            >
                              {f.label}
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#374151",
                                lineHeight: 1.5,
                              }}
                            >
                              {f.suggestion}
                            </div>
                            {f.example && (
                              <div
                                style={{
                                  marginTop: 6,
                                  padding: "7px 10px",
                                  background: "#F9FAFB",
                                  borderRadius: 5,
                                  fontSize: "0.75rem",
                                  color: "#6B7280",
                                  fontFamily: "monospace",
                                }}
                              >
                                {f.example}
                              </div>
                            )}
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
    </div>
  );
}
