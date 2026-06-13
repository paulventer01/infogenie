"use client";

// Native React port of the legacy `serp-tracker` panel (was
// `window.buildSerpTracker` + `#view-serp-tracker` / `#serpTrackerWrap` in
// app.js). Tracks a domain's Google rank for keywords across countries via the
// existing Express API through `lib/api`:
//   GET    /api/serp-tracker/keywords
//   POST   /api/serp-tracker/keywords      { keyword, target_domain, country }
//   POST   /api/serp-tracker/scan/:id
//   POST   /api/serp-tracker/scan-all
//   DELETE /api/serp-tracker/keywords/:id
//   GET    /api/serp-tracker/history/:id
// "AI Suggest" pulls keywords from the legacy `window.analysisData` global (set
// by the home-page analysis), falling back to `POST /api/openai`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Keyword {
  id: number;
  keyword: string;
  target_domain: string;
  country: string;
  last_position: number | null;
  last_run_at: string | null;
}
interface KeywordsResult {
  ok: boolean;
  keywords?: Keyword[];
}
interface ScanResult {
  ok: boolean;
  error?: string;
  note?: string;
  target?: { position?: number | null };
}
interface ScanAllResult {
  ok: boolean;
  error?: string;
  scanned?: number;
  total?: number;
}
interface HistoryRun {
  ran_at: string;
  target_position: number | null;
  target_url?: string;
  total_results?: string | number;
}
interface HistoryResult {
  ok: boolean;
  runs?: HistoryRun[];
}
interface AddResult {
  ok: boolean;
  error?: string;
}
interface OpenAiResult {
  ok?: boolean;
  choices?: { message?: { content?: string } }[];
}
interface AnalysisData {
  url?: string;
  keywords?: (string | { keyword?: string; term?: string })[];
}

const COUNTRIES: [string, string][] = [
  ["us", "🇺🇸 United States"],
  ["gb", "🇬🇧 United Kingdom"],
  ["au", "🇦🇺 Australia"],
  ["ca", "🇨🇦 Canada"],
  ["za", "🇿🇦 South Africa"],
  ["de", "🇩🇪 Germany"],
  ["fr", "🇫🇷 France"],
  ["es", "🇪🇸 Spain"],
  ["it", "🇮🇹 Italy"],
  ["nl", "🇳🇱 Netherlands"],
  ["br", "🇧🇷 Brazil"],
  ["mx", "🇲🇽 Mexico"],
  ["in", "🇮🇳 India"],
  ["sg", "🇸🇬 Singapore"],
  ["ae", "🇦🇪 UAE"],
  ["global", "🌐 Global"],
];

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}

