"use client";

// Native React port of the legacy `web-vitals` panel (was
// `window.buildWebVitals` + `#view-web-vitals` in index.html). Runs a
// Lighthouse audit (mobile + desktop) for a URL against the existing Express
// API (`POST /api/web-vitals/audit`) via `lib/api`, and renders the Lighthouse
// scores, lab Core Web Vitals, real-user CrUX field data, and opportunities.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface Metric {
  good: boolean;
  display?: string;
}

interface FieldData {
  lcp_ms?: number;
  lcp_cat?: string;
  cls?: number;
  cls_cat?: string;
  inp_ms?: number;
  inp_cat?: string;
}

interface Opportunity {
  title: string;
  savings_ms: number;
}

interface Run {
  scores: {
    performance: number;
    accessibility: number;
    best_practices: number;
    seo: number;
  };
  metrics: Record<string, Metric>;
  field_data?: FieldData;
  opportunities?: Opportunity[];
}

interface AuditResult {
  ok: boolean;
  error?: string;
  note?: string;
  mobile?: Run | null;
  desktop?: Run | null;
}

function scoreColor(n: number): string {
  return n >= 90 ? "#15803D" : n >= 50 ? "#F59E0B" : "#DC2626";
}

function catColor(cat?: string): string {
  return cat === "FAST"
    ? "#15803D"
    : cat === "AVERAGE"
      ? "#F59E0B"
      : cat === "SLOW"
        ? "#DC2626"
        : "#6B7280";
}

