"use client";

// Native React port of the legacy `tech-stack` panel (was
// `window.buildTechStack` + `#view-tech-stack` in index.html). Detects the live
// tech stack of a single domain and compares 2-5 domains side-by-side against
// the existing Express API (`POST /api/tech-stack/detect` and
// `POST /api/tech-stack/compare`) via `lib/api`. Pre-fills the picker / compare
// list from the legacy `window.analysisData` global (set by the home-page
// competitor analysis), which still lives in the replayed SPA.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiPost } from "@/lib/api";

interface Category {
  name: string;
  live: number;
  dead?: number;
}
interface Group {
  group: string;
  live: number;
  categories: Category[];
}
interface DetectResult {
  ok: boolean;
  error?: string;
  note?: string;
  domain: string;
  total: number;
  groups: Group[];
}

interface CompareRow {
  domain: string;
  total: number;
  note?: string;
}
interface MatrixRow {
  name: string;
  tag?: string;
  counts: Record<string, number>;
}
interface CompareResult {
  ok: boolean;
  error?: string;
  domains: string[];
  results: CompareRow[];
  matrix: MatrixRow[];
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
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

const MANUAL = "__manual__";

export default function TechStack() {
  // Single-domain detect state
  const [pick, setPick] = useState("");
  const [one, setOne] = useState("");
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [detectStatus, setDetectStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [detectError, setDetectError] = useState("");

  // Compare state
  const [multi, setMulti] = useState("");
  const [loadHint, setLoadHint] = useState<{ color: string; text: string } | null>(
    null,
  );
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareStatus, setCompareStatus] = useState<
    "idle" | "loading" | "error" | "empty"
  >("idle");
  const [compareError, setCompareError] = useState("");
  const [compareBanner, setCompareBanner] = useState("");

  // Build picker options + pre-fill from window.analysisData on mount.
  const { ownDom, compRows } = useMemo(() => {
    const ad = getAnalysisData();
    const own = norm(ad.url || ad.domain || "");
    const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
    const rows = comps
      .map((c) => {
        const d = norm(c.domain || c.url || c.website || "");
        const name = c.name || d;
        return d && /\./.test(d) ? { name, d } : null;
      })
      .filter((r): r is { name: string; d: string } => !!r);
    return { ownDom: own, compRows: rows };
  }, []);

  useEffect(() => {
    if (ownDom) {
      setPick(ownDom);
      setOne(ownDom);
    } else {
      setPick(MANUAL);
    }
  }, [ownDom]);

  const oneHint =
    ownDom || compRows.length
      ? {
          color: "#15803D",
          text: "✓ Pre-filled from your latest analysis. Pick another or type your own.",
        }
      : {
          color: "#9CA3AF",
          text: "Run a competitor analysis from the home page to pre-fill your site + competitors here.",
        };

  function onPickChange(v: string) {
    setPick(v);
    if (v && v !== MANUAL) setOne(v);
    else if (v === MANUAL) setOne("");
  }

  async function runDetect() {
    const d = one.trim();
    if (!d) {
      setDetectStatus("error");
      setDetectError("Domain required");
      return;
    }
    setDetectStatus("loading");
    setDetectError("");
    setDetect(null);
    const r = await apiPost<DetectResult>("/api/tech-stack/detect", {
      domain: d,
    });
    if (!r.ok) {
      setDetectStatus("error");
      setDetectError(r.error || "failed");
      return;
    }
    setDetect({
      ...r,
      domain: r.domain || d,
      total: typeof r.total === "number" ? r.total : 0,
      groups: Array.isArray(r.groups) ? r.groups : [],
    });
    setDetectStatus("idle");
  }

  function loadAnalysed() {
    const ad = getAnalysisData();
    const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
    const domains = comps
      .map((c) => norm(c.domain || c.url || c.website || c.name || ""))
      .filter((d) => d && /\./.test(d));
    const od = norm(ad.url || ad.domain || "");
    const all = od ? [od, ...domains] : domains;
    const unique = [...new Set(all)].slice(0, 5);
    if (!unique.length) {
      setLoadHint({
        color: "#B91C1C",
        text: "⚠ No analysed competitors found yet — run an analysis from the home page first, or type domains manually below.",
      });
      return;
    }
    setMulti(unique.join(", "));
    setLoadHint({
      color: "#15803D",
      text: `✓ Loaded ${unique.length} domain${unique.length > 1 ? "s" : ""} from your latest analysis. Edit freely or click Compare.`,
    });
  }

  async function runCompare() {
    const domains = multi
      .split(/[, \n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (domains.length < 2) {
      setCompareStatus("error");
      setCompareError("Need 2-5 domains");
      return;
    }
    setCompareStatus("loading");
    setCompareError("");
    setCompareBanner("");
    setCompare(null);
    const r = await apiPost<CompareResult>("/api/tech-stack/compare", {
      domains,
    });
    if (!r.ok) {
      setCompareStatus("error");
      setCompareError(r.error || "failed");
      return;
    }
    const byDom: Record<string, CompareRow> = {};
    (r.results || []).forEach((x) => {
      byDom[x.domain] = x;
    });
    const missing = (r.domains || []).filter(
      (c) => !(byDom[c] && byDom[c].total > 0),
    );
    setCompareBanner(
      missing.length
        ? `⚠ BuiltWith Free returned no data for: ${missing.join(", ")}. This usually means the domain is not in BuiltWith's free-tier index or the lookup was rate-limited. Click Compare again in 30 seconds, or upgrade to BuiltWith Pro for guaranteed coverage.`
        : "",
    );
    const matrix = (r.matrix || []).slice(0, 100);
    if (!matrix.length) {
      setCompare({ ...r, matrix: [] });
      setCompareStatus("empty");
      return;
    }
    setCompare({ ...r, matrix });
    setCompareStatus("idle");
  }

  const inputStyle: React.CSSProperties = {
    padding: "9px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: "0.88rem",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Tech Stack Detector
              </div>
              <h2 className="view-title">🧱 Competitor Tech Stack Detector</h2>
              <p className="view-sub">
                See what analytics, ad platforms, CMS, frameworks, and tools any
                competitor runs. Compare up to 5 sites side-by-side to spot gaps.
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
          {/* Single-domain detect */}
          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 4,
              }}
            >
              Single domain — full stack breakdown
            </label>
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <select
                value={pick}
                onChange={(e) => onPickChange(e.target.value)}
                style={{
                  ...inputStyle,
                  minWidth: 200,
                  fontSize: "0.84rem",
                  background: "#fff",
                }}
              >
                {ownDom && (
                  <option value={ownDom}>🏠 Your site — {ownDom}</option>
                )}
                {compRows.length > 0 && (
                  <optgroup label="Your analysed competitors">
                    {compRows.map((r) => (
                      <option key={r.d} value={r.d}>
                        {r.name} — {r.d}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={MANUAL}>
                  {!ownDom && !compRows.length
                    ? "✏️ Type a domain manually…"
                    : "✏️ Type manually…"}
                </option>
              </select>
              <input
                value={one}
                onChange={(e) => setOne(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runDetect()}
                placeholder="…or type any domain (e.g. shopify.com)"
                style={{ ...inputStyle, flex: 1, minWidth: 180 }}
              />
              <button
                onClick={runDetect}
                disabled={detectStatus === "loading"}
                style={{
                  padding: "10px 22px",
                  background: "#DC2626",
                  border: "2px solid #DC2626",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  color: "#fff",
                  WebkitTextFillColor: "#fff",
                  cursor: "pointer",
                  textShadow: "0 1px 2px rgba(0,0,0,.4)",
                }}
              >
                🔍 Detect
              </button>
            </div>
            <div
              style={{
                marginTop: 5,
                fontSize: "0.7rem",
                color: oneHint.color,
              }}
            >
              {oneHint.text}
            </div>
          </div>

          {/* Compare */}
          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <label
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                }}
              >
                Compare 2-5 domains side-by-side
              </label>
              <button
                onClick={loadAnalysed}
                style={{
                  padding: "5px 11px",
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 6,
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "#1D4ED8",
                  cursor: "pointer",
                }}
              >
                ⚡ Use my analysed competitors
              </button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={multi}
                onChange={(e) => setMulti(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runCompare()}
                placeholder="Type domains separated by commas"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={runCompare}
                disabled={compareStatus === "loading"}
                style={{
                  padding: "10px 22px",
                  background: "#fff",
                  border: "2px solid #DC2626",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  color: "#DC2626",
                  cursor: "pointer",
                }}
              >
                ⚖️ Compare
              </button>
            </div>
            {loadHint && (
              <div
                style={{
                  marginTop: 5,
                  fontSize: "0.7rem",
                  color: loadHint.color,
                }}
              >
                {loadHint.text}
              </div>
            )}
          </div>
        </div>

        {/* Output */}
        <div>
          {detectStatus === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Detecting tech stack…
            </div>
          )}
          {detectStatus === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {detectError}
            </div>
          )}
          {detectStatus === "idle" && detect && (
            <DetectView result={detect} />
          )}

          {compareStatus === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
                marginTop: 14,
              }}
            >
              ⏳ Comparing domains…
            </div>
          )}
          {compareStatus === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
                marginTop: 14,
              }}
            >
              {compareError}
            </div>
          )}
          {(compareStatus === "empty" || compareStatus === "idle") &&
            compare && (
              <CompareView
                result={compare}
                banner={compareBanner}
                empty={compareStatus === "empty"}
              />
            )}
        </div>
      </div>
    </div>
  );
}

