"use client";

// Native React port of the legacy `reddit-pulse` panel (was
// `window.buildRedditPulse` + `#view-reddit-pulse` in index.html /
// ig_intel_pack_a.js). Searches subreddits for brand mentions/keywords with AI
// sentiment classification and per-post AI reply drafting against the existing
// Express API (`POST /api/reddit-pulse/scan`,
// `POST /api/reddit-pulse/generate-reply`, `POST /api/ai-quick`) via `lib/api`.
// Brand/keyword pickers are pre-filled from the legacy `window.analysisData`
// global.

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
interface AnalysisData {
  brandName?: string;
  competitors?: AnalysisCompetitor[];
  keywords?: (string | AnalysisKeyword)[];
  industry?: { name?: string };
  tagline?: string;
}

interface RedditPost {
  title?: string;
  url?: string;
  subreddit?: string;
  author?: string;
  upvotes?: number;
  comments?: number;
  created?: string;
  selftext?: string;
  sentiment?: string;
}
interface ScanResult extends ApiResult {
  total?: number;
  counts?: { pos?: number; neu?: number; neg?: number };
  posts: RedditPost[];
}
interface ReplyResult extends ApiResult {
  reply?: string;
}
interface AiQuickResult extends ApiResult {
  text?: string;
}

const SENT_COLOR: Record<string, [string, string]> = {
  positive: ["#ECFDF5", "#065F46"],
  neutral: ["#F3F4F6", "#374151"],
  negative: ["#FEF2F2", "#991B1B"],
};
const TONES = ["Engaging", "Direct", "Balanced"];

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 7,
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.82rem",
  boxSizing: "border-box",
};

interface ReplyState {
  status: "idle" | "loading" | "error" | "done";
  text?: string;
  error?: string;
  tone?: string;
}

