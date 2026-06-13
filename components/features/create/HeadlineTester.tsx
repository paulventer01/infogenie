"use client";

// Native React port of the legacy `headline-tester` panel
// (was `window.buildHeadlineTester` in public/js/ig_intel_pack_a.js filling
// `#htWrap`, header from `#view-headline-tester` in index.html). Scores a
// headline 0-100 and generates ranked variants via the existing Express API:
//   POST /api/headline-tester/test-headline
//     { headline, audience, channel, count }
//     → { ok, original:{ text, score, strengths[], weaknesses[] },
//          variants:[{ text, score, kind, patterns_hit[], reasoning }] }
//   POST /api/studio/ai-suggest  (🧠 AI Suggest per field)
//     { field, brand, industry, currentValue, context } → { value }
// Brand grounding is read from the legacy global `window.analysisData`.

import { useRef, useState } from "react";

interface AnalysisData {
  brandName?: string;
  brand?: string;
  industry?: { name?: string } | string;
}
interface Variant {
  text?: string;
  score?: number;
  kind?: string;
  patterns_hit?: string[];
  reasoning?: string;
}
interface HeadlineResult {
  ok: boolean;
  error?: string;
  original?: {
    text?: string;
    score?: number;
    strengths?: string[];
    weaknesses?: string[];
  };
  variants?: Variant[];
}
interface AiSuggestResult {
  value?: string;
}

type FieldKey = "headline" | "audience" | "channel";

const CHANNEL_KEYS = ["landing_page", "email", "ad", "social", "blog"];
const CHANNEL_LABELS: Record<string, string> = {
  landing_page: "Landing page",
  email: "Email subject",
  ad: "Paid ad",
  social: "Social post",
  blog: "Blog post",
};

function toast(msg: string) {
  const fn = (window as unknown as { showToast?: (m: string) => void })
    .showToast;
  if (fn) fn(msg);
  else alert(msg);
}

function scoreColor(s: number): string {
  return s >= 80 ? "#10B981" : s >= 60 ? "#F59E0B" : "#EF4444";
}

const aiBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#7C3AED,#A855F7)",
  color: "#fff",
  border: 0,
  padding: "3px 9px",
  borderRadius: 5,
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
};
const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
};