function DetectView({ result }: { result: DetectResult }) {
  const groups = Array.isArray(result.groups) ? result.groups : [];
  const total = typeof result.total === "number" ? result.total : 0;
  return (
    <div>
      {result.note && (
        <div
          style={{
            background: "#FEF3C7",
            color: "#92400E",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: "0.78rem",
            marginBottom: 14,
          }}
        >
          {result.note}
        </div>
      )}
      {!groups.length ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            color: "#6B7280",
            fontSize: "0.88rem",
          }}
        >
          No tech detected for {result.domain || "this domain"}.
        </div>
      ) : (
        <>
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 20,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  color: "#0A1628",
                  fontSize: "1.1rem",
                }}
              >
                {result.domain}
              </div>
              <div
                style={{
                  background: "#DC2626",
                  color: "#fff",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: "0.7rem",
                  fontWeight: 800,
                }}
              >
                {total} LIVE TECHNOLOGIES
              </div>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))",
              gap: 12,
            }}
          >
            {groups.map((g, gi) => (
              <div
                key={gi}
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    color: "#0A1628",
                    fontSize: "0.95rem",
                    marginBottom: 10,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{g.group || ""}</span>
                  <span
                    style={{
                      background: "#DC2626",
                      color: "#fff",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: "0.66rem",
                      fontWeight: 800,
                    }}
                  >
                    {g.live} LIVE
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {g.categories.slice(0, 12).map((c, ci) => (
                    <div
                      key={ci}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "5px 8px",
                        background: c.live > 0 ? "#ECFDF5" : "#F3F4F6",
                        borderRadius: 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: c.live > 0 ? "#065F46" : "#6B7280",
                          fontWeight: 600,
                        }}
                      >
                        {c.name || ""}
                      </span>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: c.live > 0 ? "#15803D" : "#9CA3AF",
                        }}
                      >
                        {c.live} live{c.dead ? ` · ${c.dead} dead` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                {g.categories.length > 12 && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: "0.7rem",
                      color: "#9CA3AF",
                      textAlign: "center",
                    }}
                  >
                    +{g.categories.length - 12} more categories
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompareView({
  result,
  banner,
  empty,
}: {
  result: CompareResult;
  banner: string;
  empty: boolean;
}) {
  const cols = result.domains || [];
  const matrix = Array.isArray(result.matrix) ? result.matrix : [];
  const byDom: Record<string, CompareRow> = {};
  (result.results || []).forEach((x) => {
    byDom[x.domain] = x;
  });

  return (
    <div style={{ marginTop: 14 }}>
      {banner && (
        <div
          style={{
            background: "#FEF3C7",
            color: "#92400E",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: "0.78rem",
            marginBottom: 10,
          }}
        >
          {banner}
        </div>
      )}
      {empty ? (
        <div
          style={{
            background: "#FEF3C7",
            color: "#92400E",
            padding: 14,
            borderRadius: 10,
          }}
        >
          No comparable tech detected across these domains. Set
          BUILTWITH_API_KEY for real data, or upgrade to BuiltWith Pro.
        </div>
      ) : (
        <>
          <div
            style={{
              background: "#FEF3C7",
              color: "#92400E",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: "0.78rem",
              marginBottom: 10,
            }}
          >
            BuiltWith Free tier compares at the category level (not individual
            technology names). Upgrade to BuiltWith Pro for tech-level
            comparisons.
          </div>
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
                padding: "14px 18px",
                borderBottom: "1px solid #E5E7EB",
                fontWeight: 800,
                color: "#0A1628",
              }}
            >
              ⚖️ Category Comparison Matrix ({matrix.length} categories —
              counts = live tech in category)
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.82rem",
                  minWidth: 300 + cols.length * 120,
                }}
              >
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        color: "#6B7280",
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        letterSpacing: ".06em",
                      }}
                    >
                      CATEGORY
                    </th>
                    <th
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        color: "#6B7280",
                        fontSize: "0.7rem",
                        fontWeight: 800,
                        letterSpacing: ".06em",
                      }}
                    >
                      GROUP
                    </th>
                    {cols.map((c) => {
                      const row = byDom[c];
                      const total = row && row.total ? row.total : 0;
                      return (
                        <th
                          key={c}
                          style={{
                            padding: "10px 14px",
                            textAlign: "center",
                            color: "#0A1628",
                            fontSize: "0.74rem",
                            fontWeight: 800,
                          }}
                        >
                          <div>{c}</div>
                          {total > 0 ? (
                            <div
                              style={{
                                display: "inline-block",
                                marginTop: 3,
                                background: "#DCFCE7",
                                color: "#15803D",
                                padding: "1px 7px",
                                borderRadius: 4,
                                fontSize: "0.62rem",
                                fontWeight: 800,
                              }}
                            >
                              {total} live
                            </div>
                          ) : (
                            <div
                              title={
                                (row && row.note) ||
                                "No data returned by BuiltWith Free for this domain"
                              }
                              style={{
                                display: "inline-block",
                                marginTop: 3,
                                background: "#FEE2E2",
                                color: "#B91C1C",
                                padding: "1px 7px",
                                borderRadius: 4,
                                fontSize: "0.62rem",
                                fontWeight: 800,
                              }}
                            >
                              no data
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((t, ti) => (
                    <tr key={ti} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td
                        style={{
                          padding: "8px 14px",
                          color: "#0A1628",
                          fontWeight: 600,
                        }}
                      >
                        {t.name}
                      </td>
                      <td
                        style={{
                          padding: "8px 14px",
                          color: "#6B7280",
                          fontSize: "0.78rem",
                        }}
                      >
                        {t.tag || ""}
                      </td>
                      {cols.map((c) => {
                        const n = t.counts[c] || 0;
                        return (
                          <td
                            key={c}
                            style={{
                              padding: "8px 14px",
                              textAlign: "center",
                              color: n > 0 ? "#15803D" : "#D1D5DB",
                              fontWeight: n > 0 ? 700 : 400,
                            }}
                          >
                            {n > 0 ? n : "·"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
