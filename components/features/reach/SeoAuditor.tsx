"use client";

// Native React port of the legacy `seo-auditor` panel (was
// `window.buildSeoAuditor` + `#view-seo-auditor` in index.html, originally in
// public/js/ig_seo.js). Runs a 100-point on-page SEO audit for a single URL
// against the existing Express API (`POST /api/seo-auditor/audit`) and can push
// the resulting issues into the SEO Task Manager
// (`POST /api/seo-tasks/import-from-audit`) — all via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";

interface Check {
  status: "pass" | "warn" | "fail";
  weight: number;
  earned: number;
  label: string;
  message: string;
  fix?: string;
}

interface AuditSummary {
  passed?: number;
  warned?: number;
  failed?: number;
  title?: string;
  h1Count?: number;
  words?: number;
  imgCount?: number;
}

interface AuditResult {
  ok: boolean;
  error?: string;
  url: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  summary: AuditSummary;
  checks: Check[];
  runId?: number;
}

interface ImportResult {
  ok: boolean;
  error?: string;
  created?: number;
  skipped?: number;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#10B981",
  B: "#0E9F6E",
  C: "#F59E0B",
  D: "#F97316",
  F: "#EF4444",
};
const STATUS_COLOR: Record<string, string> = {
  pass: "#10B981",
  warn: "#F59E0B",
  fail: "#EF4444",
};
const STATUS_ICON: Record<string, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
};

function n(x: unknown, d = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round(v) : d;
}

// Reads the user's own URL from window.analysisData (set after Analyse Now).
function getOwnUrl(): string {
  const a = (window as unknown as { analysisData?: Record<string, unknown> })
    .analysisData;
  return String(a?.url || "").trim();
}

// Returns competitor URLs in order, pulling .url first then .domain then .name.
function getCompetitorUrls(): string[] {
  const a = (window as unknown as { analysisData?: Record<string, unknown> })
    .analysisData;
  const comps = (a?.competitors as Array<Record<string, unknown>> | undefined) || [];
  return comps
    .map((c) => String(c.url || c.domain || c.name || "").trim())
    .filter(Boolean);
}