export default function RedditPulse() {
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
  const hasPickers = !!ownBrand || compNames.length > 0;

  const [brand, setBrand] = useState(ownBrand);
  const [pick, setPick] = useState("");
  const [subs, setSubs] = useState("all");
  const [kw, setKw] = useState("");
  const [kwPlaceholder, setKwPlaceholder] = useState("defaults to brand name");
  const [status, setStatus] = useState<
    "idle" | "loading" | "error" | "done"
  >("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [tones, setTones] = useState<Record<number, string>>({});
  const [replies, setReplies] = useState<Record<number, ReplyState>>({});

  function onPick(v: string) {
    setPick(v);
    if (v) setBrand(v);
  }

  async function kwSuggest() {
    const ad = getAnalysisData();
    const fromAnalysis = Array.isArray(ad.keywords)
      ? ad.keywords
          .map((k) => (typeof k === "string" ? k : k.keyword || k.term || ""))
          .filter(Boolean)
          .slice(0, 10)
      : [];
    if (fromAnalysis.length) {
      setKw(fromAnalysis.join(", "));
      showToast(`✨ ${fromAnalysis.length} keywords pulled from your analysis`);
      return;
    }
    const b = brand.trim();
    const industry = (ad.industry && ad.industry.name) || "";
    if (!b) {
      showToast("⚠️ Enter a brand first or run an analysis");
      return;
    }
    setKwPlaceholder("⏳ Generating…");
    try {
      const data = await apiPost<AiQuickResult>("/api/ai-quick", {
        prompt: `Return ONLY a comma-separated list of 6 short Reddit-search keywords (1-3 words each) for the brand "${b}"${industry ? ` in the ${industry} industry` : ""}. No numbering.`,
        max_tokens: 120,
      });
      if (data.ok && data.text) {
        setKw(
          data.text
            .replace(/\n/g, ", ")
            .replace(/^[-•\d.\s]+/gm, "")
            .replace(/\s*,\s*/g, ", ")
            .replace(/^,\s*|,\s*$/g, "")
            .trim(),
        );
        showToast("✨ AI keywords generated");
      } else {
        showToast("⚠️ AI suggestion unavailable — type manually");
      }
    } catch (e) {
      showToast("❌ " + (e instanceof Error ? e.message : "Failed"));
    } finally {
      setKwPlaceholder("defaults to brand name");
    }
  }

  async function scan() {
    const b = brand.trim();
    const subList = subs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const kws = kw
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
    setReplies({});
    setTones({});
    const r = await apiPost<ScanResult>("/api/reddit-pulse/scan", {
      brand: b,
      subreddits: subList,
      keywords: kws.length ? kws : undefined,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "Scan failed");
      return;
    }
    setResult(r);
    setStatus("done");
  }

  async function generateReply(pi: number, post: RedditPost) {
    const ad = getAnalysisData();
    const b = brand.trim() || ad.brandName || "our brand";
    const tone = tones[pi] || "balanced";
    const brandContext = [
      ad.industry?.name ? `Industry: ${ad.industry.name}` : "",
      ad.tagline || "",
    ]
      .filter(Boolean)
      .join(". ");
    setReplies((s) => ({ ...s, [pi]: { status: "loading", tone } }));
    const r = await apiPost<ReplyResult>("/api/reddit-pulse/generate-reply", {
      postTitle: (post.title || "").slice(0, 120),
      postText: (post.selftext || "").slice(0, 200),
      brand: b,
      tone,
      brandContext,
    });
    if (!r.ok) {
      setReplies((s) => ({
        ...s,
        [pi]: { status: "error", error: r.error || "Failed", tone },
      }));
      return;
    }
    setReplies((s) => ({
      ...s,
      [pi]: { status: "done", text: r.reply || "", tone },
    }));
  }

  function copyReply(pi: number) {
    const text = replies[pi]?.text || "";
    navigator.clipboard
      ?.writeText(text)
      .then(() => showToast("✅ Reply copied!"));
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Reddit Pulse
              </div>
              <h2 className="view-title">👽 Reddit &amp; Community Pulse</h2>
              <p className="view-sub">
                Search any subreddit for brand mentions or keywords from the last
                7 days. AI sentiment classification batched via GPT-4o-mini.
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
          <h3
            style={{
              margin: "0 0 10px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
            }}
          >
            🔍 Scan Reddit
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
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
              {hasPickers ? (
                <select
                  value={pick}
                  onChange={(e) => onPick(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 9px",
                    border: "1.5px solid #D1D5DB",
                    borderRadius: 5,
                    fontSize: "0.76rem",
                    background: "#F9FAFB",
                    marginBottom: 4,
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">
                    — Pick from your analysis (or type below) —
                  </option>
                  {ownBrand && (
                    <option value={ownBrand}>{ownBrand} (your brand)</option>
                  )}
                  {compNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  style={{
                    fontSize: "0.68rem",
                    color: "#9CA3AF",
                    marginBottom: 4,
                  }}
                >
                  💡 Run an analysis to unlock pickers.
                </div>
              )}
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
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
                SUBREDDITS (comma-sep, no r/)
              </label>
              <input
                value={subs}
                onChange={(e) => setSubs(e.target.value)}
                placeholder="all, marketing, sneakers"
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 3,
              }}
            >
              <span>EXTRA KEYWORDS (optional, comma-sep)</span>
              <button
                type="button"
                onClick={kwSuggest}
                title="Pull keywords from your last analysis"
                style={{
                  padding: "3px 8px",
                  background: "linear-gradient(135deg,#0f766e,#0284c7)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  WebkitTextFillColor: "#fff",
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                🤖 AI Suggest
              </button>
            </label>
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={kwPlaceholder}
              style={inputStyle}
            />
          </div>
          <button
            onClick={scan}
            disabled={status === "loading"}
            style={{
              marginTop: 12,
              background: "linear-gradient(135deg,#FF4500,#FF8C42)",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🔍 Scan now
          </button>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Searching Reddit + classifying sentiment…
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
                <Stat value={result.total ?? 0} label="TOTAL POSTS" color="#0A1628" />
                <Stat value={result.counts?.pos ?? 0} label="POSITIVE" color="#10B981" />
                <Stat value={result.counts?.neu ?? 0} label="NEUTRAL" color="#6B7280" />
                <Stat value={result.counts?.neg ?? 0} label="NEGATIVE" color="#EF4444" />
              </div>
              {result.posts.length === 0 ? (
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
                  No posts found in the last 7 days. Try different subreddits or
                  keywords.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {result.posts.slice(0, 50).map((p, pi) => {
                    const sc =
                      SENT_COLOR[(p.sentiment || "neutral").toLowerCase()] ||
                      SENT_COLOR.neutral;
                    const activeTone = tones[pi] || "balanced";
                    const rep = replies[pi];
                    return (
                      <div
                        key={pi}
                        style={{
                          background: "#fff",
                          border: "1px solid #E5E7EB",
                          borderLeft: "3px solid #FF4500",
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
                                fontSize: "0.88rem",
                                lineHeight: 1.4,
                              }}
                            >
                              {p.url && safeUrl(p.url) !== "#" ? (
                                <a
                                  href={safeUrl(p.url)}
                                  target="_blank"
                                  rel="noopener"
                                  style={{
                                    color: "#0A1628",
                                    textDecoration: "none",
                                  }}
                                >
                                  {p.title}
                                </a>
                              ) : (
                                p.title
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: "0.72rem",
                                color: "#6B7280",
                                marginTop: 3,
                              }}
                            >
                              r/{p.subreddit || ""} · u/{p.author || ""} · ⬆{" "}
                              {p.upvotes} · 💬 {p.comments} ·{" "}
                              {p.created
                                ? new Date(p.created).toLocaleDateString()
                                : ""}
                            </div>
                            {p.selftext && (
                              <div
                                style={{
                                  fontSize: "0.78rem",
                                  color: "#374151",
                                  marginTop: 5,
                                  lineHeight: 1.4,
                                }}
                              >
                                {p.selftext.slice(0, 200)}
                                {p.selftext.length > 200 ? "…" : ""}
                              </div>
                            )}
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
                              height: "fit-content",
                            }}
                          >
                            {p.sentiment || "neutral"}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 9,
                            borderTop: "1px solid #F3F4F6",
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.67rem",
                              fontWeight: 700,
                              color: "#6B7280",
                              textTransform: "uppercase",
                              letterSpacing: ".04em",
                            }}
                          >
                            Reply tone:
                          </span>
                          {TONES.map((t) => {
                            const tv = t.toLowerCase();
                            const active = activeTone === tv;
                            return (
                              <button
                                key={t}
                                onClick={() =>
                                  setTones((s) => ({ ...s, [pi]: tv }))
                                }
                                style={{
                                  padding: "3px 9px",
                                  borderRadius: 4,
                                  border: `1.5px solid ${active ? "#7C3AED" : "#D1D5DB"}`,
                                  background: active ? "#EDE9FE" : "#fff",
                                  color: active ? "#6D28D9" : "#374151",
                                  fontSize: "0.67rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {t}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => generateReply(pi, p)}
                            style={{
                              marginLeft: "auto",
                              padding: "4px 12px",
                              background:
                                "linear-gradient(135deg,#FF4500,#FF8C42)",
                              border: "none",
                              borderRadius: 5,
                              color: "#fff",
                              fontSize: "0.72rem",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            ✍️ Generate Reply
                          </button>
                        </div>
                        {rep && (
                          <div style={{ marginTop: 8 }}>
                            {rep.status === "loading" && (
                              <div
                                style={{
                                  color: "#9CA3AF",
                                  fontSize: "0.78rem",
                                }}
                              >
                                ⏳ Generating reply…
                              </div>
                            )}
                            {rep.status === "error" && (
                              <div
                                style={{
                                  color: "#991B1B",
                                  fontSize: "0.78rem",
                                }}
                              >
                                ⚠ {rep.error}
                              </div>
                            )}
                            {rep.status === "done" && (
                              <div
                                style={{
                                  background: "#F9FAFB",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: 7,
                                  padding: "10px 13px",
                                  position: "relative",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.67rem",
                                    fontWeight: 800,
                                    color: "#7C3AED",
                                    textTransform: "uppercase",
                                    marginBottom: 5,
                                  }}
                                >
                                  AI Reply · {rep.tone}
                                </div>
                                <div
                                  style={{
                                    fontSize: "0.82rem",
                                    color: "#1F2937",
                                    lineHeight: 1.55,
                                    whiteSpace: "pre-wrap",
                                  }}
                                >
                                  {rep.text}
                                </div>
                                <button
                                  onClick={() => copyReply(pi)}
                                  style={{
                                    marginTop: 8,
                                    padding: "4px 10px",
                                    background: "#EDE9FE",
                                    border: "none",
                                    borderRadius: 5,
                                    fontSize: "0.68rem",
                                    fontWeight: 700,
                                    color: "#6D28D9",
                                    cursor: "pointer",
                                  }}
                                >
                                  📋 Copy
                                </button>
                              </div>
                            )}
                          </div>
                        )}
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
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700 }}>
        {label}
      </div>
    </div>
  );
}
