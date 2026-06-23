"use client";

// Native React port of the legacy `trending-topics` panel (was
// `window.buildTrendingTopics` + `_tr*` helpers in app.js and
// `#view-trending-topics` in index.html). Detects what's spiking in a category
// via live web search against the existing Express API:
//   GET  /api/trends/history
//   POST /api/trends/detect   { category, keywords, country, platform }
//   POST /api/ai-quick        { prompt }   (AI Suggest helpers)
// Pre-fills the category/competitor picker from the legacy `window.analysisData`
// global set by the SPA competitor analysis.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

const COUNTRIES: [string, string][] = [
  ["ALL", "🌍 Global / All countries"],
  ["US", "🇺🇸 United States"],
  ["GB", "🇬🇧 United Kingdom"],
  ["ZA", "🇿🇦 South Africa"],
  ["AU", "🇦🇺 Australia"],
  ["CA", "🇨🇦 Canada"],
  ["DE", "🇩🇪 Germany"],
  ["FR", "🇫🇷 France"],
  ["IN", "🇮🇳 India"],
  ["JP", "🇯🇵 Japan"],
  ["BR", "🇧🇷 Brazil"],
  ["MX", "🇲🇽 Mexico"],
  ["NL", "🇳🇱 Netherlands"],
  ["ES", "🇪🇸 Spain"],
  ["IT", "🇮🇹 Italy"],
  ["AE", "🇦🇪 UAE"],
  ["SG", "🇸🇬 Singapore"],
  ["NG", "🇳🇬 Nigeria"],
  ["KE", "🇰🇪 Kenya"],
];

interface Topic {
  title?: string;
  why?: string;
  sources?: string[];
}
interface HistoryRun {
  topics?: Topic[];
  source?: string;
  category?: string;
}
interface HistoryResp {
  ok?: boolean;
  error?: string;
  runs?: HistoryRun[];
}
interface DetectResp {
  ok?: boolean;
  error?: string;
  topics?: Topic[];
  source?: string;
  category?: string;
}
interface AiQuickResp {
  text?: string;
  answer?: string;
  result?: string;
}

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisKeyword {
  keyword?: string;
  term?: string;
}
interface IntentMap {
  keywords?: (string | AnalysisKeyword)[];
}
interface AnalysisData {
  brandName?: string;
  industry?: string;
  competitors?: AnalysisCompetitor[];
  keywords?: (string | AnalysisKeyword)[];
}