function RunCard({ run, label }: { run: Run | null | undefined; label: string }) {
  if (!run)
    return (
      <div
        style={{
          background: "#FEE2E2",
          color: "#B91C1C",
          padding: 14,
          borderRadius: 10,
        }}
      >
        {label}: audit failed
      </div>
    );

  const s = run.scores;
  const scoreCards: [string, number][] = [
    ["Performance", s.performance],
    ["Accessibility", s.accessibility],
    ["Best Practices", s.best_practices],
    ["SEO", s.seo],
  ];
  const labMetrics: [string, Metric][] = [
    ["LCP", run.metrics.lcp],
    ["CLS", run.metrics.cls],
    ["TBT", run.metrics.tbt],
    ["FCP", run.metrics.fcp],
    ["SI", run.metrics.si],
    ["TTI", run.metrics.tti],
  ];
  const fd = run.field_data;
  const fieldRows: [string, string, string | undefined][] = fd
    ? [
        ["LCP", fd.lcp_ms ? Math.round(fd.lcp_ms) + "ms" : "—", fd.lcp_cat],
        ["CLS", (fd.cls || 0).toFixed(2), fd.cls_cat],
        ["INP", fd.inp_ms ? Math.round(fd.inp_ms) + "ms" : "—", fd.inp_cat],
      ]
    : [];

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
          color: "#0f172a",
          padding: "14px 20px",
          fontWeight: 800,
          fontSize: "1rem",
        }}
      >
        {label}
      </div>
      <div
        style={{
          padding: "16px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
        }}
      >
        {scoreCards.map(([k, v]) => (
          <div
            key={k}
            style={{
              textAlign: "center",
              background: "#F9FAFB",
              padding: 12,
              borderRadius: 8,
              borderTop: `3px solid ${scoreColor(v)}`,
            }}
          >
            <div
              style={{ fontSize: "1.7rem", fontWeight: 800, color: scoreColor(v) }}
            >
              {v}
            </div>
            <div
              style={{
                fontSize: "0.72rem",
                color: "#6B7280",
                fontWeight: 700,
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              {k}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "0 20px 16px" }}>
        <div
          style={{
            fontSize: "0.7rem",
            color: "#6B7280",
            fontWeight: 700,
            letterSpacing: ".06em",
            marginBottom: 6,
          }}
        >
          CORE WEB VITALS (LAB)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 8,
          }}
        >
          {labMetrics.map(([k, m]) => (
            <div
              key={k}
              style={{
                background: m?.good ? "#ECFDF5" : "#FEF3C7",
                border: `1px solid ${m?.good ? "#A7F3D0" : "#FCD34D"}`,
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div
                style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700 }}
              >
                {k}
              </div>
              <div
                style={{
                  fontSize: "0.92rem",
                  color: m?.good ? "#065F46" : "#92400E",
                  fontWeight: 800,
                }}
              >
                {m?.display || ""}
              </div>
            </div>
          ))}
        </div>
      </div>
      {fd && (
        <div style={{ padding: "0 20px 16px" }}>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#6B7280",
              fontWeight: 700,
              letterSpacing: ".06em",
              marginBottom: 6,
            }}
          >
            FIELD DATA (REAL USERS · CrUX)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 8,
            }}
          >
            {fieldRows.map(([k, v, cat]) => {
              const cc = catColor(cat);
              return (
                <div
                  key={k}
                  style={{
                    background: "#F9FAFB",
                    borderLeft: `3px solid ${cc}`,
                    borderRadius: 5,
                    padding: "8px 10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6B7280",
                      fontWeight: 700,
                    }}
                  >
                    {k}
                  </div>
                  <div
                    style={{
                      fontSize: "0.95rem",
                      color: "#0A1628",
                      fontWeight: 800,
                    }}
                  >
                    {v}
                  </div>
                  <div
                    style={{
                      fontSize: "0.62rem",
                      color: cc,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {cat || ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {run.opportunities && run.opportunities.length > 0 && (
        <div style={{ padding: "0 20px 16px" }}>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#6B7280",
              fontWeight: 700,
              letterSpacing: ".06em",
              marginBottom: 6,
            }}
          >
            TOP OPPORTUNITIES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {run.opportunities.map((o, i) => (
              <div
                key={i}
                style={{
                  background: "#FEF3C7",
                  borderLeft: "3px solid #F59E0B",
                  borderRadius: 5,
                  padding: "8px 10px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.82rem",
                      color: "#92400E",
                      fontWeight: 700,
                    }}
                  >
                    {o.title}
                  </span>
                  <span
                    style={{
                      background: "#F59E0B",
                      color: "#fff",
                      padding: "2px 7px",
                      borderRadius: 4,
                      fontSize: "0.66rem",
                      fontWeight: 800,
                    }}
                  >
                    SAVE {Math.round(o.savings_ms / 100) / 10}s
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WebVitals() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "note">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function run() {
    const u = url.trim();
    if (!u) {
      setStatus("error");
      setMessage("URL required");
      return;
    }
    setStatus("loading");
    setMessage("");
    setResult(null);
    const r = await apiPost<AuditResult>("/api/web-vitals/audit", { url: u });
    if (!r.ok) {
      setStatus("error");
      setMessage(r.error || "failed");
      return;
    }
    if (r.note) {
      setStatus("note");
      setMessage(r.note);
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Web Vitals Auditor
              </div>
              <h2 className="view-title">⚡ Web Vitals Auditor</h2>
              <p className="view-sub">
                Audit any URL&apos;s Core Web Vitals (LCP, CLS, INP) and
                Lighthouse scores (Performance, SEO, Accessibility, Best
                Practices) on mobile and desktop.
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
            padding: 20,
            marginBottom: 18,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#6B7280",
              marginBottom: 4,
            }}
          >
            URL to audit
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="https://nike.com"
              style={{
                flex: 1,
                padding: "9px 12px",
                border: "1px solid #D1D5DB",
                borderRadius: 8,
                fontSize: "0.88rem",
              }}
            />
            <button
              onClick={run}
              disabled={status === "loading"}
              style={{
                padding: "10px 22px",
                background: "#6366F1",
                border: "2px solid #6366F1",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              ⚡ Run Audit
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: "0.74rem", color: "#9CA3AF" }}>
            Audits run in parallel for mobile + desktop · ~30 seconds per URL
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Running Lighthouse on mobile + desktop (this takes ~30s)…
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
              {message}
            </div>
          )}

          {status === "note" && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {message}
            </div>
          )}

          {status === "idle" && result && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
              }}
            >
              <RunCard run={result.mobile} label="📱 Mobile" />
              <RunCard run={result.desktop} label="🖥️ Desktop" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
