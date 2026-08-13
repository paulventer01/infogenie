"use client";

// Native React port of the legacy `accessibility` panel (was
// `window.buildAccessibility` + `#view-accessibility` in index.html, defined in
// public/js/ig_design_studio.js). Runs a WCAG 2.1 AA audit on any public URL via
// the existing Express API (`POST /api/accessibility/audit` and
// `GET /api/accessibility/history`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface A11yIssue {
  severity: string;
  category?: string;
  id?: string;
  criterion?: string;
  wcag_level?: string;
  description?: string;
  element_hint?: string;
  fix?: string;
}
interface AuditResult {
  ok: boolean;
  error?: string;
  score: number;
  url: string;
  summary: string;
  issues?: A11yIssue[];
  passes?: string[];
  quick_wins?: string[];
  source?: string;
}
interface HistoryRun {
  url: string;
  created_at: string;
  score: number;
}
interface HistoryResult {
  ok: boolean;
  runs?: HistoryRun[];
}

const scoreColor = (n: number) =>
  n >= 85 ? "#22C55E" : n >= 60 ? "#F59E0B" : "#EF4444";
const scoreLabel = (n: number) =>
  n >= 85 ? "Good" : n >= 60 ? "Needs Work" : "Poor";
const severityColor = (s: string) =>
  (
    {
      critical: "#EF4444",
      serious: "#0f766e",
      moderate: "#F59E0B",
      minor: "#6366F1",
    } as Record<string, string>
  )[s] || "#94A3B8";
const severityBg = (s: string) =>
  (
    {
      critical: "#FEF2F2",
      serious: "#FFF7ED",
      moderate: "#FFFBEB",
      minor: "#EEF2FF",
    } as Record<string, string>
  )[s] || "#F8FAFC";

const CAT_LABEL: Record<string, string> = {
  images: "🖼️ Images",
  color_contrast: "🎨 Color Contrast",
  keyboard: "⌨️ Keyboard",
  forms: "📝 Forms",
  structure: "🏗️ Structure",
  links: "🔗 Links",
  aria: "🔊 ARIA",
  media: "🎬 Media",
  language: "🌐 Language",
  other: "📌 Other",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1.5px solid #E2E8F0",
  padding: "28px 32px",
  marginBottom: 24,
};

