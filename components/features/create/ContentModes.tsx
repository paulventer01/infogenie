"use client";

// Native React port of the legacy `content-modes` panel (was
// `window.buildContentModes` + `#view-content-modes` in index.html, defined in
// public/js/ig_content_pro.js). Generates full SEO articles in six specialised
// modes, with the shared audio-summary generator and WordPress quick-publish
// flow inlined. All data comes from the existing Express API via `lib/api`:
//   POST /api/content-modes/generate · GET /api/content-modes/history
//   GET /api/content-modes/:id · POST /api/audio-summary/generate
//   GET /api/wordpress/sites · POST /api/wordpress/publish
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Section {
  heading?: string;
  body?: string;
}
interface Article {
  title?: string;
  seo_title?: string;
  meta_description?: string;
  word_count?: number;
  intro?: string;
  sections?: Section[];
  conclusion?: string;
  cta?: string;
  pros?: string[];
  cons?: string[];
  verdict?: string;
  rating?: number;
  local_keywords?: string[];
  internal_link_suggestions?: string[];
}
interface ArticleResult {
  ok: boolean;
  error?: string;
  mode: string;
  keyword?: string;
  source?: string;
  article?: Article;
}
interface HistoryRun {
  id: number;
  mode: string;
  keyword?: string;
  brand?: string;
  created_at: string;
}
interface WpSite {
  id: number;
  name: string;
  site_url: string;
  username?: string;
}
interface LastArticle {
  title: string;
  fullText: string;
  content: string;
  excerpt: string;
}

const MODE_CONFIG: Record<
  string,
  { label: string; color: string; fields: string[] }
> = {
  article: { label: "📝 Article", color: "#0891B2", fields: [] },
  affiliation: { label: "💰 Affiliation", color: "#D97706", fields: ["competitor_hint"] },
  ecommerce: { label: "🛒 E-commerce", color: "#7C3AED", fields: [] },
  local: { label: "📍 Local SEO", color: "#059669", fields: ["location"] },
  update: { label: "🔄 Update Content", color: "#6B7280", fields: ["existing_content"] },
  discovery: { label: "🔥 Google Discovery", color: "#DC2626", fields: [] },
};

const VOICE_OPTIONS = [
  { id: "nova", label: "👩 Nova (warm, friendly)" },
  { id: "alloy", label: "🎙 Alloy (balanced)" },
  { id: "echo", label: "📻 Echo (clear, professional)" },
  { id: "fable", label: "📖 Fable (storytelling)" },
  { id: "onyx", label: "🎤 Onyx (deep, authoritative)" },
  { id: "shimmer", label: "✨ Shimmer (soft, expressive)" },
];

function toast(msg: string, ok = true) {
  if (typeof document === "undefined") return;
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${ok ? "#10B981" : "#EF4444"};color:#fff;padding:10px 18px;border-radius:10px;font-size:0.8rem;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function esc(s?: string) {
  return String(s || "");
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  display: "block",
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.88rem",
  boxSizing: "border-box",
};

