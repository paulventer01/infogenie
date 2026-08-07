"use client";

// Native React port of the legacy `reddit` panel (Reddit Intelligence — was
// `buildRedditIntel` / `scanRedditMonitor` + `#view-reddit` / `#redditWrap` in
// index.html / ig_core_views.js). Monitors brand/keyword/competitor discussions
// across live Hacker News + AI-synthesised Reddit signals, with Monitor /
// Trending / SERP / Reply-Studio tabs. Talks to the Express API via `lib/api`:
//   POST /api/reddit-monitor        { brand, keywords[], competitors[], industry }
//   POST /api/reddit-reply          { postTitle, postPreview, brand, tone, persona, industry }
//   POST /api/reddit-autofill       { domain }
//   POST /api/reddit-studio-suggest { domain, tone, keywords, competitors }
//   POST /api/ai-quick              { prompt, max_tokens }
// Brand/keyword/competitor defaults come from the legacy `window.analysisData`.

import { useMemo, useState } from "react";
import { apiPost, type ApiResult } from "@/lib/api";
import { showToast } from "@/hooks/useToast";
import { safeUrl } from "@/lib/utils";

interface AnalysisCompetitor {
  name?: string;
  domain?: string;
}
interface AnalysisKeyword {
  keyword?: string;
  term?: string;
}
interface AnalysisData {
  url?: string;
  competitors?: AnalysisCompetitor[];
  industry?: { name?: string };
  keywords?: (string | AnalysisKeyword)[];
}

interface RedditPost {
  subreddit?: string;
  source?: string;
  velocity?: number;
  serpLikely?: boolean;
  ageHours?: number;
  url?: string;
  title?: string;
  relevance?: number;
  opportunity?: string;
  sentiment?: string;
  urgency?: string;
  score?: number;
  comments?: number;
  preview?: string;
}
interface MonitorResult extends ApiResult {
  posts?: RedditPost[];
}
interface ReplyResult extends ApiResult {
  reply?: string;
  tone_note?: string;
}
interface AutofillResult extends ApiResult {
  keywords?: string;
  competitors?: string;
}
interface SuggestResult extends ApiResult {
  persona?: string;
  titles?: string[];
}
interface AiQuickResult extends ApiResult {
  text?: string;
}

type Tab = "monitor" | "trending" | "serp" | "reply";

function getAnalysisData(): AnalysisData {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { analysisData?: AnalysisData }).analysisData || {}
  );
}
function getRedditPosts(): RedditPost[] {
  if (typeof window === "undefined") return [];
  return (window as unknown as { _redditPosts?: RedditPost[] })._redditPosts || [];
}
function setRedditPosts(posts: RedditPost[]) {
  if (typeof window !== "undefined")
    (window as unknown as { _redditPosts?: RedditPost[] })._redditPosts = posts;
}

const darkInput: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  background: "rgba(255,255,255,.06)",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 8,
  color: "white",
  fontSize: "0.8rem",
  boxSizing: "border-box",
};
const darkLabel: React.CSSProperties = {
  fontSize: "0.64rem",
  fontWeight: 700,
  color: "rgba(255,255,255,.4)",
  textTransform: "uppercase",
  letterSpacing: ".07em",
  display: "block",
  marginBottom: 5,
};