function toast(msg: string) {
  if (typeof window !== "undefined") {
    (window as unknown as { showToast?: (m: string) => void }).showToast?.(msg);
  }
}
function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisData }).analysisData || {};
}
function getIntentMap(): IntentMap | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { _intentMap?: IntentMap })._intentMap;
}
function safeUrl(u: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

interface RenderState {
  topics: Topic[];
  source: string;
  category: string;
}

export default function TrendingTopics() {
  const { brand, compNames } = useMemo(() => {
    const ad = getAnalysisData();
    const b = ad.brandName || "";
    const comps = Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter((n): n is string => !!n)
          .slice(0, 10)
      : [];
    return { brand: b, compNames: comps };
  }, []);

  const [pick, setPick] = useState("");
  const [cat, setCat] = useState("");
  const [kw, setKw] = useState("");
  const [country, setCountry] = useState("ALL");
  const [platform, setPlatform] = useState("");
  const [result, setResult] = useState<RenderState | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [kwBusy, setKwBusy] = useState(false);

  useEffect(() => {
    setCat(brand);
  }, [brand]);

  const loadHistory = useCallback(async () => {
    const h = await apiGet<HistoryResp>("/api/trends/history");
    const last = (h.runs || [])[0];
    if (last)
      setResult({
        topics: last.topics || [],
        source: last.source || "",
        category: last.category || "",
      });
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function onPickChange(v: string) {
    setPick(v);
    if (v) setCat(v);
  }

  async function suggestCat() {
    setCatBusy(true);
    const ad = getAnalysisData();
    const comps = Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const industry = ad.industry || "";
    const r = await apiPost<AiQuickResp>("/api/ai-quick", {
      prompt: `Brand: ${brand}\nKnown competitors: ${comps.join(", ") || "(none)"}\nIndustry hint: ${industry}\n\nReturn ONE concise category label (2-4 words, no punctuation) that best describes the market this brand sells into. Only output the label, nothing else.`,
    });
    const value = (r.text || r.answer || r.result || "")
      .toString()
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .slice(0, 50);
    if (value) {
      setCat(value);
      toast("✅ Category suggested");
    } else toast("⚠ Couldn't infer a category — type one manually");
    setCatBusy(false);
  }

  async function suggestKw() {
    let category = cat.trim();
    if (!category && pick) {
      category = pick;
      setCat(pick);
    }
    if (!category && typeof window !== "undefined") {
      const stored = (localStorage.getItem("ig-domain") || "")
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
      if (stored) {
        category = stored;
        setCat(stored);
      }
    }
    if (!category) {
      toast("❌ Type or suggest a category first");
      return;
    }
    setKwBusy(true);

    // Step 1: keywords already in the last analysis
    const ad = getAnalysisData();
    const im = getIntentMap();
    const directKws: string[] = [];
    if (Array.isArray(ad.keywords) && ad.keywords.length) {
      ad.keywords.forEach((k) => {
        const s = typeof k === "string" ? k : k.keyword || k.term || "";
        if (s) directKws.push(s);
      });
    }
    if (!directKws.length && im && Array.isArray(im.keywords) && im.keywords.length) {
      im.keywords.forEach((k) => {
        const s = typeof k === "string" ? k : k.keyword || k.term || "";
        if (s) directKws.push(s);
      });
    }
    if (directKws.length) {
      setKw(directKws.slice(0, 6).join(", "));
      toast(
        "✅ " +
          Math.min(directKws.length, 6) +
          " keywords pulled from your analysis",
      );
      setKwBusy(false);
      return;
    }

    // Step 2: AI generation
    const r = await apiPost<AiQuickResp>("/api/ai-quick", {
      prompt: `Category: ${category}\n\nReturn 5 short trend-tracking keywords (1-2 words each, lowercase, comma-separated, no numbering, no punctuation other than commas). Focus on terms that indicate emerging trends in this category right now.`,
    });
    const kws = (r.text || r.answer || r.result || "")
      .toString()
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .slice(0, 200);
    if (kws) {
      setKw(kws);
      toast("✅ Keywords suggested");
    } else toast("⚠ No keyword suggestions returned — type manually");
    setKwBusy(false);
  }

  async function detect() {
    const category = cat.trim();
    if (!category) {
      toast("❌ Category required");
      return;
    }
    const keywords = kw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setStatus("loading");
    setErrMsg("");
    const body: Record<string, unknown> = {
      category,
      keywords,
      country: country.trim() || "ALL",
    };
    if (platform) body.platform = platform;
    const r = await apiPost<DetectResp>("/api/trends/detect", body);
    if (!r.ok) {
      setStatus("error");
      setErrMsg(r.error || "failed");
      return;
    }
    setResult({
      topics: r.topics || [],
      source: r.source || "",
      category: r.category || category,
    });
    setStatus("idle");
  }

  const pickerOpts = [
    ...(brand ? [{ value: brand, label: `${brand} (your brand)` }] : []),
    ...compNames.map((n) => ({ value: n, label: n })),
  ];

  const aiBtn: React.CSSProperties = {
    background: "linear-gradient(135deg,#7C3AED,#A855F7)",
    color: "#fff",
    border: 0,
    padding: "2px 8px",
    borderRadius: 8,
    fontSize: "0.6rem",
    fontWeight: 800,
    cursor: "pointer",
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1.5px solid #E5E7EB",
    borderRadius: 6,
    fontSize: "0.82rem",
    boxSizing: "border-box",
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Trending Topics
              </div>
              <h2 className="view-title">🔥 Trending Topics</h2>
              <p className="view-sub">
                What&apos;s spiking in your category right now — powered by live
                web search via Perplexity.
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
              fontFamily: "Sora,sans-serif",
              fontWeight: 800,
              fontSize: "1rem",
              marginBottom: 12,
            }}
          >
            What&apos;s hot in your category?
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 2fr 130px 130px auto",
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
                  marginBottom: 3,
                }}
              >
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  Category *
                </div>
                <button
                  type="button"
                  onClick={suggestCat}
                  disabled={catBusy}
                  title="Let AI infer your category from your last analysis"
                  style={aiBtn}
                >
                  {catBusy ? "⏳…" : "🤖 AI Suggest"}
                </button>
              </div>
              {pickerOpts.length > 0 && (
                <select
                  value={pick}
                  onChange={(e) => onPickChange(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    border: "1.5px solid #E5E7EB",
                    borderRadius: 6,
                    fontSize: "0.74rem",
                    marginBottom: 4,
                    background: "#F9FAFB",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">
                    — Pick a brand/competitor as category seed —
                  </option>
                  {pickerOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                placeholder="e.g. AI marketing, fintech, fitness apparel"
                style={input}
              />
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
                <div
                  style={{
                    fontSize: "0.66rem",
                    fontWeight: 700,
                    color: "#6B7280",
                  }}
                >
                  Keywords (comma, optional)
                </div>
                <button
                  type="button"
                  onClick={suggestKw}
                  disabled={kwBusy}
                  title="Let AI suggest keywords for the chosen category"
                  style={aiBtn}
                >
                  {kwBusy ? "⏳…" : "🤖 AI Suggest"}
                </button>
              </div>
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="growth, automation"
                style={input}
              />
            </div>
            <label>
              <div
                style={{
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 3,
                }}
              >
                Country
              </div>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                style={input}
              >
                {COUNTRIES.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div
                style={{
                  fontSize: "0.66rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 3,
                }}
              >
                Platform
              </div>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                style={input}
              >
                <option value="">🌐 All Web</option>
                <option value="youtube">▶️ YouTube</option>
              </select>
            </label>
            <button
              onClick={detect}
              disabled={status === "loading"}
              style={{
                padding: "9px 18px",
                background: "#B91C1C",
                border: "2px solid #B91C1C",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.5)",
              }}
            >
              🔥 Detect
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{ textAlign: "center", padding: 40, color: "#6B7280" }}
            >
              {platform === "youtube"
                ? "⏳ Fetching YouTube trending videos…"
                : "⏳ Searching live web…"}
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
              {errMsg}
            </div>
          )}
          {status === "idle" && result && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontWeight: 800,
                    fontSize: "0.95rem",
                  }}
                >
                  🔥 Trending in{" "}
                  <span style={{ color: "#B91C1C" }}>{result.category}</span> ·{" "}
                  {result.topics.length} topics
                </div>
                <span
                  style={{
                    background:
                      result.source === "perplexity"
                        ? "#7C3AED"
                        : result.source === "youtube"
                          ? "#FF0000"
                          : "#9CA3AF",
                    color: "#fff",
                    padding: "3px 9px",
                    borderRadius: 5,
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    textTransform: "uppercase",
                  }}
                >
                  {result.source === "youtube"
                    ? "▶ YouTube"
                    : result.source === "perplexity"
                      ? "Perplexity"
                      : result.source}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))",
                  gap: 14,
                }}
              >
                {result.topics.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderLeft: `4px solid ${i < 3 ? "#B91C1C" : i < 6 ? "#F59E0B" : "#9CA3AF"}`,
                      borderRadius: 10,
                      padding: "14px 16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 800,
                          color: "#0A1628",
                          fontSize: "0.95rem",
                        }}
                      >
                        #{i + 1}. {t.title || ""}
                      </div>
                      {result.source === "youtube" && (
                        <span
                          style={{
                            background: "#FF0000",
                            color: "#fff",
                            fontSize: "0.55rem",
                            fontWeight: 800,
                            padding: "2px 6px",
                            borderRadius: 4,
                            whiteSpace: "nowrap",
                            marginLeft: 6,
                            flexShrink: 0,
                          }}
                        >
                          ▶ YouTube
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#374151",
                        marginBottom: 8,
                        lineHeight: 1.5,
                      }}
                    >
                      {t.why || ""}
                    </div>
                    {(t.sources || []).length > 0 && (
                      <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                        {(t.sources || []).slice(0, 3).map((u, j) => (
                          <a
                            key={j}
                            href={safeUrl(u)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#7C3AED",
                              display: "block",
                              marginTop: 2,
                            }}
                          >
                            {u.replace(/^https?:\/\//, "").slice(0, 60)}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
