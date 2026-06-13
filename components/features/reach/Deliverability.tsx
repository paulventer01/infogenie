"use client";

// Native React port of the legacy `deliverability` panel (was
// `window.buildDeliverability` + `#view-deliverability` in index.html). Runs a
// live DNS deliverability audit (SPF · DKIM · DMARC · MX · MTA-STS · BIMI)
// against the existing Express API (`POST /api/deliverability/audit`) via
// `lib/api`, and renders the grade, per-record diagnosis and recommended fixes.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface Check {
  ok: boolean;
  severity?: "high" | "med" | "low";
  score?: number;
  msg?: string;
  record?: string | object;
}

interface AuditResult {
  ok: boolean;
  error?: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  domain: string;
  checks: Record<string, Check>;
  recommendations: string[];
}

const GRADE_COLOR: Record<string, string> = {
  A: "#15803D",
  B: "#16A34A",
  C: "#F59E0B",
  D: "#EA580C",
  F: "#B91C1C",
};

const CHECK_ROWS: [string, string][] = [
  ["mx", "MX (Mail Servers)"],
  ["spf", "SPF (Sender Policy)"],
  ["dkim", "DKIM (Signature)"],
  ["dmarc", "DMARC (Policy)"],
  ["mta_sts", "MTA-STS (TLS)"],
  ["bimi", "BIMI (Logo)"],
];

function sevColor(sev?: string): string {
  return sev === "high" ? "#B91C1C" : sev === "med" ? "#EA580C" : "#15803D";
}

function recordPreview(record?: string | object) {
  if (!record) return null;
  const text =
    typeof record === "string"
      ? record.slice(0, 200)
      : JSON.stringify(record).slice(0, 200);
  return (
    <div
      style={{
        fontFamily: "ui-monospace,monospace",
        fontSize: "0.72rem",
        color: "#475569",
        background: "#F1F5F9",
        padding: "6px 10px",
        borderRadius: 4,
        marginTop: 6,
        wordBreak: "break-all",
      }}
    >
      {text}
    </div>
  );
}

function CheckRow({ check, label }: { check?: Check; label: string }) {
  if (!check) return null;
  const ok = check.ok;
  const col = ok ? "#15803D" : sevColor(check.severity);
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderLeft: `4px solid ${col}`,
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.9rem" }}>
          {ok ? "✅" : "❌"} {label}
        </div>
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: col }}>
          {check.score || 0}/100
        </div>
      </div>
      <div style={{ fontSize: "0.82rem", color: "#374151", marginTop: 6 }}>
        {check.msg || ""}
      </div>
      {recordPreview(check.record)}
    </div>
  );
}

export default function Deliverability() {
  const [domain, setDomain] = useState("nike.com");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function run() {
    const d = domain.trim();
    if (!d) {
      setStatus("error");
      setError("Domain required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<AuditResult>("/api/deliverability/audit", {
      domain: d,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  const gc = result ? GRADE_COLOR[result.grade] || "#6B7280" : "#6B7280";

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> Email Auditor
              </div>
              <h2 className="view-title">📬 Email Deliverability Auditor</h2>
              <p className="view-sub">
                Live DNS lookups for SPF, DKIM, DMARC, MX, MTA-STS, and BIMI. Get
                a deliverability grade, per-record diagnosis, and concrete fixes.
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
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Domain
              </label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="e.g. nike.com"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                }}
              />
            </div>
            <button
              onClick={run}
              disabled={status === "loading"}
              style={{
                padding: "10px 22px",
                background: "#14B8A6",
                border: "2px solid #14B8A6",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              📬 Audit
            </button>
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
              ⏳ Looking up DNS records (SPF · DKIM · DMARC · MX · MTA-STS ·
              BIMI)…
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
                  display: "flex",
                  gap: 18,
                  alignItems: "center",
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 24,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    background: gc,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                    width: 90,
                    height: 90,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "3rem",
                    fontWeight: 800,
                    textShadow: "0 1px 2px rgba(0,0,0,.4)",
                  }}
                >
                  {result.grade}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6B7280",
                      fontWeight: 700,
                      letterSpacing: ".06em",
                    }}
                  >
                    DELIVERABILITY GRADE
                  </div>
                  <div
                    style={{
                      fontSize: "1.6rem",
                      fontWeight: 800,
                      color: "#0A1628",
                      marginTop: 2,
                    }}
                  >
                    {result.domain}
                  </div>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "#374151",
                      marginTop: 4,
                    }}
                  >
                    Overall score: <strong>{result.score}/100</strong>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                {CHECK_ROWS.map(([key, label]) => (
                  <CheckRow key={key} check={result.checks[key]} label={label} />
                ))}
              </div>

              {result.recommendations.length ? (
                <div
                  style={{
                    background: "#FEF3C7",
                    border: "1px solid #FCD34D",
                    borderRadius: 10,
                    padding: "16px 20px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: "#92400E",
                      marginBottom: 8,
                    }}
                  >
                    🔧 Recommended fixes ({result.recommendations.length})
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 22,
                      color: "#92400E",
                      fontSize: "0.85rem",
                      lineHeight: 1.7,
                    }}
                  >
                    {result.recommendations.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div
                  style={{
                    background: "#D1FAE5",
                    color: "#065F46",
                    padding: "14px 18px",
                    borderRadius: 10,
                    fontSize: "0.88rem",
                    fontWeight: 700,
                  }}
                >
                  🎉 No critical issues found — your email auth is solid.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
