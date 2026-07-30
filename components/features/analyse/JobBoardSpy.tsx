"use client";

// Native React port of the legacy `job-board-spy` panel (was
// `window.buildJobBoardSpy` + `#view-job-board-spy` in index.html). Scans
// competitors' open roles via the existing Express API
// (`POST /api/job-board-spy/scan`) through `lib/api`. Pre-fills the competitor
// picker from the legacy `window.analysisData` global (set by the home-page
// competitor analysis), which still lives in the replayed SPA.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useMemo, useState } from "react";
import { apiPost } from "@/lib/api";

const DEPTS = [
  "engineering",
  "sales",
  "marketing",
  "product",
  "design",
  "ops",
  "finance",
  "hr",
  "other",
];
const DEPT_COLORS: Record<string, string> = {
  engineering: "#0066FF",
  sales: "#10B981",
  marketing: "#F59E0B",
  product: "#7C3AED",
  design: "#EC4899",
  ops: "#6B7280",
  finance: "#059669",
  hr: "#DC2626",
  other: "#9CA3AF",
};

interface Job {
  title?: string;
  url?: string;
  department?: string;
  seniority?: string;
  location?: string;
  posted?: string;
  summary?: string;
}
interface ScanResult {
  ok: boolean;
  error?: string;
  company: string;
  total_jobs?: number;
  by_dept?: Record<string, number>;
  strategic_signals?: string[];
  jobs?: Job[];
}

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisData {
  brandName?: string;
  companyName?: string;
  competitors?: AnalysisCompetitor[];
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function safeUrl(u?: string): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return parsed.href;
  } catch {
    /* invalid */
  }
  return null;
}

type ProgState = "scanning" | "done" | "failed";
interface Prog {
  company: string;
  state: ProgState;
  note: string;
}

