"use client";

// Native React port of the legacy `seo-roadmap` panel (was
// `public/js/ig_seo_roadmap.js` + `#view-seo-roadmap` in index.html). Renders
// the 9-step SEO roadmap, reads/writes per-step progress against the existing
// Express API (`GET`/`POST /api/seo-roadmap/progress`) via `lib/api`, and jumps
// to other dashboard tools through `lib/nav` (legacy navigateTo + Next router).
//
// This is the pilot for the panel-migration pattern — see
// `docs/react-panel-migration.md`.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

type Status = "todo" | "in_progress" | "done";

interface StepProgress {
  status: Status;
  updatedAt?: string;
}

interface Step {
  id: string;
  num: string;
  title: string;
  desc: string;
  icon: string;
  color: string;
  tools: { label: string; view: string }[];
}

const STEPS: Step[] = [
  {
    id: "tools",
    num: "01",
    title: "Set Up SEO Tools",
    desc: "Connect your AI providers and configure InfoGenie as your SEO command centre.",
    icon: "🛠️",
    color: "#6366f1",
    tools: [
      { label: "⚙️ AI Providers", view: "ai-providers" },
      { label: "📊 Web Analytics", view: "web-analytics" },
    ],
  },
  {
    id: "keywords",
    num: "02",
    title: "Keyword Research",
    desc: "Find high-intent keywords your audience is actively searching for.",
    icon: "🔑",
    color: "#f59e0b",
    tools: [
      { label: "🔑 Keyword Explorer", view: "keyword-explorer" },
      { label: "📈 SERP Tracker", view: "serp-tracker" },
    ],
  },
  {
    id: "audit",
    num: "03",
    title: "Website SEO Audit",
    desc: "Check for technical issues, broken links, page speed, and mobile-friendliness.",
    icon: "🔍",
    color: "#10b981",
    tools: [
      { label: "🕸️ Multi-page Crawler", view: "seo-crawler" },
      { label: "📋 On-Page Audit", view: "seo-auditor" },
    ],
  },
  {
    id: "onpage",
    num: "04",
    title: "On-Page SEO",
    desc: "Optimise titles, meta descriptions, headings, URLs, images, and internal links.",
    icon: "✍️",
    color: "#3b82f6",
    tools: [
      { label: "📝 Content Scorer", view: "content-score" },
      { label: "🔗 Internal Link Suggester", view: "link-suggester" },
    ],
  },
  {
    id: "content",
    num: "05",
    title: "Create Quality Content",
    desc: "Publish helpful, original content that solves your audience's problems.",
    icon: "📝",
    color: "#8b5cf6",
    tools: [
      { label: "📅 Content Calendar", view: "content-calendar" },
      { label: "🌍 GEO Audit", view: "geo-audit" },
    ],
  },
  {
    id: "technical",
    num: "06",
    title: "Technical SEO",
    desc: "Fix crawl errors, improve site speed, set up sitemap, robots.txt, and HTTPS.",
    icon: "⚙️",
    color: "#ec4899",
    tools: [
      { label: "⚡ Web Vitals", view: "web-vitals" },
      { label: "🧱 Tech Stack Detector", view: "tech-stack" },
    ],
  },
  {
    id: "authority",
    num: "07",
    title: "Build Authority",
    desc: "Earn quality backlinks through guest posts, digital PR, citations, and outreach.",
    icon: "🏆",
    color: "#14b8a6",
    tools: [
      { label: "🔗 Link Prospector", view: "link-prospector" },
      { label: "📡 Backlink Monitor", view: "backlink-monitor" },
    ],
  },
  {
    id: "local",
    num: "08",
    title: "Local SEO",
    desc: "Optimise Google Business Profile, build local citations, and gather reviews.",
    icon: "📍",
    color: "#f97316",
    tools: [
      { label: "📍 Local Lead Finder", view: "local-leads" },
      { label: "🗺️ Local SEO", view: "local-seo" },
    ],
  },
  {
    id: "track",
    num: "09",
    title: "Track & Improve",
    desc: "Monitor rankings, traffic, and conversions. Analyse and keep iterating.",
    icon: "📈",
    color: "#0ea5e9",
    tools: [
      { label: "📈 SERP Tracker", view: "serp-tracker" },
      { label: "📊 Web Analytics", view: "web-analytics" },
    ],
  },
];