export default function HeadlineTester() {
  const [headline, setHeadline] = useState("");
  const [audience, setAudience] = useState("");
  const [channel, setChannel] = useState("landing_page");
  const [countPick, setCountPick] = useState("8");
  const [count, setCount] = useState("8");

  const [suggesting, setSuggesting] = useState<FieldKey | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HeadlineResult | null>(null);
  const [error, setError] = useState("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function aiSuggest(field: FieldKey, prompt: string, ctxExtra: string) {
    if (suggesting) return;
    const isSelect = field === "channel";
    const prev =
      field === "headline" ? headline : field === "audience" ? audience : channel;
    setSuggesting(field);
    setElapsed(0);
    const t0 = performance.now();
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setElapsed((performance.now() - t0) / 1000);
    }, 100);
    try {
      const ad =
        (window as unknown as { analysisData?: AnalysisData }).analysisData ||
        {};
      const industry =
        (ad.industry &&
          (typeof ad.industry === "string"
            ? ad.industry
            : ad.industry.name)) ||
        "";
      const r = await fetch("/api/studio/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: prompt,
          brand: ad.brandName || ad.brand || "",
          industry,
          currentValue: isSelect ? "" : prev,
          context: ctxExtra || "",
        }),
      });
      const j = (await r.json()) as AiSuggestResult;
      const v = String(j?.value || "").trim();
      if (!v) throw new Error("AI returned an empty suggestion");
      if (isSelect) {
        const low = v.toLowerCase();
        const match =
          CHANNEL_KEYS.find(
            (k) => low.includes(k.replace("_", " ")) || low.includes(k),
          ) ||
          (low.includes("landing") ? "landing_page" : null) ||
          (low.includes("email") || low.includes("subject") ? "email" : null) ||
          (low.includes("paid") || low.includes("ads") || low === "ad"
            ? "ad"
            : null) ||
          (low.includes("social") ||
          low.includes("linkedin") ||
          low.includes("twitter") ||
          low.includes("tweet") ||
          low.includes("instagram")
            ? "social"
            : null) ||
          (low.includes("blog") || low.includes("article") ? "blog" : null) ||
          "landing_page";
        setChannel(match);
      } else if (field === "headline") {
        setHeadline(v);
      } else {
        setAudience(v);
      }
    } catch (e) {
      toast("⚠ AI Suggest failed: " + (e instanceof Error ? e.message : e));
    } finally {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setSuggesting(null);
    }
  }

  function onCountPick(v: string) {
    setCountPick(v);
    if (v !== "custom") setCount(v);
  }

  async function run() {
    const h = headline.trim();
    const a = audience.trim();
    const c = parseInt(count, 10);
    if (!h) {
      setError("⚠ Headline required");
      setResult(null);
      return;
    }
    setError("");
    setRunning(true);
    setResult(null);
    try {
      const r = (await fetch("/api/headline-tester/test-headline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headline: h, audience: a, channel, count: c }),
      }).then((x) => x.json())) as HeadlineResult;
      if (!r.ok) {
        setError(r.error || "failed");
        setRunning(false);
        return;
      }
      setResult(r);
    } catch (e) {
      setError("Network error: " + (e instanceof Error ? e.message : e));
    }
    setRunning(false);
  }

  function copyVariant(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast("✅ Copied"))
      .catch(() => toast("❌ Copy failed"));
  }

  const thinkingText = `⏳ Thinking… [${elapsed.toFixed(1)}s]`;
  const sortedV = (result?.variants || [])
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Headline Tester
              </div>
              <h2 className="view-title">🎯 Headline &amp; Hook Tester</h2>
              <p className="view-sub">
                Score any headline 0-100 across virality patterns + get up to 10
                alternate variants ranked by predicted performance.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{ paddingTop: 24, paddingBottom: 56 }}
      >
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
            🎯 Test a Headline
          </h3>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 3,
              }}
            >
              <label style={labelStyle}>HEADLINE</label>
              <button
                type="button"
                style={aiBtnStyle}
                onClick={() =>
                  aiSuggest(
                    "headline",
                    "A high-converting marketing headline (one sentence, specific, no buzzwords)",
                    "Audience: " +
                      (audience || "unspecified") +
                      ". Channel: " +
                      channel,
                  )
                }
              >
                🧠 AI Suggest
              </button>
            </div>
            <input
              placeholder={'e.g. "Stop wasting ad budget — automate it"'}
              value={suggesting === "headline" ? thinkingText : headline}
              disabled={suggesting === "headline"}
              onChange={(e) => setHeadline(e.target.value)}
              style={{
                width: "100%",
                padding: 9,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                fontSize: "0.9rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 1fr 140px",
              gap: 10,
              marginTop: 10,
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
                <label style={labelStyle}>AUDIENCE</label>
                <button
                  type="button"
                  style={aiBtnStyle}
                  onClick={() =>
                    aiSuggest(
                      "audience",
                      "A specific target audience segment for this brand (job title + company stage or region — one short phrase)",
                      "",
                    )
                  }
                >
                  🧠 AI Suggest
                </button>
              </div>
              <input
                placeholder="e.g. SaaS founders, Series A-B"
                value={suggesting === "audience" ? thinkingText : audience}
                disabled={suggesting === "audience"}
                onChange={(e) => setAudience(e.target.value)}
                style={{
                  width: "100%",
                  padding: 7,
                  border: "1px solid #D1D5DB",
                  borderRadius: 5,
                  fontSize: "0.82rem",
                  boxSizing: "border-box",
                }}
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
                <label style={labelStyle}>CHANNEL</label>
                <button
                  type="button"
                  style={aiBtnStyle}
                  onClick={() =>
                    aiSuggest(
                      "channel",
                      "The single best distribution channel for this headline. Reply with one of: landing_page, email, ad, social, blog",
                      'Headline: "' +
                        (headline || "(none yet)") +
                        '". Audience: ' +
                        (audience || "unspecified"),
                    )
                  }
                >
                  🧠 AI Suggest
                </button>
              </div>
              <select
                value={suggesting === "channel" ? "__thinking__" : channel}
                disabled={suggesting === "channel"}
                onChange={(e) => setChannel(e.target.value)}
                style={{
                  width: "100%",
                  padding: 7,
                  border: "1px solid #D1D5DB",
                  borderRadius: 5,
                  fontSize: "0.82rem",
                  boxSizing: "border-box",
                }}
              >
                {suggesting === "channel" && (
                  <option value="__thinking__">{thinkingText}</option>
                )}
                {CHANNEL_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {CHANNEL_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                style={{ ...labelStyle, display: "block", marginBottom: 3 }}
              >
                VARIANTS
              </label>
              <div style={{ display: "flex", gap: 4 }}>
                <select
                  value={countPick}
                  onChange={(e) => onCountPick(e.target.value)}
                  style={{
                    flex: 1,
                    padding: 7,
                    border: "1px solid #D1D5DB",
                    borderRadius: 5,
                    fontSize: "0.82rem",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="3">3</option>
                  <option value="5">5</option>
                  <option value="8">8</option>
                  <option value="10">10</option>
                  <option value="custom">Custom…</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  style={{
                    width: 54,
                    padding: 7,
                    border: "1px solid #D1D5DB",
                    borderRadius: 5,
                    fontSize: "0.82rem",
                    boxSizing: "border-box",
                    display: countPick === "custom" ? "inline-block" : "none",
                  }}
                />
              </div>
            </div>
          </div>
          <button
            onClick={run}
            style={{
              marginTop: 12,
              background: "linear-gradient(135deg,#DC2626,#EF4444)",
              color: "#fff",
              border: "none",
              padding: "12px 24px",
              borderRadius: 8,
              fontSize: "0.86rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🎯 Score + Generate Variants
          </button>
        </div>

        <div>
          {running && (
            <div style={{ color: "#9CA3AF" }}>
              ⏳ Scoring + generating variants…
            </div>
          )}
          {error && (
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
          {result && result.ok && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 14,
                  borderLeft: "4px solid #1E1B4B",
                }}
              >
                <div
                  style={{
                    fontSize: "0.74rem",
                    fontWeight: 700,
                    color: "#6B7280",
                    textTransform: "uppercase",
                  }}
                >
                  📌 Original
                </div>
                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: 700,
                    color: "#0A1628",
                    margin: "6px 0",
                  }}
                >
                  {result.original?.text || headline}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    marginTop: 8,
                  }}
                >
                  <div
                    style={{
                      background: scoreColor(result.original?.score || 0),
                      color: "#fff",
                      padding: "4px 12px",
                      borderRadius: 20,
                      fontWeight: 800,
                      fontSize: "1rem",
                    }}
                  >
                    {result.original?.score || 0}/100
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                    {(result.original?.strengths || [])
                      .map((x) => `✓ ${x}`)
                      .join(" · ")}
                  </div>
                </div>
                {(result.original?.weaknesses || []).length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: "0.76rem",
                      color: "#991B1B",
                    }}
                  >
                    {(result.original?.weaknesses || [])
                      .map((x) => `⚠ ${x}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
              <div
                style={{
                  fontWeight: 800,
                  color: "#0A1628",
                  marginBottom: 8,
                }}
              >
                🔥 Variants (ranked best-first)
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {sortedV.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 10,
                      padding: 14,
                      borderLeft: `3px solid ${scoreColor(v.score || 0)}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                        gap: 10,
                        marginBottom: 5,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: "#0A1628",
                            fontSize: "0.92rem",
                            lineHeight: 1.4,
                          }}
                        >
                          {v.text || ""}
                        </div>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "#6B7280",
                            marginTop: 4,
                          }}
                        >
                          {i === 0 ? "🏆 " : ""}
                          <strong style={{ textTransform: "uppercase" }}>
                            {v.kind || ""}
                          </strong>{" "}
                          · {(v.patterns_hit || []).join(" · ")}
                        </div>
                        {v.reasoning && (
                          <div
                            style={{
                              fontSize: "0.74rem",
                              color: "#9CA3AF",
                              marginTop: 3,
                              fontStyle: "italic",
                            }}
                          >
                            {v.reasoning}
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            background: scoreColor(v.score || 0),
                            color: "#fff",
                            padding: "3px 10px",
                            borderRadius: 14,
                            fontWeight: 800,
                            fontSize: "0.86rem",
                          }}
                        >
                          {v.score || 0}
                        </div>
                        <button
                          onClick={() => copyVariant(v.text || "")}
                          style={{
                            background: "#F3F4F6",
                            border: "1px solid #E5E7EB",
                            color: "#374151",
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontSize: "0.66rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          📋
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
