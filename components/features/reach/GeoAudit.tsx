"use client";

// Native React port of the legacy `geo-audit` panel (was
// `window.buildGeoAudit` + `#view-geo-audit` in index.html, originally in
// public/js/ig_seo.js). Scores how well a page is structured to be cited by
// generative engines (ChatGPT / Perplexity / Gemini) against the existing
// Express API (`POST /api/geo-audit/run`, `GET /api/geo-audit/runs`) via
// `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Check {
  status: "pass" | "warn" | "fail";
  weight: number;
  earned: number;
  label: string;
  message: string;
  fix?: string;
}

interface AuditResult {
  ok: boolean;
  error?: string;
  url: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  summary?: { passed?: number; warned?: number; failed?: number; words?: number };
  checks?: Check[];
}

interface RunRow {
  url: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  created_at: string;
}

interface RunsResult {
  ok: boolean;
  runs?: RunRow[];
}

const GRADE_COLORS: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#ca8a04",
  D: "#ea580c",
  F: "#dc2626",
};

function sortChecks(checks: Check[]): Check[] {
  const ord = { fail: 0, warn: 1, pass: 2 };
  return [...checks].sort((a, b) =>
    ord[a.status] !== ord[b.status]
      ? ord[a.status] - ord[b.status]
      : b.weight - a.weight,
  );
}

export default function GeoAudit() {
  const [url, setUrl] = useState("");
  const [headless, setHeadless] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<RunRow[] | null>(null);

  async function loadList() {
    const r = await apiGet<RunsResult>("/api/geo-audit/runs");
    setRuns(r.ok && r.runs ? r.runs : []);
  }

  useEffect(() => {
    loadList();
  }, []);

  async function run() {
    const u = url.trim();
    if (!u) {
      setStatus("error");
      setError("Enter a URL.");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<AuditResult>("/api/geo-audit/run", {
      url: u,
      headless,
    });
    if (!r.ok) {
      setStatus("error");
      setError("Failed: " + (r.error || "unknown"));
      return;
    }
    setResult(r);
    setStatus("idle");
    loadList();
  }

  const gradeColor = result ? GRADE_COLORS[result.grade] || "#64748b" : "#64748b";

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> GEO Audit
              </div>
              <h2 className="view-title">
                🤖 GEO Audit — Generative Engine Optimization
              </h2>
              <p className="view-sub">
                Score how well any page is structured to be cited by ChatGPT,
                Perplexity and Gemini. Checks clear headings, concise answer
                blocks, JSON-LD schema, author bio, freshness signals, semantic
                chunking and more — with prioritised fixes.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Run a GEO audit</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label>
              Page URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                type="url"
                placeholder="https://example.com/your-best-article"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: "#fff",
                  marginTop: 4,
                  boxSizing: "border-box",
                }}
              />
            </label>
            <button
              onClick={run}
              disabled={status === "loading"}
              className="btn btn-primary"
            >
              {status === "loading" ? "⏳ Auditing…" : "🤖 Audit page"}
            </button>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              color: "#475569",
              fontSize: "0.86rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
            />{" "}
            Render with real browser (slower, but works for SPA / JavaScript-heavy
            sites)
          </label>
          <p
            style={{
              color: "#64748b",
              fontSize: "0.84rem",
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            Scores how well a page is structured to be cited by ChatGPT,
            Perplexity and Gemini. Different from classic SEO — focuses on AI
            snippet extractability.
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          {status === "loading" && (
            <div
              style={{ textAlign: "center", padding: 32, color: "#64748b" }}
            >
              Fetching page and running 12 GEO checks…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#fee",
                color: "#dc2626",
                padding: 16,
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 20,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginBottom: 18,
                }}
              >
                <div style={{ textAlign: "center", minWidth: 110 }}>
                  <div
                    style={{
                      fontSize: "3.6rem",
                      fontWeight: 800,
                      color: gradeColor,
                      lineHeight: 1,
                    }}
                  >
                    {result.grade}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.84rem" }}>
                    GEO grade
                  </div>
                </div>
                <div style={{ textAlign: "center", minWidth: 110 }}>
                  <div style={{ fontSize: "2.4rem", fontWeight: 800 }}>
                    {result.score}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.84rem" }}>
                    out of 100
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ wordBreak: "break-all", fontWeight: 600 }}>
                    {result.url}
                  </div>
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: "0.84rem",
                      marginTop: 4,
                    }}
                  >
                    {result.summary?.passed || 0} pass ·{" "}
                    {result.summary?.warned || 0} warn ·{" "}
                    <span style={{ color: "#dc2626" }}>
                      {result.summary?.failed || 0} fail
                    </span>{" "}
                    · {result.summary?.words || 0} words
                  </div>
                </div>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {sortChecks(result.checks || []).map((c, i) => {
                  const sColor =
                    c.status === "pass"
                      ? "#16a34a"
                      : c.status === "warn"
                        ? "#ca8a04"
                        : "#dc2626";
                  const sIcon =
                    c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✕";
                  return (
                    <div
                      key={i}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderLeft: `4px solid ${sColor}`,
                        borderRadius: 6,
                        padding: "10px 14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          <span
                            style={{
                              color: sColor,
                              marginRight: 6,
                              fontWeight: 800,
                            }}
                          >
                            {sIcon}
                          </span>
                          {c.label}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
                          {c.earned}/{c.weight} pts
                        </div>
                      </div>
                      <div
                        style={{
                          color: "#475569",
                          fontSize: "0.86rem",
                          marginTop: 4,
                        }}
                      >
                        {c.message}
                      </div>
                      {c.fix && c.status !== "pass" && (
                        <div
                          style={{
                            color: "#0369a1",
                            fontSize: "0.84rem",
                            marginTop: 6,
                            background: "#f0f9ff",
                            padding: "8px 10px",
                            borderRadius: 4,
                          }}
                        >
                          <strong>Fix:</strong> {c.fix}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #e2e8f0",
              fontWeight: 700,
            }}
          >
            Recent audits
          </div>
          <div style={{ padding: "14px 20px", color: "#64748b" }}>
            {runs === null ? (
              "Loading…"
            ) : runs.length === 0 ? (
              "No audits yet — run your first one above."
            ) : (
              runs.map((rn, i) => {
                const gc = GRADE_COLORS[rn.grade] || "#64748b";
                return (
                  <div
                    key={i}
                    style={{
                      padding: "10px 0",
                      borderTop: "1px solid #e2e8f0",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 800,
                        color: gc,
                        minWidth: 36,
                        textAlign: "center",
                      }}
                    >
                      {rn.grade}
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div
                        style={{ fontWeight: 600, wordBreak: "break-all" }}
                      >
                        {rn.url}
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
                        Score {rn.score} ·{" "}
                        {new Date(rn.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