export default function ContentModes() {
  const [mode, setMode] = useState("article");
  const [keyword, setKeyword] = useState("");
  const [brand, setBrand] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [location, setLocation] = useState("");
  const [existing, setExisting] = useState("");

  const [view, setView] = useState<"none" | "loading" | "error" | "article" | "history">(
    "none",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<ArticleResult | null>(null);
  const [last, setLast] = useState<LastArticle | null>(null);
  const [history, setHistory] = useState<HistoryRun[]>([]);

  // Audio summary state
  const [audioPicker, setAudioPicker] = useState(false);
  const [audioVoice, setAudioVoice] = useState("nova");
  const [audioStatus, setAudioStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [audioData, setAudioData] = useState<{
    mp3Url: string;
    charCount: number;
    script?: string;
    voice: string;
    title: string;
  } | null>(null);
  const [audioError, setAudioError] = useState("");

  // WordPress publish state
  const [wpOpen, setWpOpen] = useState(false);
  const [wpSites, setWpSites] = useState<WpSite[]>([]);
  const [wpTitle, setWpTitle] = useState("");
  const [wpSite, setWpSite] = useState("");
  const [wpStatus, setWpStatus] = useState("draft");
  const [wpPublishing, setWpPublishing] = useState(false);
  const [wpError, setWpError] = useState("");

  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.article;
  const fields = cfg.fields;

  function buildLast(a: Article): LastArticle {
    const sections = (a.sections || [])
      .map((s) => `<h2>${esc(s.heading)}</h2>\n<p>${esc(s.body)}</p>`)
      .join("\n");
    const fullText = [a.intro, ...(a.sections || []).map((s) => s.body), a.conclusion]
      .filter(Boolean)
      .join("\n\n");
    return {
      title: a.title || "",
      fullText,
      content: `<p>${a.intro || ""}</p>${sections}<p>${a.conclusion || ""}</p>`,
      excerpt: a.meta_description || "",
    };
  }

  async function generate() {
    if (!keyword && mode !== "update") {
      toast("⚠️ Keyword required", false);
      return;
    }
    if (mode === "update" && !existing) {
      toast("⚠️ Paste your existing content to refresh", false);
      return;
    }
    if (mode === "local" && !location) {
      toast("⚠️ Location required for Local SEO mode", false);
      return;
    }
    setView("loading");
    setAudioStatus("idle");
    setAudioData(null);
    const r = await apiPost<ArticleResult>("/api/content-modes/generate", {
      mode,
      keyword,
      brand,
      audience,
      tone,
      location,
      existing_content: existing,
    });
    if (!r.ok) {
      setView("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    if (r.article) setLast(buildLast(r.article));
    setView("article");
  }

  async function showHistory() {
    setView("history");
    const r = await apiGet<{ ok: boolean; runs?: HistoryRun[] }>(
      "/api/content-modes/history",
    );
    setHistory(r.ok && r.runs ? r.runs : []);
  }

  async function loadRun(id: number) {
    const r = await apiGet<{
      ok: boolean;
      run?: {
        result: Article;
        mode: string;
        keyword?: string;
        brand?: string;
        source?: string;
      };
    }>(`/api/content-modes/${id}`);
    if (!r.ok || !r.run) return;
    const res: ArticleResult = {
      ok: true,
      article: r.run.result,
      mode: r.run.mode,
      keyword: r.run.keyword,
      source: r.run.source,
    };
    setResult(res);
    setLast(buildLast(r.run.result));
    setView("article");
    setAudioStatus("idle");
    setAudioData(null);
  }

  function copyArticle() {
    if (!last) return;
    const md = `# ${last.title || "Article"}\n\n${last.fullText}`;
    navigator.clipboard
      .writeText(md)
      .then(() => toast("✅ Copied as Markdown"))
      .catch((e) => toast("❌ " + e.message, false));
  }

  function openAudio() {
    if (!last) return;
    if (!last.fullText || last.fullText.length < 50) {
      toast("⚠️ Not enough text for an audio summary", false);
      return;
    }
    setAudioPicker(true);
  }

  async function generateAudio() {
    if (!last) return;
    setAudioPicker(false);
    setAudioStatus("loading");
    setAudioError("");
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      mp3Url: string;
      charCount: number;
      script?: string;
    }>("/api/audio-summary/generate", {
      text: last.fullText,
      title: last.title,
      voice: audioVoice,
    });
    if (!r.ok) {
      setAudioStatus("error");
      setAudioError(r.error || "failed");
      return;
    }
    setAudioData({
      mp3Url: r.mp3Url,
      charCount: r.charCount,
      script: r.script,
      voice: audioVoice,
      title: last.title || "Article",
    });
    setAudioStatus("ready");
  }

  async function openWpPublish() {
    if (!last) {
      toast("⚠️ Generate an article first", false);
      return;
    }
    const r = await apiGet<{ ok: boolean; sites?: WpSite[] }>(
      "/api/wordpress/sites",
    );
    const sites = r.ok && r.sites ? r.sites : [];
    if (!sites.length) {
      toast(
        "No WordPress sites connected. Go to Settings → WordPress to add a site first.",
        false,
      );
      return;
    }
    setWpSites(sites);
    setWpTitle(last.title);
    setWpSite(String(sites[0].id));
    setWpStatus("draft");
    setWpError("");
    setWpOpen(true);
  }

  async function doPublish() {
    if (!last) return;
    if (!wpTitle) {
      setWpError("Title required");
      return;
    }
    setWpPublishing(true);
    setWpError("");
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      post_url?: string;
      wp_post_id?: number;
    }>("/api/wordpress/publish", {
      title: wpTitle,
      content: last.content,
      excerpt: last.excerpt,
      site_id: Number(wpSite),
      status: wpStatus,
      source: "content-modes",
    });
    setWpPublishing(false);
    if (!r.ok) {
      setWpError(r.error || "failed");
      return;
    }
    setWpOpen(false);
    const verb = wpStatus === "publish" ? "Published" : "Saved as draft";
    if (r.post_url) {
      toast(`✅ ${verb} on WordPress`);
      if (confirm(`${verb} on WordPress!\n\nOpen post?`))
        window.open(r.post_url, "_blank");
    } else {
      toast(`✅ ${verb} on WordPress (post #${r.wp_post_id})`);
    }
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Content Modes
              </div>
              <h2 className="view-title">✍️ Content Modes</h2>
              <p className="view-sub">
                Generate full SEO articles in 6 specialised modes — Affiliation,
                E-commerce, Local SEO, Discovery, Update, and standard Article.
                Publish directly to WordPress.
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
            padding: 20,
            marginBottom: 18,
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>CONTENT MODE</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(MODE_CONFIG).map(([k, v]) => {
                const active = mode === k;
                return (
                  <button
                    key={k}
                    onClick={() => setMode(k)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      border: `2px solid ${active ? v.color : "#E5E7EB"}`,
                      background: active ? v.color : "#fff",
                      color: active ? "#fff" : "#374151",
                    }}
                  >
                    {v.label}
                  </button>
                );
              })}
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
                KEYWORD / TOPIC <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. best running shoes 2026"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>BRAND (optional)</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>AUDIENCE (optional)</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. fitness enthusiasts 25-45"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>TONE (optional)</label>
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="e.g. expert + conversational"
                style={inputStyle}
              />
            </div>
          </div>

          {(fields.includes("location") ||
            fields.includes("existing_content")) && (
            <div style={{ marginBottom: 12 }}>
              {fields.includes("location") && (
                <div>
                  <label style={labelStyle}>
                    LOCATION <span style={{ color: "#DC2626" }}>*</span>
                  </label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Austin, TX"
                    style={inputStyle}
                  />
                </div>
              )}
              {fields.includes("existing_content") && (
                <div>
                  <label style={labelStyle}>
                    EXISTING CONTENT TO REFRESH{" "}
                    <span style={{ color: "#DC2626" }}>*</span>
                  </label>
                  <textarea
                    value={existing}
                    onChange={(e) => setExisting(e.target.value)}
                    rows={5}
                    placeholder="Paste your existing article here…"
                    style={{
                      ...inputStyle,
                      fontSize: "0.84rem",
                      resize: "vertical",
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={generate}
              style={{
                padding: "10px 22px",
                background: "#0891B2",
                border: "2px solid #0891B2",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              ✍️ Generate Article
            </button>
            <button
              onClick={showHistory}
              style={{
                padding: "10px 16px",
                background: "#fff",
                border: "1px solid #D1D5DB",
                borderRadius: 8,
                fontSize: "0.82rem",
                fontWeight: 700,
                color: "#374151",
                cursor: "pointer",
              }}
            >
              📂 History
            </button>
          </div>
        </div>

        <div>
          {view === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Writing {cfg.label} article for &quot;{keyword || "your content"}
              &quot;…
              <br />
              <small
                style={{
                  fontSize: "0.74rem",
                  marginTop: 4,
                  display: "block",
                }}
              >
                This takes 15-30 seconds for full AI generation.
              </small>
            </div>
          )}
          {view === "error" && (
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
          {view === "article" && result?.article && (
            <ArticleView
              r={result}
              audioStatus={audioStatus}
              audioData={audioData}
              audioError={audioError}
              onCopy={copyArticle}
              onAudio={openAudio}
              onPublish={openWpPublish}
            />
          )}
          {view === "history" && (
            <HistoryView runs={history} onLoad={loadRun} />
          )}
        </div>
      </div>

      {audioPicker && (
        <Overlay onClose={() => setAudioPicker(false)} maxWidth={420}>
          <ModalHeader title="🎧 Generate Audio Summary" onClose={() => setAudioPicker(false)} />
          <div
            style={{ fontSize: "0.82rem", color: "#6B7280", marginBottom: 14 }}
          >
            InfoGenie will summarise this article into ~90 seconds of spoken
            audio using AI.
          </div>
          <label style={{ ...labelStyle, marginBottom: 6 }}>VOICE</label>
          <select
            value={audioVoice}
            onChange={(e) => setAudioVoice(e.target.value)}
            style={{ ...inputStyle, marginBottom: 16 }}
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            onClick={generateAudio}
            style={{
              width: "100%",
              padding: 10,
              background: "linear-gradient(135deg,#10B981,#059669)",
              border: "none",
              borderRadius: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            🎙 Generate Audio
          </button>
        </Overlay>
      )}

      {wpOpen && (
        <Overlay onClose={() => setWpOpen(false)} maxWidth={540}>
          <ModalHeader title="📤 Publish to WordPress" onClose={() => setWpOpen(false)} />
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label style={labelStyle}>POST TITLE</label>
              <input
                value={wpTitle}
                onChange={(e) => setWpTitle(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>SITE</label>
              <select
                value={wpSite}
                onChange={(e) => setWpSite(e.target.value)}
                style={inputStyle}
              >
                {wpSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.site_url}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>STATUS</label>
              <select
                value={wpStatus}
                onChange={(e) => setWpStatus(e.target.value)}
                style={inputStyle}
              >
                <option value="draft">Draft — save for review</option>
                <option value="publish">Publish immediately</option>
                <option value="pending">Pending review</option>
              </select>
            </div>
          </div>
          {wpError && (
            <div
              style={{
                marginTop: 10,
                background: "#FEE2E2",
                color: "#991B1B",
                padding: "10px 12px",
                borderRadius: 7,
                fontSize: "0.82rem",
              }}
            >
              {wpError}
            </div>
          )}
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={() => setWpOpen(false)}
              style={{
                padding: "9px 18px",
                background: "#fff",
                border: "1px solid #D1D5DB",
                borderRadius: 7,
                fontSize: "0.82rem",
                fontWeight: 700,
                color: "#374151",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={doPublish}
              disabled={wpPublishing}
              style={{
                padding: "9px 18px",
                background: "#1D4ED8",
                border: "none",
                borderRadius: 7,
                fontSize: "0.82rem",
                fontWeight: 800,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {wpPublishing ? "⏳ Publishing…" : "📤 Publish to WordPress"}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({
  children,
  onClose,
  maxWidth,
}: {
  children: React.ReactNode;
  onClose: () => void;
  maxWidth: number;
}) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "24px 28px",
          maxWidth,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: "1rem", color: "#0A1628" }}>
        {title}
      </div>
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          fontSize: "1.4rem",
          cursor: "pointer",
          color: "#9CA3AF",
        }}
      >
        ×
      </button>
    </div>
  );
}

function ArticleView({
  r,
  audioStatus,
  audioData,
  audioError,
  onCopy,
  onAudio,
  onPublish,
}: {
  r: ArticleResult;
  audioStatus: "idle" | "loading" | "ready" | "error";
  audioData: {
    mp3Url: string;
    charCount: number;
    script?: string;
    voice: string;
    title: string;
  } | null;
  audioError: string;
  onCopy: () => void;
  onAudio: () => void;
  onPublish: () => void;
}) {
  const a = r.article || {};
  const cfg = MODE_CONFIG[r.mode] || { color: "#0891B2", label: r.mode };
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderTop: `4px solid ${cfg.color}`,
        borderRadius: 12,
        padding: "24px 28px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                background: cfg.color,
                color: "#fff",
                padding: "3px 10px",
                borderRadius: 5,
                fontSize: "0.7rem",
                fontWeight: 800,
              }}
            >
              {cfg.label}
            </span>
            <span
              style={{
                background: r.source === "openai" ? "#ECFDF5" : "#F3F4F6",
                color: r.source === "openai" ? "#059669" : "#6B7280",
                padding: "3px 8px",
                borderRadius: 5,
                fontSize: "0.68rem",
                fontWeight: 700,
              }}
            >
              {r.source === "openai" ? "🤖 AI" : "📋 Template"}
            </span>
            {a.word_count ? (
              <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>
                ~{a.word_count} words
              </span>
            ) : null}
          </div>
          <h2
            style={{
              fontSize: "1.2rem",
              fontWeight: 800,
              color: "#0A1628",
              margin: 0,
            }}
          >
            {a.title || r.keyword || ""}
          </h2>
          {a.seo_title && (
            <div
              style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 4 }}
            >
              SEO title: {a.seo_title}
            </div>
          )}
          {a.meta_description && (
            <div
              style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: 2 }}
            >
              Meta: {a.meta_description}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={onCopy}
            style={{
              padding: "7px 14px",
              background: "#fff",
              border: "1px solid #D1D5DB",
              borderRadius: 7,
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            📋 Copy
          </button>
          <button
            onClick={onAudio}
            style={{
              padding: "7px 14px",
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 7,
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#15803D",
              cursor: "pointer",
            }}
          >
            🎧 Audio Summary
          </button>
          <button
            onClick={onPublish}
            style={{
              padding: "7px 14px",
              background: "#EFF6FF",
              border: "1px solid #BFDBFE",
              borderRadius: 7,
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#1D4ED8",
              cursor: "pointer",
            }}
          >
            📤 Publish to WP
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        {audioStatus === "loading" && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              padding: "10px 14px",
              borderRadius: 8,
              color: "#15803D",
              fontSize: "0.82rem",
            }}
          >
            ⏳ Generating audio summary (15-30s)…
          </div>
        )}
        {audioStatus === "error" && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#B91C1C",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: "0.82rem",
            }}
          >
            {audioError}
          </div>
        )}
        {audioStatus === "ready" && audioData && (
          <div
            style={{
              background: "#F0FDF4",
              border: "1px solid #BBF7D0",
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: "1.1rem" }}>🎧</span>
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    color: "#0A1628",
                  }}
                >
                  Audio Summary — {audioData.title}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                  Voice: {audioData.voice} ·{" "}
                  {Math.ceil(audioData.charCount / 15)}s estimated
                </div>
              </div>
            </div>
            <audio
              controls
              style={{ width: "100%", borderRadius: 6 }}
              src={audioData.mp3Url}
            />
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <a
                href={audioData.mp3Url}
                download
                style={{
                  padding: "5px 12px",
                  background: "#fff",
                  border: "1px solid #BBF7D0",
                  borderRadius: 6,
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  color: "#059669",
                  textDecoration: "none",
                }}
              >
                ⬇ Download MP3
              </a>
            </div>
            {audioData.script && (
              <details style={{ marginTop: 8 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: "0.74rem",
                    color: "#6B7280",
                  }}
                >
                  View script
                </summary>
                <p
                  style={{
                    fontSize: "0.78rem",
                    color: "#374151",
                    lineHeight: 1.6,
                    marginTop: 6,
                  }}
                >
                  {audioData.script}
                </p>
              </details>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid #F3F4F6",
          paddingTop: 18,
          lineHeight: 1.7,
          color: "#374151",
        }}
      >
        {a.intro && (
          <p style={{ fontSize: "0.92rem", color: "#374151" }}>{a.intro}</p>
        )}
        {(a.sections || []).map((s, i) => (
          <div key={i}>
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "#0A1628",
                margin: "18px 0 6px",
              }}
            >
              {s.heading || ""}
            </h3>
            <p style={{ fontSize: "0.88rem" }}>{s.body || ""}</p>
          </div>
        ))}
        {a.conclusion && (
          <p
            style={{
              fontSize: "0.88rem",
              fontStyle: "italic",
              color: "#374151",
              marginTop: 14,
            }}
          >
            {a.conclusion}
          </p>
        )}
        {a.cta && (
          <div
            style={{
              background: "#EFF6FF",
              borderLeft: "3px solid #1D4ED8",
              padding: "10px 14px",
              borderRadius: "0 8px 8px 0",
              marginTop: 14,
              fontWeight: 700,
              color: "#1D4ED8",
              fontSize: "0.88rem",
            }}
          >
            → {a.cta}
          </div>
        )}
      </div>

      {a.pros && (
        <div
          style={{
            marginTop: 18,
            borderTop: "1px solid #F3F4F6",
            paddingTop: 14,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#059669",
                  marginBottom: 8,
                  fontSize: "0.85rem",
                }}
              >
                ✅ Pros
              </div>
              {(a.pros || []).map((p, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "0.82rem",
                    color: "#374151",
                    marginBottom: 4,
                  }}
                >
                  • {p}
                </div>
              ))}
            </div>
            <div>
              <div
                style={{
                  fontWeight: 700,
                  color: "#DC2626",
                  marginBottom: 8,
                  fontSize: "0.85rem",
                }}
              >
                ❌ Cons
              </div>
              {(a.cons || []).map((c, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: "0.82rem",
                    color: "#374151",
                    marginBottom: 4,
                  }}
                >
                  • {c}
                </div>
              ))}
            </div>
          </div>
          {a.verdict && (
            <div
              style={{
                marginTop: 12,
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: "0.85rem",
                color: "#92400E",
              }}
            >
              <strong>Verdict:</strong> {a.verdict}
            </div>
          )}
          {a.rating ? (
            <div
              style={{
                marginTop: 8,
                fontSize: "0.88rem",
                fontWeight: 800,
                color: "#D97706",
              }}
            >
              Rating: {"⭐".repeat(Math.round(a.rating))} ({a.rating}/5)
            </div>
          ) : null}
        </div>
      )}

      {a.local_keywords && (
        <div
          style={{
            marginTop: 14,
            borderTop: "1px solid #F3F4F6",
            paddingTop: 12,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.82rem",
              color: "#059669",
              marginBottom: 6,
            }}
          >
            📍 Local Keywords Used
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(a.local_keywords || []).map((k, i) => (
              <span
                key={i}
                style={{
                  background: "#ECFDF5",
                  color: "#059669",
                  padding: "3px 9px",
                  borderRadius: 5,
                  fontSize: "0.72rem",
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.internal_link_suggestions?.length ? (
        <div
          style={{
            marginTop: 14,
            borderTop: "1px solid #F3F4F6",
            paddingTop: 12,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.82rem",
              color: "#6B7280",
              marginBottom: 6,
            }}
          >
            🔗 Internal Link Opportunities
          </div>
          {(a.internal_link_suggestions || []).map((l, i) => (
            <div
              key={i}
              style={{
                fontSize: "0.78rem",
                color: "#374151",
                marginBottom: 3,
              }}
            >
              • {l}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HistoryView({
  runs,
  onLoad,
}: {
  runs: HistoryRun[];
  onLoad: (id: number) => void;
}) {
  if (!runs.length) {
    return (
      <div style={{ color: "#6B7280", padding: 16 }}>
        No history yet. Generate your first article above.
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontWeight: 700, color: "#0A1628", marginBottom: 10 }}>
        📂 Recent Articles
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {runs.map((run) => {
          const cfg = MODE_CONFIG[run.mode] || {
            color: "#6B7280",
            label: run.mode,
          };
          return (
            <div
              key={run.id}
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderLeft: `4px solid ${cfg.color}`,
                borderRadius: 8,
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div>
                <span
                  style={{
                    background: cfg.color,
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: "0.66rem",
                    fontWeight: 800,
                  }}
                >
                  {cfg.label}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: "#0A1628",
                    fontSize: "0.88rem",
                    marginLeft: 8,
                  }}
                >
                  {run.keyword || "(no keyword)"}
                </span>
                {run.brand && (
                  <span style={{ fontSize: "0.74rem", color: "#6B7280" }}>
                    {" "}
                    · {run.brand}
                  </span>
                )}
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "#9CA3AF",
                    marginTop: 3,
                  }}
                >
                  {new Date(run.created_at).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => onLoad(run.id)}
                style={{
                  padding: "5px 12px",
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 6,
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  color: "#1D4ED8",
                  cursor: "pointer",
                }}
              >
                Load
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
