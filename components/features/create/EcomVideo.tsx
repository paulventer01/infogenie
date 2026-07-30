"use client";

// Native React port of the legacy `ecom-video` panel (was
// `window.buildEcomVideo` + `#view-ecom-video` in index.html, defined in
// public/js/ig_creator_suite.js). Generates a conversion-optimised product video
// storyboard and (optionally) renders a scene with Google Veo 3 against the
// existing Express API (`/api/ecom-video/*`, `/api/personas`) through `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Persona {
  id: number;
  name: string;
  niche: string;
  is_active?: boolean;
}
interface Scene {
  scene: number;
  shot_type?: string;
  duration_s?: number;
  action?: string;
  text_overlay?: string;
  voiceover?: string;
}
interface Storyboard {
  title?: string;
  duration_seconds?: number;
  hook?: string;
  scenes?: Scene[];
  cta?: string;
  caption?: string;
  hashtags?: string[];
}
interface Msg {
  type: "info" | "error";
  text: string;
}
interface VeoState {
  status: "idle" | "submitting" | "polling" | "done" | "error";
  progress?: string;
  videoSrc?: string;
  error?: string;
}

const MAX_ATTEMPTS = 30;

export default function EcomVideo() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [product, setProduct] = useState("");
  const [desc, setDesc] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState("Instagram Reels / TikTok");
  const [style, setStyle] = useState("lifestyle + demo hybrid");
  const [persona, setPersona] = useState("");

  const [status, setStatus] = useState<Msg | null>(null);
  const [loading, setLoading] = useState(false);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [source, setSource] = useState("ai");

  const [veoScene, setVeoScene] = useState<number>(1);
  const [veoRatio, setVeoRatio] = useState("9:16");
  const [veo, setVeo] = useState<VeoState>({ status: "idle" });

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean; personas?: Persona[] }>("/api/personas").then((r) => {
      if (!r.ok) {
        setLoadError(true);
        return;
      }
      setPersonas((r.personas || []).filter((p) => p.is_active));
    });
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function generate() {
    if (!product.trim()) {
      setStatus({ type: "error", text: "Product name is required." });
      return;
    }
    setStatus({ type: "info", text: "🎬 Generating storyboard…" });
    setLoading(true);
    setStoryboard(null);
    setVeo({ status: "idle" });
    const r = await apiPost<{
      ok: boolean;
      error?: string;
      storyboard?: Storyboard;
      source?: string;
    }>("/api/ecom-video/generate", {
      product_name: product,
      product_description: desc,
      target_audience: audience,
      platform,
      video_style: style,
      persona_name: persona,
    });
    setLoading(false);
    if (!r.ok) {
      setStatus({ type: "error", text: r.error || "Generation failed." });
      return;
    }
    setStatus(null);
    const s = r.storyboard || {};
    setStoryboard(s);
    setSource(r.source || "ai");
    setVeoScene((s.scenes || [])[0]?.scene || 1);
  }

  function renderVeo() {
    if (pollRef.current) clearTimeout(pollRef.current);
    const s = storyboard || {};
    const scene =
      (s.scenes || []).find((sc) => sc.scene === veoScene) ||
      (s.scenes || [])[0] ||
      ({} as Scene);
    const prompt = [
      `Cinematic product video clip for ${platform}.`,
      scene.shot_type ? `Shot type: ${scene.shot_type}.` : "",
      scene.action ? `Scene: ${scene.action}.` : "",
      scene.voiceover ? `Mood matches voiceover: "${scene.voiceover}".` : "",
      `Product: ${product || "product"}. Professional lighting, clean background, high-end commercial style. No text overlays.`,
    ]
      .filter(Boolean)
      .join(" ");
    setVeo({ status: "submitting" });
    apiPost<{ ok: boolean; error?: string; operation_id?: string }>(
      "/api/ecom-video/render-veo",
      {
        prompt,
        aspect_ratio: veoRatio,
        duration_seconds: scene.duration_s || 5,
      },
    ).then((r) => {
      if (!r.ok || r.error) {
        setVeo({ status: "error", error: r.error || "Request failed" });
        return;
      }
      setVeo({ status: "polling" });
      pollVeo(r.operation_id || "", 0);
    });
  }

  function pollVeo(opId: string, attempts: number) {
    if (attempts > MAX_ATTEMPTS) {
      setVeo({
        status: "error",
        error: `Veo 3 timed out after ${MAX_ATTEMPTS} polls. Try a shorter duration.`,
      });
      return;
    }
    pollRef.current = setTimeout(async () => {
      const data = await apiGet<{
        ok?: boolean;
        status?: string;
        progress?: string;
        video_base64?: string;
        mime_type?: string;
        error?: string;
      }>(`/api/ecom-video/veo-status?op=${encodeURIComponent(opId)}`);
      if (data.error) {
        setVeo({ status: "error", error: data.error });
        return;
      }
      if (data.status === "pending") {
        setVeo({ status: "polling", progress: data.progress });
        pollVeo(opId, attempts + 1);
        return;
      }
      if (data.status === "failed") {
        setVeo({ status: "error", error: data.error || "unknown" });
        return;
      }
      if (data.status === "complete" && data.video_base64) {
        setVeo({
          status: "done",
          videoSrc: `data:${data.mime_type || "video/mp4"};base64,${data.video_base64}`,
        });
      }
    }, 10000);
  }

  const scenes = storyboard?.scenes || [];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Product Video
              </div>
              <h2 className="view-title">🛒 E-commerce Product Video</h2>
              <p className="view-sub">
                Generate a conversion-optimised 6-scene video storyboard for any
                product — with shot types, voiceovers, text overlays, and a
                ready-to-post caption. Pair with an AI Persona for full
                influencer-style content.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loadError ? (
          <div className="ig-alert ig-alert-error">Failed to load.</div>
        ) : (
          <div className="ig-two-col" style={{ gap: 24 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ig-card">
                <h3 style={{ margin: "0 0 16px" }}>🛒 Product Video Brief</h3>
                <div style={{ marginBottom: 12 }}>
                  <label className="ig-label">Product Name *</label>
                  <input
                    className="ig-input"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    placeholder="e.g. LUMI Vitamin C Serum"
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="ig-label">Product Description</label>
                  <textarea
                    className="ig-textarea"
                    rows={2}
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="What it does, key ingredients/features, why it's special"
                  />
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
                    <label className="ig-label">Target Audience</label>
                    <input
                      className="ig-input"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="e.g. women 25-40, skincare enthusiasts"
                    />
                  </div>
                  <div>
                    <label className="ig-label">Platform</label>
                    <select
                      className="ig-select"
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                    >
                      <option value="Instagram Reels / TikTok">
                        Instagram Reels / TikTok
                      </option>
                      <option value="YouTube Shorts">YouTube Shorts</option>
                      <option value="Facebook Video Ad">Facebook Video Ad</option>
                      <option value="Pinterest Video">Pinterest Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="ig-label">Video Style</label>
                    <select
                      className="ig-select"
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                    >
                      <option value="lifestyle + demo hybrid">
                        Lifestyle + Demo
                      </option>
                      <option value="ugc-style authentic review">
                        UGC Authentic Review
                      </option>
                      <option value="before and after transformation">
                        Before & After
                      </option>
                      <option value="unboxing and reveal">
                        Unboxing & Reveal
                      </option>
                      <option value="product close-up showcase">
                        Product Showcase
                      </option>
                    </select>
                  </div>
                  {personas.length > 0 && (
                    <div>
                      <label className="ig-label">AI Persona Presenter</label>
                      <select
                        className="ig-select"
                        value={persona}
                        onChange={(e) => setPersona(e.target.value)}
                      >
                        <option value="">No persona</option>
                        {personas.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name} — {p.niche}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={generate}
                  style={{ width: "100%" }}
                >
                  🎬 Generate Video Storyboard
                </button>
                {status && (
                  <div
                    className={`ig-alert ig-alert-${status.type}`}
                    style={{ margin: "8px 0" }}
                  >
                    {status.text}
                  </div>
                )}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {loading ? (
                <div style={{ textAlign: "center", padding: 32 }}>
                  <span className="ig-spinner" />
                </div>
              ) : storyboard ? (
                <div className="ig-card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <h3 style={{ margin: "0 0 4px" }}>
                        {storyboard.title || "Video Storyboard"}
                      </h3>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        ~{storyboard.duration_seconds || 30}s · Hook: &quot;
                        {storyboard.hook || ""}&quot;
                      </div>
                    </div>
                    <span className="ig-badge">{source.toUpperCase()}</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginBottom: 20,
                    }}
                  >
                    {scenes.map((sc) => (
                      <div
                        key={sc.scene}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "28px 80px 1fr 1fr",
                          gap: 12,
                          alignItems: "start",
                          padding: 12,
                          background: "var(--bg-subtle,#f8f9fa)",
                          borderRadius: 8,
                        }}
                      >
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            background: "var(--ig-primary,#667eea)",
                            color: "#fff",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {sc.scene}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "var(--text-muted)",
                            }}
                          >
                            SHOT
                          </div>
                          <div style={{ fontSize: "0.82rem" }}>
                            {sc.shot_type || ""}
                          </div>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            {sc.duration_s || 5}s
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "var(--text-muted)",
                            }}
                          >
                            ACTION
                          </div>
                          <div style={{ fontSize: "0.82rem" }}>
                            {sc.action || ""}
                          </div>
                          {sc.text_overlay && (
                            <div
                              style={{
                                marginTop: 4,
                                padding: "2px 6px",
                                background: "rgba(0,0,0,0.7)",
                                color: "#fff",
                                borderRadius: 4,
                                fontSize: "0.72rem",
                                display: "inline-block",
                              }}
                            >
                              {sc.text_overlay}
                            </div>
                          )}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              color: "var(--text-muted)",
                            }}
                          >
                            VOICEOVER
                          </div>
                          <div
                            style={{
                              fontSize: "0.82rem",
                              fontStyle: "italic",
                            }}
                          >
                            &quot;{sc.voiceover || ""}&quot;
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      padding: 14,
                      background: "var(--bg-subtle,#f8f9fa)",
                      borderRadius: 8,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        marginBottom: 4,
                      }}
                    >
                      CTA
                    </div>
                    <div style={{ fontWeight: 600 }}>{storyboard.cta || ""}</div>
                  </div>
                  {storyboard.caption && (
                    <div
                      style={{
                        background: "var(--bg-subtle,#f8f9fa)",
                        borderRadius: 8,
                        padding: 14,
                        marginBottom: 16,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "var(--text-muted)",
                          marginBottom: 6,
                        }}
                      >
                        CAPTION + HASHTAGS
                      </div>
                      <div style={{ fontSize: "0.88rem", lineHeight: 1.6 }}>
                        {storyboard.caption}
                      </div>
                      <div
                        style={{
                          color: "var(--ig-primary,#667eea)",
                          fontSize: "0.85rem",
                          marginTop: 6,
                        }}
                      >
                        {(storyboard.hashtags || []).join(" ")}
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      border: "1px solid var(--ig-primary,#667eea)",
                      borderRadius: 10,
                      padding: 16,
                      background:
                        "linear-gradient(135deg,#667eea08,#764ba208)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: "1.4rem" }}>🎬</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                          Generate with Veo 3
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          Turn any scene into an AI-generated video clip (Google
                          Veo 3 · requires GEMINI_API_KEY)
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto auto",
                        gap: 8,
                        alignItems: "end",
                      }}
                    >
                      <div>
                        <label className="ig-label">Select Scene</label>
                        <select
                          className="ig-select"
                          value={veoScene}
                          onChange={(e) => setVeoScene(Number(e.target.value))}
                        >
                          {scenes.map((sc) => (
                            <option key={sc.scene} value={sc.scene}>
                              {sc.scene}.{" "}
                              {(sc.shot_type || "Scene " + sc.scene).slice(0, 30)}{" "}
                              · {sc.duration_s || 5}s
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="ig-label">Format</label>
                        <select
                          className="ig-select"
                          value={veoRatio}
                          onChange={(e) => setVeoRatio(e.target.value)}
                        >
                          <option value="9:16">9:16 (Reels/TikTok)</option>
                          <option value="16:9">16:9 (YouTube)</option>
                          <option value="1:1">1:1 (Square)</option>
                        </select>
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={renderVeo}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        ▶ Generate Clip
                      </button>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {veo.status === "error" && (
                        <div className="ig-alert ig-alert-error">
                          Veo 3: {veo.error}
                        </div>
                      )}
                      {(veo.status === "submitting" ||
                        veo.status === "polling") && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: 12,
                            background: "var(--bg-subtle,#f8f9fa)",
                            borderRadius: 8,
                          }}
                        >
                          <span className="ig-spinner" />
                          <div style={{ fontSize: "0.85rem" }}>
                            {veo.status === "submitting"
                              ? "Submitting to Veo 3… this takes 1-3 minutes."
                              : "Generating video… polling every 10s"}
                          </div>
                          {veo.progress && (
                            <div
                              style={{
                                fontSize: "0.78rem",
                                color: "var(--text-muted)",
                                marginLeft: "auto",
                              }}
                            >
                              {veo.progress}%
                            </div>
                          )}
                        </div>
                      )}
                      {veo.status === "done" && veo.videoSrc && (
                        <div style={{ marginTop: 4 }}>
                          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                          <video
                            controls
                            playsInline
                            style={{
                              width: "100%",
                              maxHeight: 320,
                              borderRadius: 8,
                              background: "#000",
                            }}
                            src={veo.videoSrc}
                          />
                          <div
                            style={{ display: "flex", gap: 8, marginTop: 10 }}
                          >
                            <a
                              href={veo.videoSrc}
                              download="veo3_scene.mp4"
                              className="btn btn-primary"
                              style={{ fontSize: "0.82rem", padding: "8px 16px" }}
                            >
                              ⬇ Download MP4
                            </a>
                            <span
                              style={{
                                fontSize: "0.78rem",
                                color: "var(--text-muted)",
                                alignSelf: "center",
                              }}
                            >
                              Generated by Google Veo 3
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="ig-card"
                  style={{
                    background:
                      "linear-gradient(135deg,#667eea10,#764ba210)",
                    border: "2px dashed var(--border)",
                  }}
                >
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
                    <h4>Your storyboard will appear here</h4>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      Fill in the brief and click Generate. You&apos;ll get a
                      6-scene storyboard optimised for conversion — with shot
                      types, voiceovers, text overlays, and a ready-to-use
                      caption.
                    </p>
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
