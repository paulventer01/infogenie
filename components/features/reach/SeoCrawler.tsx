"use client";

// Native React port of the legacy `seo-crawler` panel (was
// `window.buildSeoCrawler` + `#view-seo-crawler` in index.html, originally in
// public/js/ig_seo.js). Crawls up to 100 pages, runs the T22 19-check audit on
// each, and aggregates a site-wide grade against the existing Express API
// (`POST /api/seo-crawler/run`, `GET /api/seo-crawler/runs`, `…/runs/:id`,
// `DELETE …/runs/:id`, `POST …/runs/:id/import-tasks`) via `lib/api`. Insight
// drill-downs and re-audit jump to the SEO Task Manager / single-page Auditor
// through `goToView` (legacy navigateTo + Next router).
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface CrawlRun {
  id: number | string;
  root_url: string;
  status: string;
  page_count: number;
  max_pages?: number;
  avg_score?: number | null;
  site_grade?: string | null;
  started_at: string;
}

interface RunsResult {
  ok: boolean;
  runs?: CrawlRun[];
}

interface PageSummary {
  passed?: number;
  warned?: number;
  failed?: number;
}
interface CrawlPage {
  url: string;
  score: number;
  grade: string;
  summary?: PageSummary;
}

interface TopIssue {
  id: string;
  label: string;
  fix?: string;
  message?: string;
  failCount: number;
  warnCount: number;
  pagesAffected: number;
  pctOfSite: number;
  impact: number;
  weight: number;
  sampleFailPages: string[];
  sampleWarnPages: string[];
}
interface QuickWin {
  id: string;
  label: string;
  pagesAffected: number;
  pctOfSite: number;
  weight: number;
}
interface Aggregate {
  topIssues: TopIssue[];
  quickWins: QuickWin[];
  worstPages: CrawlPage[];
  totals: {
    pages: number;
    failures: number;
    warnings: number;
    uniqueIssues: number;
  };
}
interface RunDetail {
  ok: boolean;
  error?: string;
  run: CrawlRun;
  pages?: CrawlPage[];
  aggregate?: Aggregate;
  live?: { progress?: number; errors?: number };
}

interface ImportResult {
  ok: boolean;
  error?: string;
  created?: number;
  skipped?: number;
  total?: number;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#ca8a04",
  D: "#d97706",
  F: "#dc2626",
};

function gradeColor(g?: string | null): string {
  return (g && GRADE_COLORS[g]) || "#64748b";
}
function sevColor(n: number): string {
  return n === 0 ? "#16a34a" : n <= 2 ? "#ca8a04" : "#dc2626";
}