export default function Reddit() {
  const ad = useMemo(() => getAnalysisData(), []);
  const initialBrand = useMemo(
    () =>
      ad.url?.replace(/https?:\/\//, "").split("/")[0] || "",
    [ad],
  );
  const initialCompetitors = useMemo(
    () => (ad.competitors || []).map((c) => c.name).filter(Boolean).join(", "),
    [ad],
  );
  const industry = ad.industry?.name || "marketing";
  const initialKeywords = useMemo(
    () =>
      (ad.keywords || [])
        .slice(0, 5)
        .map((k) => (typeof k === "string" ? k : k.keyword || k.term || ""))
        .filter(Boolean)
        .join(", "),
    [ad],
  );

  const [brand, setBrand] = useState(initialBrand);
  const [keywords, setKeywords] = useState(initialKeywords);
  const [competitors, setCompetitors] = useState(initialCompetitors);
  const [tab, setTab] = useState<Tab>("monitor");

  const [scanning, setScanning] = useState(false);
  const [scanSec, setScanSec] = useState(0);
  const [posts, setPosts] = useState<RedditPost[]>(getRedditPosts());
  const [scanError, setScanError] = useState("");
  const [scanned, setScanned] = useState(false);

  const [kwSuggesting, setKwSuggesting] = useState(false);

  // Reply Studio state
  const [persona, setPersona] = useState("");
  const [tone, setTone] = useState("Helpful");
  const [selPost, setSelPost] = useState<RedditPost | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [personaSuggesting, setPersonaSuggesting] = useState(false);
  const [titleSuggesting, setTitleSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reply, setReply] = useState<ReplyResult | null>(null);

  async function scan() {
    const kw = keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const comps = competitors
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!brand.trim() && kw.length === 0) {
      showToast("⚠️ Enter a brand name or keywords first");
      return;
    }
    setScanning(true);
    setScanError("");
    setScanSec(0);
    const startedAt = Date.now();
    const tick = setInterval(
      () => setScanSec(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    const r = await apiPost<MonitorResult>("/api/reddit-monitor", {
      brand: brand.trim(),
      keywords: kw,
      competitors: comps,
      industry,
    });
    clearInterval(tick);
    setScanning(false);
    setScanned(true);
    if (!r.ok && !(r.posts && r.posts.length)) {
      setScanError(r.error || "Scan failed");
      setPosts([]);
      setRedditPosts([]);
      return;
    }
    const p = r.posts || [];
    setPosts(p);
    setRedditPosts(p);
    if (p.length === 0) {
      setScanError(
        r.error || "No threads found. Try broader keywords or add more competitors.",
      );
      showToast("ℹ️ No threads matched — try broader keywords");
      return;
    }
    const hnCount = p.filter((x) => x.source === "hn").length;
    const aiCount = p.filter((x) => x.source === "ai").length;
    const serpCount = p.filter((x) => x.serpLikely).length;
    showToast(
      `✅ ${p.length} signals loaded · ${hnCount} live HN · ${aiCount} AI Reddit · ${serpCount} SERP`,
    );
  }

  async function kwSuggest() {
    const fromAnalysis = (ad.keywords || [])
      .map((k) => (typeof k === "string" ? k : k.keyword || k.term || ""))
      .filter(Boolean)
      .slice(0, 10);
    if (fromAnalysis.length) {
      setKeywords(fromAnalysis.join(", "));
      showToast(`✨ ${fromAnalysis.length} keywords pulled from your analysis`);
      return;
    }
    if (!brand.trim()) {
      showToast("⚠️ Enter a brand first or run an analysis");
      return;
    }
    setKwSuggesting(true);
    const r = await apiPost<AiQuickResult>("/api/ai-quick", {
      prompt: `Return ONLY a comma-separated list of 6 short monitoring keywords (1-3 words each) for the brand "${brand.trim()}"${
        ad.industry?.name ? ` in the ${ad.industry.name} industry` : ""
      }. No numbering, no explanations.`,
      max_tokens: 120,
    });
    setKwSuggesting(false);
    if (r.ok && r.text) {
      setKeywords(
        r.text
          .replace(/\n/g, ", ")
          .replace(/^[-•\d.\s]+/gm, "")
          .replace(/\s*,\s*/g, ", ")
          .replace(/^,\s*|,\s*$/g, "")
          .trim(),
      );
      showToast("✨ AI keywords generated");
    } else {
      showToast("⚠️ AI suggestion unavailable — type keywords manually");
    }
  }

  async function autoFill() {
    const d = brand.trim();
    if (d.length < 3) return;
    if (keywords.trim() && competitors.trim()) return;
    const r = await apiPost<AutofillResult>("/api/reddit-autofill", {
      domain: d,
    });
    if (r.keywords && !keywords.trim()) setKeywords(r.keywords);
    if (r.competitors && !competitors.trim()) setCompetitors(r.competitors);
  }

  function openReply(post: RedditPost) {
    setSelPost(post);
    setManualTitle("");
    setTab("reply");
  }

  async function suggestPersona() {
    if (!brand.trim()) {
      showToast("⚠️ Enter a brand name first");
      return;
    }
    setPersonaSuggesting(true);
    const r = await apiPost<SuggestResult>("/api/reddit-studio-suggest", {
      domain: brand.trim(),
      tone,
      keywords: keywords.trim(),
      competitors: competitors.trim(),
    });
    setPersonaSuggesting(false);
    if (r.persona) {
      setPersona(r.persona);
      if (Array.isArray(r.titles) && r.titles.length)
        setTitleSuggestions(r.titles);
      showToast("✨ Persona drafted by AI");
    } else {
      showToast("⚠️ Could not draft persona — " + (r.error || "try again"));
    }
  }

  async function suggestTitle() {
    if (!brand.trim()) {
      showToast("⚠️ Enter a brand name first");
      return;
    }
    if (titleSuggestions.length) return; // cache
    setTitleSuggesting(true);
    const r = await apiPost<SuggestResult>("/api/reddit-studio-suggest", {
      domain: brand.trim(),
      tone,
      keywords: keywords.trim(),
      competitors: competitors.trim(),
    });
    setTitleSuggesting(false);
    if (Array.isArray(r.titles) && r.titles.length) {
      setTitleSuggestions(r.titles);
      showToast(`✨ ${r.titles.length} title ideas ready`);
    } else {
      showToast("⚠️ No title ideas returned — " + (r.error || "try again"));
    }
  }

  async function generateReply() {
    const postTitle = manualTitle.trim() || selPost?.title || "";
    if (!postTitle) {
      showToast("⚠️ Select a thread or paste a post title");
      return;
    }
    setGenerating(true);
    setReply(null);
    const r = await apiPost<ReplyResult>("/api/reddit-reply", {
      postTitle,
      postPreview: selPost?.preview || "",
      brand: brand.trim(),
      tone,
      persona: persona.trim(),
      industry: ad.industry?.name || "marketing",
    });
    setGenerating(false);
    if (!r.reply) {
      showToast("⚠️ Reply generation failed: " + (r.error || "No reply generated"));
      return;
    }
    setReply(r);
  }

  const tabs: [Tab, string, string][] = [
    ["monitor", "📡", "Monitor"],
    ["trending", "🔥", "Trending"],
    ["serp", "🔍", "SERP Signals"],
    ["reply", "✍️", "Reply Studio"],
  ];

  const byRelevance = [...posts].sort(
    (a, b) => (b.relevance || 0) - (a.relevance || 0),
  );
  const byVelocity = [...posts].sort(
    (a, b) => (b.velocity || 0) - (a.velocity || 0),
  );
  const serpPosts = posts.filter((p) => p.serpLikely);

  return (
    <div>
      <div className="view-header-wrap">
        <div className="view-header ig-panel-hero">
          <div className="container">
            <div className="vh-inner">
              <div>
                <div className="breadcrumb">
                  <span className="bc-group">Analyse</span>{" "}
                  <span className="bc-sep">›</span> Reddit Research
                </div>
                <h2 className="view-title">🔴 Reddit Research</h2>
                <p className="view-sub">
                  Searches Reddit for threads and comments about your brand,
                  category, or competitors — one of the most authentic sources
                  of unfiltered customer opinion.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Config Panel */}
      <div
        style={{
          background: "var(--ig-panel2)",
          border: "1px solid rgba(255,100,0,.25)",
          borderRadius: 16,
          padding: "20px 24px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "0.85rem",
            fontWeight: 800,
            color: "white",
            marginBottom: 14,
          }}
        >
          ⚙️ Monitor Settings
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <label style={darkLabel}>Your Brand / Domain</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              onBlur={autoFill}
              placeholder="yourbrand.com"
              style={darkInput}
            />
          </div>
          <div>
            <label
              style={{
                ...darkLabel,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>
                Keywords to Monitor
                {kwSuggesting && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: "0.6rem",
                      color: "#00C9C8",
                      fontWeight: 600,
                    }}
                  >
                    ✦ auto-filling…
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={kwSuggest}
                style={{
                  padding: "3px 8px",
                  background: "linear-gradient(135deg,#0f766e,#0284c7)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
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
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. email marketing, CRM, automation"
              style={darkInput}
            />
          </div>
          <div>
            <label style={darkLabel}>Competitors to Watch</label>
            <input
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder="e.g. HubSpot, Mailchimp"
              style={darkInput}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,.4)" }}>
            <span style={{ color: "#FF6600", fontWeight: 700 }}>📰 Live HN</span>{" "}
            real Hacker News threads &nbsp;·&nbsp;
            <span style={{ color: "#A78BFA", fontWeight: 700 }}>🤖 AI Signal</span>{" "}
            GPT-4o community intelligence based on real Reddit patterns &nbsp;·&nbsp;
            AI scores each thread for relevance, sentiment &amp; urgency
          </div>
          <button
            onClick={scan}
            disabled={scanning}
            style={{
              padding: "10px 22px",
              background: "linear-gradient(135deg,#FF4500,#FF6B35)",
              border: "none",
              borderRadius: 10,
              fontSize: "0.82rem",
              fontWeight: 700,
              color: "white",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {scanning ? `⏳ Scanning… ${scanSec}s` : "🔍 Scan Now"}
          </button>
        </div>
      </div>

      {/* Dark shell wrapping tabs + content */}
      <div
        style={{
          background: "var(--ig-panel2)",
          border: "1px solid rgba(255,100,0,.15)",
          borderRadius: 16,
          padding: "16px 20px",
        }}
      >
        {/* Tab Bar */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 16,
            background: "rgba(255,255,255,.06)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 12,
            padding: 5,
          }}
        >
          {tabs.map(([t, ic, label]) => {
            const active = t === tab;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 9,
                  border: "none",
                  fontSize: "0.77rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all .15s",
                  background: active
                    ? "rgba(255,100,0,.25)"
                    : "rgba(255,255,255,.05)",
                  color: active ? "#FF6B35" : "rgba(255,255,255,.6)",
                }}
              >
                {ic} {label}
              </button>
            );
          })}
        </div>

        {/* Monitor / Trending / SERP feeds */}
        {tab === "monitor" && (
          <Feed
            scanning={scanning}
            scanSec={scanSec}
            scanned={scanned}
            error={scanError}
            posts={byRelevance}
            allPosts={posts}
            onReply={openReply}
            onRetry={scan}
            emptyIcon="📡"
            emptyText="Find brand mentions, competitor threads & rising discussions"
            showReadyState
          />
        )}
        {tab === "trending" && (
          <Feed
            scanning={scanning}
            scanSec={scanSec}
            scanned={scanned}
            error={scanError}
            posts={byVelocity.every((p) => !p.velocity) ? [] : byVelocity}
            allPosts={posts}
            onReply={openReply}
            onRetry={scan}
            emptyIcon="🔥"
            emptyText="Run a scan first to see trending threads sorted by upvote velocity"
          />
        )}
        {tab === "serp" && (
          <div>
            <div
              style={{
                background: "rgba(0,102,255,.08)",
                border: "1px solid rgba(0,102,255,.2)",
                borderRadius: 12,
                padding: "14px 18px",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "rgba(255,255,255,.65)",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: "#60A5FA", fontWeight: 700 }}>
                  🔍 What is SERP Discovery?
                </span>{" "}
                Reddit posts often rank on page 1 of Google for high-intent
                keywords. These threads are prime opportunities — engage early to
                drive organic traffic and shape perception before your
                competitors do.
              </div>
            </div>
            <Feed
              scanning={scanning}
              scanSec={scanSec}
              scanned={scanned}
              error={scanError}
              posts={serpPosts}
              allPosts={posts}
              onReply={openReply}
              onRetry={scan}
              emptyIcon="🔍"
              emptyText="Run a scan to surface threads likely ranking in Google SERPs"
            />
          </div>
        )}

        {/* Reply Studio */}
        {tab === "reply" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            {/* Left: Persona */}
            <div
              style={{
                background: "var(--ig-panel2)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  color: "white",
                  marginBottom: 14,
                }}
              >
                🎭 Brand Persona
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={darkLabel}>Brand Name</label>
                  <input
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Your brand name"
                    style={darkInput}
                  />
                </div>
                <div>
                  <label style={darkLabel}>Tone</label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    style={darkInput}
                  >
                    <option value="Helpful">Helpful Expert</option>
                    <option value="Professional">Professional</option>
                    <option value="Friendly">Friendly &amp; Conversational</option>
                    <option value="Educational">Educational</option>
                    <option value="Direct">Direct &amp; Confident</option>
                  </select>
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <label style={{ ...darkLabel, marginBottom: 0 }}>
                      Persona Description
                    </label>
                    <button
                      type="button"
                      onClick={suggestPersona}
                      disabled={personaSuggesting}
                      style={{
                        padding: "4px 10px",
                        background:
                          "linear-gradient(135deg,rgba(255,69,0,.18),rgba(255,107,53,.18))",
                        border: "1px solid rgba(255,107,53,.35)",
                        borderRadius: 6,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        color: "#FF6B35",
                        cursor: "pointer",
                      }}
                    >
                      {personaSuggesting ? "⏳ Drafting…" : "✨ AI Suggest"}
                    </button>
                  </div>
                  <textarea
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                    rows={3}
                    placeholder="e.g. Senior SaaS consultant who focuses on ROI and practical solutions. Never mention competitors by name. — or click ✨ AI Suggest above"
                    style={{ ...darkInput, fontSize: "0.78rem", resize: "vertical" }}
                  />
                </div>
              </div>
            </div>

            {/* Right: Reply Generator */}
            <div
              style={{
                background: "var(--ig-panel2)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontFamily: "Sora,sans-serif",
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  color: "white",
                  marginBottom: 14,
                }}
              >
                ✍️ Reply Generator
              </div>
              <div
                style={{
                  background: "rgba(255,100,0,.07)",
                  border: "1px solid rgba(255,100,0,.2)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 12,
                  minHeight: 60,
                }}
              >
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "rgba(255,255,255,.7)",
                    marginBottom: 4,
                  }}
                >
                  {selPost
                    ? selPost.title
                    : "Select a thread from Monitor tab or paste a title below"}
                </div>
                <div style={{ fontSize: "0.68rem", color: "#FF6B35" }}>
                  {selPost ? selPost.subreddit : ""}
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 5,
                  }}
                >
                  <label style={{ ...darkLabel, marginBottom: 0 }}>
                    Or paste a post title manually
                  </label>
                  <button
                    type="button"
                    onClick={suggestTitle}
                    disabled={titleSuggesting}
                    style={{
                      padding: "4px 10px",
                      background:
                        "linear-gradient(135deg,rgba(255,69,0,.18),rgba(255,107,53,.18))",
                      border: "1px solid rgba(255,107,53,.35)",
                      borderRadius: 6,
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      color: "#FF6B35",
                      cursor: "pointer",
                    }}
                  >
                    {titleSuggesting ? "⏳ Drafting…" : "✨ Suggest Title"}
                  </button>
                </div>
                <input
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="Paste Reddit post title here… — or click ✨ Suggest Title to draft one"
                  style={{ ...darkInput, fontSize: "0.78rem" }}
                />
                {titleSuggestions.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {titleSuggestions.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setManualTitle(t);
                          setTitleSuggestions([]);
                          showToast("✅ Title selected");
                        }}
                        style={{
                          textAlign: "left",
                          padding: "8px 11px",
                          background: "rgba(255,255,255,.04)",
                          border: "1px solid rgba(255,107,53,.2)",
                          borderRadius: 7,
                          color: "rgba(255,255,255,.85)",
                          fontSize: "0.74rem",
                          cursor: "pointer",
                          lineHeight: 1.4,
                        }}
                      >
                        💡 {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={generateReply}
                disabled={generating}
                style={{
                  width: "100%",
                  padding: 11,
                  background: "linear-gradient(135deg,#FF4500,#FF6B35)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: "white",
                  cursor: "pointer",
                  marginBottom: 14,
                }}
              >
                ✍️ Generate Brand Reply
              </button>
              {generating && (
                <div style={{ textAlign: "center", padding: 20 }}>
                  <div
                    style={{ fontSize: "0.76rem", color: "rgba(255,255,255,.4)" }}
                  >
                    GPT-4 crafting your brand reply…
                  </div>
                </div>
              )}
              {reply && reply.reply && !generating && (
                <div>
                  <div
                    style={{
                      fontSize: "0.64rem",
                      fontWeight: 700,
                      color: "rgba(255,255,255,.35)",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      marginBottom: 6,
                    }}
                  >
                    Generated Reply
                  </div>
                  <div
                    style={{
                      background: "rgba(255,255,255,.04)",
                      border: "1px solid rgba(255,255,255,.08)",
                      borderRadius: 10,
                      padding: 14,
                      fontSize: "0.8rem",
                      color: "rgba(255,255,255,.85)",
                      lineHeight: 1.55,
                      marginBottom: 8,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {reply.reply}
                  </div>
                  {reply.tone_note && (
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "rgba(255,100,0,.7)",
                        fontStyle: "italic",
                        marginBottom: 10,
                      }}
                    >
                      💡 {reply.tone_note}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => {
                        navigator.clipboard
                          .writeText(reply.reply || "")
                          .then(() => showToast("✅ Reply copied!"));
                      }}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        padding: 9,
                        background: "rgba(255,255,255,.08)",
                        border: "1px solid rgba(255,255,255,.12)",
                        borderRadius: 8,
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        color: "white",
                        cursor: "pointer",
                      }}
                    >
                      📋 Copy Reply
                    </button>
                    <button
                      onClick={generateReply}
                      style={{
                        padding: "9px 14px",
                        background: "rgba(255,100,0,.2)",
                        border: "1px solid rgba(255,100,0,.3)",
                        borderRadius: 8,
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        color: "#FF6B35",
                        cursor: "pointer",
                      }}
                    >
                      ↺ Regenerate
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Feed({
  scanning,
  scanSec,
  scanned,
  error,
  posts,
  allPosts,
  onReply,
  onRetry,
  emptyIcon,
  emptyText,
  showReadyState,
}: {
  scanning: boolean;
  scanSec: number;
  scanned: boolean;
  error: string;
  posts: RedditPost[];
  allPosts: RedditPost[];
  onReply: (p: RedditPost) => void;
  onRetry: () => void;
  emptyIcon: string;
  emptyText: string;
  showReadyState?: boolean;
}) {
  if (scanning) {
    return (
      <div style={{ textAlign: "center", padding: "40px 24px" }}>
        <div
          style={{
            fontFamily: "Sora,sans-serif",
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "white",
            marginBottom: 5,
          }}
        >
          Scanning community intelligence…{" "}
          <span style={{ color: "#FF4500" }}>{scanSec}s</span>
        </div>
        <div
          style={{
            fontSize: "0.75rem",
            color: "rgba(255,255,255,.35)",
            marginBottom: 8,
          }}
        >
          Fetching live HN data · GPT-4o generating Reddit signals
        </div>
        <div style={{ fontSize: "0.7rem", color: "rgba(255,180,0,.5)" }}>
          ⏱ This usually takes 10–20 seconds
        </div>
      </div>
    );
  }
  if (scanned && error && allPosts.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 24px" }}>
        <div style={{ fontSize: "2rem", marginBottom: 10 }}>🕳️</div>
        <div
          style={{
            fontSize: "0.85rem",
            fontWeight: 700,
            color: "rgba(255,255,255,.55)",
            marginBottom: 8,
            maxWidth: 420,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.45,
          }}
        >
          {error.replace(/[<>]/g, "")}
        </div>
        <button
          onClick={onRetry}
          style={{
            padding: "9px 20px",
            background: "#FF4500",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: "0.78rem",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          🔄 Try Again
        </button>
      </div>
    );
  }
  if (posts.length === 0) {
    if (showReadyState && !scanned) {
      return (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "rgba(255,255,255,.5)",
          }}
        >
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: "rgba(255,255,255,.5)",
              marginBottom: 6,
            }}
          >
            Ready to scan
          </div>
          <div style={{ fontSize: "0.78rem", marginBottom: 18 }}>{emptyText}</div>
          <button
            onClick={onRetry}
            style={{
              padding: "11px 26px",
              background: "linear-gradient(135deg,#FF4500,#FF6B35)",
              border: "none",
              borderRadius: 10,
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "white",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(255,69,0,.35)",
            }}
          >
            🔍 Scan Now
          </button>
        </div>
      );
    }
    return (
      <div
        style={{
          textAlign: "center",
          padding: "48px 24px",
          color: '#94a3b8',
        }}
      >
        <div style={{ fontSize: "2.5rem", marginBottom: 10 }}>{emptyIcon}</div>
        <div style={{ fontSize: "0.78rem" }}>{emptyText}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {posts.map((p, i) => (
        <RedditCard key={i} p={p} onReply={() => onReply(p)} />
      ))}
    </div>
  );
}

