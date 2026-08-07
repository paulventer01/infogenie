"use client";

// Native React port of the legacy `technical-suite` panel (was
// `window.buildTechnicalSuite` + the `_techPanel`/`runSingleTech`/`runTechSuiteAll`
// helpers inline in app.js, plus `#view-technical-suite`). Three on-demand audits
// (Site Health, Crawlability, Index Signals) that POST a domain to the existing
// Express API (`/api/tech-site-health`, `/api/tech-crawlability`,
// `/api/tech-index-signals`) and grade every signal.

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface TechCheck {
  label: string;
  pass?: boolean;
  sev?: string;
}
interface TechFix {
  label: string;
  sev?: string;
  fix?: string;
}
interface TechResult {
  ok?: boolean;
  score?: number;
  passed?: number;
  total?: number;
  reachable?: boolean;
  error?: string;
  checks?: TechCheck[];
  fixes?: TechFix[];
}

type Kind = "health" | "crawl" | "index";

const ENDPOINTS: Record<Kind, { url: string; label: string }> = {
  health: { url: "/api/tech-site-health", label: "Site Health" },
  crawl: { url: "/api/tech-crawlability", label: "Crawlability" },
  index: { url: "/api/tech-index-signals", label: "Index Signals" },
};

const PANELS: { kind: Kind; title: string; subtitle: string }[] = [
  {
    kind: "health",
    title: "🩺 Site Health",
    subtitle:
      "HTTPS, performance, mobile readiness, accessibility & security headers",
  },
  {
    kind: "crawl",
    title: "🤖 Crawlability",
    subtitle:
      "robots.txt, sitemap, indexability flags, internal links & render-blocking JS",
  },
  {
    kind: "index",
    title: "📑 Index Signals",
    subtitle: "Title, meta, headings, schema, Open Graph & overall index readiness",
  },
];

function sevColor(sev?: string) {
  return sev === "high"
    ? "#DC2626"
    : sev === "med"
      ? "#F59E0B"
      : sev === "low"
        ? "#6366F1"
        : "#10B981";
}
function sevBg(sev?: string) {
  return sev === "high"
    ? "#FEE2E2"
    : sev === "med"
      ? "#FEF3C7"
      : sev === "low"
        ? "#EEF2FF"
        : "#DCFCE7";
}