export default function SeoAuditor() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [importLabel, setImportLabel] = useState("📋 Add to Task Manager");
  const [importing, setImporting] = useState(false);
  // Tracks which AI Suggest slot we'll fill next: 0 = own URL, 1+ = competitors.
  const [suggestIdx, setSuggestIdx] = useState(0);

  // The legacy crawler sets `window._seoAuditorPrefill` then routes here.
  useEffect(() => {
    const pre = (window as unknown as { _seoAuditorPrefill?: string })
      ._seoAuditorPrefill;
    if (pre) {
      setUrl(pre);
      (window as unknown as { _seoAuditorPrefill?: string })._seoAuditorPrefill =
        undefined;
    }
  }, []);

  function aiSuggest() {
    const ownUrl = getOwnUrl();
    const compUrls = getCompetitorUrls();
    // Build the full cycle: own site first, then each competitor in order.
    const slots = [ownUrl, ...compUrls].filter(Boolean);
    if (!slots.length) return; // nothing analysed yet — do nothing
    const idx = suggestIdx % slots.length;
    let picked = slots[idx];
    if (!/^https?:\/\//i.test(picked)) picked = "https://" + picked;
    setUrl(picked);
    setSuggestIdx(idx + 1);
  }

  async function run() {
    let u = url.trim();
    if (!u) {
      setStatus("error");
      setError("⚠ Enter a URL");
      return;
    }
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setStatus("loading");
    setError("");
    setResult(null);
    setImportLabel("📋 Add to Task Manager");
    const r = await apiPost<AuditResult>("/api/seo-auditor/audit", { url: u });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Audit failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  async function addToTasks() {
    if (!result?.runId) return;
    setImporting(true);
    setImportLabel("⏳ Importing…");
    const j = await apiPost<ImportResult>("/api/seo-tasks/import-from-audit", {
      auditRunId: result.runId,
    });
    setImporting(false);
    if (!j.ok) {
      setImportLabel("⚠ " + (j.error || "failed").slice(0, 30));
      return;
    }
    setImportLabel(`✓ ${j.created} added${j.skipped ? ` · ${j.skipped} dup` : ""}`);
  }

  const sorted = result
    ? [...result.checks].sort((a, b) => {
        const order = { fail: 0, warn: 1, pass: 2 };
        return order[a.status] - order[b.status] || b.weight - a.weight;
      })
    : [];

  const gradeColor = result ? GRADE_COLORS[result.grade] || "#6B7280" : "#6B7280";

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> SEO On-Page Auditor
              </div>
              <h2 className="view-title">🧭 SEO On-Page Auditor</h2>
              <p className="view-sub">
                Drop in any URL and get a 100-point on-page SEO report — title,
                meta, H1, alt text, schema, mobile, OG/Twitter, robots, sitemap,
                mixed content and more — with prioritised fixes for each issue.
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
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "3fr 1fr",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 3,
                }}
              >
                <label
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  URL TO AUDIT
                </label>
                <button
                  type="button"
                  onClick={aiSuggest}
                  title={
                    suggestIdx === 0
                      ? "Fill with your site URL"
                      : suggestIdx === 1
                        ? "Fill with a competitor URL"
                        : `Cycle to next competitor (${suggestIdx} of ${[getOwnUrl(), ...getCompetitorUrls()].filter(Boolean).length})`
                  }
                  style={{
                    background: "linear-gradient(135deg,#7C3AED,#0066FF)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    letterSpacing: 0.3,
                    lineHeight: "18px",
                  }}
                >
                  🧠 AI Suggest
                </button>
              </div>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="https://yoursite.com/page"
                style={{
                  width: "100%",
                  padding: 10,
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.86rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <button
                onClick={run}
                disabled={status === "loading"}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg,#10B981,#0066FF)",
                  color: "#fff",
                  border: "none",
                  padding: "10px 16px",
                  borderRadius: 6,
                  fontSize: "0.86rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                🧭 Run Audit
              </button>
            </div>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Fetching page + running 19 checks (5-15s)…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  background: `linear-gradient(135deg,${gradeColor},${gradeColor}dd)`,
                  color: "#fff",
                  borderRadius: 14,
                  padding: 24,
                  marginBottom: 18,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 24,
                  alignItems: "center",
                }}
              >
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{ fontSize: "4rem", fontWeight: 800, lineHeight: 1 }}
                  >
                    {result.score}
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      opacity: 0.85,
                      fontWeight: 700,
                      letterSpacing: 1,
                    }}
                  >
                    / 100
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "1.6rem",
                      fontWeight: 800,
                      marginBottom: 4,
                    }}
                  >
                    Grade {result.grade}
                  </div>
                  <div
                    style={{
                      fontSize: "0.86rem",
                      opacity: 0.95,
                      marginBottom: 8,
                    }}
                  >
                    {result.url}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 18,
                      fontSize: "0.84rem",
                      opacity: 0.95,
                    }}
                  >
                    <span>✓ {n(result.summary.passed)} passed</span>
                    <span>⚠ {n(result.summary.warned)} warnings</span>
                    <span>✗ {n(result.summary.failed)} failed</span>
                  </div>
                </div>
                {result.runId ? (
                  <button
                    onClick={addToTasks}
                    disabled={importing}
                    style={{
                      background: "rgba(255,255,255,.2)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,.5)",
                      padding: "10px 16px",
                      borderRadius: 8,
                      fontSize: "0.84rem",
                      fontWeight: 800,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {importLabel}
                  </button>
                ) : (
                  <span />
                )}
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "14px 18px",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 14,
                    fontSize: "0.78rem",
                  }}
                >
                  <div>
                    <span style={{ color: "#6B7280", fontWeight: 700 }}>
                      TITLE
                    </span>
                    <div style={{ color: "#0A1628" }}>
                      {(result.summary.title || "").slice(0, 80) || "(missing)"}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "#6B7280", fontWeight: 700 }}>
                      H1 COUNT
                    </span>
                    <div style={{ color: "#0A1628" }}>
                      {n(result.summary.h1Count)}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "#6B7280", fontWeight: 700 }}>
                      WORDS
                    </span>
                    <div style={{ color: "#0A1628" }}>
                      {n(result.summary.words)}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "#6B7280", fontWeight: 700 }}>
                      IMAGES
                    </span>
                    <div style={{ color: "#0A1628" }}>
                      {n(result.summary.imgCount)}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {sorted.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderLeft: `4px solid ${STATUS_COLOR[c.status]}`,
                      borderRadius: 10,
                      padding: "12px 16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <strong style={{ color: "#0A1628", fontSize: "0.9rem" }}>
                        <span
                          style={{
                            color: STATUS_COLOR[c.status],
                            marginRight: 6,
                            fontWeight: 800,
                          }}
                        >
                          {STATUS_ICON[c.status]}
                        </span>
                        {c.label}
                      </strong>
                      <span style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                        {c.earned}/{c.weight} pts
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "#374151",
                        marginLeft: 20,
                      }}
                    >
                      {c.message}
                    </div>
                    {c.status !== "pass" && c.fix && (
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#7C3AED",
                          marginTop: 4,
                          marginLeft: 20,
                        }}
                      >
                        <strong>Fix:</strong> {c.fix}
                      </div>
                    )}
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
