"use client";

// Native React port of the legacy `brand-safety` panel (was
// `window.buildBrandSafety` in public/js/ig_moat_features.js +
// `#view-brand-safety`). Audits content against compliance jurisdictions and
// lists recent audits against the existing Express API
// (`POST /api/brand-safety/check`, `GET /api/brand-safety/history`).

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Flag {
  rule?: string;
  severity?: string;
  quote?: string;
  issue?: string;
  fix?: string;
}
interface BSResults {
  risk_score?: number;
  overall_verdict?: string;
  summary?: string;
  flags?: Flag[];
  compliant_points?: string[];
  required_disclaimers?: string[];
  rewritten_version?: string;
  content_snippet?: string;
}
interface BSCheckResult {
  ok: boolean;
  error?: string;
  results?: BSResults;
}
interface BSHistItem {
  check_type?: string;
  vertical?: string;
  jurisdictions?: string[];
  overall_verdict?: string;
  risk_score?: number;
  content_snippet?: string;
  created_at: string;
}
interface BSHistResult {
  ok: boolean;
  checks?: BSHistItem[];
}

const CHECK_TYPES: [string, string][] = [
  ["ad_copy", "Ad Copy"],
  ["landing_page", "Landing Page Copy"],
  ["email", "Email Body"],
  ["social_post", "Social Post"],
  ["disclaimer", "Disclaimer Text"],
];
const VERTICALS: [string, string][] = [
  ["general", "General"],
  ["finance", "Finance / FinTech"],
  ["health", "Health & Wellness"],
  ["crypto", "Crypto / Web3"],
  ["forex", "Forex / CFDs"],
  ["e-commerce", "E-Commerce"],
  ["saas", "SaaS"],
  ["education", "Education"],
];
const JURISDICTIONS: [string, string][] = [
  ["ftc", "FTC (US)"],
  ["gdpr", "GDPR (EU)"],
  ["fca", "FCA (UK Finance)"],
  ["esma", "ESMA (EU Finance)"],
  ["hipaa", "HIPAA (US Health)"],
  ["asa", "ASA (UK General)"],
];

const SEV_COL: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  critical: "#ef4444",
};
const VERDICT_COL: Record<string, string> = {
  pass: "#10b981",
  caution: "#f59e0b",
  fail: "#ef4444",
};

function riskCol(score: number) {
  return score >= 70 ? "#ef4444" : score >= 40 ? "#f59e0b" : "#10b981";
}
function pct(val: number, max: number) {
  return Math.min(100, Math.max(0, Math.round((val / max) * 100)));
}

