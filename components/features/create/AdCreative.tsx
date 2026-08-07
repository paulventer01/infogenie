"use client";

// Native React port of the legacy `ad-creative` panel (was
// `window.buildAdCreative` + `#view-ad-creative` in index.html, defined in
// public/js/ig_creative_suite.js). Bundles three tools that lived in the same
// panel: the DALL-E 3 Ad Creative generator, the Pre-launch Creative Scorer
// (T68) and the UGC Video Ad Script generator (T69). All data comes from the
// existing Express API via `lib/api`:
//   POST /api/ad-creative/generate · GET /api/ad-creative/history
//   DELETE /api/ad-creative/:id · POST /api/ad-creative/score
//   POST /api/ad-creative/ugc-script
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface AdResult {
  ok: boolean;
  error?: string;
  image_url: string;
  prompt: string;
  source?: string;
}
interface AdHistoryItem {
  id: number;
  image_url: string;
  headline?: string;
  platform: string;
  style: string;
}
interface ScoreResult {
  ok: boolean;
  error?: string;
  overall?: number;
  grade?: string;
  verdict?: string;
  source?: string;
  ctr_range?: { low?: string; high?: string };
  scores?: Record<string, number>;
  tips?: { dimension?: string; tip?: string }[];
}
interface UgcScene {
  type?: string;
  timestamp?: string;
  script?: string;
  direction?: string;
  text_overlay?: string;
}
interface UgcResult {
  ok: boolean;
  error?: string;
  scenes?: UgcScene[];
  caption?: string;
  hashtags?: string[];
  creator_tips?: string[];
  source?: string;
}

const PLATFORMS = [
  { id: "facebook_ad", label: "Facebook Ad", icon: "📘" },
  { id: "instagram_post", label: "Instagram Post", icon: "📸" },
  { id: "instagram_story", label: "IG Story", icon: "⭕" },
  { id: "google_display", label: "Google Display", icon: "🔷" },
  { id: "twitter_x", label: "Twitter/X", icon: "🐦" },
  { id: "linkedin", label: "LinkedIn", icon: "💼" },
  { id: "tiktok", label: "TikTok Thumb", icon: "🎵" },
  { id: "youtube_thumbnail", label: "YT Thumbnail", icon: "▶️" },
  { id: "email_banner", label: "Email Banner", icon: "📧" },
  { id: "pinterest", label: "Pinterest", icon: "📌" },
];
const STYLES = [
  { id: "photorealistic", label: "Photo" },
  { id: "illustration", label: "Illustration" },
  { id: "minimalist", label: "Minimal" },
  { id: "bold_graphic", label: "Bold" },
  { id: "corporate", label: "Corporate" },
  { id: "playful", label: "Playful" },
  { id: "editorial", label: "Editorial" },
  { id: "flat_design", label: "Flat" },
];
const FORMATS = ["square", "landscape", "portrait"];