function cleanDomain(raw: string) {
  return raw
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

export default function TechnicalSuite() {
  const toast = useToast();
  const [domain, setDomain] = useState("");
  const [results, setResults] = useState<Record<Kind, TechResult | null>>({
    health: null,
    crawl: null,
    index: null,
  });
  const [running, setRunning] = useState<Record<Kind, boolean>>({
    health: false,
    crawl: false,
    index: false,
  });

  useEffect(() => {
    try {
      const url = localStorage.getItem("ig-last-analysed-url");
      if (url) setDomain(cleanDomain(url));
    } catch {
      /* ignore */
    }
  }, []);

  async function runSingle(kind: Kind) {
    const dom = cleanDomain(domain);
    if (!dom) {
      toast("Enter a domain in the box above (e.g. example.com) to run the audit.");
      return;
    }
    const m = ENDPOINTS[kind];
    setRunning((r) => ({ ...r, [kind]: true }));
    try {
      const d = await apiPost<TechResult>(m.url, { domain: dom });
      if (d && d.ok) {
        setResults((prev) => ({ ...prev, [kind]: d }));
        toast(`✅ ${m.label}: ${d.score}/100`);
      } else {
        toast(`⚠️ ${m.label} failed${d?.error ? ": " + d.error : ""}`);
      }
    } catch (e) {
      toast(`❌ ${m.label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning((r) => ({ ...r, [kind]: false }));
    }
  }

  async function runAll() {
    await Promise.all([runSingle("health"), runSingle("crawl"), runSingle("index")]);
  }

  const dom = cleanDomain(domain);

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
      <div
        style={{
          background: "linear-gradient(135deg,#ECFDF5,#F0FDF4)",
          border: "1.5px solid #A7F3D0",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: "1.6rem" }}>🛠️</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div
              style={{
                fontFamily: "Sora,sans-serif",
                fontSize: "0.92rem",
                fontWeight: 800,
                color: "#0A1628",
              }}
            >
              Technical Suite
            </div>
            <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 2 }}>
              Audit any live website — enter a domain below or use the one from your last
              analysis.
            </div>
          </div>
          <input
            type="text"
            placeholder="yourdomain.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runAll();
              }
            }}
            style={{
              padding: "10px 14px",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              fontSize: "0.84rem",
              fontFamily: "inherit",
              minWidth: 240,
              background: "white",
              color: "#0A1628",
              outline: "none",
            }}
          />
          <button
            onClick={runAll}
            style={{
              padding: "10px 20px",
              background: "linear-gradient(135deg,#0F766E 0%,#0284C7 100%)",
              border: "none",
              borderRadius: 10,
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#FFFFFF",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ▶ Run All
          </button>
        </div>
        {dom ? (
          <div
            style={{
              fontSize: "0.7rem",
              color: "#047857",
              marginTop: 8,
              marginLeft: 34,
            }}
          >
            Target: <strong>{dom}</strong>
          </div>
        ) : null}
      </div>

      {PANELS.map((p) => (
        <TechPanelView
          key={p.kind}
          title={p.title}
          subtitle={p.subtitle}
          data={results[p.kind]}
          busy={running[p.kind]}
          onRun={() => runSingle(p.kind)}
        />
      ))}
    </div>
  );
}

function TechPanelView({
  title,
  subtitle,
  data,
  busy,
  onRun,
}: {
  title: string;
  subtitle: string;
  data: TechResult | null;
  busy: boolean;
  onRun: () => void;
}) {
  const empty = !data;
  const reachable = !!data && data.reachable !== false;
  const score = data?.score ?? 0;
  const scoreColor = score >= 85 ? "#15803D" : score >= 60 ? "#F59E0B" : "#DC2626";

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        padding: "22px 24px",
        marginBottom: 20,
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
              color: "#0A1628",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 2 }}>
            {subtitle}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {data ? (
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: "1.6rem",
                  fontWeight: 800,
                  color: scoreColor,
                  lineHeight: 1,
                }}
              >
                {score}
                <span style={{ fontSize: "0.85rem", color: "#94A3B8" }}>/100</span>
              </div>
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "#94A3B8",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                {data.passed || 0}/{data.total || 0} passed
              </div>
            </div>
          ) : null}
          <button
            onClick={onRun}
            disabled={busy}
            style={{
              padding: "9px 18px",
              background: "linear-gradient(135deg,#0F766E 0%,#0284C7 100%)",
              border: "none",
              borderRadius: 9,
              fontSize: "0.76rem",
              fontWeight: 700,
              color: "#FFFFFF",
              cursor: busy ? "default" : "pointer",
              whiteSpace: "nowrap",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "⏳ Auditing…" : data ? "↺ Re-run" : "▶ Run audit"}
          </button>
        </div>
      </div>

      {empty ? (
        <div
          style={{
            background: "#F8FAFC",
            border: "1.5px dashed #CBD5E1",
            borderRadius: 12,
            padding: 20,
            textAlign: "center",
            fontSize: "0.8rem",
            color: "#64748B",
          }}
        >
          Click <strong>Run audit</strong> to fetch your live site and grade every signal.
        </div>
      ) : null}

      {data && !reachable ? (
        <div
          style={{
            background: "#FEE2E2",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: 14,
            fontSize: "0.8rem",
            color: "#991B1B",
          }}
        >
          ⚠ Could not reach site: {data.error || "network error"}
        </div>
      ) : null}

      {data && reachable ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {(data.checks || []).map((c, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 9,
                  background: c.pass ? "#F0FDF4" : sevBg(c.sev),
                }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    flexShrink: 0,
                    color: c.pass ? "#15803D" : sevColor(c.sev),
                  }}
                >
                  {c.pass ? "✓" : "✗"}
                </div>
                <div
                  style={{
                    fontSize: "0.74rem",
                    color: "#1F2937",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                </div>
                {!c.pass ? (
                  <span
                    style={{
                      fontSize: "0.58rem",
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 5,
                      background: sevColor(c.sev),
                      color: "white",
                      textTransform: "uppercase",
                    }}
                  >
                    {c.sev}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {(data.fixes || []).length ? (
            <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 14 }}>
              <div
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "#0A1628",
                  marginBottom: 10,
                }}
              >
                🔧 Prioritised Fixes ({data.fixes!.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {data.fixes!.slice(0, 8).map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      background: "#FAFAFA",
                      borderLeft: `3px solid ${sevColor(c.sev)}`,
                      borderRadius: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.6rem",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 5,
                        background: sevColor(c.sev),
                        color: "white",
                        textTransform: "uppercase",
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {c.sev}
                    </span>
                    <div
                      style={{
                        fontSize: "0.74rem",
                        color: "#1F2937",
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>{c.label}.</strong> {c.fix}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              style={{
                fontSize: "0.78rem",
                color: "#15803D",
                fontWeight: 600,
                textAlign: "center",
                padding: 8,
              }}
            >
              🎉 All checks passing.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
