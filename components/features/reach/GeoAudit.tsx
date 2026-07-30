"use client";

// Native React port of the legacy `geo-audit` panel (was
// `window.buildGeoAudit` + `#view-geo-audit` in index.html, originally in
// public/js/ig_seo.js). Scores how well a page is structured to be cited by
// generative engines (ChatGPT / Perplexity / Gemini) against the existing
// Express API (`POST /api/geo-audit/run`, `GET /api/geo-audit/runs`) via
// `lib/api`.
//
// Citation tracking: POST /api/geo-audit/runs/:id/cite-check queries the
// actual AI engines with page-derived questions and records whether your
// domain appears in their responses.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Check {
  status: "pass" | "warn" | "fail";
  weight: number;
  earned: number;
  label: string;
  message: string;
  fix?: string;
}

interface AuditResult {
  ok: boolean;
  error?: string;
  id?: string;
  url: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  summary?: { passed?: number; warned?: number; failed?: number; words?: number };
  checks?: Check[];
}

interface RunRow {
  id?: string;
  url: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  created_at: string;
}

interface RunsResult {
  ok: boolean;
  runs?: RunRow[];
}

interface ProviderResult {
  name: string;
  cited: boolean;
  answer?: string;
  competitors?: string[];
  error?: string;
}

interface QueryResult {
  query: string;
  providers: ProviderResult[];
}

interface CitationCheck {
  ok: boolean;
  id?: string;
  domain?: string;
  queries?: string[];
  results?: QueryResult[];
  citationRate?: number;
  totalProbes?: number;
  totalCited?: number;
  check?: {
    domain: string;
    queries: string[];
    results: QueryResult[];
    citation_rate: number;
    checked_at: string;
  } | null;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#ca8a04",
  D: "#ea580c",
  F: "#dc2626",
};

const PROVIDER_ICONS: Record<string, string> = {
  ChatGPT: "🤖",
  Perplexity: "🔭",
  Gemini: "✨",
};

function sortChecks(checks: Check[]): Check[] {
  const ord = { fail: 0, warn: 1, pass: 2 };
  return [...checks].sort((a, b) =>
    ord[a.status] !== ord[b.status]
      ? ord[a.status] - ord[b.status]
      : b.weight - a.weight,
  );
}

