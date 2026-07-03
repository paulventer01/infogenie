"use client";

// Native React port of the legacy `maps-intel` panel (was
// `window.buildMapsIntel` + `#view-maps-intel` in index.html). Maps the local
// competitive landscape via the existing Express API (`/api/maps-intel/*` and
// `POST /api/studio/ai-suggest`) through `lib/api`. The "AI Suggest" keyword
// helper seeds from the legacy `window.analysisData` global (set by the
// home-page competitor analysis) before falling back to an AI round-trip.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Business {
  name?: string;
  address?: string;
  rating?: number | null;
  review_count?: number | null;
  price_range?: string;
  website?: string;
  competitive_signal?: string;
}
interface MarketSummary {
  avg_rating_benchmark?: number | string;
  market_maturity?: string;
  density?: number | string;
  opportunities?: string[];
  threats?: string[];
}
interface Run {
  id: number | string;
  keyword: string;
  region: string;
  total_count?: number;
  market_summary?: MarketSummary;
  businesses?: Business[];
  created_at: string;
}
interface RunsResult {
  ok: boolean;
  error?: string;
  runs?: Run[];
}
interface RunResult {
  ok: boolean;
  error?: string;
  run?: Run;
}
interface ScanResult {
  ok: boolean;
  error?: string;
  keyword?: string;
  region?: string;
  businesses?: Business[];
  market_summary?: MarketSummary;
}
interface AiSuggestResult {
  ok: boolean;
  result?: string;
}

interface AnalysisKeyword {
  keyword?: string;
  term?: string;
}
interface AnalysisData {
  keywords?: (string | AnalysisKeyword)[];
  industry?: { name?: string } | string;
}

const RATING_COLOR = (r: number) =>
  r >= 4.5 ? "#059669" : r >= 4.0 ? "#D97706" : "#DC2626";
const PRICE_BG: Record<string, string> = {
  $: "#EDE9FE",
  $$: "#DBEAFE",
  $$$: "#FEF3C7",
  $$$$: "#FEE2E2",
};
const PRICE_COL: Record<string, string> = {
  $: "#7C3AED",
  $$: "#1D4ED8",
  $$$: "#92400E",
  $$$$: "#991B1B",
};
const MATURITY_COL: Record<string, string> = {
  saturated: "#DC2626",
  mature: "#F97316",
  moderate: "#0EA5E9",
  emerging: "#059669",
  fragmented: "#8B5CF6",
};

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

function Stars({ rating }: { rating?: number | null }) {
  if (!rating) return <span style={{ color: "#9CA3AF" }}>N/A</span>;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const emp = 5 - full - half;
  return (
    <>
      <span style={{ color: "#F59E0B", fontSize: "0.9rem" }}>
        {"★".repeat(full)}
        {half ? "½" : ""}
        <span style={{ opacity: 0.35 }}>{"☆".repeat(emp)}</span>
      </span>{" "}
      <span style={{ color: "#374151", fontSize: "0.78rem", fontWeight: 700 }}>
        {rating.toFixed(1)}
      </span>
    </>
  );
}

interface Current {
  keyword: string;
  region: string;
  businesses: Business[];
  market_summary: MarketSummary;
}
interface Filter {
  minRating: number;
  minReviews: number;
  sortCol: "name" | "rating" | "review_count";
  sortDir: 1 | -1;
}

const KW_FALLBACK = [
  "dentist",
  "coffee shop",
  "digital marketing agency",
  "gym",
  "accounting firm",
];
const RG_FALLBACK = [
  "Cape Town South Africa",
  "London UK",
  "Manhattan New York",
  "Sydney Australia",
  "Dubai UAE",
];