function ResultCard({ r }: { r: ScanResult }) {
  if (!r.ok)
    return (
      <div
        style={{
          background: "#FEE2E2",
          color: "#B91C1C",
          padding: 14,
          borderRadius: 10,
          marginBottom: 12,
        }}
      >
        <strong>{r.company}</strong>: {r.error}
      </div>
    );
  const dept = r.by_dept || {};
  const signals = r.strategic_signals || [];
  const jobs = r.jobs || [];
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
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
        <div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0A1628" }}>
            {r.total_jobs ?? 0}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 700 }}>
            OPEN ROLES AT {(r.company || "").toUpperCase()}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(dept).map(([k, v]) =>
          v > 0 ? (
            <span
              key={k}
              style={{
                background: DEPT_COLORS[String(k).toLowerCase()] || "#9CA3AF",
                color: "#fff",
                padding: "3px 9px",
                borderRadius: 14,
                fontSize: "0.72rem",
                fontWeight: 700,
                textTransform: "capitalize",
              }}
            >
              {k}: {v}
            </span>
          ) : null,
        )}
      </div>
      {signals.length > 0 && (
        <div
          style={{
            background: "linear-gradient(135deg,#FEF3C7,#FDE68A)",
            border: "1px solid #F59E0B",
            borderRadius: 8,
            padding: "12px 16px",
            marginTop: 12,
          }}
        >
          <div
            style={{
              fontWeight: 800,
              color: "#92400E",
              fontSize: "0.84rem",
              marginBottom: 6,
            }}
          >
            🎯 Strategic Signals
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              color: "#78350F",
              fontSize: "0.8rem",
              lineHeight: 1.6,
            }}
          >
            {signals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {jobs.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#0066FF",
            }}
          >
            ▶ View {jobs.length} open role(s)
          </summary>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
              gap: 8,
              marginTop: 8,
            }}
          >
            {jobs.map((j, i) => {
              const href = safeUrl(j.url);
              const meta = [j.department, j.seniority, j.location, j.posted]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={i}
                  style={{
                    background: "#F9FAFB",
                    border: "1px solid #E5E7EB",
                    borderRadius: 6,
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#0A1628",
                      fontSize: "0.84rem",
                    }}
                  >
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener"
                        style={{ color: "#0A1628", textDecoration: "none" }}
                      >
                        {j.title || ""}
                      </a>
                    ) : (
                      j.title || ""
                    )}
                  </div>
                  {meta && (
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "#6B7280",
                        marginTop: 2,
                      }}
                    >
                      {meta}
                    </div>
                  )}
                  {j.summary && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#374151",
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      {j.summary}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function Matrix({ results }: { results: ScanResult[] }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #E5E7EB",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontWeight: 800, color: "#0A1628", fontSize: "0.92rem" }}>
          📊 Hiring Matrix
        </span>
        <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>
          {results.length} companies · open roles by department
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.8rem",
          }}
        >
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: "0.68rem",
                  color: "#6B7280",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                COMPANY
              </th>
              <th
                style={{
                  padding: "8px 12px",
                  textAlign: "center",
                  fontSize: "0.68rem",
                  color: "#6B7280",
                  fontWeight: 700,
                }}
              >
                TOTAL
              </th>
              {DEPTS.map((d) => (
                <th
                  key={d}
                  style={{
                    padding: "6px 10px",
                    textAlign: "center",
                    fontSize: "0.65rem",
                    color: DEPT_COLORS[d],
                    fontWeight: 700,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.slice(0, 3).toUpperCase()}
                </th>
              ))}
              <th
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: "0.68rem",
                  color: "#6B7280",
                  fontWeight: 700,
                }}
              >
                TOP SIGNAL
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, ri) => {
              if (!r.ok)
                return (
                  <tr key={ri}>
                    <td
                      style={{
                        padding: "8px 12px",
                        fontWeight: 700,
                        color: "#0A1628",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.company}
                    </td>
                    <td
                      colSpan={DEPTS.length + 1}
                      style={{
                        padding: "8px 12px",
                        color: "#B91C1C",
                        fontSize: "0.8rem",
                      }}
                    >
                      {r.error || "Failed"}
                    </td>
                  </tr>
                );
              const dept = r.by_dept || {};
              const total = r.total_jobs || 0;
              const topSignal = (r.strategic_signals || [])[0] || "—";
              return (
                <tr key={ri} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontWeight: 700,
                      color: "#0A1628",
                      whiteSpace: "nowrap",
                      fontSize: "0.84rem",
                    }}
                  >
                    {r.company}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      textAlign: "center",
                      fontWeight: 800,
                      fontSize: "1rem",
                      color: "#0A1628",
                    }}
                  >
                    {total}
                  </td>
                  {DEPTS.map((d) => {
                    const v = parseInt(String(dept[d] || 0), 10);
                    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                    return (
                      <td
                        key={d}
                        style={{ padding: "6px 10px", textAlign: "center" }}
                      >
                        {v > 0 ? (
                          <span
                            style={{
                              background: DEPT_COLORS[d],
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: "0.72rem",
                              fontWeight: 700,
                            }}
                          >
                            {v}
                          </span>
                        ) : (
                          <span style={{ color: "#D1D5DB", fontSize: "0.72rem" }}>
                            —
                          </span>
                        )}
                        {v > 0 && total > 0 && (
                          <div
                            style={{
                              fontSize: "0.6rem",
                              color: "#9CA3AF",
                              marginTop: 1,
                            }}
                          >
                            {pct}%
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td
                    style={{
                      padding: "8px 12px",
                      fontSize: "0.73rem",
                      color: "#6B7280",
                      maxWidth: 260,
                    }}
                  >
                    {topSignal.slice(0, 120)}
                    {topSignal.length > 120 ? "…" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function JobBoardSpy() {
  const { allKnownValues, allKnownLabels } = useMemo(() => {
    const ad = getAnalysisData();
    const ownBrand = ad.brandName || ad.companyName || "";
    const compNames = Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter((n): n is string => !!n)
          .slice(0, 15)
      : [];
    const values = [ownBrand, ...compNames].filter(Boolean);
    const labels = [
      ownBrand ? ownBrand + " (your brand)" : "",
      ...compNames,
    ].filter(Boolean);
    return { allKnownValues: values, allKnownLabels: labels };
  }, []);

  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    allKnownValues.length ? ({ 0: true } as Record<number, boolean>) : {},
  );
  const [allSelected, setAllSelected] = useState(false);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Prog[]>([]);
  const [results, setResults] = useState<ScanResult[] | null>(null);
  const [warning, setWarning] = useState("");

  function toggleAll() {
    const next = !allSelected;
    setAllSelected(next);
    const map: Record<number, boolean> = {};
    allKnownValues.forEach((_, i) => {
      map[i] = next;
    });
    setChecked(map);
  }

  async function scan() {
    const picked = allKnownValues
      .filter((_, i) => checked[i])
      .map((v) => v.trim())
      .filter(Boolean);
    const m = manual.trim();
    const toScan = [...new Set([...picked, ...(m ? [m] : [])])];
    if (!toScan.length) {
      setWarning("⚠ Select at least one company or type a name below.");
      setResults(null);
      return;
    }
    setWarning("");
    setResults(null);
    setScanning(true);
    setProgress(
      toScan.map((c) => ({ company: c, state: "scanning", note: "scanning…" })),
    );

    const out: ScanResult[] = new Array(toScan.length);
    const queue = [...toScan];
    let qi = 0;
    const workers = new Array(Math.min(3, toScan.length))
      .fill(0)
      .map(async () => {
        while (qi < queue.length) {
          const idx = qi++;
          const company = queue[idx];
          try {
            const r = await apiPost<ScanResult>("/api/job-board-spy/scan", {
              company,
            });
            out[idx] = { ...r, company };
            setProgress((prev) => {
              const copy = [...prev];
              copy[idx] = {
                company,
                state: r.ok ? "done" : "failed",
                note: r.ok
                  ? `${r.total_jobs || 0} roles found`
                  : r.error || "failed",
              };
              return copy;
            });
          } catch (e) {
            out[idx] = {
              ok: false,
              company,
              error: e instanceof Error ? e.message : "failed",
            };
            setProgress((prev) => {
              const copy = [...prev];
              copy[idx] = {
                company,
                state: "failed",
                note: e instanceof Error ? e.message : "failed",
              };
              return copy;
            });
          }
        }
      });
    await Promise.all(workers);

    setScanning(false);
    setResults(out.filter(Boolean));
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Job Board Spy
              </div>
              <h2 className="view-title">💼 Job Board Spy</h2>
              <p className="view-sub">
                Track competitors&apos; open roles across LinkedIn, Indeed and
                careers pages — leading indicator of strategic direction (AI
                hires? geographic expansion? new product line?).
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
            padding: 18,
            marginBottom: 18,
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
            <label
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
              }}
            >
              COMPETITOR / COMPANY
            </label>
            {allKnownValues.length > 1 && (
              <button
                onClick={toggleAll}
                style={{
                  background: "#EEF2FF",
                  border: "1px solid #C7D2FE",
                  color: "#4F46E5",
                  padding: "4px 12px",
                  borderRadius: 6,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {allSelected ? "☐ Deselect All" : "☑ Select All"}
              </button>
            )}
          </div>
          {allKnownValues.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                gap: 2,
                marginBottom: 10,
                maxHeight: 180,
                overflowY: "auto",
                border: "1px solid #E5E7EB",
                borderRadius: 6,
                padding: 4,
              }}
            >
              {allKnownValues.map((v, i) => (
                <label
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.84rem",
                    color: "#0A1628",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!checked[i]}
                    onChange={(e) =>
                      setChecked((prev) => ({ ...prev, [i]: e.target.checked }))
                    }
                    style={{
                      width: 15,
                      height: 15,
                      accentColor: "#0066FF",
                      cursor: "pointer",
                    }}
                  />
                  <span>{allKnownLabels[i]}</span>
                </label>
              ))}
            </div>
          ) : (
            <div
              style={{
                fontSize: "0.72rem",
                color: "#9CA3AF",
                marginBottom: 8,
              }}
            >
              💡 Run an analysis from the top-right <strong>+ Analyse</strong>{" "}
              button to unlock competitor pickers here.
            </div>
          )}
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Or type any company name and click Scan"
            style={{
              width: "100%",
              padding: 9,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.88rem",
              boxSizing: "border-box",
              marginBottom: 10,
            }}
          />
          <button
            onClick={scan}
            disabled={scanning}
            style={{
              width: "100%",
              background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
              color: '#0f172a',
              border: "none",
              padding: "11px 20px",
              borderRadius: 6,
              fontSize: "0.86rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {scanning ? "⏳ Scanning…" : "💼 Scan Open Roles"}
          </button>
        </div>

        <div>
          {warning && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: 12,
                borderRadius: 8,
              }}
            >
              {warning}
            </div>
          )}
          {scanning && progress.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                padding: 4,
                marginBottom: 14,
              }}
            >
              {progress.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    fontSize: "0.82rem",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      flexShrink: 0,
                      textAlign: "center",
                    }}
                  >
                    {p.state === "done"
                      ? "✅"
                      : p.state === "failed"
                        ? "❌"
                        : "⏳"}
                  </span>
                  <span style={{ color: "#0A1628", fontWeight: 600 }}>
                    {p.company}
                  </span>
                  <span
                    style={{
                      color:
                        p.state === "failed"
                          ? "#B91C1C"
                          : p.state === "done"
                            ? "#15803D"
                            : "#9CA3AF",
                      fontSize: "0.72rem",
                    }}
                  >
                    {p.note}
                  </span>
                </div>
              ))}
            </div>
          )}
          {results &&
            (results.length === 0 ? (
              <div style={{ color: "#9CA3AF" }}>No results.</div>
            ) : results.length === 1 ? (
              <ResultCard r={results[0]} />
            ) : (
              <>
                <Matrix results={results} />
                <div style={{ marginTop: 4 }}>
                  {results.map((r, i) => (
                    <ResultCard key={i} r={r} />
                  ))}
                </div>
              </>
            ))}
        </div>
      </div>
    </div>
  );
}