const GRADE_COLOR: Record<string, string> = {
  A: "#15803D",
  B: "#1D4ED8",
  C: "#D97706",
  D: "#DC2626",
  F: "#7C3AED",
};
const SCORE_DIMS: Record<string, string> = {
  hook_strength: "Hook Strength",
  cta_clarity: "CTA Clarity",
  urgency: "Urgency",
  emotional_resonance: "Emotional",
  relevance: "Relevance",
};
const UGC_TYPE_COLORS: Record<string, string> = {
  hook: "#EF4444",
  problem: "#F59E0B",
  solution: "#3B82F6",
  proof: "#8B5CF6",
  cta: "#10B981",
};
const UGC_TYPE_EMOJI: Record<string, string> = {
  hook: "🎣",
  problem: "😤",
  solution: "✅",
  proof: "📊",
  cta: "👆",
};

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1.5px solid #E2E8F0",
  padding: 24,
};
const fieldLabel: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#64748B",
  display: "block",
  marginBottom: 5,
};
const fieldInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  border: "1.5px solid #E2E8F0",
  borderRadius: 9,
  fontSize: "0.8rem",
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    border: `1.5px solid ${active ? "#6366F1" : "#E2E8F0"}`,
    borderRadius: 8,
    fontSize: "0.72rem",
    fontWeight: 600,
    background: active ? "#EEF2FF" : "#fff",
    color: active ? "#6366F1" : "#475569",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function scoreBar(val: number) {
  const pct = val * 10;
  const col =
    val >= 8 ? "#15803D" : val >= 6 ? "#1D4ED8" : val >= 4 ? "#D97706" : "#DC2626";
  return (
    <div
      style={{
        background: "#F1F5F9",
        borderRadius: 4,
        height: 6,
        width: "100%",
        marginTop: 4,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: col,
          borderRadius: 4,
          transition: "width .3s",
        }}
      />
    </div>
  );
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export default function AdCreative() {
  // ── Generator state ──
  const [platform, setPlatform] = useState("facebook_ad");
  const [format, setFormat] = useState("square");
  const [style, setStyle] = useState("photorealistic");
  const [headline, setHeadline] = useState("");
  const [bodyCopy, setBodyCopy] = useState("");
  const [brandName, setBrandName] = useState("");
  const [cta, setCta] = useState("");
  const [colors, setColors] = useState("");
  const [extra, setExtra] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [genResult, setGenResult] = useState<AdResult | null>(null);
  const [history, setHistory] = useState<AdHistoryItem[]>([]);

  // ── Scorer state ──
  const [scHeadline, setScHeadline] = useState("");
  const [scBody, setScBody] = useState("");
  const [scCta, setScCta] = useState("");
  const [scPlatform, setScPlatform] = useState("facebook_ad");
  const [scVisual, setScVisual] = useState("");
  const [scLoading, setScLoading] = useState(false);
  const [scError, setScError] = useState("");
  const [scResult, setScResult] = useState<ScoreResult | null>(null);

  // ── UGC state ──
  const [ugProduct, setUgProduct] = useState("");
  const [ugAudience, setUgAudience] = useState("");
  const [ugBenefit, setUgBenefit] = useState("");
  const [ugHookType, setUgHookType] = useState("problem-solution");
  const [ugPlatform, setUgPlatform] = useState("instagram_reels");
  const [ugDuration, setUgDuration] = useState("30");
  const [ugLoading, setUgLoading] = useState(false);
  const [ugError, setUgError] = useState("");
  const [ugResult, setUgResult] = useState<UgcResult | null>(null);

  async function loadHistory() {
    const r = await apiGet<{ ok: boolean; items?: AdHistoryItem[] }>(
      "/api/ad-creative/history",
    );
    if (r.ok && r.items?.length) setHistory(r.items);
    else setHistory([]);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function generate() {
    if (!headline.trim()) {
      setGenError("Please enter a headline first.");
      setGenResult(null);
      return;
    }
    setGenLoading(true);
    setGenError("");
    setGenResult(null);
    const r = await apiPost<AdResult>("/api/ad-creative/generate", {
      platform,
      format,
      style,
      headline: headline.trim(),
      body_copy: bodyCopy.trim(),
      brand_name: brandName.trim(),
      cta_text: cta.trim(),
      brand_colors: colors.trim(),
      extra_context: extra.trim(),
    });
    setGenLoading(false);
    if (!r.ok) {
      setGenError(`Error: ${r.error || "generation failed"}`);
      return;
    }
    setGenResult(r);
    loadHistory();
  }

  async function deleteCreative(id: number) {
    await apiDelete(`/api/ad-creative/${id}`);
    loadHistory();
  }

  async function score() {
    if (!scHeadline.trim()) {
      setScError("Please enter a headline to score.");
      setScResult(null);
      return;
    }
    setScLoading(true);
    setScError("");
    setScResult(null);
    const r = await apiPost<ScoreResult>("/api/ad-creative/score", {
      headline: scHeadline,
      body_copy: scBody,
      cta_text: scCta,
      platform: scPlatform,
      visual_desc: scVisual,
    });
    setScLoading(false);
    if (!r.ok) {
      setScError(`Error: ${r.error || "scoring failed"}`);
      return;
    }
    setScResult(r);
  }

  async function genUgc() {
    if (!ugProduct.trim()) {
      setUgError("Please enter your product or service first.");
      setUgResult(null);
      return;
    }
    setUgLoading(true);
    setUgError("");
    setUgResult(null);
    const r = await apiPost<UgcResult>("/api/ad-creative/ugc-script", {
      product: ugProduct,
      audience: ugAudience,
      benefit: ugBenefit,
      hook_type: ugHookType,
      platform: ugPlatform,
      duration: ugDuration,
    });
    setUgLoading(false);
    if (!r.ok) {
      setUgError(`Error: ${r.error || "generation failed"}`);
      return;
    }
    setUgResult(r);
  }

  const isPlaceholder = genResult?.source === "placeholder";

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div style={{ flex: 1 }}>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Ad Creative Generator
              </div>
              <h2 className="view-title">🎨 AI Ad Creative Generator</h2>
              <p className="view-sub">
                Generate professional ad images for any platform using DALL-E 3.
                Facebook ads, Instagram posts, Google Display banners, TikTok
                thumbnails and more — in any style.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  marginTop: 12,
                }}
              >
                <button
                  onClick={() => scrollTo("adCreativeGen")}
                  style={{
                    padding: "6px 14px",
                    background: "rgba(255,255,255,0.15)",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 20,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  🎨 Image Generator ↓
                </button>
                <button
                  onClick={() => scrollTo("csScorer")}
                  style={{
                    padding: "6px 14px",
                    background: "rgba(255,255,255,0.15)",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 20,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  🎯 Pre-launch Scorer ↓
                </button>
                <button
                  onClick={() => scrollTo("ugcScripter")}
                  style={{
                    padding: "6px 14px",
                    background: "rgba(255,255,255,0.15)",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 20,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  🎬 UGC Script Generator ↓
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {/* ── Generator ── */}
        <div
          id="adCreativeGen"
          style={{
            display: "grid",
            gridTemplateColumns: "340px 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div style={{ ...card, position: "sticky", top: 80 }}>
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "#1E293B",
                margin: "0 0 18px",
              }}
            >
              🎨 Generate Ad Creative
            </h3>

            <label style={{ ...fieldLabel, marginBottom: 6 }}>PLATFORM</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 16,
              }}
            >
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  style={pillStyle(platform === p.id)}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            <label style={{ ...fieldLabel, marginBottom: 6 }}>FORMAT</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {FORMATS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  style={{
                    ...pillStyle(format === f),
                    flex: 1,
                    padding: 7,
                    textTransform: "capitalize",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            <label style={{ ...fieldLabel, marginBottom: 6 }}>STYLE</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 16,
              }}
            >
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  style={{
                    ...pillStyle(style === s.id),
                    padding: "5px 9px",
                    borderRadius: 7,
                    fontSize: "0.7rem",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <label style={fieldLabel}>HEADLINE</label>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. Stop overpaying for marketing tools"
              style={{ ...fieldInput, marginBottom: 12 }}
            />

            <label style={fieldLabel}>BODY COPY (optional)</label>
            <textarea
              value={bodyCopy}
              onChange={(e) => setBodyCopy(e.target.value)}
              rows={2}
              placeholder="Supporting message or offer details…"
              style={{ ...fieldInput, resize: "vertical", marginBottom: 12 }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={fieldLabel}>BRAND NAME</label>
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. InfoGenie"
                  style={{ ...fieldInput, padding: "8px 10px", borderRadius: 8 }}
                />
              </div>
              <div>
                <label style={fieldLabel}>CTA TEXT</label>
                <input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder="e.g. Get Started Free"
                  style={{ ...fieldInput, padding: "8px 10px", borderRadius: 8 }}
                />
              </div>
            </div>

            <label style={fieldLabel}>BRAND COLORS (optional)</label>
            <input
              value={colors}
              onChange={(e) => setColors(e.target.value)}
              placeholder="e.g. #6366F1, #0EA5E9, white"
              style={{ ...fieldInput, padding: "8px 10px", marginBottom: 12 }}
            />

            <label style={fieldLabel}>EXTRA DIRECTION (optional)</label>
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="e.g. Show a happy professional at a laptop"
              style={{ ...fieldInput, padding: "8px 10px", marginBottom: 18 }}
            />

            <button
              onClick={generate}
              disabled={genLoading}
              style={{
                width: "100%",
                padding: 12,
                background: "linear-gradient(135deg,#6366F1,#8B5CF6)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {genLoading ? "⏳ Generating…" : "✨ Generate Creative"}
            </button>
          </div>

          <div>
            <div style={{ marginBottom: 24 }}>
              {genLoading && (
                <div style={{ ...card, padding: 32, textAlign: "center" }}>
                  <div style={{ fontSize: "2rem", marginBottom: 12 }}>🎨</div>
                  <p
                    style={{
                      color: "#6366F1",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                    }}
                  >
                    DALL-E 3 is designing your creative…
                  </p>
                  <p
                    style={{
                      color: "#94A3B8",
                      fontSize: "0.78rem",
                      marginTop: 6,
                    }}
                  >
                    This usually takes 10-20 seconds
                  </p>
                </div>
              )}
              {!genLoading && genError && (
                <p style={{ color: "#EF4444", fontSize: "0.8rem" }}>
                  {genError}
                </p>
              )}
              {!genLoading && genResult && (
                <div style={card}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontSize: "0.95rem",
                        fontWeight: 700,
                        color: "#1E293B",
                        margin: 0,
                      }}
                    >
                      ✅ Creative Generated
                    </h3>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "3px 8px",
                        background: isPlaceholder ? "#FEF3C7" : "#D1FAE5",
                        color: isPlaceholder ? "#92400E" : "#065F46",
                        borderRadius: 20,
                        fontWeight: 600,
                      }}
                    >
                      {isPlaceholder
                        ? "⚠️ Placeholder (add OpenAI key)"
                        : "✨ DALL-E 3"}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={genResult.image_url}
                    alt="Generated Ad Creative"
                    style={{
                      width: "100%",
                      maxWidth: 600,
                      display: "block",
                      borderRadius: 12,
                      border: "1px solid #E2E8F0",
                      margin: "0 auto 16px",
                    }}
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a
                      href={genResult.image_url}
                      download={`ad-creative-${Date.now()}.png`}
                      style={{
                        padding: "9px 16px",
                        background: "#6366F1",
                        borderRadius: 9,
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#fff",
                        textDecoration: "none",
                      }}
                    >
                      ⬇ Download
                    </a>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(genResult.image_url)
                      }
                      style={{
                        padding: "9px 16px",
                        background: "#F1F5F9",
                        border: "1.5px solid #E2E8F0",
                        borderRadius: 9,
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#475569",
                        cursor: "pointer",
                      }}
                    >
                      📋 Copy URL
                    </button>
                    <button
                      onClick={generate}
                      style={{
                        padding: "9px 16px",
                        background: "#F1F5F9",
                        border: "1.5px solid #E2E8F0",
                        borderRadius: 9,
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#475569",
                        cursor: "pointer",
                      }}
                    >
                      🔄 Regenerate
                    </button>
                  </div>
                  <details style={{ marginTop: 12 }}>
                    <summary
                      style={{
                        fontSize: "0.75rem",
                        color: "#94A3B8",
                        cursor: "pointer",
                      }}
                    >
                      View AI prompt
                    </summary>
                    <p
                      style={{
                        fontSize: "0.72rem",
                        color: "#64748B",
                        marginTop: 8,
                        lineHeight: 1.5,
                        background: "#F8FAFC",
                        padding: 10,
                        borderRadius: 8,
                      }}
                    >
                      {genResult.prompt}
                    </p>
                  </details>
                </div>
              )}
            </div>

            {history.length > 0 && (
              <div>
                <h3
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 700,
                    color: "#1E293B",
                    margin: "0 0 14px",
                  }}
                >
                  Recent Creatives
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill,minmax(180px,1fr))",
                    gap: 12,
                  }}
                >
                  {history.map((it) => (
                    <div
                      key={it.id}
                      style={{
                        background: "#fff",
                        borderRadius: 12,
                        border: "1.5px solid #E2E8F0",
                        overflow: "hidden",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={it.image_url}
                        alt={it.headline || ""}
                        style={{
                          width: "100%",
                          aspectRatio: "1",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                      <div style={{ padding: 10 }}>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            color: "#1E293B",
                            marginBottom: 4,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {it.headline || "(no headline)"}
                        </div>
                        <div style={{ fontSize: "0.65rem", color: "#94A3B8" }}>
                          {it.platform} · {it.style}
                        </div>
                        <div
                          style={{ display: "flex", gap: 6, marginTop: 8 }}
                        >
                          <a
                            href={it.image_url}
                            download
                            style={{
                              fontSize: "0.65rem",
                              color: "#6366F1",
                              fontWeight: 600,
                              textDecoration: "none",
                            }}
                          >
                            ⬇ DL
                          </a>
                          <button
                            onClick={() => deleteCreative(it.id)}
                            style={{
                              fontSize: "0.65rem",
                              color: "#EF4444",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              fontWeight: 600,
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Pre-launch Creative Scorer ── */}
        <div id="csScorer" style={{ ...card, marginTop: 28 }}>
          <div style={{ marginBottom: 18 }}>
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "#1E293B",
                margin: "0 0 4px",
              }}
            >
              🎯 Pre-launch Creative Scorer
            </h3>
            <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
              Score your ad creative before you spend — predict CTR range, get a
              grade, and receive specific improvement tips.
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "340px 1fr",
              gap: 20,
              alignItems: "start",
            }}
          >
            <div>
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                HEADLINE TO SCORE
              </label>
              <input
                value={scHeadline}
                onChange={(e) => setScHeadline(e.target.value)}
                placeholder="e.g. Stop wasting money on ads that don't convert"
                style={{ ...fieldInput, marginBottom: 10 }}
              />
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                BODY COPY (optional)
              </label>
              <textarea
                value={scBody}
                onChange={(e) => setScBody(e.target.value)}
                rows={2}
                placeholder="Supporting message…"
                style={{
                  ...fieldInput,
                  resize: "vertical",
                  marginBottom: 10,
                  fontFamily: "inherit",
                }}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div>
                  <label style={{ ...fieldLabel, fontWeight: 700 }}>
                    CTA TEXT
                  </label>
                  <input
                    value={scCta}
                    onChange={(e) => setScCta(e.target.value)}
                    placeholder="e.g. Start Free Trial"
                    style={{
                      ...fieldInput,
                      padding: "8px 10px",
                      borderRadius: 8,
                    }}
                  />
                </div>
                <div>
                  <label style={{ ...fieldLabel, fontWeight: 700 }}>
                    PLATFORM
                  </label>
                  <select
                    value={scPlatform}
                    onChange={(e) => setScPlatform(e.target.value)}
                    style={{
                      ...fieldInput,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "#fff",
                    }}
                  >
                    <option value="facebook_ad">Facebook Ad</option>
                    <option value="instagram_post">Instagram</option>
                    <option value="google_display">Google Display</option>
                    <option value="tiktok">TikTok</option>
                    <option value="linkedin">LinkedIn</option>
                  </select>
                </div>
              </div>
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                VISUAL DESCRIPTION (optional)
              </label>
              <input
                value={scVisual}
                onChange={(e) => setScVisual(e.target.value)}
                placeholder="e.g. Happy professional at a clean desk"
                style={{ ...fieldInput, marginBottom: 14 }}
              />
              <button
                onClick={score}
                disabled={scLoading}
                style={{
                  width: "100%",
                  padding: 11,
                  background: "linear-gradient(135deg,#F59E0B,#EF4444)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {scLoading ? "⏳ Scoring…" : "🎯 Score This Creative"}
              </button>
            </div>
            <div>
              {scLoading && (
                <div
                  style={{
                    background: "#F8FAFC",
                    borderRadius: 12,
                    padding: 20,
                    textAlign: "center",
                    color: "#94A3B8",
                  }}
                >
                  <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>⏳</div>
                  <div style={{ fontSize: "0.8rem" }}>
                    Analysing your creative against real ad performance
                    benchmarks…
                  </div>
                </div>
              )}
              {!scLoading && scError && (
                <p style={{ color: "#EF4444", fontSize: "0.8rem" }}>
                  {scError}
                </p>
              )}
              {!scLoading && !scResult && !scError && (
                <div
                  style={{
                    background: "#F8FAFC",
                    borderRadius: 12,
                    padding: 20,
                    textAlign: "center",
                    color: "#94A3B8",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>🎯</div>
                  <div style={{ fontSize: "0.8rem" }}>
                    Enter your headline and click Score to get a pre-launch
                    performance prediction.
                  </div>
                </div>
              )}
              {!scLoading && scResult && <ScoreView r={scResult} />}
            </div>
          </div>
        </div>

        {/* ── UGC Script Generator ── */}
        <div id="ugcScripter" style={{ ...card, marginTop: 24 }}>
          <div style={{ marginBottom: 18 }}>
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "#1E293B",
                margin: "0 0 4px",
              }}
            >
              🎬 UGC Video Ad Script Generator
            </h3>
            <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
              Generate a complete timed UGC video script with scene directions,
              text overlays, post caption, and hashtags — ready for a creator
              brief.
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "340px 1fr",
              gap: 20,
              alignItems: "start",
            }}
          >
            <div>
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                PRODUCT / SERVICE
              </label>
              <input
                value={ugProduct}
                onChange={(e) => setUgProduct(e.target.value)}
                placeholder="e.g. AI email writing tool"
                style={{ ...fieldInput, marginBottom: 10 }}
              />
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                TARGET AUDIENCE
              </label>
              <input
                value={ugAudience}
                onChange={(e) => setUgAudience(e.target.value)}
                placeholder="e.g. busy founders, 30-45"
                style={{ ...fieldInput, marginBottom: 10 }}
              />
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                KEY BENEFIT
              </label>
              <input
                value={ugBenefit}
                onChange={(e) => setUgBenefit(e.target.value)}
                placeholder="e.g. write cold emails 10x faster"
                style={{ ...fieldInput, marginBottom: 10 }}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div>
                  <label style={{ ...fieldLabel, fontWeight: 700 }}>
                    HOOK TYPE
                  </label>
                  <select
                    value={ugHookType}
                    onChange={(e) => setUgHookType(e.target.value)}
                    style={{
                      ...fieldInput,
                      padding: "8px 10px",
                      borderRadius: 8,
                      fontSize: "0.78rem",
                      background: "#fff",
                    }}
                  >
                    <option value="problem-solution">Problem → Solution</option>
                    <option value="before-after">Before → After</option>
                    <option value="testimonial">Authentic Testimonial</option>
                    <option value="asmr">ASMR / Sensory</option>
                    <option value="trending-sound">
                      Trending Sound Format
                    </option>
                  </select>
                </div>
                <div>
                  <label style={{ ...fieldLabel, fontWeight: 700 }}>
                    PLATFORM
                  </label>
                  <select
                    value={ugPlatform}
                    onChange={(e) => setUgPlatform(e.target.value)}
                    style={{
                      ...fieldInput,
                      padding: "8px 10px",
                      borderRadius: 8,
                      fontSize: "0.78rem",
                      background: "#fff",
                    }}
                  >
                    <option value="instagram_reels">Instagram Reels</option>
                    <option value="tiktok">TikTok</option>
                    <option value="youtube_shorts">YouTube Shorts</option>
                    <option value="facebook_reels">Facebook Reels</option>
                  </select>
                </div>
              </div>
              <label style={{ ...fieldLabel, fontWeight: 700 }}>
                VIDEO DURATION
              </label>
              <select
                value={ugDuration}
                onChange={(e) => setUgDuration(e.target.value)}
                style={{
                  ...fieldInput,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#fff",
                  marginBottom: 14,
                }}
              >
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="45">45 seconds</option>
                <option value="60">60 seconds</option>
              </select>
              <button
                onClick={genUgc}
                disabled={ugLoading}
                style={{
                  width: "100%",
                  padding: 11,
                  background: "linear-gradient(135deg,#EC4899,#8B5CF6)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {ugLoading ? "⏳ Writing…" : "🎬 Generate Script"}
              </button>
            </div>
            <div>
              {ugLoading && (
                <div
                  style={{
                    background: "#F8FAFC",
                    borderRadius: 12,
                    padding: 20,
                    textAlign: "center",
                    color: "#94A3B8",
                  }}
                >
                  <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>✍️</div>
                  <div style={{ fontSize: "0.8rem" }}>
                    Writing your UGC script with timed scenes and creator
                    directions…
                  </div>
                </div>
              )}
              {!ugLoading && ugError && (
                <p style={{ color: "#EF4444", fontSize: "0.8rem" }}>
                  {ugError}
                </p>
              )}
              {!ugLoading && !ugResult && !ugError && (
                <div
                  style={{
                    background: "#F8FAFC",
                    borderRadius: 12,
                    padding: 20,
                    textAlign: "center",
                    color: "#94A3B8",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>🎬</div>
                  <div style={{ fontSize: "0.8rem" }}>
                    Fill in your product details and generate a complete UGC
                    video script with timed scenes and creator directions.
                  </div>
                </div>
              )}
              {!ugLoading && ugResult && (
                <UgcView
                  r={ugResult}
                  duration={ugDuration}
                  platform={ugPlatform}
                  hookType={ugHookType}
                  onRegenerate={genUgc}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreView({ r }: { r: ScoreResult }) {
  const overall = r.overall || 0;
  const overallColor =
    overall >= 80 ? "#15803D" : overall >= 60 ? "#D97706" : "#DC2626";
  const dims = r.scores || {};
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        border: "1.5px solid #E2E8F0",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "2.5rem",
              fontWeight: 900,
              color: overallColor,
              lineHeight: 1,
            }}
          >
            {overall}
          </div>
          <div
            style={{ fontSize: "0.65rem", color: "#94A3B8", fontWeight: 700 }}
          >
            / 100
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "2.2rem",
              fontWeight: 900,
              color: GRADE_COLOR[r.grade || ""] || "#64748B",
              lineHeight: 1,
            }}
          >
            {r.grade || "C"}
          </div>
          <div
            style={{ fontSize: "0.65rem", color: "#94A3B8", fontWeight: 700 }}
          >
            GRADE
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "0.78rem",
              fontWeight: 600,
              color: "#1E293B",
              marginBottom: 4,
            }}
          >
            {r.verdict || ""}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
            Predicted CTR:{" "}
            <strong style={{ color: "#1D4ED8" }}>
              {r.ctr_range?.low || "?"} – {r.ctr_range?.high || "?"}
            </strong>
          </div>
        </div>
        <div
          style={{
            fontSize: "0.65rem",
            padding: "3px 8px",
            background: r.source === "openai" ? "#D1FAE5" : "#FEF3C7",
            color: r.source === "openai" ? "#065F46" : "#92400E",
            borderRadius: 5,
            fontWeight: 700,
          }}
        >
          {r.source || ""}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {Object.entries(SCORE_DIMS).map(([k, label]) => (
          <div
            key={k}
            style={{ background: "#F8FAFC", borderRadius: 8, padding: 10 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "#475569",
              }}
            >
              <span>{label}</span>
              <span style={{ fontWeight: 800, color: "#1E293B" }}>
                {dims[k] || 0}/10
              </span>
            </div>
            {scoreBar(dims[k] || 0)}
          </div>
        ))}
      </div>
      {r.tips?.length ? (
        <div>
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#6B7280",
              marginBottom: 8,
            }}
          >
            IMPROVEMENT TIPS
          </div>
          {r.tips.slice(0, 5).map((t, i) => (
            <div
              key={i}
              style={{
                background: "#FFF7ED",
                borderLeft: "3px solid #F59E0B",
                borderRadius: "0 6px 6px 0",
                padding: "8px 12px",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#92400E",
                  marginBottom: 2,
                }}
              >
                {(t.dimension || "").replace(/_/g, " ").toUpperCase()}
              </div>
              <div style={{ fontSize: "0.77rem", color: "#1E293B" }}>
                {t.tip || ""}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UgcView({
  r,
  duration,
  platform,
  hookType,
  onRegenerate,
}: {
  r: UgcResult;
  duration: string;
  platform: string;
  hookType: string;
  onRegenerate: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  function copyScript() {
    const txt = containerRef.current?.innerText || "";
    navigator.clipboard.writeText(txt);
  }
  return (
    <div
      ref={containerRef}
      style={{
        background: "#fff",
        borderRadius: 12,
        border: "1.5px solid #E2E8F0",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div
          style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1E293B" }}
        >
          ✅ {duration}s UGC Script — {platform.replace(/_/g, " ")}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span
            style={{
              background: "#FDF4FF",
              color: "#7C3AED",
              padding: "3px 8px",
              borderRadius: 5,
              fontSize: "0.68rem",
              fontWeight: 700,
            }}
          >
            {hookType.replace(/-/g, " ")}
          </span>
          <span
            style={{
              background: r.source === "openai" ? "#D1FAE5" : "#FEF3C7",
              color: r.source === "openai" ? "#065F46" : "#92400E",
              padding: "3px 8px",
              borderRadius: 5,
              fontSize: "0.68rem",
              fontWeight: 700,
            }}
          >
            {r.source || ""}
          </span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {(r.scenes || []).map((s, i) => {
          const color = UGC_TYPE_COLORS[s.type || ""] || "#94A3B8";
          return (
            <div
              key={i}
              style={{
                background: "#F8FAFC",
                borderRadius: 10,
                padding: 12,
                borderLeft: `3px solid ${color}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 800,
                    background: `${color}20`,
                    color,
                    padding: "2px 7px",
                    borderRadius: 4,
                  }}
                >
                  {UGC_TYPE_EMOJI[s.type || ""] || ""}{" "}
                  {(s.type || "").toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#94A3B8",
                    fontWeight: 700,
                  }}
                >
                  {s.timestamp || ""}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.88rem",
                  fontWeight: 600,
                  color: "#1E293B",
                  marginBottom: 6,
                }}
              >
                &quot;{s.script || ""}&quot;
              </div>
              <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                <span style={{ fontWeight: 600 }}>📷 Direction:</span>{" "}
                {s.direction || ""}
              </div>
              {s.text_overlay && (
                <div style={{ fontSize: "0.72rem", marginTop: 4 }}>
                  <span
                    style={{
                      background: "#1E293B",
                      color: "#fff",
                      padding: "2px 7px",
                      borderRadius: 3,
                      fontWeight: 600,
                      fontSize: "0.67rem",
                    }}
                  >
                    ON SCREEN:
                  </span>{" "}
                  <span
                    style={{
                      color: "#1E293B",
                      fontWeight: 600,
                      marginLeft: 4,
                    }}
                  >
                    {s.text_overlay}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {r.caption && (
        <div
          style={{
            background: "#F0FDF4",
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#6B7280",
              marginBottom: 6,
            }}
          >
            POST CAPTION
          </div>
          <div style={{ fontSize: "0.82rem", color: "#1E293B" }}>
            {r.caption}
          </div>
          {r.hashtags?.length ? (
            <div style={{ marginTop: 8 }}>
              {r.hashtags.map((h, i) => (
                <span
                  key={i}
                  style={{ color: "#6366F1", fontSize: "0.72rem" }}
                >
                  #{h}{" "}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {r.creator_tips?.length ? (
        <div>
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#6B7280",
              marginBottom: 6,
            }}
          >
            CREATOR TIPS
          </div>
          {r.creator_tips.map((t, i) => (
            <div
              key={i}
              style={{
                fontSize: "0.78rem",
                color: "#475569",
                padding: "4px 0",
                borderBottom: "1px solid #F1F5F9",
              }}
            >
              💡 {t}
            </div>
          ))}
        </div>
      ) : null}
      <div
        style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}
      >
        <button
          onClick={copyScript}
          style={{
            padding: "8px 14px",
            background: "#6366F1",
            border: "none",
            borderRadius: 8,
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          📋 Copy Script
        </button>
        <button
          onClick={onRegenerate}
          style={{
            padding: "8px 14px",
            background: "#F1F5F9",
            border: "1.5px solid #E2E8F0",
            borderRadius: 8,
            fontSize: "0.75rem",
            fontWeight: 700,
            color: "#475569",
            cursor: "pointer",
          }}
        >
          🔄 Regenerate
        </button>
      </div>
    </div>
  );
}
