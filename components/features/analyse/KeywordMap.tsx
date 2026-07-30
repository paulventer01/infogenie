"use client";

// Native React port of the legacy `keyword-map` panel (was
// `window.buildKeywordMap` + `#view-keyword-map` in index.html). Maps target
// keywords to the right pages, flags keyword cannibalisation and content gaps
// via the existing Express API (`POST /api/keyword-page-map`) through `lib/api`.
// Pre-fills brand/keywords from the legacy `window.analysisData` global and the
// `window._intentMap` cache; results export to CSV and can be sent to the
// Battle Plan tool via `goToView(router, 'battleplan')`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface PageRow {
  url?: string;
  title?: string;
  primary_keyword?: string;
  secondary_keywords?: string[];
  intent?: string;
  status?: string;
  recommendation?: string;
}
interface CannibalGroup {
  keyword?: string;
  pages?: string[];
  recommendation?: string;
}
interface MapSummary {
  total_pages?: number;
  mapped_keywords?: number;
  gaps?: number;
  cannibalization_issues?: number;
}
interface MapResult {
  ok: boolean;
  error?: string;
  pages?: PageRow[];
  summary?: MapSummary;
  cannibalGroups?: CannibalGroup[];
  content_gaps?: string[];
}

interface AnalysisCompetitor {
  topKeywords?: string[];
}
interface AnalysisData {
  url?: string;
  name?: string;
  brand_name?: string;
  industry?: string | { name?: string };
  competitors?: AnalysisCompetitor[];
}
interface IntentMapEntry {
  keyword?: string;
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}
function getIntentMap(): IntentMapEntry[] {
  if (typeof window === "undefined") return [];
  const m = (window as unknown as { _intentMap?: unknown })._intentMap;
  return Array.isArray(m) ? (m as IntentMapEntry[]) : [];
}
function safeUrl(u?: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

const STATUS_COLOR: Record<string, string> = {
  optimized: "#15803D",
  optimised: "#15803D",
  needs_work: "#F59E0B",
  gap: "#DC2626",
  cannibalization: "#DC2626",
};

export default function KeywordMap() {
  const router = useRouter();

  const prefill = useMemo(() => {
    const ad = getAnalysisData();
    const industry =
      typeof ad.industry === "string"
        ? ad.industry
        : (ad.industry && ad.industry.name) || "";
    const seen = new Set<string>();
    const kws: string[] = [];
    getIntentMap().forEach((e) => {
      const k = e && e.keyword;
      if (k && !seen.has(k.toLowerCase())) {
        seen.add(k.toLowerCase());
        kws.push(k);
      }
    });
    (ad.competitors || []).forEach((c) => {
      (c.topKeywords || []).forEach((k) => {
        if (k && !seen.has(k.toLowerCase())) {
          seen.add(k.toLowerCase());
          kws.push(k);
        }
      });
    });
    return {
      brand: ad.name || ad.brand_name || "",
      industry,
      url: ad.url || "",
      keywords: kws.slice(0, 30).join("\n"),
    };
  }, []);

  const [brand, setBrand] = useState("");
  const [industry, setIndustry] = useState("");
  const [pagesText, setPagesText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<MapResult | null>(null);

  useEffect(() => {
    setBrand(prefill.brand);
    setIndustry(prefill.industry);
    setKeywordsText(prefill.keywords);
    if (prefill.url) setPagesText(prefill.url);
  }, [prefill]);

  function parsePages(): { url: string; title: string }[] {
    return pagesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        const url = (parts[0] || "").trim();
        const title = (parts[1] || "").trim();
        return { url, title };
      });
  }

  async function run() {
    const pages = parsePages();
    const keywords = keywordsText
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (!pages.length) {
      setStatus("error");
      setError("⚠️ Add at least one page URL.");
      return;
    }
    if (!keywords.length) {
      setStatus("error");
      setError("⚠️ Add at least one target keyword.");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<MapResult>("/api/keyword-page-map", {
      brand: brand.trim(),
      industry: industry.trim(),
      pages,
      keywords,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  function exportCsv() {
    if (!result?.pages?.length) return;
    const rows: string[][] = [
      [
        "url",
        "title",
        "primary_keyword",
        "secondary_keywords",
        "intent",
        "status",
        "recommendation",
      ],
    ];
    result.pages.forEach((p) =>
      rows.push([
        p.url || "",
        p.title || "",
        p.primary_keyword || "",
        (p.secondary_keywords || []).join("; "),
        p.intent || "",
        p.status || "",
        p.recommendation || "",
      ]),
    );
    const csv = rows
      .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "keyword-page-map.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#6B7280",
    marginBottom: 4,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 9,
    border: "1px solid #D1D5DB",
    borderRadius: 7,
    fontSize: "0.85rem",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const sum = result?.summary;

  return (
    <div className="view-header-wrap">
      <div
        className="view-header"
        style={{
          background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#475569" }}>
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Keyword Map
              </div>
              <h2 className="view-title" style={{ color: "#0f172a" }}>
                🗺️ Keyword Map
              </h2>
              <p className="view-sub" style={{ color: "#475569" }}>
                Map your target keywords to the right pages, catch keyword
                cannibalisation before it tanks your rankings, and spot the
                content gaps your competitors are exploiting.
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
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>BRAND</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Your brand"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>INDUSTRY</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. SaaS"
                style={inputStyle}
              />
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>
                PAGES (one per line · &quot;url | title&quot;)
              </label>
              <textarea
                value={pagesText}
                onChange={(e) => setPagesText(e.target.value)}
                rows={7}
                placeholder={"https://site.com/pricing | Pricing\nhttps://site.com/blog/seo | SEO Guide"}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
            <div>
              <label style={labelStyle}>
                TARGET KEYWORDS (one per line or comma-separated)
              </label>
              <textarea
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                rows={7}
                placeholder={"seo software\nkeyword research tool"}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>
          </div>
          <button
            onClick={run}
            disabled={status === "loading"}
            style={{
              background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
              color: "#0f172a",
              border: "none",
              padding: "10px 22px",
              borderRadius: 8,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🗺️ Build Keyword Map
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Mapping keywords to pages…
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: "10px 14px",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
          {status === "idle" && result && (
            <>
              {sum && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  {[
                    ["Pages", sum.total_pages || 0, "#0066FF"],
                    ["Keywords Mapped", sum.mapped_keywords || 0, "#15803D"],
                    ["Content Gaps", sum.gaps || 0, "#F59E0B"],
                    [
                      "Cannibalisation",
                      sum.cannibalization_issues || 0,
                      "#DC2626",
                    ],
                  ].map(([label, value, color]) => (
                    <div
                      key={label as string}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderTop: `3px solid ${color as string}`,
                        borderRadius: 10,
                        padding: 14,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: "#6B7280",
                          textTransform: "uppercase",
                        }}
                      >
                        {label}
                      </div>
                      <div
                        style={{
                          fontSize: "1.6rem",
                          fontWeight: 800,
                          color: color as string,
                          marginTop: 3,
                        }}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(result.cannibalGroups || []).length > 0 && (
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1.5px solid #FECACA",
                    borderRadius: 10,
                    padding: 14,
                    marginBottom: 18,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "#991B1B",
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    ⚠️ Keyword Cannibalisation
                  </div>
                  {(result.cannibalGroups || []).map((g, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          color: "#7F1D1D",
                        }}
                      >
                        “{g.keyword}” → {(g.pages || []).length} competing pages
                      </div>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#991B1B",
                          marginTop: 2,
                        }}
                      >
                        {(g.pages || []).join(", ")}
                      </div>
                      {g.recommendation && (
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#374151",
                            marginTop: 2,
                          }}
                        >
                          → {g.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  overflow: "hidden",
                  overflowX: "auto",
                  marginBottom: 16,
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.83rem",
                    minWidth: 720,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      {[
                        "Page",
                        "Primary KW",
                        "Secondary",
                        "Intent",
                        "Status",
                        "Recommendation",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "9px 12px",
                            fontSize: "0.68rem",
                            color: "#6B7280",
                            fontWeight: 700,
                            textTransform: "uppercase",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.pages || []).map((p, i) => {
                      const url = safeUrl(p.url);
                      return (
                        <tr
                          key={i}
                          style={{ borderTop: "1px solid #F3F4F6" }}
                        >
                          <td style={{ padding: "9px 12px" }}>
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "#0066FF",
                                  textDecoration: "none",
                                  fontWeight: 600,
                                }}
                              >
                                {p.title || p.url}
                              </a>
                            ) : (
                              <span style={{ fontWeight: 600 }}>
                                {p.title || p.url || ""}
                              </span>
                            )}
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              fontWeight: 700,
                              color: "#0A1628",
                            }}
                          >
                            {p.primary_keyword || "—"}
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              color: "#6B7280",
                              fontSize: "0.78rem",
                            }}
                          >
                            {(p.secondary_keywords || []).join(", ") || "—"}
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              color: "#6B7280",
                              fontSize: "0.78rem",
                            }}
                          >
                            {p.intent || "—"}
                          </td>
                          <td style={{ padding: "9px 12px" }}>
                            <span
                              style={{
                                background:
                                  STATUS_COLOR[p.status || ""] || "#6B7280",
                                color: "#fff",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                textTransform: "uppercase",
                              }}
                            >
                              {(p.status || "").replace(/_/g, " ") || "—"}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              color: "#374151",
                              fontSize: "0.78rem",
                            }}
                          >
                            {p.recommendation || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {(result.content_gaps || []).length > 0 && (
                <div
                  style={{
                    background: "#FFFBEB",
                    border: "1.5px solid #FDE68A",
                    borderRadius: 10,
                    padding: 14,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "#92400E",
                      textTransform: "uppercase",
                      marginBottom: 8,
                    }}
                  >
                    🕳️ Content Gaps
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(result.content_gaps || []).map((g, i) => (
                      <span
                        key={i}
                        style={{
                          background: "#FEF3C7",
                          color: "#92400E",
                          padding: "3px 10px",
                          borderRadius: 10,
                          fontSize: "0.78rem",
                          fontWeight: 600,
                        }}
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={exportCsv}
                  style={{
                    padding: "9px 16px",
                    background: "#fff",
                    border: "1.5px solid #0066FF",
                    color: "#0066FF",
                    borderRadius: 7,
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📥 Export CSV
                </button>
                <button
                  onClick={() => goToView(router, "battleplan")}
                  style={{
                    padding: "9px 16px",
                    background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
                    border: "none",
                    color: "#0f172a",
                    borderRadius: 7,
                    fontSize: "0.82rem",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  ⚔️ Send to Battle Plan
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