// Static CSS — verbatim from the legacy module (dynamic bits below are applied
// as inline styles instead). Mounted once via a <style> tag so the visual output
// is byte-for-byte the same as the ported panel.
const SR_CSS = `
.sr-wrap { max-width:760px; margin:0 auto; padding:0 16px 56px; }
.sr-header { text-align:center; margin-bottom:28px; }
.sr-header h3 { font-size:1.4rem; font-weight:700; margin:0 0 6px; }
.sr-header p { color:var(--text-muted,#6b7280); font-size:.9rem; margin:0; }
.sr-progress-card { background:var(--card-bg,#fff); border:1px solid var(--border,#e5e7eb); border-radius:16px; padding:20px 24px; margin-bottom:28px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.sr-progress-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.sr-progress-label { font-weight:600; font-size:.95rem; }
.sr-progress-pct { font-size:1.5rem; font-weight:800; }
.sr-bar-bg { background:var(--border,#e5e7eb); border-radius:8px; height:10px; overflow:hidden; }
.sr-bar-fill { height:100%; border-radius:8px; transition:width .5s; }
.sr-progress-sub { display:flex; gap:16px; margin-top:10px; font-size:.8rem; color:var(--text-muted,#6b7280); }
.sr-progress-sub span b { color:var(--text,#111); }
.sr-steps { display:flex; flex-direction:column; gap:12px; }
.sr-step { background:var(--card-bg,#fff); border:1px solid var(--border,#e5e7eb); border-left:4px solid var(--step-color); border-radius:0 12px 12px 0; padding:16px; display:flex; gap:14px; transition:box-shadow .18s; }
.sr-step:hover { box-shadow:0 4px 16px rgba(0,0,0,.08); }
.sr-step-done { opacity:.75; border-left-color:var(--step-color); background:var(--surface,#f9fafb); }
.sr-step-wip { box-shadow:0 0 0 2px var(--step-color); }
.sr-step-left { flex-shrink:0; }
.sr-num { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:.8rem; transition:background .3s,color .3s; }
.sr-step-body { flex:1; min-width:0; }
.sr-step-header { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
.sr-step-icon { font-size:1.1rem; }
.sr-step-title { font-weight:700; font-size:.95rem; }
.sr-status { border-radius:10px; padding:2px 8px; font-size:.7rem; font-weight:600; margin-left:auto; white-space:nowrap; }
.sr-done { background:#d1fae5; color:#065f46; }
.sr-wip  { background:#fef3c7; color:#92400e; }
.sr-todo { background:var(--surface,#f3f4f6); color:var(--text-muted,#6b7280); }
.sr-step-desc { font-size:.82rem; color:var(--text-muted,#6b7280); margin-bottom:10px; line-height:1.5; }
.sr-step-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.sr-tools { display:flex; gap:6px; flex-wrap:wrap; }
.sr-tool-btn { background:transparent; border:1px solid var(--step-color); color:var(--step-color); border-radius:6px; padding:4px 10px; font-size:.72rem; cursor:pointer; transition:background .15s; }
.sr-tool-btn:hover { background:var(--step-color); color:#fff; }
.sr-actions { flex-shrink:0; }
.sr-status-btn { background:var(--surface,#f3f4f6); border:1px solid var(--border,#e5e7eb); color:var(--text,#374151); border-radius:7px; padding:5px 12px; font-size:.75rem; font-weight:600; cursor:pointer; }
.sr-status-btn:hover { border-color:var(--step-color); color:var(--step-color); }
.sr-congrats { text-align:center; padding:16px; background:linear-gradient(135deg,#d1fae5,#a7f3d0); border-radius:12px; margin-bottom:20px; font-weight:700; color:#065f46; font-size:1rem; }
`;

function statusLabel(s: Status) {
  if (s === "done")
    return <span className="sr-status sr-done">✓ Done</span>;
  if (s === "in_progress")
    return <span className="sr-status sr-wip">⏳ In progress</span>;
  return <span className="sr-status sr-todo">○ Not started</span>;
}

function nextStatus(current: Status): Status {
  return current === "todo"
    ? "in_progress"
    : current === "in_progress"
      ? "done"
      : "todo";
}