export default function Accessibility() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryRun[]>([]);

  async function loadHistory() {
    const r = await apiGet<HistoryResult>("/api/accessibility/history");
    if (r.ok && r.runs?.length) setHistory(r.runs);
    else setHistory([]);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function runAudit() {
    const u = url.trim();
    if (!u) {
      setStatus("error");
      setError("Enter a URL first");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<AuditResult>("/api/accessibility/audit", { url: u });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Audit failed");
      return;
    }
    setResult(r);
    setStatus("idle");
    loadHistory();
  }

  const issues = result?.issues || [];
  const passes = result?.passes || [];
  const wins = result?.quick_wins || [];
  const counts: Record<string, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  issues.forEach((i) => {
    if (counts[i.severity] !== undefined) counts[i.severity]++;
  });
  const byCategory: Record<string, A11yIssue[]> = {};
  issues.forEach((i) => {
    const k = i.category || "other";
    if (!byCategory[k]) byCategory[k] = [];
    byCategory[k].push(i);
  });

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Accessibility Audit
              </div>
              <h2 className="view-title">♿ WCAG Accessibility Audit</h2>
              <p className="view-sub">
                Scan any public URL for WCAG 2.1 AA accessibility violations. Get
                a scored report with specific issues, affected elements, and
                actionable fixes — prioritised by severity.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={cardStyle}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#1E293B",
              margin: "0 0 6px",
            }}
          >
            WCAG 2.1 AA Accessibility Audit
          </h3>
          <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 20px" }}>
            Enter any public URL to scan for accessibility violations — missing
            alt text, contrast issues, unlabelled forms, keyboard traps and more.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-end",
              marginBottom: 8,
            }}
          >
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Page URL to audit
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runAudit()}
                placeholder="https://example.com"
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  border: "1.5px solid #E2E8F0",
                  borderRadius: 10,
                  fontSize: 14,
                  color: "#1E293B",
                  outline: "none",
                }}
              />
            </div>
            <button
              onClick={runAudit}
              disabled={status === "loading"}
              style={{
                background: "#6366F1",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "12px 24px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ♿ Run Audit
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#94A3B8", margin: 0 }}>
            Audits use Firecrawl + AI analysis. Only public URLs are accepted.
          </p>
        </div>

        <div style={{ marginTop: 8 }}>
          {status === "loading" && (
            <div style={{ ...cardStyle, textAlign: "center", padding: "64px 24px" }}>
              <p style={{ color: "#64748B", fontSize: 14 }}>
                ⏳ Fetching page and running WCAG 2.1 AA analysis… (30-60 seconds)
              </p>
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1.5px solid #FECACA",
                borderRadius: 12,
                padding: 20,
                color: "#DC2626",
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 32,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 56,
                        fontWeight: 900,
                        color: scoreColor(result.score),
                        lineHeight: 1,
                      }}
                    >
                      {result.score}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: scoreColor(result.score),
                      }}
                    >
                      {scoreLabel(result.score)}
                    </div>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                      out of 100
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#1E293B",
                        marginBottom: 8,
                      }}
                    >
                      {result.url}
                    </div>
                    <p
                      style={{
                        fontSize: 14,
                        color: "#475569",
                        lineHeight: 1.5,
                        margin: "0 0 12px",
                      }}
                    >
                      {result.summary}
                    </p>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {Object.entries(counts).map(([s, n]) =>
                        n ? (
                          <span
                            key={s}
                            style={{
                              background: severityBg(s),
                              color: severityColor(s),
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {s}: {n}
                          </span>
                        ) : null,
                      )}
                      {issues.length === 0 && (
                        <span
                          style={{
                            background: "#DCFCE7",
                            color: "#16A34A",
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          ✅ No issues found
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {wins.length > 0 && (
                  <div
                    style={{
                      marginTop: 20,
                      background: "#EEF2FF",
                      borderRadius: 10,
                      padding: "14px 16px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#6366F1",
                        marginBottom: 8,
                      }}
                    >
                      ⚡ QUICK WINS
                    </div>
                    {wins.map((w, i) => (
                      <div
                        key={i}
                        style={{ fontSize: 13, color: "#1E293B", marginBottom: 4 }}
                      >
                        • {w}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {Object.keys(byCategory).map((cat) => (
                <div key={cat} style={{ ...cardStyle, marginTop: 0 }}>
                  <h4
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#1E293B",
                      margin: "0 0 16px",
                    }}
                  >
                    {CAT_LABEL[cat] || cat}
                  </h4>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 12 }}
                  >
                    {byCategory[cat].map((issue, idx) => (
                      <div
                        key={idx}
                        style={{
                          borderLeft: `4px solid ${severityColor(issue.severity)}`,
                          padding: "12px 16px",
                          background: severityBg(issue.severity),
                          borderRadius: "0 10px 10px 0",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              background: severityColor(issue.severity),
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            {issue.severity}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: "#6366F1",
                            }}
                          >
                            WCAG {issue.id}
                          </span>
                          <span style={{ fontSize: 12, color: "#94A3B8" }}>
                            {issue.criterion}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              background: "#E2E8F0",
                              color: "#475569",
                              padding: "1px 6px",
                              borderRadius: 4,
                            }}
                          >
                            Level {issue.wcag_level}
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: 14,
                            color: "#1E293B",
                            margin: "0 0 8px",
                            fontWeight: 600,
                          }}
                        >
                          {issue.description}
                        </p>
                        {issue.element_hint && (
                          <code
                            style={{
                              fontSize: 12,
                              background: "rgba(0,0,0,.06)",
                              padding: "2px 6px",
                              borderRadius: 4,
                              color: "#374151",
                            }}
                          >
                            {issue.element_hint}
                          </code>
                        )}
                        {issue.fix && (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 13,
                              color: "#374151",
                            }}
                          >
                            <strong>Fix:</strong> {issue.fix}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {passes.length > 0 && (
                <div style={{ ...cardStyle, marginTop: 0 }}>
                  <h4
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#16A34A",
                      margin: "0 0 12px",
                    }}
                  >
                    ✅ What&apos;s Working
                  </h4>
                  {passes.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 13,
                        color: "#374151",
                        padding: "6px 0",
                        borderBottom: "1px solid #F1F5F9",
                      }}
                    >
                      ✓ {p}
                    </div>
                  ))}
                </div>
              )}

              {result.source === "template" && (
                <p
                  style={{
                    fontSize: 12,
                    color: "#94A3B8",
                    textAlign: "right",
                    marginTop: 8,
                  }}
                >
                  ⚠️ Structural scan only — add an OpenAI key for full AI analysis
                </p>
              )}
            </>
          )}
        </div>

        {history.length > 0 && (
          <div style={{ ...cardStyle, marginTop: 24 }}>
            <h4
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#1E293B",
                margin: "0 0 16px",
              }}
            >
              Recent Audits
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map((run, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#F8FAFC",
                    borderRadius: 10,
                    padding: "10px 14px",
                    border: "1.5px solid #E2E8F0",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#1E293B",
                      }}
                    >
                      {run.url}
                    </span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        color: "#94A3B8",
                      }}
                    >
                      {new Date(run.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: scoreColor(run.score),
                    }}
                  >
                    {run.score}/100
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
