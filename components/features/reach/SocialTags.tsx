"use client";

// Native React port of the legacy `social-tags` panel (was
// `window.buildSocialTags` in public/js/ig_seo.js + `#view-social-tags` in
// index.html). Audits Open Graph / Twitter Cards / pixels / GA4 / social profile
// links / favicons for a page, backed by the existing Express API
// (`/api/social-tags/*`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Check {
  status: "pass" | "warn" | "fail";
  weight: number;
  earned: number;
  label: string;
  message: string;
  fix?: string;
}

interface Summary {
  passed?: number;
  warned?: number;
  failed?: number;
  platforms?: string[];
}

interface RunResult {
  ok: boolean;
  error?: string;
  url: string;
  grade: string;
  score: number;
  summary?: Summary;
  checks?: Check[];
}

interface PastRun {
  url: string;
  grade: string;
  score: number;
  created_at: string;
}

interface RunsResult {
  ok: boolean;
  error?: string;
  runs: PastRun[];
}

const GRADE_COLOR: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#ca8a04",
  D: "#ea580c",
  F: "#dc2626",
};

export default function SocialTags() {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [headless, setHeadless] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [resultError, setResultError] = useState("");
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<PastRun[] | null>(null);

  async function loadList() {
    const r = await apiGet<RunsResult>("/api/social-tags/runs");
    if (!r.ok || !r.runs.length) {
      setRuns([]);
      return;
    }
    setRuns(r.runs);
  }

  useEffect(() => {
    loadList();
  }, []);

  async function run() {
    if (!url.trim()) {
      toast("⚠️ Enter a URL to audit.");
      return;
    }
    setRunning(true);
    setResult(null);
    setResultError("");
    const r = await apiPost<RunResult>("/api/social-tags/run", { url: url.trim(), headless });
    setRunning(false);
    if (!r.ok) {
      setResultError(r.error || "unknown");
      return;
    }
    setResult(r);
    loadList();
  }

  function renderResult(r: RunResult) {
    const gradeColor = GRADE_COLOR[r.grade] || "#64748b";
    const ord: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
    const sortedChecks = (r.checks || []).slice().sort((a, b) => {
      if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
      return b.weight - a.weight;
    });
    const platforms = (r.summary && r.summary.platforms) || [];
    return (
      <div
        style={{
          background: "var(--card-bg,#fff)",
          border: "1px solid var(--border-color,#e2e8f0)",
          borderRadius: 12,
          padding: 24,
        }}
      >
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
          <div style={{ textAlign: "center", minWidth: 110 }}>
            <div style={{ fontSize: "3.6rem", fontWeight: 800, color: gradeColor, lineHeight: 1 }}>{r.grade}</div>
            <div style={{ color: "#64748b", fontSize: "0.84rem" }}>Social tag grade</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 110 }}>
            <div style={{ fontSize: "2.4rem", fontWeight: 800 }}>{r.score}</div>
            <div style={{ color: "#64748b", fontSize: "0.84rem" }}>out of 100</div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ wordBreak: "break-all", fontWeight: 600 }}>{r.url}</div>
            <div style={{ color: "#64748b", fontSize: "0.84rem", marginTop: 4 }}>
              {(r.summary && r.summary.passed) || 0} pass · {(r.summary && r.summary.warned) || 0} warn ·{" "}
              <span style={{ color: "#dc2626" }}>{(r.summary && r.summary.failed) || 0} fail</span>
              {platforms.length ? " · profiles: " + platforms.join(", ") : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedChecks.map((c, i) => {
            const sColor = c.status === "pass" ? "#16a34a" : c.status === "warn" ? "#ca8a04" : "#dc2626";
            const sIcon = c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✕";
            return (
              <div
                key={i}
                style={{
                  border: "1px solid var(--border-color,#e2e8f0)",
                  borderLeft: `4px solid ${sColor}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600 }}>
                    <span style={{ color: sColor, marginRight: 6, fontWeight: 800 }}>{sIcon}</span>
                    {c.label}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
                    {c.earned}/{c.weight} pts
                  </div>
                </div>
                <div style={{ color: "#475569", fontSize: "0.86rem", marginTop: 4 }}>{c.message}</div>
                {c.fix && c.status !== "pass" ? (
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
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Social Tags Audit
              </div>
              <h2 className="view-title">🔖 Social Tags Audit</h2>
              <p className="view-sub">
                Audits Open Graph (Facebook/LinkedIn previews), Twitter Cards (X previews), Facebook Pixel, GA4, social
                profile links, favicon and Apple touch icon. Catches the &quot;why does my link look ugly when
                shared?&quot; problems instantly.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "var(--card-bg,#fff)",
            border: "1px solid var(--border-color,#e2e8f0)",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Audit social tags &amp; tracking</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
            <label>
              Page URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="https://example.com"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid var(--border-color,#e2e8f0)",
                  borderRadius: 6,
                  background: "var(--card-bg,#fff)",
                  marginTop: 4,
                  boxSizing: "border-box",
                }}
              />
            </label>
            <button onClick={run} disabled={running} className="btn btn-primary">
              {running ? "⏳ Auditing…" : "🔖 Audit page"}
            </button>
          </div>
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "#475569", fontSize: "0.86rem", cursor: "pointer" }}
          >
            <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} /> Render with real
            browser (slower, but works for SPA / JavaScript-heavy sites)
          </label>
          <p style={{ color: "#64748b", fontSize: "0.84rem", marginTop: 10, marginBottom: 0 }}>
            13 checks for Open Graph, Twitter Cards, Facebook Pixel, GA4, social profile links, favicon and Apple touch
            icon.
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          {running && (
            <div style={{ textAlign: "center", padding: 32, color: "#64748b" }}>Running 13 social tag checks…</div>
          )}
          {!running && resultError && (
            <div style={{ background: "#fee", color: "#dc2626", padding: 16, borderRadius: 8 }}>
              Failed: {resultError}
            </div>
          )}
          {!running && result && renderResult(result)}
        </div>

        <div style={{ background: "var(--card-bg,#fff)", border: "1px solid var(--border-color,#e2e8f0)", borderRadius: 12 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-color,#e2e8f0)", fontWeight: 700 }}>
            Recent audits
          </div>
          <div style={{ padding: "14px 20px", color: "#64748b" }}>
            {runs === null ? (
              "Loading…"
            ) : runs.length === 0 ? (
              <div style={{ color: "#64748b" }}>No audits yet — run your first one above.</div>
            ) : (
              runs.map((run, i) => {
                const gradeColor = GRADE_COLOR[run.grade] || "#64748b";
                return (
                  <div
                    key={i}
                    style={{
                      padding: "10px 0",
                      borderTop: "1px solid var(--border-color,#e2e8f0)",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: gradeColor, minWidth: 36, textAlign: "center" }}>
                      {run.grade}
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{run.url}</div>
                      <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
                        Score {run.score} · {new Date(run.created_at).toLocaleString()}
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