function CitationPanel({
  runId,
  existingCheck,
}: {
  runId: string;
  existingCheck?: CitationCheck["check"];
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CitationCheck | null>(
    existingCheck
      ? {
          ok: true,
          domain: existingCheck.domain,
          queries: existingCheck.queries,
          results: existingCheck.results,
          citationRate: existingCheck.citation_rate,
        }
      : null,
  );
  const [expanded, setExpanded] = useState<number | null>(null);

  async function runCheck() {
    setChecking(true);
    const r = await apiPost<CitationCheck>(
      `/api/geo-audit/runs/${runId}/cite-check`,
      {},
    );
    setChecking(false);
    if (r.ok) setResult(r);
  }

  const pct = result?.citationRate != null
    ? Math.round(result.citationRate * 100)
    : null;
  const pctColor =
    pct == null ? "#64748b" : pct >= 60 ? "#16a34a" : pct >= 30 ? "#ca8a04" : "#dc2626";

  return (
    <div
      style={{
        marginTop: 24,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderBottom: result ? "1px solid #e2e8f0" : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.97rem" }}>
            🔍 AI Citation Tracker
          </div>
          <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: 2 }}>
            Queries ChatGPT, Perplexity &amp; Gemini with questions derived from
            this page and checks if your domain appears in their answers.
          </div>
        </div>
        <button
          onClick={runCheck}
          disabled={checking}
          className="btn btn-outline"
          style={{ whiteSpace: "nowrap" }}
        >
          {checking
            ? "⏳ Checking…"
            : result
              ? "🔄 Re-check"
              : "🔍 Check AI citation"}
        </button>
      </div>

      {result && (
        <div style={{ padding: "16px 20px" }}>
          {/* Summary row */}
          <div
            style={{
              display: "flex",
              gap: 20,
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: 18,
            }}
          >
            <div style={{ textAlign: "center", minWidth: 90 }}>
              <div
                style={{
                  fontSize: "2.4rem",
                  fontWeight: 800,
                  color: pctColor,
                  lineHeight: 1,
                }}
              >
                {pct}%
              </div>
              <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: 2 }}>
                citation rate
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>{result.domain}</div>
              <div style={{ color: "#64748b", fontSize: "0.82rem", marginTop: 2 }}>
                {result.totalCited ?? 0} of {result.totalProbes ?? 0} AI responses
                cited your domain
              </div>
              <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: 2 }}>
                across {result.queries?.length ?? 0} auto-generated queries ·{" "}
                {(result.results ?? []).reduce(
                  (s, r) => s + r.providers.length,
                  0,
                )}{" "}
                total probes
              </div>
            </div>
            {/* Per-provider pills */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["ChatGPT", "Perplexity", "Gemini"].map((pname) => {
                const probes = (result.results ?? []).flatMap((r) =>
                  r.providers.filter((p) => p.name === pname),
                );
                if (!probes.length) return null;
                const hits = probes.filter((p) => p.cited).length;
                const pillColor =
                  hits === probes.length
                    ? "#dcfce7"
                    : hits > 0
                      ? "#fef9c3"
                      : "#fee2e2";
                const textColor =
                  hits === probes.length
                    ? "#15803d"
                    : hits > 0
                      ? "#a16207"
                      : "#b91c1c";
                return (
                  <div
                    key={pname}
                    style={{
                      background: pillColor,
                      color: textColor,
                      borderRadius: 20,
                      padding: "4px 12px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                  >
                    {PROVIDER_ICONS[pname]} {pname}: {hits}/{probes.length}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-query breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(result.results ?? []).map((qr, qi) => {
              const anyCited = qr.providers.some((p) => p.cited);
              const allCited = qr.providers.every((p) => p.cited);
              const borderColor = allCited
                ? "#16a34a"
                : anyCited
                  ? "#ca8a04"
                  : "#dc2626";
              const open = expanded === qi;
              const allCompetitors = [
                ...new Set(qr.providers.flatMap((p) => p.competitors ?? [])),
              ].slice(0, 5);
              return (
                <div
                  key={qi}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderLeft: `4px solid ${borderColor}`,
                    borderRadius: 6,
                  }}
                >
                  <div
                    onClick={() => setExpanded(open ? null : qi)}
                    style={{
                      padding: "10px 14px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, fontWeight: 600, fontSize: "0.88rem" }}>
                      {qr.query}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {qr.providers.map((p) => (
                        <span
                          key={p.name}
                          title={p.name}
                          style={{
                            fontSize: "0.75rem",
                            background: p.cited ? "#dcfce7" : "#fee2e2",
                            color: p.cited ? "#15803d" : "#b91c1c",
                            borderRadius: 10,
                            padding: "2px 8px",
                          }}
                        >
                          {PROVIDER_ICONS[p.name]} {p.cited ? "cited" : "not cited"}
                        </span>
                      ))}
                    </div>
                    <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                      {open ? "▲" : "▼"}
                    </span>
                  </div>
                  {open && (
                    <div
                      style={{
                        borderTop: "1px solid #e2e8f0",
                        padding: "10px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {qr.providers.map((p) => (
                        <div key={p.name}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: "0.83rem",
                              marginBottom: 4,
                            }}
                          >
                            {PROVIDER_ICONS[p.name]} {p.name}
                            {p.cited ? (
                              <span
                                style={{
                                  marginLeft: 8,
                                  color: "#16a34a",
                                  fontWeight: 700,
                                }}
                              >
                                ✓ cited your domain
                              </span>
                            ) : (
                              <span
                                style={{
                                  marginLeft: 8,
                                  color: "#dc2626",
                                  fontWeight: 700,
                                }}
                              >
                                ✕ not cited
                              </span>
                            )}
                          </div>
                          {p.answer && (
                            <div
                              style={{
                                background: "#f8fafc",
                                borderRadius: 4,
                                padding: "8px 10px",
                                fontSize: "0.82rem",
                                color: "#334155",
                                fontStyle: "italic",
                                maxHeight: 100,
                                overflow: "auto",
                              }}
                            >
                              &ldquo;{p.answer.slice(0, 300)}
                              {p.answer.length > 300 ? "…" : ""}&rdquo;
                            </div>
                          )}
                          {p.error && (
                            <div style={{ color: "#dc2626", fontSize: "0.8rem" }}>
                              Error: {p.error}
                            </div>
                          )}
                          {(p.competitors ?? []).length > 0 && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: "0.78rem",
                                color: "#64748b",
                              }}
                            >
                              Cited instead: {p.competitors!.join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                      {allCompetitors.length > 0 && (
                        <div
                          style={{
                            background: "#fef9c3",
                            borderRadius: 6,
                            padding: "8px 10px",
                            fontSize: "0.8rem",
                            color: "#92400e",
                          }}
                        >
                          <strong>Competing domains cited in this answer:</strong>{" "}
                          {allCompetitors.join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {pct !== null && pct < 30 && (
            <div
              style={{
                marginTop: 14,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: "0.85rem",
                color: "#1d4ed8",
              }}
            >
              <strong>💡 Tip:</strong> Your citation rate is low. Improve your
              GEO score above (especially JSON-LD schema, question-style headings,
              and concise paragraphs) then re-check — these directly increase AI
              citation probability. Also add a <code>/llms.txt</code> and submit
              to the LLM Knowledge Base (Analyse menu).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GeoAudit() {
  const [url, setUrl] = useState("");
  const [headless, setHeadless] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<RunRow[] | null>(null);

  async function loadList() {
    const r = await apiGet<RunsResult>("/api/geo-audit/runs");
    setRuns(r.ok && r.runs ? r.runs : []);
  }

  useEffect(() => {
    loadList();
  }, []);

  async function run() {
    const u = url.trim();
    if (!u) {
      setStatus("error");
      setError("Enter a URL.");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<AuditResult>("/api/geo-audit/run", {
      url: u,
      headless,
    });
    if (!r.ok) {
      setStatus("error");
      setError("Failed: " + (r.error || "unknown"));
      return;
    }
    setResult(r);
    setStatus("idle");
    loadList();
  }

  const gradeColor = result ? GRADE_COLORS[result.grade] || "#64748b" : "#64748b";

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span>{" "}
                <span className="bc-sep">›</span> GEO Audit
              </div>
              <h2 className="view-title">
                🤖 GEO Audit — Generative Engine Optimization
              </h2>
              <p className="view-sub">
                Score how well any page is structured to be cited by ChatGPT,
                Perplexity and Gemini. Then run the AI Citation Tracker to see
                whether those engines actually cite your domain today.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Run a GEO audit</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label>
              Page URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                type="url"
                placeholder="https://example.com/your-best-article"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: "#fff",
                  marginTop: 4,
                  boxSizing: "border-box",
                }}
              />
            </label>
            <button
              onClick={run}
              disabled={status === "loading"}
              className="btn btn-primary"
            >
              {status === "loading" ? "⏳ Auditing…" : "🤖 Audit page"}
            </button>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              color: "#475569",
              fontSize: "0.86rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
            />{" "}
            Render with real browser (slower, but works for SPA / JavaScript-heavy
            sites)
          </label>
          <p
            style={{
              color: "#64748b",
              fontSize: "0.84rem",
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            Step 1: audit your page structure (12 checks). Step 2: click{" "}
            <strong>Check AI citation</strong> to query the actual AI engines and
            see if they cite you.
          </p>
        </div>

        <div style={{ marginBottom: 18 }}>
          {status === "loading" && (
            <div
              style={{ textAlign: "center", padding: 32, color: "#64748b" }}
            >
              Fetching page and running 12 GEO checks…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#fee",
                color: "#dc2626",
                padding: 16,
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 20,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 18,
                  }}
                >
                  <div style={{ textAlign: "center", minWidth: 110 }}>
                    <div
                      style={{
                        fontSize: "3.6rem",
                        fontWeight: 800,
                        color: gradeColor,
                        lineHeight: 1,
                      }}
                    >
                      {result.grade}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.84rem" }}>
                      GEO grade
                    </div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: 110 }}>
                    <div style={{ fontSize: "2.4rem", fontWeight: 800 }}>
                      {result.score}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.84rem" }}>
                      out of 100
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ wordBreak: "break-all", fontWeight: 600 }}>
                      {result.url}
                    </div>
                    <div
                      style={{
                        color: "#64748b",
                        fontSize: "0.84rem",
                        marginTop: 4,
                      }}
                    >
                      {result.summary?.passed || 0} pass ·{" "}
                      {result.summary?.warned || 0} warn ·{" "}
                      <span style={{ color: "#dc2626" }}>
                        {result.summary?.failed || 0} fail
                      </span>{" "}
                      · {result.summary?.words || 0} words
                    </div>
                  </div>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {sortChecks(result.checks || []).map((c, i) => {
                    const sColor =
                      c.status === "pass"
                        ? "#16a34a"
                        : c.status === "warn"
                          ? "#ca8a04"
                          : "#dc2626";
                    const sIcon =
                      c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✕";
                    return (
                      <div
                        key={i}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderLeft: `4px solid ${sColor}`,
                          borderRadius: 6,
                          padding: "10px 14px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>
                            <span
                              style={{
                                color: sColor,
                                marginRight: 6,
                                fontWeight: 800,
                              }}
                            >
                              {sIcon}
                            </span>
                            {c.label}
                          </div>
                          <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
                            {c.earned}/{c.weight} pts
                          </div>
                        </div>
                        <div
                          style={{
                            color: "#475569",
                            fontSize: "0.86rem",
                            marginTop: 4,
                          }}
                        >
                          {c.message}
                        </div>
                        {c.fix && c.status !== "pass" && (
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
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Citation tracking panel — shown once a run ID is available */}
              {result.id && <CitationPanel runId={result.id} />}
            </>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #e2e8f0",
              fontWeight: 700,
            }}
          >
            Recent audits
          </div>
          <div style={{ padding: "14px 20px", color: "#64748b" }}>
            {runs === null ? (
              "Loading…"
            ) : runs.length === 0 ? (
              "No audits yet — run your first one above."
            ) : (
              runs.map((rn, i) => {
                const gc = GRADE_COLORS[rn.grade] || "#64748b";
                return (
                  <div
                    key={i}
                    style={{
                      padding: "10px 0",
                      borderTop: "1px solid #e2e8f0",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 800,
                        color: gc,
                        minWidth: 36,
                        textAlign: "center",
                      }}
                    >
                      {rn.grade}
                    </div>
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div
                        style={{ fontWeight: 600, wordBreak: "break-all" }}
                      >
                        {rn.url}
                      </div>
                      <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
                        Score {rn.score} ·{" "}
                        {new Date(rn.created_at).toLocaleString()}
                      </div>
                    </div>
                    {rn.id && (
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ fontSize: "0.75rem" }}
                        onClick={async () => {
                          const d = await apiGet<CitationCheck>(
                            `/api/geo-audit/runs/${rn.id}/cite-check`,
                          );
                          if (d.ok && d.check) {
                            setResult({
                              ok: true,
                              id: rn.id,
                              url: rn.url,
                              grade: rn.grade,
                              score: rn.score,
                            });
                          } else {
                            setResult({
                              ok: true,
                              id: rn.id,
                              url: rn.url,
                              grade: rn.grade,
                              score: rn.score,
                            });
                          }
                          setStatus("idle");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        🔍 Citation check
                      </button>
                    )}
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