function VerdictBadge({ v }: { v?: string }) {
  return (
    <span
      style={{
        background: VERDICT_COL[v || ""] || "#6b7280",
        color: "#fff",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: ".75rem",
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      {(v || "").replace(/_/g, " ")}
    </span>
  );
}

export default function BrandSafety() {
  const [checkType, setCheckType] = useState(CHECK_TYPES[0][0]);
  const [vertical, setVertical] = useState(VERTICALS[0][0]);
  const [jurs, setJurs] = useState<string[]>(["ftc"]);
  const [content, setContent] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BSResults | null>(null);
  const [history, setHistory] = useState<BSHistItem[]>([]);

  function toggleJur(k: string) {
    setJurs((prev) =>
      prev.includes(k) ? prev.filter((j) => j !== k) : [...prev, k],
    );
  }

  async function loadHistory() {
    const d = await apiGet<BSHistResult>("/api/brand-safety/history");
    if (d.ok && d.checks) setHistory(d.checks);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function run() {
    const c = content.trim();
    if (!c) {
      alert("Paste some content to audit.");
      return;
    }
    const selected = jurs;
    if (!selected.length) {
      alert("Select at least one jurisdiction.");
      return;
    }
    setRunning(true);
    const d = await apiPost<BSCheckResult>("/api/brand-safety/check", {
      check_type: checkType,
      content: c,
      vertical,
      jurisdictions: selected,
    });
    setRunning(false);
    if (!d.ok) {
      alert(d.error || "Error");
      return;
    }
    setResults(d.results || {});
    loadHistory();
  }

  function renderResult() {
    if (!results) return null;
    const r = results;
    const score = r.risk_score || 0;
    const verdictCol = VERDICT_COL[r.overall_verdict || ""] || "#6b7280";
    return (
      <div className="ig-card" style={{ borderLeft: `4px solid ${verdictCol}`, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: `conic-gradient(${riskCol(score)} ${pct(score, 100)}%,#e5e7eb 0)`,
              fontSize: "1rem",
              fontWeight: 800,
              color: riskCol(score),
            }}
          >
            {score}
          </div>
          <div>
            <div
              style={{
                fontSize: ".75rem",
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              Risk Score · {r.overall_verdict || ""}
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>Compliance Audit Result</div>
            <div style={{ marginTop: 4 }}>
              <VerdictBadge v={r.overall_verdict} />
            </div>
          </div>
        </div>
        <p style={{ color: "#374151", marginBottom: 16 }}>{r.summary || ""}</p>

        {r.flags && r.flags.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>
              FLAGS ({r.flags.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {r.flags.map((f, i) => (
                <div
                  key={i}
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    borderLeft: `3px solid ${SEV_COL[f.severity || ""] || "#6b7280"}`,
                    background: "#f9fafb",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 4,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: ".85rem" }}>{f.rule || ""}</span>
                    <span
                      style={{
                        background: SEV_COL[f.severity || ""] || "#6b7280",
                        color: "#fff",
                        borderRadius: 4,
                        padding: "1px 6px",
                        fontSize: ".7rem",
                        fontWeight: 700,
                      }}
                    >
                      {(f.severity || "").toUpperCase()}
                    </span>
                  </div>
                  {f.quote && (
                    <div
                      style={{
                        fontSize: ".8rem",
                        background: "#fee2e2",
                        borderRadius: 4,
                        padding: "4px 8px",
                        color: "#991b1b",
                        marginBottom: 4,
                      }}
                    >
                      &quot;{f.quote}&quot;
                    </div>
                  )}
                  <div style={{ fontSize: ".85rem", color: "#374151", marginBottom: 4 }}>
                    {f.issue || ""}
                  </div>
                  <div style={{ fontSize: ".85rem", color: "#10b981" }}>
                    <strong>Fix:</strong> {f.fix || ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {r.compliant_points && r.compliant_points.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#10b981", marginBottom: 6 }}>
              ✅ COMPLIANT POINTS
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: ".85rem", color: "#374151" }}>
              {r.compliant_points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {r.required_disclaimers && r.required_disclaimers.length > 0 && (
          <div style={{ background: "#eff6ff", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#3b82f6", marginBottom: 6 }}>
              📋 REQUIRED DISCLAIMERS
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: ".85rem", color: "#374151" }}>
              {r.required_disclaimers.map((d2, i) => (
                <li key={i}>{d2}</li>
              ))}
            </ul>
          </div>
        )}

        {r.rewritten_version && r.rewritten_version !== r.content_snippet && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: ".75rem", fontWeight: 600, color: "#8b5cf6", marginBottom: 6 }}>
              ✏️ COMPLIANT REWRITE
            </div>
            <div
              style={{
                background: "#faf5ff",
                borderRadius: 8,
                padding: 12,
                fontSize: ".85rem",
                color: "#374151",
                whiteSpace: "pre-wrap",
              }}
            >
              {r.rewritten_version}
            </div>
            <button
              className="btn btn-sm btn-outline"
              style={{ marginTop: 6 }}
              onClick={() => navigator.clipboard.writeText(r.rewritten_version || "")}
            >
              Copy rewrite
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="view-header">
        <h2>🔒 Brand Safety &amp; Compliance</h2>
        <p className="view-sub">
          Audit ad copy and landing pages against FTC, GDPR, FCA, ESMA, HIPAA, and ASA rules before
          you publish.
        </p>
      </div>
      <div className="ig-card" style={{ maxWidth: 760, marginBottom: 24 }}>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="form-group">
            <label>Check Type</label>
            <select
              className="form-control"
              value={checkType}
              onChange={(e) => setCheckType(e.target.value)}
            >
              {CHECK_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Vertical / Industry</label>
            <select
              className="form-control"
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
            >
              {VERTICALS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Jurisdictions to check (select multiple)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {JURISDICTIONS.map(([k, l]) => (
              <label
                key={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  padding: "4px 10px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  fontSize: ".85rem",
                }}
              >
                <input type="checkbox" checked={jurs.includes(k)} onChange={() => toggleJur(k)} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label>Content to Audit</label>
          <textarea
            className="form-control"
            rows={6}
            placeholder="Paste your ad copy, landing page text, email body, or social post here…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ width: "100%" }}
          disabled={running}
          onClick={run}
        >
          {running ? "Auditing…" : "🔒 Run Compliance Audit"}
        </button>
      </div>
      <div>{renderResult()}</div>
      <div>
        {history.length > 0 && (
          <>
            <h3
              style={{
                fontSize: ".9rem",
                fontWeight: 600,
                color: "#6b7280",
                margin: "16px 0 8px",
              }}
            >
              Recent Audits
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map((c, i) => {
                const col = VERDICT_COL[c.overall_verdict || ""] || "#6b7280";
                return (
                  <div
                    key={i}
                    className="ig-card"
                    style={{ padding: 12, borderLeft: `3px solid ${col}` }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {(c.check_type || "").replace(/_/g, " ")} · {c.vertical}
                      </span>
                      <span style={{ color: "#6b7280", fontSize: ".8rem" }}>
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontSize: ".8rem", color: "#6b7280", marginTop: 2 }}>
                      {(c.jurisdictions || []).join(", ")}
                    </div>
                    <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                      <VerdictBadge v={c.overall_verdict} />
                      <span style={{ fontSize: ".8rem" }}>Risk: {c.risk_score}</span>
                    </div>
                    <div style={{ fontSize: ".8rem", color: "#374151", marginTop: 4 }}>
                      {(c.content_snippet || "").slice(0, 80)}…
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
