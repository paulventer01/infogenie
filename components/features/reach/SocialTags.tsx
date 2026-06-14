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

interface Tags {
  ogTitle?: string;
  ogDesc?: string;
  ogImage?: string;
  ogType?: string;
  ogUrl?: string;
  twCard?: string;
  twImage?: string;
  twTitle?: string;
}

interface RunResult {
  ok: boolean;
  error?: string;
  url: string;
  grade: string;
  score: number;
  summary?: Summary;
  tags?: Tags;
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

  function renderSharePreviews(r: RunResult) {
    const t = r.tags || {};
    const pageHost = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return r.url; } })();
    const ogImg = t.ogImage || "";
    const ogTitle = t.ogTitle || "";
    const ogDesc = t.ogDesc || "";
    const twImg = t.twImage || ogImg;
    const twTitle = t.twTitle || ogTitle;
    const twDesc = ogDesc;
    const twCard = t.twCard || "";
    const isLargeCard = !twCard || twCard === "summary_large_image" || twCard === "app";

    const imgPlaceholder = (
      <div
        style={{
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          fontSize: "0.8rem",
          fontStyle: "italic",
        }}
      >
        No image
      </div>
    );

    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: "0.9rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Share previews
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>

          {/* Facebook / LinkedIn OG card */}
          <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "1rem" }}>𝑓</span> Facebook / LinkedIn
            </div>
            <div
              style={{
                border: "1px solid #d9d9d9",
                borderRadius: 8,
                overflow: "hidden",
                background: "#fff",
                fontFamily: "Helvetica Neue, Arial, sans-serif",
              }}
            >
              <div style={{ width: "100%", aspectRatio: "1200/630", position: "relative", background: "#f1f5f9" }}>
                {ogImg ? (
                  <img
                    src={ogImg}
                    alt="OG preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : imgPlaceholder}
              </div>
              <div style={{ padding: "10px 12px 12px", borderTop: "1px solid #e4e4e4", background: "#f2f3f5" }}>
                <div style={{ fontSize: "0.7rem", color: "#606770", textTransform: "uppercase", marginBottom: 3 }}>{pageHost}</div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1c1e21", lineHeight: 1.3, marginBottom: 4 }}>
                  {ogTitle || <em style={{ color: "#94a3b8" }}>No og:title</em>}
                </div>
                <div style={{ fontSize: "0.82rem", color: "#606770", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                  {ogDesc || <em style={{ color: "#94a3b8" }}>No og:description</em>}
                </div>
              </div>
            </div>
          </div>

          {/* X / Twitter card */}
          <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "1rem" }}>𝕏</span> X / Twitter
              {twCard && (
                <span style={{ background: "#f1f5f9", borderRadius: 4, padding: "1px 6px", fontSize: "0.72rem", color: "#64748b" }}>
                  {twCard}
                </span>
              )}
            </div>
            <div
              style={{
                border: "1px solid #cfd9de",
                borderRadius: 16,
                overflow: "hidden",
                background: "#fff",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              }}
            >
              {isLargeCard ? (
                <>
                  <div style={{ width: "100%", aspectRatio: "2/1", position: "relative", background: "#f7f9f9" }}>
                    {twImg ? (
                      <img
                        src={twImg}
                        alt="Twitter card preview"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : imgPlaceholder}
                  </div>
                  <div style={{ padding: "10px 14px 12px" }}>
                    <div style={{ fontSize: "0.78rem", color: "#536471", marginBottom: 2 }}>{pageHost}</div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f1419", lineHeight: 1.3 }}>
                      {twTitle || <em style={{ color: "#94a3b8" }}>No title</em>}
                    </div>
                    {twDesc && (
                      <div style={{ fontSize: "0.82rem", color: "#536471", marginTop: 2, lineHeight: 1.4 }}>
                        {twDesc.length > 120 ? twDesc.slice(0, 120) + "…" : twDesc}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* summary card — thumbnail left */
                <div style={{ display: "flex", gap: 0 }}>
                  <div style={{ width: 120, minHeight: 120, flexShrink: 0, background: "#f7f9f9" }}>
                    {twImg ? (
                      <img
                        src={twImg}
                        alt="Twitter summary card"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : imgPlaceholder}
                  </div>
                  <div style={{ padding: "10px 14px", flex: 1 }}>
                    <div style={{ fontSize: "0.78rem", color: "#536471", marginBottom: 2 }}>{pageHost}</div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f1419", lineHeight: 1.3 }}>
                      {twTitle || <em style={{ color: "#94a3b8" }}>No title</em>}
                    </div>
                    {twDesc && (
                      <div style={{ fontSize: "0.82rem", color: "#536471", marginTop: 2, lineHeight: 1.4 }}>
                        {twDesc.length > 80 ? twDesc.slice(0, 80) + "…" : twDesc}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    );
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
        {renderSharePreviews(r)}
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