export default function MapsIntel() {
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [outStatus, setOutStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [outError, setOutError] = useState("");
  const [filter, setFilter] = useState<Filter>({
    minRating: 0,
    minReviews: 0,
    sortCol: "rating",
    sortDir: -1,
  });

  const [kwPills, setKwPills] = useState<string[] | null>(null);
  const [rgPills, setRgPills] = useState<string[] | null>(null);
  const [kwLoading, setKwLoading] = useState(false);
  const [rgLoading, setRgLoading] = useState(false);

  async function loadRuns() {
    const rr = await apiGet<RunsResult>("/api/maps-intel/runs");
    setRuns(rr.ok ? rr.runs || [] : []);
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function aiSuggest(
    fieldLabel: string,
    placeholder: string,
    fallback: string[],
  ): Promise<string[]> {
    const r = await apiPost<AiSuggestResult>("/api/studio/ai-suggest", {
      fieldLabel,
      fieldPlaceholder: placeholder,
      context: `Google Maps competitor intelligence tool. ${fieldLabel}. Suggest 5 options.`,
      format: "json_array",
    });
    let sugs = fallback;
    // Backend returns { ok, values: [...] } for format=json_array
    const raw = r.ok && ((r as unknown as { values?: unknown }).values || r.result);
    if (raw) {
      if (Array.isArray(raw)) {
        sugs = raw as string[];
      } else {
        try {
          const p = JSON.parse(String(raw));
          sugs = Array.isArray(p) ? p : fallback;
        } catch {
          const m = String(raw).match(/\[[\s\S]*\]/);
          if (m) {
            try { sugs = JSON.parse(m[0]); } catch { /* keep fallback */ }
          }
        }
      }
    }
    if (!Array.isArray(sugs) || !sugs.length) sugs = fallback;
    return sugs.slice(0, 6).map((s) => String(s).slice(0, 80));
  }

  async function onKwSuggest() {
    const ad = getAnalysisData();
    const fromAnalysis = Array.isArray(ad.keywords)
      ? ad.keywords
          .map((k) => (typeof k === "string" ? k : k.keyword || k.term || ""))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const industry =
      (ad.industry &&
        (typeof ad.industry === "string" ? ad.industry : ad.industry.name)) ||
      "";
    const combined = [
      ...new Set([...(industry ? [industry] : []), ...fromAnalysis]),
    ].slice(0, 8);
    if (combined.length) {
      setKwPills(combined.map((s) => String(s).slice(0, 80)));
    } else {
      setKwLoading(true);
      const sugs = await aiSuggest(
        "Business category or keyword for local competitor research",
        "e.g. dentist, coffee shop, digital marketing agency",
        KW_FALLBACK,
      );
      setKwPills(sugs);
      setKwLoading(false);
    }
  }

  async function onRgSuggest() {
    setRgLoading(true);
    const sugs = await aiSuggest(
      "Target city or region for local competitor research",
      "e.g. Cape Town, Manhattan New York, London UK",
      RG_FALLBACK,
    );
    setRgPills(sugs);
    setRgLoading(false);
  }

  function renderResult(
    kw: string,
    reg: string,
    businesses: Business[],
    ms: MarketSummary,
  ) {
    setCurrent({
      keyword: kw,
      region: reg,
      businesses: Array.isArray(businesses) ? businesses : [],
      market_summary: ms || {},
    });
    setFilter({ minRating: 0, minReviews: 0, sortCol: "rating", sortDir: -1 });
    setOutStatus("idle");
  }

  async function scan() {
    const kw = keyword.trim();
    const reg = region.trim();
    if (!kw) {
      setOutStatus("error");
      setOutError("⚠ Business category / keyword is required");
      return;
    }
    if (!reg) {
      setOutStatus("error");
      setOutError("⚠ Target city / region is required");
      return;
    }
    setOutStatus("loading");
    setOutError("");
    setCurrent(null);
    const r = await apiPost<ScanResult>("/api/maps-intel/scan", {
      keyword: kw,
      region: reg,
    });
    if (!r.ok) {
      setOutStatus("error");
      setOutError(r.error || "Scan failed");
      return;
    }
    renderResult(
      r.keyword || kw,
      r.region || reg,
      r.businesses || [],
      r.market_summary || {},
    );
    loadRuns();
  }

  async function loadRun(id: number | string) {
    setOutStatus("loading");
    setCurrent(null);
    const r = await apiGet<RunResult>("/api/maps-intel/runs/" + id);
    if (!r.ok || !r.run) {
      setOutStatus("error");
      setOutError(r.error || "Failed to load run");
      return;
    }
    renderResult(
      r.run.keyword,
      r.run.region,
      r.run.businesses || [],
      r.run.market_summary || {},
    );
  }

  async function deleteRun(id: number | string) {
    if (!confirm("Delete this scan?")) return;
    await apiDelete("/api/maps-intel/runs/" + id);
    setRuns((prev) => prev.filter((r) => String(r.id) !== String(id)));
  }

  function setSort(col: Filter["sortCol"]) {
    setFilter((prev) =>
      prev.sortCol === col
        ? { ...prev, sortDir: (prev.sortDir * -1) as 1 | -1 }
        : { ...prev, sortCol: col, sortDir: -1 },
    );
  }

  const filteredRows = useMemo(() => {
    if (!current) return [];
    const rows = current.businesses.filter(
      (b) =>
        (b.rating == null || b.rating >= filter.minRating) &&
        (b.review_count == null || b.review_count >= filter.minReviews),
    );
    return rows.sort((a, b) => {
      const col = filter.sortCol;
      const av =
        col === "rating"
          ? a.rating || 0
          : col === "review_count"
            ? a.review_count || 0
            : String(a.name || "").toLowerCase();
      const bv =
        col === "rating"
          ? b.rating || 0
          : col === "review_count"
            ? b.review_count || 0
            : String(b.name || "").toLowerCase();
      return av < bv ? filter.sortDir : av > bv ? -filter.sortDir : 0;
    });
  }, [current, filter]);

  function sortInd(col: Filter["sortCol"]) {
    if (filter.sortCol !== col) return " ⇅";
    return filter.sortDir === -1 ? " ▼" : " ▲";
  }

  const ms = current?.market_summary || {};
  const avgR = ms.avg_rating_benchmark
    ? parseFloat(String(ms.avg_rating_benchmark)).toFixed(1)
    : "N/A";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 8,
    border: "1px solid #D1D5DB",
    borderRadius: 5,
    fontSize: "0.84rem",
    boxSizing: "border-box",
  };
  const suggestBtn: React.CSSProperties = {
    padding: "3px 10px",
    background: "linear-gradient(135deg,#7C3AED,#0EA5E9)",
    border: "none",
    borderRadius: 5,
    color: "#fff",
    fontSize: "0.65rem",
    fontWeight: 700,
    cursor: "pointer",
  };

  function Pills({
    pills,
    onPick,
  }: {
    pills: string[];
    onPick: (v: string) => void;
  }) {
    return (
      <div
        style={{
          display: "flex",
          marginTop: 5,
          flexWrap: "wrap",
          gap: 5,
        }}
      >
        {pills.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            style={{
              padding: "4px 12px",
              background: "#EDE9FE",
              color: "#7C3AED",
              border: "1px solid #DDD6FE",
              borderRadius: 12,
              fontSize: "0.74rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Maps Intel
              </div>
              <h2 className="view-title">🗺️ Maps Intel</h2>
              <p className="view-sub">
                Map your local competitive landscape — discover every competitor
                in a region with ratings, review counts, price range, and
                AI-generated strategic signals.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {/* Controls */}
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
              gridTemplateColumns: "1fr 1fr auto",
              gap: 10,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 3,
                }}
              >
                <label
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  BUSINESS CATEGORY / KEYWORD *
                </label>
                <button
                  onClick={onKwSuggest}
                  disabled={kwLoading}
                  style={suggestBtn}
                >
                  {kwLoading ? "⏳…" : "🧠 AI Suggest"}
                </button>
              </div>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && scan()}
                placeholder="e.g. dentist, coffee shop, digital marketing agency"
                style={inputStyle}
              />
              {kwPills && (
                <Pills
                  pills={kwPills}
                  onPick={(v) => {
                    setKeyword(v);
                    setKwPills(null);
                  }}
                />
              )}
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 3,
                }}
              >
                <label
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  TARGET CITY / REGION *
                </label>
                <button
                  onClick={onRgSuggest}
                  disabled={rgLoading}
                  style={suggestBtn}
                >
                  {rgLoading ? "⏳…" : "🧠 AI Suggest"}
                </button>
              </div>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && scan()}
                placeholder="e.g. Cape Town, Manhattan New York, London UK"
                style={inputStyle}
              />
              {rgPills && (
                <Pills
                  pills={rgPills}
                  onPick={(v) => {
                    setRegion(v);
                    setRgPills(null);
                  }}
                />
              )}
            </div>
            <button
              onClick={scan}
              disabled={outStatus === "loading"}
              style={{
                background: "linear-gradient(135deg,#0F4C81,#1E88E5)",
                color: "#fff",
                border: "none",
                padding: "9px 20px",
                borderRadius: 6,
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
                whiteSpace: "nowrap",
                alignSelf: "flex-end",
              }}
            >
              🗺️ Scan Market
            </button>
          </div>
          <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 8 }}>
            Powered by Perplexity Sonar · AI-researched from live Google Maps
            data · 25-45s per scan
          </div>
        </div>

        {/* Output */}
        <div>
          {outStatus === "loading" && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                background: "#F0F7FF",
                borderRadius: 12,
                color: "#1E40AF",
              }}
            >
              <div style={{ fontSize: "1.8rem", marginBottom: 10 }}>🗺️</div>
              <div style={{ fontSize: "0.85rem" }}>
                Scanning competitors…
                <br />
                <span style={{ opacity: 0.7 }}>
                  Powered by Perplexity Sonar · 25-45s
                </span>
              </div>
            </div>
          )}
          {outStatus === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              {outError}
            </div>
          )}
          {outStatus === "idle" && current && (
            <>
              {/* Hero */}
              <div
                style={{
                  background: "linear-gradient(135deg,#0F4C81,#1E88E5)",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "18px 22px",
                  marginBottom: 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        opacity: 0.8,
                        textTransform: "uppercase",
                        marginBottom: 4,
                      }}
                    >
                      🗺️ Google Maps · Competitive Landscape
                    </div>
                    <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>
                      {current.keyword}{" "}
                      <span style={{ opacity: 0.8, fontSize: "1rem" }}>in</span>{" "}
                      {current.region}
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", gap: 16, textAlign: "center" }}
                  >
                    <div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>
                        {current.businesses.length}
                      </div>
                      <div
                        style={{
                          fontSize: "0.68rem",
                          opacity: 0.8,
                          fontWeight: 700,
                        }}
                      >
                        BUSINESSES
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>
                        ⭐ {avgR}
                      </div>
                      <div
                        style={{
                          fontSize: "0.68rem",
                          opacity: 0.8,
                          fontWeight: 700,
                        }}
                      >
                        AVG RATING
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>
                        {ms.density ?? current.businesses.length}
                      </div>
                      <div
                        style={{
                          fontSize: "0.68rem",
                          opacity: 0.8,
                          fontWeight: 700,
                        }}
                      >
                        DENSITY
                      </div>
                    </div>
                  </div>
                </div>
                {ms.market_maturity && (
                  <div style={{ marginTop: 10 }}>
                    <span
                      style={{
                        background: "rgba(255,255,255,.2)",
                        border: "1px solid rgba(255,255,255,.4)",
                        padding: "3px 12px",
                        borderRadius: 10,
                        fontSize: "0.72rem",
                        fontWeight: 800,
                        textTransform: "uppercase",
                      }}
                    >
                      Market: {ms.market_maturity}
                    </span>
                  </div>
                )}
              </div>

              {/* Opportunities + threats */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 18,
                }}
              >
                <div
                  style={{
                    background: "#F0FDF4",
                    border: "1px solid #BBF7D0",
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: "#065F46",
                      fontSize: "0.88rem",
                      marginBottom: 10,
                    }}
                  >
                    🚀 Opportunities ({(ms.opportunities || []).length})
                  </div>
                  {(ms.opportunities || []).length ? (
                    (ms.opportunities || []).map((o, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            color: "#059669",
                            fontSize: "0.85rem",
                            flexShrink: 0,
                          }}
                        >
                          ✅
                        </span>
                        <div style={{ color: "#374151", fontSize: "0.8rem" }}>
                          {o}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>
                      None identified.
                    </div>
                  )}
                </div>
                <div
                  style={{
                    background: "#FFF5F5",
                    border: "1px solid #FED7D7",
                    borderRadius: 10,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: "#991B1B",
                      fontSize: "0.88rem",
                      marginBottom: 10,
                    }}
                  >
                    ⚠️ Threats ({(ms.threats || []).length})
                  </div>
                  {(ms.threats || []).length ? (
                    (ms.threats || []).map((t, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          marginBottom: 6,
                        }}
                      >
                        <span
                          style={{
                            color: "#DC2626",
                            fontSize: "0.85rem",
                            flexShrink: 0,
                          }}
                        >
                          ⚠️
                        </span>
                        <div style={{ color: "#374151", fontSize: "0.8rem" }}>
                          {t}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>
                      None identified.
                    </div>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        color: "#6B7280",
                        marginBottom: 4,
                      }}
                    >
                      MIN RATING
                    </label>
                    <select
                      value={filter.minRating}
                      onChange={(e) =>
                        setFilter((prev) => ({
                          ...prev,
                          minRating: parseFloat(e.target.value),
                        }))
                      }
                      style={{
                        padding: "5px 8px",
                        border: "1px solid #D1D5DB",
                        borderRadius: 5,
                        fontSize: "0.8rem",
                        background: "#F9FAFB",
                      }}
                    >
                      <option value="0">Any rating</option>
                      <option value="3">3.0+</option>
                      <option value="3.5">3.5+</option>
                      <option value="4">4.0+</option>
                      <option value="4.5">4.5+</option>
                    </select>
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        color: "#6B7280",
                        marginBottom: 4,
                      }}
                    >
                      MIN REVIEWS
                    </label>
                    <select
                      value={filter.minReviews}
                      onChange={(e) =>
                        setFilter((prev) => ({
                          ...prev,
                          minReviews: parseInt(e.target.value, 10),
                        }))
                      }
                      style={{
                        padding: "5px 8px",
                        border: "1px solid #D1D5DB",
                        borderRadius: 5,
                        fontSize: "0.8rem",
                        background: "#F9FAFB",
                      }}
                    >
                      <option value="0">Any count</option>
                      <option value="10">10+</option>
                      <option value="50">50+</option>
                      <option value="100">100+</option>
                      <option value="250">250+</option>
                    </select>
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#6B7280",
                      paddingBottom: 5,
                    }}
                  >
                    Showing {filteredRows.length} of{" "}
                    {current.businesses.length} businesses
                  </div>
                </div>
              </div>

              {/* Table */}
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  overflow: "auto",
                  marginBottom: 14,
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.82rem",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: "#F9FAFB",
                        borderBottom: "2px solid #E5E7EB",
                      }}
                    >
                      <th
                        onClick={() => setSort("name")}
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontWeight: 700,
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          userSelect: "none",
                          minWidth: 180,
                        }}
                      >
                        Business{sortInd("name")}
                      </th>
                      <th
                        onClick={() => setSort("rating")}
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontWeight: 700,
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          userSelect: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Rating{sortInd("rating")}
                      </th>
                      <th
                        onClick={() => setSort("review_count")}
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontWeight: 700,
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          userSelect: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Reviews{sortInd("review_count")}
                      </th>
                      <th
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontWeight: 700,
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Price
                      </th>
                      <th
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontWeight: 700,
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Website
                      </th>
                      <th
                        style={{
                          padding: "9px 10px",
                          textAlign: "left",
                          color: "#6B7280",
                          fontWeight: 700,
                          fontSize: "0.7rem",
                          textTransform: "uppercase",
                          minWidth: 200,
                        }}
                      >
                        Competitive Signal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? (
                      filteredRows.map((b, i) => {
                        const pbg = PRICE_BG[b.price_range || ""] || "#F3F4F6";
                        const pc = PRICE_COL[b.price_range || ""] || "#6B7280";
                        const href = safeUrl(b.website);
                        return (
                          <tr
                            key={i}
                            style={{
                              borderBottom: "1px solid #F3F4F6",
                              background: i % 2 === 0 ? undefined : "#FAFAFA",
                            }}
                          >
                            <td style={{ padding: "8px 10px" }}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: "#0A1628",
                                  fontSize: "0.83rem",
                                }}
                              >
                                {b.name || ""}
                              </div>
                              <div
                                style={{
                                  color: "#9CA3AF",
                                  fontSize: "0.7rem",
                                }}
                              >
                                {b.address || ""}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: "8px 10px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Stars rating={b.rating} />
                            </td>
                            <td
                              style={{
                                padding: "8px 10px",
                                color: "#374151",
                                fontSize: "0.8rem",
                                fontWeight: 700,
                              }}
                            >
                              {b.review_count != null
                                ? b.review_count.toLocaleString()
                                : "—"}
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {b.price_range ? (
                                <span
                                  style={{
                                    background: pbg,
                                    color: pc,
                                    padding: "2px 8px",
                                    borderRadius: 8,
                                    fontSize: "0.72rem",
                                    fontWeight: 800,
                                  }}
                                >
                                  {b.price_range}
                                </span>
                              ) : (
                                <span
                                  style={{
                                    color: "#D1D5DB",
                                    fontSize: "0.74rem",
                                  }}
                                >
                                  —
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: "#1D4ED8",
                                    fontSize: "0.74rem",
                                    textDecoration: "none",
                                    fontWeight: 700,
                                  }}
                                >
                                  🔗 Visit
                                </a>
                              ) : (
                                <span
                                  style={{
                                    color: "#D1D5DB",
                                    fontSize: "0.74rem",
                                  }}
                                >
                                  —
                                </span>
                              )}
                            </td>
                            <td
                              style={{
                                padding: "8px 10px",
                                color: "#4B5563",
                                fontSize: "0.74rem",
                                maxWidth: 220,
                              }}
                            >
                              {(b.competitive_signal || "").slice(0, 180)}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          style={{
                            padding: 14,
                            color: "#9CA3AF",
                            textAlign: "center",
                          }}
                        >
                          No businesses match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Recent scans */}
        <h3
          style={{
            margin: "24px 0 8px",
            color: "#0A1628",
            fontSize: "0.96rem",
            fontWeight: 800,
          }}
        >
          📚 Recent Scans
        </h3>
        <div>
          {!runs.length ? (
            <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>
              No scans yet.
            </div>
          ) : (
            runs.slice(0, 20).map((r) => {
              const rms = r.market_summary || {};
              return (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 8,
                    padding: "10px 14px",
                    marginBottom: 6,
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <strong style={{ color: "#0A1628" }}>{r.keyword}</strong>
                    <span
                      style={{
                        color: "#6B7280",
                        fontSize: "0.74rem",
                        marginLeft: 8,
                      }}
                    >
                      in {r.region}
                    </span>
                    <span
                      style={{
                        color: "#9CA3AF",
                        fontSize: "0.72rem",
                        marginLeft: 8,
                      }}
                    >
                      {r.total_count || 0} businesses · avg ⭐
                      {rms.avg_rating_benchmark || "N/A"}
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ color: "#9CA3AF", fontSize: "0.72rem" }}>
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => loadRun(r.id)}
                      style={{
                        padding: "4px 12px",
                        background: "#EFF6FF",
                        border: "1px solid #BFDBFE",
                        borderRadius: 5,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        color: "#1D4ED8",
                        cursor: "pointer",
                      }}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteRun(r.id)}
                      style={{
                        padding: "4px 10px",
                        background: "#FEE2E2",
                        border: "1px solid #FECACA",
                        borderRadius: 5,
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        color: "#B91C1C",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
