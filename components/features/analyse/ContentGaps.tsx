"use client";

// Native React port of the legacy `content-gaps` panel (was
// `buildContentGaps` / `runContentGaps` / `renderContentGaps` in
// public/js/ig_mentions_gaps.js + `#view-content-gaps` in index.html).
// Reads sitemaps for your domain and your competitors and asks AI to find the
// topics they cover that you don't, via the existing Express API
// (`POST /api/content-gaps`) through `lib/api`. Pre-fills the domain +
// competitor picker from the legacy `window.analysisData` global set by the
// home-page competitor analysis.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api";

interface Gap {
  topic: string;
  rationale: string;
  suggested_angle?: string;
  priority?: number;
  competitors_covering?: string[];
}
interface GapsResult {
  ok: boolean;
  error?: string;
  detail?: string;
  message?: string;
  gaps?: Gap[];
  dataSource?: string;
  confidence?: string;
  dataOrigin?: string;
  yourPagesAnalyzed?: number;
  competitorPagesAnalyzed?: number;
  competitorsWithSitemap?: string[];
  blockedDomains?: string[];
}

interface AnalysisCompetitor {
  domain?: string;
  url?: string;
  website?: string;
  name?: string;
}
interface AnalysisData {
  url?: string;
  domain?: string;
  competitors?: AnalysisCompetitor[];
}

function norm(u: string): string {
  return String(u || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}

type Status = "idle" | "loading" | "error" | "sitemap" | "done";

export default function ContentGaps() {
  const { ownDom, compOptions } = useMemo(() => {
    const ad = getAnalysisData();
    const own = norm(ad.url || ad.domain || "");
    const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
    const opts = comps
      .map((c) => norm(c.domain || c.url || c.website || ""))
      .filter((d) => d && /\./.test(d));
    return { ownDom: own, compOptions: [...new Set(opts)] };
  }, []);

  const [domain, setDomain] = useState(ownDom);
  const [selected, setSelected] = useState<string[]>(() =>
    compOptions.slice(0, 4),
  );
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<GapsResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [sitemap, setSitemap] = useState<{
    detail: string;
    blocked: string;
    found: string;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (status !== "loading") return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  function toggleComp(d: string) {
    setSelected((prev) =>
      prev.includes(d)
        ? prev.filter((x) => x !== d)
        : prev.length >= 8
          ? prev
          : [...prev, d],
    );
  }

  async function runContentGaps() {
    const dom = domain.trim();
    const competitors = selected.slice(0, 8);
    if (!dom) {
      setStatus("error");
      setErrorMsg("⚠️ Enter your domain");
      return;
    }
    if (!competitors.length) {
      setStatus("error");
      setErrorMsg("⚠️ Pick at least one competitor from the list");
      return;
    }
    setStatus("loading");
    setData(null);
    setSitemap(null);
    setErrorMsg("");

    const j = await apiPost<GapsResult>("/api/content-gaps", {
      domain: dom,
      competitors,
    });

    if (!j.ok) {
      if (j.error === "sitemap-unavailable") {
        setSitemap({
          detail: j.detail || "",
          blocked: (j.blockedDomains || []).join(", ") || "—",
          found: (j.competitorsWithSitemap || []).join(", ") || "none",
        });
        setStatus("sitemap");
        return;
      }
      setErrorMsg(
        j.error || j.detail || j.message || "Content-gap analysis failed",
      );
      setStatus("error");
      return;
    }
    setData(j);
    setStatus("done");
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{
          background:
            "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#FEF3C7" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(254,243,199,.75)" }}
                >
                  Analyse
                </span>{" "}
                <span
                  className="bc-sep"
                  style={{ color: "rgba(255,255,255,.3)" }}
                >
                  ›
                </span>{" "}
                Content Gaps
              </div>
              <h2 className="view-title">AI Content-Gap Ideation</h2>
              <p className="view-sub">
                Reads sitemaps for your domain and your competitors, then asks AI
                to find the topics they cover that you don&apos;t — with a
                suggested angle for each gap.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 60 }}
      >
        <div className="cg-controls">
          <div className="cg-control">
            <label className="cg-lbl">Your domain</label>
            <input
              type="text"
              className="cg-input"
              placeholder="example.com"
              maxLength={120}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="cg-control" style={{ flex: 2 }}>
            <label className="cg-lbl">
              Competitor domains{" "}
              {compOptions.length ? (
                <span style={{ fontWeight: 400, color: "#64748B" }}>
                  · {compOptions.length} detected from your analysis
                </span>
              ) : null}
            </label>
            {compOptions.length ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "6px 0",
                }}
              >
                {compOptions.map((d) => {
                  const on = selected.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleComp(d)}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: on
                          ? "1px solid #9333EA"
                          : "1px solid #CBD5E1",
                        background: on ? "#9333EA" : "#fff",
                        color: on ? "#fff" : "#475569",
                      }}
                    >
                      {on ? "✓ " : ""}
                      {d}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="cg-input" style={{ color: "#64748B" }}>
                No competitors detected yet
              </div>
            )}
          </div>
          <div
            className="cg-control"
            style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end" }}
          >
            <button
              className="cg-btn-run"
              disabled={status === "loading"}
              onClick={runContentGaps}
            >
              {status === "loading" ? "⏳ Analysing…" : "🧩 Find gaps"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          {status === "idle" && (
            <div className="cg-empty">
              {domain && (selected.length || compOptions.length) ? (
                <>
                  Click <strong>Find gaps</strong> to compare{" "}
                  <strong>{domain}</strong>
                  {selected.length
                    ? ` vs ${selected.length} competitor${selected.length > 1 ? "s" : ""}`
                    : ""}
                  .
                </>
              ) : (
                <>
                  Run an analysis on the home page first, or enter your domain and
                  pick at least one competitor, then click{" "}
                  <strong>Find gaps</strong>.
                </>
              )}
            </div>
          )}

          {status === "loading" && (
            <div
              className="cg-loading"
              style={{ textAlign: "center", padding: 24 }}
            >
              <div
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: "#0F172A",
                  marginBottom: 6,
                }}
              >
                ⏳ Reading sitemaps and asking AI to spot the topic gaps…
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  color: "#475569",
                  marginBottom: 10,
                }}
              >
                {selected.length + 1} domains · sitemap fetch + AI gap analysis
                (typical: 10-25s)
              </div>
              <div
                style={{
                  fontSize: "1.5rem",
                  fontFamily: "'Sora',sans-serif",
                  fontWeight: 800,
                  color: "#0066FF",
                }}
              >
                ⏱ {mm}:{ss}
              </div>
            </div>
          )}

          {status === "error" && <div className="cg-error">⚠️ {errorMsg}</div>}

          {status === "sitemap" && sitemap && (
            <div
              className="cg-error"
              style={{ textAlign: "left", lineHeight: 1.55 }}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>
                ⚠️ Sitemap unavailable for one or more domains
              </div>
              {sitemap.detail && (
                <div style={{ fontSize: "0.85rem", marginBottom: 6 }}>
                  {sitemap.detail}
                </div>
              )}
              <div
                style={{ fontSize: "0.8rem", color: "#475569", marginTop: 10 }}
              >
                <div>
                  • Blocked / no sitemap: <strong>{sitemap.blocked}</strong>
                </div>
                <div>
                  • Sitemaps successfully read: <strong>{sitemap.found}</strong>
                </div>
                <div style={{ marginTop: 8, color: "#0066FF" }}>
                  💡 Fix: remove the blocked domains from the picker above and run
                  again. Many big sites (Cloudflare-protected) block automated
                  sitemap fetches.
                </div>
              </div>
            </div>
          )}

          {status === "done" && data && <GapsView data={data} />}
        </div>
      </div>
    </div>
  );
}

