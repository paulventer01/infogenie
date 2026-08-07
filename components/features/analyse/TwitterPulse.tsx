"use client";

// Native React port of the legacy `twitter-pulse` panel (was
// `window.buildTwitterPulse` + `#view-twitter-pulse` in index.html /
// ig_intel_pack_a.js). Searches X for brand mentions with sentiment +
// viral-thread detection against the existing Express API
// (`POST /api/twitter-pulse/scan` and `POST /api/ai-quick` for AI keyword
// suggestions) via `lib/api`. Brand/competitor pickers are pre-filled from the
// legacy `window.analysisData` global.

import { useMemo, useState } from "react";
import { apiPost, type ApiResult } from "@/lib/api";
import { safeUrl } from "@/lib/utils";
import { showToast } from "@/hooks/useToast";

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
  competitors?: AnalysisCompetitor[];
  keywords?: (string | AnalysisKeyword)[];
  industry?: { name?: string };
}

interface Tweet {
  handle?: string;
  author?: string;
  text?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  date?: string;
  url?: string;
  viral?: boolean;
  sentiment?: string;
}
interface ScanResult extends ApiResult {
  total?: number;
  counts?: { pos?: number; neu?: number; neg?: number };
  viral_count?: number;
  tweets: Tweet[];
}
interface AiQuickResult {
  text?: string;
  answer?: string;
  result?: string;
}

const SENT_COLOR: Record<string, [string, string]> = {
  positive: ["#ECFDF5", "#065F46"],
  neutral: ["#F3F4F6", "#374151"],
  negative: ["#FEF2F2", "#991B1B"],
};

function _n(x: unknown, d?: number): number {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round(v) : d || 0;
}

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}
function getIntentMap(): IntentMap | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { _intentMap?: IntentMap })._intentMap || null;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.84rem",
  boxSizing: "border-box",
};