function toast(msg: string) {
  (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
}

function posColor(p: number | null): string {
  if (p === null) return "#9CA3AF";
  if (p <= 3) return "#15803D";
  if (p <= 10) return "#F59E0B";
  return "#DC2626";
}

export default function SerpTracker() {
  const autoDomain = (getAnalysisData().url || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  const [keyword, setKeyword] = useState("");
  const [domainV, setDomainV] = useState(autoDomain);
  const [country, setCountry] = useState("us");
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const kwIdx = useRef(0);

  const [detail, setDetail] = useState<{
    keyword: string;
    runs: HistoryRun[];
  } | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const r = await apiGet<KeywordsResult>("/api/serp-tracker/keywords");
    setKeywords(r.ok ? r.keywords || [] : []);
    setLoaded(true);
  }

  async function add() {
    if (!keyword.trim() || !domainV.trim()) {
      toast("⚠️ Keyword + domain required");
      return;
    }
    setAdding(true);
    try {
      const r = await apiPost<AddResult>("/api/serp-tracker/keywords", {
        keyword,
        target_domain: domainV,
        country,
      });
      if (!r.ok) {
        toast("❌ " + (r.error || "failed"));
        return;
      }
      setKeyword("");
      toast("✅ Tracking added");
      refresh();
    } finally {
      setAdding(false);
    }
  }

  async function suggest() {
    const fromAnalysis = (getAnalysisData().keywords || [])
      .map((k) => (typeof k === "string" ? k : k.keyword || k.term || ""))
      .filter(Boolean)
      .slice(0, 10);
    if (fromAnalysis.length) {
      const idx = kwIdx.current % fromAnalysis.length;
      setKeyword(fromAnalysis[idx]);
      kwIdx.current = idx + 1;
      return;
    }
    const domain = domainV || getAnalysisData().url || "";
    if (!domain) {
      toast(
        "⚠️ Run an analysis first or enter your domain — then AI Suggest will fill keywords from it.",
      );
      return;
    }
    setSuggesting(true);
    try {
      const r = await apiPost<OpenAiResult>("/api/openai", {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Suggest one high-value SEO keyword to track in Google SERP rankings for the website "${domain}". Reply with ONLY the keyword phrase — no explanation, no quotes.`,
          },
        ],
      });
      const suggested = (r.choices?.[0]?.message?.content || "")
        .trim()
        .replace(/^["'.]+|["'.]+$/g, "");
      if (suggested) setKeyword(suggested);
    } catch {
      toast("AI Suggest failed — enter keyword manually.");
    } finally {
      setSuggesting(false);
    }
  }

  async function scan(id: number) {
    toast("⏳ Scanning Google…");
    const r = await apiPost<ScanResult>(`/api/serp-tracker/scan/${id}`);
    if (!r.ok) {
      toast("❌ " + (r.error || "failed"));
      return;
    }
    if (r.note) {
      toast("ℹ️ " + r.note);
      return;
    }
    toast(
      r.target?.position ? `✅ Ranked #${r.target.position}` : "⚠️ Not in top 10",
    );
    refresh();
  }

  async function scanAll() {
    toast("⏳ Scanning all keywords…");
    const r = await apiPost<ScanAllResult>("/api/serp-tracker/scan-all");
    if (!r.ok) {
      toast("❌ " + (r.error || "failed"));
      return;
    }
    toast(`✅ Scanned ${r.scanned}/${r.total}`);
    refresh();
  }

  async function del(id: number) {
    if (!confirm("Delete this keyword and its history?")) return;
    await apiDelete(`/api/serp-tracker/keywords/${id}`);
    refresh();
  }

  async function showHistory(id: number, kw: string) {
    const r = await apiGet<HistoryResult>(`/api/serp-tracker/history/${id}`);
    setDetail({ keyword: kw, runs: r.ok ? r.runs || [] : [] });
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> SERP Position Tracker
              </div>
              <h2 className="view-title">🔎 SERP Position Tracker</h2>
              <p className="view-sub">
                Track your domain&apos;s Google search rank for any keyword across
                countries — see who&apos;s outranking you and how positions move
                over time.
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
              gridTemplateColumns: "2fr 1fr 160px auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
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
                    display: "block",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  Keyword
                </label>
                <button
                  onClick={suggest}
                  disabled={suggesting}
                  title="Fill from your analysis keywords"
                  style={{
                    padding: "2px 8px",
                    background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                    border: "none",
                    borderRadius: 5,
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {suggesting ? "⏳" : "✨ AI Suggest"}
                </button>
              </div>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="best running shoes"
                style={trInput}
              />
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
                Your domain{" "}
                <span style={{ color: "#15803D", fontWeight: 600 }}>
                  (auto-filled)
                </span>
              </label>
              <input
                value={domainV}
                onChange={(e) => setDomainV(e.target.value)}
                placeholder="nike.com"
                style={{
                  ...trInput,
                  background: autoDomain ? "#F0FDF4" : "#fff",
                }}
              />
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
                style={{ ...trInput, fontSize: "0.82rem", background: "#fff" }}
              >
                {COUNTRIES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={add}
              disabled={adding}
              style={{
                padding: "10px 18px",
                background: "#F97316",
                border: "2px solid #F97316",
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
              {adding ? "⏳…" : "+ Track"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0, color: "#0A1628", fontSize: "1.05rem" }}>
            Tracked keywords
          </h3>
          <button
            onClick={scanAll}
            style={{
              padding: "7px 14px",
              background: "#fff",
              border: "1.5px solid #F97316",
              color: "#F97316",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ⚡ Scan All
          </button>
        </div>

        <div>
          {!loaded ? null : !keywords.length ? (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 30,
                textAlign: "center",
                color: "#6B7280",
              }}
            >
              No keywords tracked yet — add one above.
            </div>
          ) : (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.84rem",
                }}
              >
                <thead>
                  <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                    <th style={trTh}>Keyword</th>
                    <th style={trTh}>Domain</th>
                    <th style={trTh}>Country</th>
                    <th style={trTh}>Position</th>
                    <th style={trTh}>Last scan</th>
                    <th style={{ padding: "9px 12px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => (
                    <tr key={k.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td
                        style={{
                          padding: "9px 12px",
                          color: "#0A1628",
                          fontWeight: 600,
                        }}
                      >
                        {k.keyword}
                      </td>
                      <td style={{ padding: "9px 12px", color: "#374151" }}>
                        {k.target_domain}
                      </td>
                      <td
                        style={{
                          padding: "9px 12px",
                          color: "#6B7280",
                          textTransform: "uppercase",
                          fontSize: "0.74rem",
                          fontWeight: 700,
                        }}
                      >
                        {k.country}
                      </td>
                      <td style={{ padding: "9px 12px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            minWidth: 34,
                            textAlign: "center",
                            background: posColor(k.last_position),
                            color: "#fff",
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontWeight: 800,
                            fontSize: "0.78rem",
                          }}
                        >
                          {k.last_position === null ? "—" : "#" + k.last_position}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "9px 12px",
                          color: "#9CA3AF",
                          fontSize: "0.76rem",
                        }}
                      >
                        {k.last_run_at
                          ? new Date(k.last_run_at).toLocaleString()
                          : "never"}
                      </td>
                      <td
                        style={{
                          padding: "9px 12px",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <button
                          onClick={() => scan(k.id)}
                          style={{
                            padding: "5px 10px",
                            background: "#F97316",
                            border: "none",
                            color: "#fff",
                            borderRadius: 5,
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            WebkitTextFillColor: "#fff",
                          }}
                        >
                          Scan
                        </button>{" "}
                        <button
                          onClick={() => showHistory(k.id, k.keyword)}
                          style={{
                            padding: "5px 10px",
                            background: "#fff",
                            border: "1.5px solid #D1D5DB",
                            color: "#374151",
                            borderRadius: 5,
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          History
                        </button>{" "}
                        <button
                          onClick={() => del(k.id)}
                          style={{
                            padding: "5px 10px",
                            background: "#fff",
                            border: "1.5px solid #FCA5A5",
                            color: "#DC2626",
                            borderRadius: 5,
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {detail && (
          <div style={{ marginTop: 18 }}>
            {!detail.runs.length ? (
              <div
                style={{
                  background: "#F9FAFB",
                  border: "1px dashed #D1D5DB",
                  borderRadius: 10,
                  padding: 20,
                  textAlign: "center",
                  color: "#6B7280",
                }}
              >
                No scan history yet for &quot;{detail.keyword}&quot;
              </div>
            ) : (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  padding: "14px 18px",
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
                  <div style={{ fontWeight: 800, color: "#0A1628" }}>
                    📈 Position history — {detail.keyword}
                  </div>
                  <button
                    onClick={() => setDetail(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#6B7280",
                      cursor: "pointer",
                      fontSize: "1.1rem",
                    }}
                  >
                    ×
                  </button>
                </div>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.82rem",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
                      <th style={histTh}>When</th>
                      <th style={histTh}>Position</th>
                      <th style={histTh}>URL</th>
                      <th style={histTh}>Total results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.runs.map((x, i) => {
                      const url = x.target_url || "";
                      return (
                        <tr key={i} style={{ borderTop: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "7px 10px", color: "#374151" }}>
                            {new Date(x.ran_at).toLocaleString()}
                          </td>
                          <td style={{ padding: "7px 10px" }}>
                            <span
                              style={{
                                background: posColor(x.target_position),
                                color: "#fff",
                                padding: "2px 7px",
                                borderRadius: 4,
                                fontWeight: 800,
                                fontSize: "0.74rem",
                              }}
                            >
                              {x.target_position === null
                                ? "—"
                                : "#" + x.target_position}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "7px 10px",
                              color: "#0A1628",
                              fontSize: "0.76rem",
                              maxWidth: 340,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: "#F97316" }}
                              >
                                {url}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td
                            style={{
                              padding: "7px 10px",
                              color: "#6B7280",
                              fontSize: "0.76rem",
                            }}
                          >
                            {x.total_results || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const trInput: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.86rem",
  boxSizing: "border-box",
};
const trTh: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: "0.7rem",
  color: "#6B7280",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const histTh: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: "0.68rem",
  color: "#6B7280",
};