export default function SeoCrawler() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(25);
  const [runs, setRuns] = useState<CrawlRun[] | null>(null);
  const [active, setActive] = useState<RunDetail | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [issuePop, setIssuePop] = useState<TopIssue | null>(null);
  const [importMsg, setImportMsg] = useState<{
    kind: "info" | "ok" | "err";
    text: string;
  } | null>(null);

  const activeRunId = useRef<number | string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async () => {
    const r = await apiGet<RunsResult>("/api/seo-crawler/runs");
    setRuns(r.ok && r.runs ? r.runs : []);
  }, []);

  const pollActive = useCallback(async () => {
    if (!activeRunId.current) return;
    const r = await apiGet<RunDetail>(
      "/api/seo-crawler/runs/" + activeRunId.current,
    );
    if (!r.ok) return;
    setActive(r);
    if (r.run.status !== "running") {
      activeRunId.current = null;
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      loadList();
    }
  }, [loadList]);

  useEffect(() => {
    loadList();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [loadList]);

  function startPolling(id: number | string) {
    activeRunId.current = id;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(pollActive, 2500);
    pollActive();
  }

  async function startCrawl(targetUrl: string, pages: number) {
    const u = targetUrl.trim();
    if (!u) {
      alert("Enter a URL.");
      return;
    }
    const r = await apiPost<{ ok: boolean; error?: string; id: number }>(
      "/api/seo-crawler/run",
      { url: u, maxPages: pages },
    );
    if (!r.ok) {
      alert("Failed: " + (r.error || "unknown"));
      return;
    }
    startPolling(r.id);
    loadList();
  }

  async function deleteRun(id: number | string) {
    if (!confirm("Delete this crawl run?")) return;
    await apiDelete("/api/seo-crawler/runs/" + id);
    loadList();
  }

  async function openRun(id: number | string) {
    setImportMsg(null);
    const r = await apiGet<RunDetail>("/api/seo-crawler/runs/" + id);
    if (!r.ok) {
      alert("Failed to load run");
      return;
    }
    setDetail({
      ...r,
      pages: r.pages || [],
      aggregate: r.aggregate || {
        topIssues: [],
        quickWins: [],
        worstPages: [],
        totals: {
          pages: (r.pages || []).length,
          failures: 0,
          warnings: 0,
          uniqueIssues: 0,
        },
      },
    });
  }

  async function importTasks(onlyFails: boolean) {
    if (!detail) return;
    setImportMsg({
      kind: "info",
      text: "⏳ Sending issues to SEO Task Manager…",
    });
    const r = await apiPost<ImportResult>(
      "/api/seo-crawler/runs/" + detail.run.id + "/import-tasks",
      { onlyFails },
    );
    if (!r.ok) {
      setImportMsg({ kind: "err", text: "✕ " + (r.error || "Import failed") });
      return;
    }
    setImportMsg({
      kind: "ok",
      text: `✓ Created ${r.created} new tasks · skipped ${r.skipped} existing · out of ${r.total} total issues.`,
    });
  }

  function reAuditPage(pageUrl: string) {
    setDetail(null);
    (window as unknown as { _seoAuditorPrefill?: string })._seoAuditorPrefill =
      pageUrl;
    goToView(router, "seo-auditor");
  }

  function openTasks() {
    setDetail(null);
    goToView(router, "seo-tasks");
  }

  const inputBorder = "1px solid #e2e8f0";

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Site SEO Crawler
              </div>
              <h2 className="view-title">🕸️ Multi-Page SEO Crawler</h2>
              <p className="view-sub">
                Crawl up to 100 pages of any site, run the full T22 19-check
                audit on each, and aggregate into a site-wide SEO score with the
                worst-offender pages surfaced. Same A–F grading scale as the
                single-page audit.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: inputBorder,
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>
            Start a new crawl
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label>
              Root URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && startCrawl(url, maxPages)
                }
                type="url"
                placeholder="https://example.com"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: inputBorder,
                  borderRadius: 6,
                  background: "#fff",
                  marginTop: 4,
                  boxSizing: "border-box",
                }}
              />
            </label>
            <label>
              Max pages
              <select
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: inputBorder,
                  borderRadius: 6,
                  background: "#fff",
                  marginTop: 4,
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <button
              onClick={() => startCrawl(url, maxPages)}
              className="btn btn-primary"
            >
              🕸️ Start crawl
            </button>
          </div>
          {active && (
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: "0.88rem",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1e40af" }}>
                  {active.run.status === "running"
                    ? "⏳ Crawling…"
                    : active.run.status === "completed"
                      ? "✓ Crawl complete"
                      : "⚠️ " + active.run.status}
                </div>
                <div style={{ color: "#475569", marginTop: 4 }}>
                  {active.run.root_url} ·{" "}
                  {active.run.page_count || active.live?.progress || 0} /{" "}
                  {active.run.max_pages} pages
                  {active.live?.errors
                    ? " · " + active.live.errors + " fetch errors"
                    : ""}
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          style={{ background: "#fff", border: inputBorder, borderRadius: 12 }}
        >
          <div
            style={{
              padding: "14px 20px",
              borderBottom: inputBorder,
              fontWeight: 700,
            }}
          >
            Recent crawls
          </div>
          <div style={{ padding: "14px 20px", color: "#64748b" }}>
            {runs === null ? (
              "Loading…"
            ) : runs.length === 0 ? (
              "No crawls yet — kick off your first one above."
            ) : (
              runs.map((run) => {
                const grade = run.site_grade || "—";
                const score =
                  run.avg_score != null ? Number(run.avg_score).toFixed(1) : "—";
                return (
                  <div
                    key={run.id}
                    style={{
                      padding: "12px 0",
                      borderTop: inputBorder,
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1.6rem",
                        fontWeight: 800,
                        color: gradeColor(run.site_grade),
                        minWidth: 42,
                        textAlign: "center",
                      }}
                    >
                      {grade}
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontWeight: 600 }}>
                        {run.root_url}{" "}
                        <StatusBadge status={run.status} />
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.82rem" }}>
                        {run.page_count} pages crawled · avg score {score} ·
                        started {new Date(run.started_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => openRun(run.id)}
                      className="btn btn-primary"
                      style={{ fontSize: "0.82rem" }}
                    >
                      🎯 Open Insights &amp; Automate →
                    </button>
                    <button
                      onClick={() =>
                        startCrawl(run.root_url, run.max_pages || 25)
                      }
                      className="btn btn-secondary"
                      style={{ fontSize: "0.82rem" }}
                      title="Re-crawl this URL"
                    >
                      🔄
                    </button>
                    <button
                      onClick={() => deleteRun(run.id)}
                      className="btn btn-link"
                      style={{ color: "#dc2626", fontSize: "0.82rem" }}
                    >
                      🗑
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {detail && (
        <RunModal
          detail={detail}
          importMsg={importMsg}
          onClose={() => setDetail(null)}
          onImport={importTasks}
          onOpenTasks={openTasks}
          onReAudit={reAuditPage}
          onViewIssue={setIssuePop}
          onRecrawl={() => {
            const r = detail.run;
            setDetail(null);
            startCrawl(r.root_url, r.max_pages || 25);
          }}
        />
      )}

      {issuePop && (
        <IssuePopup issue={issuePop} onClose={() => setIssuePop(null)} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    running: { bg: "#dbeafe", color: "#1e40af", label: "RUNNING" },
    partial: { bg: "#fef3c7", color: "#92400e", label: "PARTIAL" },
    failed: { bg: "#fee", color: "#dc2626", label: "FAILED" },
  };
  const s = map[status] || { bg: "#dcfce7", color: "#166534", label: "DONE" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "0.74rem",
      }}
    >
      {s.label}
    </span>
  );
}

function RunModal({
  detail,
  importMsg,
  onClose,
  onImport,
  onOpenTasks,
  onReAudit,
  onViewIssue,
  onRecrawl,
}: {
  detail: RunDetail;
  importMsg: { kind: "info" | "ok" | "err"; text: string } | null;
  onClose: () => void;
  onImport: (onlyFails: boolean) => void;
  onOpenTasks: () => void;
  onReAudit: (url: string) => void;
  onViewIssue: (issue: TopIssue) => void;
  onRecrawl: () => void;
}) {
  const run = detail.run;
  const pages = detail.pages || [];
  const agg = detail.aggregate as Aggregate;
  const grade = run.site_grade || "—";
  const border = "1px solid #e2e8f0";

  const importColors = {
    info: { bg: "#eff6ff", bd: "#bfdbfe", fg: "#1e40af" },
    ok: { bg: "#dcfce7", bd: "#86efac", fg: "#166534" },
    err: { bg: "#fee", bd: "#fee", fg: "#b91c1c" },
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 20,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "#f8fafc",
          borderRadius: 12,
          maxWidth: 1100,
          width: "100%",
          padding: 24,
          margin: "auto",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 18,
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: "1.1rem",
                wordBreak: "break-all",
              }}
            >
              {run.root_url}
            </div>
            <div style={{ color: "#64748b", fontSize: "0.84rem", marginTop: 3 }}>
              {pages.length} pages · {run.status} · {agg.totals.failures} fails ·{" "}
              {agg.totals.warnings} warnings · {agg.totals.uniqueIssues} unique
              issues
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: "2.4rem",
                  fontWeight: 800,
                  color: gradeColor(run.site_grade),
                  lineHeight: 1,
                }}
              >
                {grade}
              </div>
              <div style={{ fontSize: "0.74rem", color: "#64748b" }}>
                Site grade ·{" "}
                {run.avg_score != null ? Number(run.avg_score).toFixed(1) : "—"}
                /100
              </div>
            </div>
            <button
              onClick={onClose}
              className="btn btn-link"
              style={{ fontSize: "1.4rem" }}
            >
              ✕
            </button>
          </div>
        </div>

        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
        >
          <button
            onClick={() => onImport(true)}
            className="btn btn-primary"
            style={{ fontSize: "0.86rem" }}
          >
            🚀 Send all CRITICAL issues to SEO Task Manager
          </button>
          <button
            onClick={() => onImport(false)}
            className="btn btn-secondary"
            style={{ fontSize: "0.86rem" }}
          >
            📋 Send ALL issues (fails + warnings)
          </button>
          <a
            href={"/api/seo-crawler/runs/" + run.id + "/export.csv"}
            className="btn btn-secondary"
            style={{ fontSize: "0.86rem", textDecoration: "none" }}
            download
          >
            ⬇️ Export CSV
          </a>
          <button
            onClick={onOpenTasks}
            className="btn btn-secondary"
            style={{ fontSize: "0.86rem" }}
          >
            📋 Open SEO Task Manager →
          </button>
        </div>
        {importMsg && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                background: importColors[importMsg.kind].bg,
                border: `1px solid ${importColors[importMsg.kind].bd}`,
                color: importColors[importMsg.kind].fg,
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: "0.86rem",
              }}
            >
              {importMsg.text}
              {importMsg.kind === "ok" && (
                <button
                  onClick={onOpenTasks}
                  style={{
                    color: "#166534",
                    textDecoration: "underline",
                    marginLeft: 6,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.86rem",
                  }}
                >
                  Open SEO Task Manager →
                </button>
              )}
            </div>
          </div>
        )}

        {!agg.topIssues.length && pages.length > 0 ? (
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #F59E0B",
              borderRadius: 10,
              padding: 18,
              marginBottom: 16,
            }}
          >
            <div
              style={{ fontWeight: 700, color: "#78350F", marginBottom: 6 }}
            >
              ⚠️ This crawl was run before per-check insights were enabled
            </div>
            <div
              style={{
                fontSize: "0.86rem",
                color: "#78350F",
                lineHeight: 1.55,
                marginBottom: 12,
              }}
            >
              {pages.length} page{pages.length === 1 ? "" : "s"} were crawled but
              the per-check details weren&apos;t stored, so we can&apos;t show top
              issues, quick wins or send tasks to the SEO Task Manager. Re-run the
              crawl below to unlock all the new automation features.
            </div>
            <button
              onClick={onRecrawl}
              className="btn btn-primary"
              style={{ fontSize: "0.86rem" }}
            >
              🔄 Re-crawl {run.root_url} now
            </button>
          </div>
        ) : !pages.length ? (
          <div
            style={{
              background: "#FFFBEB",
              border: "1px solid #F59E0B",
              borderRadius: 10,
              padding: 18,
              marginBottom: 16,
              color: "#78350F",
              fontSize: "0.9rem",
            }}
          >
            No pages were crawled in this run. Try again with a publicly
            reachable URL.
          </div>
        ) : null}

        {agg.quickWins.length > 0 && (
          <div
            style={{
              background: "linear-gradient(135deg,#fef3c7,#fde68a)",
              border: "1px solid #f59e0b",
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div
              style={{ fontWeight: 700, color: "#78350f", marginBottom: 8 }}
            >
              ⚡ Quick wins — fix these first
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agg.quickWins.map((q) => {
                const issue = agg.topIssues.find((i) => i.id === q.id);
                return (
                  <div
                    key={q.id}
                    style={{
                      background: "#fff",
                      borderRadius: 6,
                      padding: "9px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>
                        {q.label}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#475569" }}>
                        Affects <strong>{q.pagesAffected}</strong> of{" "}
                        {agg.totals.pages} pages ({q.pctOfSite}%) · weight{" "}
                        {q.weight}
                      </div>
                    </div>
                    {issue && (
                      <button
                        onClick={() => onViewIssue(issue)}
                        className="btn btn-secondary"
                        style={{ fontSize: "0.78rem", padding: "5px 10px" }}
                      >
                        View pages
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {agg.topIssues.length > 0 && (
          <div
            style={{
              background: "#fff",
              border,
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: border,
                fontWeight: 700,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span>
                🎯 Site-wide top issues ({agg.topIssues.length} unique)
              </span>
              <span
                style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 500 }}
              >
                Sorted by impact = pages × weight
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.86rem",
                }}
              >
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>Issue</th>
                    <th style={{ padding: 10, width: 90 }}>Fail / Warn</th>
                    <th style={{ padding: 10, width: 90 }}>Pages</th>
                    <th style={{ padding: 10, width: 80 }}>Impact</th>
                    <th style={{ padding: 10, width: 140 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.topIssues.map((i) => (
                    <tr key={i.id} style={{ borderTop: border }}>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ fontWeight: 600 }}>{i.label}</div>
                        {i.fix && (
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#0369a1",
                              marginTop: 3,
                            }}
                          >
                            <strong>Fix:</strong> {i.fix}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        <span style={{ color: "#dc2626", fontWeight: 700 }}>
                          {i.failCount}
                        </span>{" "}
                        /{" "}
                        <span style={{ color: "#ca8a04", fontWeight: 700 }}>
                          {i.warnCount}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        <strong>{i.pagesAffected}</strong>{" "}
                        <span style={{ color: "#64748b" }}>
                          ({i.pctOfSite}%)
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          textAlign: "center",
                          fontWeight: 700,
                        }}
                      >
                        {i.impact}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <button
                          onClick={() => onViewIssue(i)}
                          className="btn btn-link"
                          style={{ fontSize: "0.78rem", padding: 0 }}
                        >
                          View pages →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {agg.worstPages.length > 0 && (
          <div
            style={{
              background: "#fff",
              border,
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: border,
                fontWeight: 700,
              }}
            >
              🔥 Worst-offender pages (lowest scores)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.86rem",
                }}
              >
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>Page</th>
                    <th style={{ padding: 10, width: 70 }}>Score</th>
                    <th style={{ padding: 10, width: 60 }}>Grade</th>
                    <th style={{ padding: 10, width: 160 }}>Issues</th>
                    <th style={{ padding: 10, width: 120 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.worstPages.map((p, idx) => {
                    const s = p.summary || {};
                    return (
                      <tr key={idx} style={{ borderTop: border }}>
                        <td style={{ padding: "8px 10px" }}>
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#0369a1",
                              wordBreak: "break-all",
                            }}
                          >
                            {p.url}
                          </a>
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            textAlign: "center",
                            fontWeight: 700,
                          }}
                        >
                          {p.score}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            textAlign: "center",
                            fontWeight: 800,
                            color: gradeColor(p.grade),
                          }}
                        >
                          {p.grade}
                        </td>
                        <td style={{ padding: "8px 10px", color: "#64748b" }}>
                          {s.passed || 0}✓{" "}
                          <span style={{ color: "#ca8a04" }}>
                            {s.warned || 0}⚠
                          </span>{" "}
                          <span style={{ color: sevColor(s.failed || 0) }}>
                            {s.failed || 0}✕
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <button
                            onClick={() => onReAudit(p.url)}
                            className="btn btn-link"
                            style={{ fontSize: "0.78rem", padding: 0 }}
                          >
                            Re-audit →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <details
          style={{
            background: "#fff",
            border,
            borderRadius: 10,
            marginBottom: 16,
          }}
        >
          <summary
            style={{ padding: "12px 16px", fontWeight: 700, cursor: "pointer" }}
          >
            📄 All {pages.length} crawled pages
          </summary>
          <div style={{ overflowX: "auto", borderTop: border }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.86rem",
              }}
            >
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  <th style={{ textAlign: "left", padding: 10 }}>Page</th>
                  <th style={{ padding: 10, width: 70 }}>Score</th>
                  <th style={{ padding: 10, width: 60 }}>Grade</th>
                  <th style={{ padding: 10 }}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p, idx) => {
                  const s = p.summary || {};
                  return (
                    <tr key={idx} style={{ borderTop: border }}>
                      <td style={{ padding: "8px 10px" }}>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#0369a1", wordBreak: "break-all" }}
                        >
                          {p.url}
                        </a>
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          textAlign: "center",
                          fontWeight: 700,
                        }}
                      >
                        {p.score}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          textAlign: "center",
                          fontWeight: 800,
                          color: gradeColor(p.grade),
                        }}
                      >
                        {p.grade}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#64748b" }}>
                        {s.passed || 0} pass · {s.warned || 0} warn ·{" "}
                        <span style={{ color: "#dc2626" }}>
                          {s.failed || 0} fail
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}

function IssuePopup({
  issue,
  onClose,
}: {
  issue: TopIssue;
  onClose: () => void;
}) {
  const pagesList = [
    ...issue.sampleFailPages.map((u) => ({ u, sev: "fail" })),
    ...issue.sampleWarnPages.map((u) => ({ u, sev: "warn" })),
  ];
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 10001,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          maxWidth: 640,
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 700 }}>{issue.label}</div>
          <button
            onClick={onClose}
            className="btn btn-link"
            style={{ fontSize: "1.2rem" }}
          >
            ✕
          </button>
        </div>
        {issue.message && (
          <div
            style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 10 }}
          >
            {issue.message}
          </div>
        )}
        {issue.fix && (
          <div
            style={{
              background: "#f0f9ff",
              borderLeft: "3px solid #0369a1",
              padding: "9px 12px",
              borderRadius: 4,
              marginBottom: 12,
              fontSize: "0.86rem",
            }}
          >
            <strong>Fix:</strong> {issue.fix}
          </div>
        )}
        <div
          style={{ fontWeight: 600, marginBottom: 6, fontSize: "0.86rem" }}
        >
          Affected pages (showing up to 10):
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {pagesList.map((p, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <span
                style={{
                  color: p.sev === "fail" ? "#dc2626" : "#ca8a04",
                  fontWeight: 700,
                  width: 50,
                }}
              >
                {p.sev.toUpperCase()}
              </span>
              <a
                href={p.u}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#0369a1",
                  wordBreak: "break-all",
                  fontSize: "0.84rem",
                }}
              >
                {p.u}
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
