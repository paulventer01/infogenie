"use client";

// Native React port of the legacy `keyword-explorer` panel (was
// `window.buildKeywordExplorer` + `#view-keyword-explorer` in index.html). Takes
// any seed keyword and returns search volume, CPC, competition, keyword
// difficulty, intent and dozens of related ideas (Google Ads + DataForSEO Labs)
// via the existing Express API (`POST /api/keyword-explorer/explore`) through
// `lib/api`. The ✨ AI Suggest picker is sourced from the legacy
// `window.analysisData` global; results export to CSV client-side.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useMemo, useState } from "react";
import { apiPost } from "@/lib/api";

interface SeedMetrics {
  keyword?: string;
  intent?: string;
  search_volume?: number;
  keyword_difficulty?: number | null;
  cpc?: number;
  competition_level?: string;
  low_top_of_page_bid?: number;
  high_top_of_page_bid?: number;
}
interface Idea {
  keyword?: string;
  search_volume?: number;
  keyword_difficulty?: number | null;
  cpc?: number;
  competition_level?: string;
  intent?: string;
}
interface ExploreResult {
  ok: boolean;
  error?: string;
  note?: string;
  seed_metrics?: SeedMetrics;
  ideas?: Idea[];
}

interface AnalysisCompetitor {
  topKeywords?: string[];
}
interface AnalysisData {
  url?: string;
  brand_name?: string;
  country_code?: string;
  keywords?: (string | { keyword?: string; term?: string })[];
  competitors?: AnalysisCompetitor[];
}