export default function SeoRoadmap() {
  const router = useRouter();
  const [progress, setProgress] = useState<Record<string, StepProgress>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGet<{ ok: boolean; progress?: Record<string, StepProgress> }>(
        "/api/seo-roadmap/progress",
      );
      if (cancelled) return;
      if (res.progress) setProgress(res.progress);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cycle = useCallback(
    async (stepId: string, current: Status) => {
      const next = nextStatus(current);
      // Optimistic — mirrors the legacy module, which updated locally after POST.
      setProgress((p) => ({
        ...p,
        [stepId]: { status: next, updatedAt: new Date().toISOString() },
      }));
      await apiPost("/api/seo-roadmap/progress", { stepId, status: next });
    },
    [],
  );

  const doneCount = STEPS.filter((s) => progress[s.id]?.status === "done").length;
  const wipCount = STEPS.filter(
    (s) => progress[s.id]?.status === "in_progress",
  ).length;
  const pct = Math.round((doneCount / STEPS.length) * 100);
  const barColour = pct === 100 ? "#10b981" : pct > 50 ? "#3b82f6" : "#6366f1";

  return (
    <div className="view-header-wrap">
      <style dangerouslySetInnerHTML={{ __html: SR_CSS }} />
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> SEO Roadmap
              </div>
              <h2 className="view-title">🗺️ SEO Roadmap</h2>
              <p className="view-sub">
                A 9-step system to rank your website on Google — track your
                progress and jump to the right InfoGenie tool at each step.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 0",
              color: "var(--text-muted,#6b7280)",
            }}
          >
            🗺️ Loading roadmap…
          </div>
        ) : (
          <div className="sr-wrap">
            <div className="sr-header">
              <h3>🗺️ SEO Roadmap</h3>
              <p>
                A step-by-step system to rank your website — track progress and
                jump to each InfoGenie tool.
              </p>
            </div>

            <div className="sr-progress-card">
              <div className="sr-progress-top">
                <div className="sr-progress-label">Your SEO progress</div>
                <div className="sr-progress-pct" style={{ color: barColour }}>
                  {pct}%
                </div>
              </div>
              <div className="sr-bar-bg">
                <div
                  className="sr-bar-fill"
                  style={{ width: `${pct}%`, background: barColour }}
                />
              </div>
              <div className="sr-progress-sub">
                <span>
                  <b>{doneCount}</b> completed
                </span>
                <span>
                  <b>{wipCount}</b> in progress
                </span>
                <span>
                  <b>{STEPS.length - doneCount - wipCount}</b> remaining
                </span>
              </div>
            </div>

            {pct === 100 && (
              <div className="sr-congrats">
                🎉 All 9 steps complete — your SEO system is fully set up!
              </div>
            )}

            <div className="sr-steps">
              {STEPS.map((step) => {
                const st: Status = progress[step.id]?.status || "todo";
                const isDone = st === "done";
                const isWip = st === "in_progress";
                return (
                  <div
                    key={step.id}
                    className={`sr-step${isDone ? " sr-step-done" : isWip ? " sr-step-wip" : ""}`}
                    style={
                      { "--step-color": step.color } as React.CSSProperties
                    }
                    data-step-id={step.id}
                  >
                    <div className="sr-step-left">
                      <div
                        className="sr-num"
                        style={{
                          background: isDone
                            ? step.color
                            : "var(--border,#e5e7eb)",
                          color: isDone ? "#fff" : "var(--text-muted,#9ca3af)",
                        }}
                      >
                        {isDone ? "✓" : step.num}
                      </div>
                    </div>
                    <div className="sr-step-body">
                      <div className="sr-step-header">
                        <span className="sr-step-icon">{step.icon}</span>
                        <span className="sr-step-title">{step.title}</span>
                        {statusLabel(st)}
                      </div>
                      <div className="sr-step-desc">{step.desc}</div>
                      <div className="sr-step-footer">
                        <div className="sr-tools">
                          {step.tools.map((t) => (
                            <button
                              key={t.view}
                              className="sr-tool-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                goToView(router, t.view);
                              }}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        <div className="sr-actions">
                          <button
                            className="sr-status-btn"
                            onClick={() => cycle(step.id, st)}
                          >
                            {st === "todo"
                              ? "Mark in progress"
                              : st === "in_progress"
                                ? "Mark done ✓"
                                : "Reset"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