function RedditCard({ p, onReply }: { p: RedditPost; onReply: () => void }) {
  const relColor =
    (p.relevance || 0) >= 70
      ? "#10B981"
      : (p.relevance || 0) >= 40
        ? "#F59E0B"
        : "#6B7280";
  const sentColor =
    p.sentiment === "positive"
      ? "#10B981"
      : p.sentiment === "negative"
        ? "#EF4444"
        : "#6B7280";
  const urgColor =
    p.urgency === "critical"
      ? "#EF4444"
      : p.urgency === "high"
        ? "#F59E0B"
        : p.urgency === "medium"
          ? "#0066FF"
          : "#6B7280";
  return (
    <div
      style={{
        background: "var(--ig-panel2)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 5,
            }}
          >
            <span
              style={{
                fontSize: "0.62rem",
                fontWeight: 700,
                color: "#FF6B35",
                background: "rgba(255,100,0,.12)",
                padding: "2px 7px",
                borderRadius: 5,
              }}
            >
              {p.subreddit}
            </span>
            <span
              style={{
                background:
                  p.source === "hn"
                    ? "rgba(255,102,0,.12)"
                    : "rgba(124,58,237,.12)",
                color: p.source === "hn" ? "#FF6600" : "#A78BFA",
                border: `1px solid ${
                  p.source === "hn"
                    ? "rgba(255,102,0,.25)"
                    : "rgba(124,58,237,.25)"
                }`,
                padding: "2px 7px",
                borderRadius: 5,
                fontSize: "0.6rem",
                fontWeight: 700,
              }}
            >
              {p.source === "hn" ? "📰 Live HN" : "🤖 AI Signal"}
            </span>
            {(p.velocity || 0) > 50 && (
              <span
                style={{
                  background: "rgba(239,68,68,.15)",
                  color: "#EF4444",
                  border: "1px solid rgba(239,68,68,.25)",
                  padding: "2px 7px",
                  borderRadius: 5,
                  fontSize: "0.62rem",
                  fontWeight: 700,
                }}
              >
                🔥 {p.velocity}/hr
              </span>
            )}
            {p.serpLikely && (
              <span
                style={{
                  background: "rgba(0,102,255,.15)",
                  color: "#60A5FA",
                  border: "1px solid rgba(0,102,255,.25)",
                  padding: "2px 7px",
                  borderRadius: 5,
                  fontSize: "0.62rem",
                  fontWeight: 700,
                }}
              >
                🔍 SERP
              </span>
            )}
            <span style={{ fontSize: "0.62rem", color: '#94a3b8' }}>
              {(p.ageHours || 0) < 24
                ? `${p.ageHours}h ago`
                : `${Math.round((p.ageHours || 0) / 24)}d ago`}
            </span>
          </div>
          <a
            href={safeUrl(p.url)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "white",
              textDecoration: "none",
              lineHeight: 1.35,
              display: "block",
            }}
          >
            {p.title}
          </a>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: "0.95rem", fontWeight: 800, color: relColor }}>
            {p.relevance || 0}
          </div>
          <div
            style={{
              fontSize: "0.56rem",
              color: '#94a3b8',
              fontWeight: 600,
            }}
          >
            AI SCORE
          </div>
        </div>
      </div>
      <div
        style={{
          height: 4,
          background: "rgba(255,255,255,.06)",
          borderRadius: 3,
          marginBottom: 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${p.relevance || 0}%`,
            background: relColor,
            borderRadius: 3,
          }}
        />
      </div>
      <div
        style={{
          fontSize: "0.73rem",
          color: "rgba(255,255,255,.5)",
          marginBottom: 10,
          lineHeight: 1.4,
        }}
      >
        {p.opportunity || ""}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: "0.62rem",
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 5,
              background: `${sentColor}18`,
              color: sentColor,
              border: `1px solid ${sentColor}30`,
            }}
          >
            {p.sentiment || "neutral"}
          </span>
          <span
            style={{
              fontSize: "0.62rem",
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 5,
              background: `${urgColor}18`,
              color: urgColor,
              border: `1px solid ${urgColor}30`,
            }}
          >
            ⚡ {p.urgency || "medium"}
          </span>
          <span style={{ fontSize: "0.62rem", color: "rgba(255,255,255,.35)" }}>
            ▲ {p.score} · 💬 {p.comments}
          </span>
        </div>
        <button
          onClick={onReply}
          style={{
            padding: "5px 12px",
            background: "rgba(255,100,0,.18)",
            border: "1px solid rgba(255,100,0,.3)",
            borderRadius: 7,
            fontSize: "0.7rem",
            fontWeight: 700,
            color: "#FF6B35",
            cursor: "pointer",
          }}
        >
          ✍️ Reply
        </button>
      </div>
    </div>
  );
}