const KE_COUNTRIES: [string, string][] = [
  ["global", "🌍 Global (all countries)"],
  ["us", "🇺🇸 United States"],
  ["gb", "🇬🇧 United Kingdom"],
  ["au", "🇦🇺 Australia"],
  ["ca", "🇨🇦 Canada"],
  ["de", "🇩🇪 Germany"],
  ["fr", "🇫🇷 France"],
  ["es", "🇪🇸 Spain"],
  ["it", "🇮🇹 Italy"],
  ["nl", "🇳🇱 Netherlands"],
  ["be", "🇧🇪 Belgium"],
  ["ch", "🇨🇭 Switzerland"],
  ["at", "🇦🇹 Austria"],
  ["pt", "🇵🇹 Portugal"],
  ["se", "🇸🇪 Sweden"],
  ["no", "🇳🇴 Norway"],
  ["dk", "🇩🇰 Denmark"],
  ["fi", "🇫🇮 Finland"],
  ["ie", "🇮🇪 Ireland"],
  ["pl", "🇵🇱 Poland"],
  ["cz", "🇨🇿 Czech Republic"],
  ["ro", "🇷🇴 Romania"],
  ["hu", "🇭🇺 Hungary"],
  ["gr", "🇬🇷 Greece"],
  ["ru", "🇷🇺 Russia"],
  ["tr", "🇹🇷 Turkey"],
  ["in", "🇮🇳 India"],
  ["cn", "🇨🇳 China"],
  ["jp", "🇯🇵 Japan"],
  ["kr", "🇰🇷 South Korea"],
  ["sg", "🇸🇬 Singapore"],
  ["hk", "🇭🇰 Hong Kong"],
  ["tw", "🇹🇼 Taiwan"],
  ["my", "🇲🇾 Malaysia"],
  ["id", "🇮🇩 Indonesia"],
  ["th", "🇹🇭 Thailand"],
  ["ph", "🇵🇭 Philippines"],
  ["bd", "🇧🇩 Bangladesh"],
  ["pk", "🇵🇰 Pakistan"],
  ["br", "🇧🇷 Brazil"],
  ["mx", "🇲🇽 Mexico"],
  ["ar", "🇦🇷 Argentina"],
  ["co", "🇨🇴 Colombia"],
  ["cl", "🇨🇱 Chile"],
  ["nz", "🇳🇿 New Zealand"],
  ["za", "🇿🇦 South Africa"],
  ["ng", "🇳🇬 Nigeria"],
  ["ke", "🇰🇪 Kenya"],
  ["gh", "🇬🇭 Ghana"],
  ["eg", "🇪🇬 Egypt"],
  ["sa", "🇸🇦 Saudi Arabia"],
  ["ae", "🇦🇪 UAE"],
  ["il", "🇮🇱 Israel"],
];

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}
function kd(v: number | null | undefined): { label: string; color: string } {
  if (v === null || v === undefined)
    return { label: "—", color: "#9CA3AF" };
  if (v <= 30) return { label: v + " easy", color: "#15803D" };
  if (v <= 60) return { label: v + " med", color: "#F59E0B" };
  return { label: v + " hard", color: "#DC2626" };
}
function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export default function KeywordExplorer() {
  const defaultCty = useMemo(() => {
    const ad = getAnalysisData();
    const def = (ad.country_code || "global").toLowerCase().slice(0, 5);
    const found = KE_COUNTRIES.find(([v]) => v === def);
    return found ? found[0] : "global";
  }, []);

  const suggestions = useMemo(() => {
    const ad = getAnalysisData();
    const seen = new Set<string>();
    const pool: string[] = [];
    if (Array.isArray(ad.keywords)) {
      ad.keywords.forEach((k) => {
        const s =
          typeof k === "string" ? k : (k && (k.keyword || k.term)) || "";
        if (s && !seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          pool.push(s);
        }
      });
    }
    if (Array.isArray(ad.competitors)) {
      ad.competitors.forEach((c) => {
        (c.topKeywords || []).forEach((k) => {
          if (k && !seen.has(k.toLowerCase())) {
            seen.add(k.toLowerCase());
            pool.push(k);
          }
        });
      });
    }
    if (!pool.length) {
      const domain = (ad.url || "")
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
      const seed = domain || ad.brand_name || "";
      if (seed) pool.push(seed);
    }
    return pool.slice(0, 24);
  }, []);

  const [seed, setSeed] = useState("");
  const [country, setCountry] = useState(defaultCty);
  const [limit, setLimit] = useState(25);
  const [showSuggest, setShowSuggest] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "note">(
    "idle",
  );
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ExploreResult | null>(null);

  useEffect(() => {
    setCountry(defaultCty);
  }, [defaultCty]);

  async function run() {
    if (!seed.trim()) {
      setStatus("error");
      setError("⚠️ Seed keyword required");
      return;
    }
    setStatus("loading");
    setError("");
    setNote("");
    setResult(null);
    const r = await apiPost<ExploreResult>("/api/keyword-explorer/explore", {
      seed: seed.trim(),
      country,
      limit,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    if (r.note) {
      setStatus("note");
      setNote(r.note);
      return;
    }
    setResult(r);
    setStatus("idle");
  }

  function exportCsv() {
    if (!result?.ideas?.length) return;
    const sm = result.seed_metrics;
    const rows: (string | number)[][] = [
      [
        "keyword",
        "search_volume",
        "keyword_difficulty",
        "cpc",
        "competition_level",
        "intent",
      ],
    ];
    result.ideas.forEach((i) =>
      rows.push([
        i.keyword || "",
        i.search_volume || 0,
        i.keyword_difficulty ?? "",
        i.cpc || 0,
        i.competition_level || "",
        i.intent || "",
      ]),
    );
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `keyword-ideas-${String(sm?.keyword || "export").replace(
      /[^a-z0-9]+/gi,
      "-",
    )}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sm = result?.seed_metrics;
  const seedKd = kd(sm?.keyword_difficulty);

  const tile = (label: string, value: React.ReactNode, color: string) => (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderTop: `3px solid ${color}`,
        borderRadius: 10,
        padding: 13,
      }}
    >
      <div
        style={{
          fontSize: "0.68rem",
          color: "#6B7280",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.3rem",
          fontWeight: 800,
          color: "#0A1628",
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Keyword Explorer
              </div>
              <h2 className="view-title">🔬 Keyword Explorer</h2>
              <p className="view-sub">
                Drop in any seed keyword to get search volume, CPC, competition,
                keyword difficulty, search intent, and dozens of related keyword
                ideas — Google Ads + DataForSEO Labs data.
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
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 200px 110px auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
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
                  Seed keyword
                </label>
                <button
                  onClick={() => setShowSuggest((v) => !v)}
                  title="Show keywords from your analysis"
                  style={{
                    padding: "2px 9px",
                    background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                    border: "none",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    lineHeight: 1.6,
                  }}
                >
                  ✨ AI Suggest
                </button>
              </div>
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="e.g. forex trading"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.86rem",
                  boxSizing: "border-box",
                }}
              />
              {showSuggest && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "calc(100% + 4px)",
                    background: "#fff",
                    border: "1.5px solid #7C3AED",
                    borderRadius: 10,
                    boxShadow: "0 8px 28px rgba(124,58,237,.22)",
                    zIndex: 9999,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        color: "#7C3AED",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                      }}
                    >
                      Keywords from your analysis — click to use
                    </span>
                    <span
                      onClick={() => setShowSuggest(false)}
                      style={{
                        cursor: "pointer",
                        color: "#9CA3AF",
                        fontSize: "0.85rem",
                        lineHeight: 1,
                      }}
                      title="Close"
                    >
                      ✕
                    </span>
                  </div>
                  {suggestions.length ? (
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                    >
                      {suggestions.map((kw, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSeed(kw);
                            setShowSuggest(false);
                          }}
                          style={{
                            padding: "5px 12px",
                            background: "#F5F3FF",
                            border: "1.5px solid #DDD6FE",
                            borderRadius: 20,
                            fontSize: "0.76rem",
                            fontWeight: 600,
                            color: "#5B21B6",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {kw}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>
                      Run a website analysis first — AI Suggest will populate
                      keywords from it.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Country
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  background: "#fff",
                  boxSizing: "border-box",
                }}
              >
                {KE_COUNTRIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Ideas
              </label>
              <input
                type="number"
                value={limit}
                min={5}
                max={50}
                onChange={(e) =>
                  setLimit(parseInt(e.target.value, 10) || 25)
                }
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.86rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={run}
              disabled={status === "loading"}
              style={{
                padding: "10px 18px",
                background: "#8B5CF6",
                border: "2px solid #8B5CF6",
                borderRadius: 8,
                fontSize: "0.82rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
                whiteSpace: "nowrap",
              }}
            >
              🔬 Explore
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
                padding: 30,
                textAlign: "center",
                color: "#6B7280",
              }}
            >
              ⏳ Querying DataForSEO Labs… (this can take 10-20s)
            </div>
          )}
          {status === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 18,
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          {status === "note" && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: 18,
                borderRadius: 10,
                border: "1px solid #FDE68A",
              }}
            >
              {note}
            </div>
          )}
          {status === "idle" && result && sm && (
            <>
              <div
                style={{
                  background:
                    "linear-gradient(135deg,#8B5CF6 0%,#6D28D9 100%)",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "16px 20px",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>
                  🔬 {sm.keyword}
                </div>
                <div
                  style={{ fontSize: "0.78rem", opacity: 0.9, marginTop: 2 }}
                >
                  {country === "global"
                    ? "🌍 Global"
                    : (country || "us").toUpperCase()}{" "}
                  · {sm.intent ? sm.intent + " intent" : "no intent data"}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))",
                  gap: 10,
                  marginBottom: 18,
                }}
              >
                {tile(
                  "Search volume",
                  num(sm.search_volume).toLocaleString() + "/mo",
                  "#0EA5E9",
                )}
                {tile(
                  "Difficulty",
                  <span
                    style={{
                      background: seedKd.color,
                      color: "#fff",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: "0.78rem",
                    }}
                  >
                    {seedKd.label}
                  </span>,
                  "#F59E0B",
                )}
                {tile("CPC", "$" + num(sm.cpc).toFixed(2), "#15803D")}
                {tile(
                  "Competition",
                  sm.competition_level || "—",
                  "#9CA3AF",
                )}
                {tile(
                  "Top-of-page low",
                  "$" + num(sm.low_top_of_page_bid).toFixed(2),
                  "#9CA3AF",
                )}
                {tile(
                  "Top-of-page high",
                  "$" + num(sm.high_top_of_page_bid).toFixed(2),
                  "#9CA3AF",
                )}
              </div>

              <h3 style={{ margin: "0 0 10px", color: "#0A1628" }}>
                {(result.ideas || []).length} keyword ideas
              </h3>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  overflow: "hidden",
                  overflowX: "auto",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.84rem",
                    minWidth: 680,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      {[
                        "Keyword",
                        "Volume",
                        "KD",
                        "CPC",
                        "Comp",
                        "Intent",
                      ].map((h, i) => (
                        <th
                          key={h}
                          style={{
                            padding: "9px 12px",
                            fontSize: "0.68rem",
                            color: "#6B7280",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            textAlign:
                              i >= 1 && i <= 3 ? "right" : "left",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(result.ideas || []).map((it, i) => {
                      const ikd = kd(it.keyword_difficulty);
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                          <td
                            style={{
                              padding: "9px 12px",
                              color: "#0A1628",
                              fontWeight: 600,
                            }}
                          >
                            {it.keyword || ""}
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              textAlign: "right",
                              color: "#0A1628",
                              fontWeight: 700,
                            }}
                          >
                            {num(it.search_volume).toLocaleString()}
                          </td>
                          <td
                            style={{ padding: "9px 12px", textAlign: "right" }}
                          >
                            <span
                              style={{
                                background: ikd.color,
                                color: "#fff",
                                padding: "2px 7px",
                                borderRadius: 4,
                                fontSize: "0.72rem",
                                fontWeight: 700,
                              }}
                            >
                              {ikd.label}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              textAlign: "right",
                              color: "#15803D",
                              fontWeight: 700,
                            }}
                          >
                            ${num(it.cpc).toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              color: "#6B7280",
                              fontSize: "0.78rem",
                            }}
                          >
                            {it.competition_level || "—"}
                          </td>
                          <td
                            style={{
                              padding: "9px 12px",
                              color: "#6B7280",
                              fontSize: "0.78rem",
                            }}
                          >
                            {it.intent || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, textAlign: "right" }}>
                <button
                  onClick={exportCsv}
                  style={{
                    padding: "8px 14px",
                    background: "#fff",
                    border: "1.5px solid #8B5CF6",
                    color: "#8B5CF6",
                    borderRadius: 6,
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📥 Export CSV
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