function GapsView({ data }: { data: GapsResult }) {
  if (!data.gaps || !data.gaps.length) {
    return (
      <div className="cg-empty">
        No clear gaps found — your content coverage matches or exceeds the
        competitors analysed.
      </div>
    );
  }
  return (
    <>
      <div className="mt-ribbon">
        <span
          className="mt-ribbon-dot"
          style={{ background: "#9333EA" }}
        ></span>
        <span>📊 {data.dataSource || "AI-verified"}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span
          style={{
            textTransform: "uppercase",
            letterSpacing: ".04em",
            fontSize: ".65rem",
          }}
        >
          {data.confidence || "medium"} confidence
        </span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ fontWeight: 500, opacity: 0.85 }}>
          {data.dataOrigin || ""} · {data.yourPagesAnalyzed} of your pages vs{" "}
          {data.competitorPagesAnalyzed} competitor pages
        </span>
      </div>
      <div className="cg-grid">
        {data.gaps.map((g, i) => {
          const pri = g.priority || 5;
          const priColor =
            pri >= 8 ? "#EF4444" : pri >= 6 ? "#F59E0B" : "#10B981";
          return (
            <div className="cg-card" key={i}>
              <div className="cg-card-head">
                <div className="cg-priority" style={{ background: priColor }}>
                  P{pri}
                </div>
                <div className="cg-card-topic">{g.topic}</div>
              </div>
              <div className="cg-card-rationale">{g.rationale}</div>
              {g.suggested_angle && (
                <div className="cg-card-angle">
                  <strong>Suggested angle:</strong> {g.suggested_angle}
                </div>
              )}
              {g.competitors_covering && g.competitors_covering.length > 0 && (
                <div className="cg-card-comps">
                  Covered by:{" "}
                  {g.competitors_covering.map((c, ci) => (
                    <span className="cg-comp-tag" key={ci}>
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