export default function TwitterPulse() {
  const ownBrand = useMemo(() => getAnalysisData().brandName || "", []);
  const compNames = useMemo(() => {
    const ad = getAnalysisData();
    return Array.isArray(ad.competitors)
      ? ad.competitors
          .map((c) => c.name || c.domain)
          .filter((n): n is string => !!n)
          .slice(0, 15)
      : [];
  }, []);

  const [brand, setBrand] = useState(ownBrand);
  const [pick, setPick] = useState("");
  const [keywords, setKeywords] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "loading" | "error" | "done"
  >("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  function onPick(v: string) {
    setPick(v);
    if (v) setBrand(v);
  }

  async function kwSuggest() {
    setSuggesting(true);
    try {
      const ad = getAnalysisData();
      const im = getIntentMap();
      let directKws: string[] = [];
      const toStr = (k: string | AnalysisKeyword) =>
        (typeof k === "string" ? k : k.keyword || k.term || "").trim();
      if (Array.isArray(ad.keywords) && ad.keywords.length) {
        directKws = ad.keywords.slice(0, 8).map(toStr).filter(Boolean);
      }
      if (!directKws.length && im && Array.isArray(im.keywords) && im.keywords.length) {
        directKws = im.keywords.slice(0, 8).map(toStr).filter(Boolean);
      }
      if (
        directKws.length < 4 &&
        Array.isArray(ad.competitors) &&
        ad.competitors.length
      ) {
        const compKws = ad.competitors
          .slice(0, 4)
          .map((c) => c.name || c.domain || "")
          .filter(Boolean);
        directKws = [...new Set([...directKws, ...compKws])].slice(0, 8);
      }
      if (directKws.length) {
        setKeywords(directKws.join(", "));
        showToast("✅ " + directKws.length + " keywords pulled from your analysis");
        return;
      }
      const b = brand || ad.brandName || "";
      if (!b) {
        showToast("⚠ Enter a brand first");
        return;
      }
      const r = await apiPost<ApiResult & AiQuickResult>("/api/ai-quick", {
        prompt: `Brand: ${b}\n\nSuggest 5-6 short Twitter/X search keywords or hashtags to monitor brand mentions, product discussions, and competitor comparisons for this brand. Return them as a comma-separated list only, no explanation.`,
      });
      const kws = ((r.text || r.answer || r.result) || "")
        .toString()
        .trim()
        .replace(/^["']|["']$/g, "")
        .split("\n")[0]
        .slice(0, 200);
      if (kws) {
        setKeywords(kws);
        showToast("✅ AI keyword suggestions loaded");
      } else {
        showToast("⚠ No keyword suggestions returned — type manually");
      }
    } catch (e) {
      showToast("❌ " + (e instanceof Error ? e.message : "Failed"));
    } finally {
      setSuggesting(false);
    }
  }

  async function scan() {
    const b = brand.trim();
    const kws = keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!b) {
      setStatus("error");
      setError("⚠ Brand required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<ScanResult>("/api/twitter-pulse/scan", {
      brand: b,
      keywords: kws,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Scan failed");
      return;
    }
    setResult(r);
    setStatus("done");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Twitter/X Pulse
              </div>
              <h2 className="view-title">🐦 Twitter/X Pulse</h2>
              <p className="view-sub">
                Search X for brand mentions in the last 7 days with sentiment
                classification + viral-thread detection. No X API key needed.
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
              gridTemplateColumns: "1fr 2fr",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 3,
                }}
              >
                BRAND{" "}
                <span style={{ color: "#15803D", fontWeight: 600 }}>
                  (auto-filled from your analysis)
                </span>
              </label>
              {(ownBrand || compNames.length > 0) && (
                <select
                  value={pick}
                  onChange={(e) => onPick(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: "1.5px solid #D1D5DB",
                    borderRadius: 5,
                    fontSize: "0.78rem",
                    background: "#F9FAFB",
                    marginBottom: 5,
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">— Pick from your analysis —</option>
                  {ownBrand && (
                    <option value={ownBrand}>{ownBrand} (your brand)</option>
                  )}
                  {compNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Tesla — or pick from list above"
                style={{
                  ...inputStyle,
                  background: ownBrand ? "#F0FDF4" : "#fff",
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
                  marginBottom: 3,
                }}
              >
                EXTRA KEYWORDS (optional, comma-sep)
                <button
                  type="button"
                  onClick={kwSuggest}
                  disabled={suggesting}
                  style={{
                    marginLeft: 6,
                    background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                    color: "#fff",
                    border: 0,
                    padding: "2px 8px",
                    borderRadius: 8,
                    fontSize: "0.6rem",
                    fontWeight: 800,
                    cursor: "pointer",
                    verticalAlign: "middle",
                  }}
                >
                  {suggesting ? "⏳" : "🤖 AI Suggest"}
                </button>
              </label>
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="cybertruck, FSD, autopilot"
                style={inputStyle}
              />
            </div>
          </div>
          <button
            onClick={scan}
            disabled={status === "loading"}
            style={{
              background: "linear-gradient(135deg,#1DA1F2,#0EA5E9)",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🐦 Scan X
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>⏳ Searching X (15-30s)…</div>
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
          {status === "done" && result && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "14px 18px",
                  marginBottom: 14,
                  display: "flex",
                  justifyContent: "space-around",
                  textAlign: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <Stat value={_n(result.total)} label="TOTAL TWEETS" color="#0A1628" />
                <Stat value={_n(result.counts && result.counts.pos)} label="POSITIVE" color="#10B981" />
                <Stat value={_n(result.counts && result.counts.neu)} label="NEUTRAL" color="#6B7280" />
                <Stat value={_n(result.counts && result.counts.neg)} label="NEGATIVE" color="#EF4444" />
                <Stat value={`🔥 ${_n(result.viral_count)}`} label="VIRAL" color="#7C3AED" />
              </div>
              {result.tweets.length === 0 ? (
                <div
                  style={{
                    background: "#F9FAFB",
                    border: "1px dashed #D1D5DB",
                    borderRadius: 10,
                    padding: 24,
                    textAlign: "center",
                    color: "#6B7280",
                  }}
                >
                  No recent tweets found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {result.tweets.map((t, i) => {
                    const sc =
                      SENT_COLOR[(t.sentiment || "neutral").toLowerCase()] ||
                      SENT_COLOR.neutral;
                    return (
                      <div
                        key={i}
                        style={{
                          background: "#fff",
                          border: "1px solid #E5E7EB",
                          borderLeft: `3px solid ${t.viral ? "#7C3AED" : "#1DA1F2"}`,
                          borderRadius: 8,
                          padding: "12px 14px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#0A1628",
                                fontSize: "0.86rem",
                              }}
                            >
                              {t.handle || t.author || "@unknown"}{" "}
                              {t.viral && (
                                <span
                                  style={{
                                    background: "#FEF3C7",
                                    color: "#92400E",
                                    padding: "1px 6px",
                                    borderRadius: 3,
                                    fontSize: "0.66rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  🔥 VIRAL
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                color: "#0A1628",
                                fontSize: "0.86rem",
                                marginTop: 4,
                                lineHeight: 1.5,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {t.text || ""}
                            </div>
                            <div
                              style={{
                                fontSize: "0.72rem",
                                color: "#6B7280",
                                marginTop: 6,
                              }}
                            >
                              ❤️ {_n(t.likes)} · 🔁 {_n(t.retweets)} · 💬{" "}
                              {_n(t.replies)} · {t.date || ""}{" "}
                              {t.url && safeUrl(t.url) !== "#" && (
                                <>
                                  ·{" "}
                                  <a
                                    href={safeUrl(t.url)}
                                    target="_blank"
                                    rel="noopener"
                                    style={{ color: "#1DA1F2", fontWeight: 700 }}
                                  >
                                    View →
                                  </a>
                                </>
                              )}
                            </div>
                          </div>
                          <span
                            style={{
                              background: sc[0],
                              color: sc[1],
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {t.sentiment || "neutral"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  color,
}: {
  value: number | string;
  label: string;
  color: string;
}) {
  return (
    <div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}
