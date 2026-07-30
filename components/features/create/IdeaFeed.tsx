"use client";

// Native React port of the legacy `idea-feed` panel (was `window.buildIdeaFeed`
// in public/js/ig_creative_suite.js + `#view-idea-feed` in index.html). Daily
// AI-generated content idea swipe feed + content angles library. Calls the same
// Express endpoints:
//   GET  /api/idea-feed/angles
//   GET  /api/idea-feed/ideas?brand=&force=
//   POST /api/idea-feed/dismiss/:id
//   POST /api/idea-feed/save/:id
//   GET  /api/idea-feed/saved
//   POST /api/content-calendar/add
//
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Angle {
  angle: string;
  icon: string;
  desc: string;
  example?: string;
}
interface AnglesResult {
  ok: boolean;
  error?: string;
  angles: Angle[];
}

interface Idea {
  id: number;
  angle?: string;
  headline: string;
  copy: string;
  channel: string;
  hashtags?: string[] | string;
  cta?: string;
  visual_concept?: string;
  status?: string;
}
interface IdeasResult {
  ok: boolean;
  error?: string;
  ideas: Idea[];
  source?: string;
}
interface SavedResult {
  ok: boolean;
  error?: string;
  ideas: Idea[];
}

const CHANNEL_COLORS: Record<string, string> = {
  instagram: "#E1306C",
  tiktok: "#010101",
  linkedin: "#0A66C2",
  x: "#1DA1F2",
  facebook: "#1877F2",
  youtube: "#FF0000",
  blog: "#6366F1",
  email: "#10B981",
};

function parseTags(hashtags?: string[] | string): string[] {
  if (Array.isArray(hashtags)) return hashtags;
  if (typeof hashtags === "string") {
    try {
      const parsed = JSON.parse(hashtags || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface Toast {
  id: number;
  text: string;
  color: string;
  onClick?: () => void;
}

export default function IdeaFeed() {
  const router = useRouter();

  const [brand, setBrand] = useState("");
  const [angles, setAngles] = useState<Angle[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [feedError, setFeedError] = useState("");
  const [loading, setLoading] = useState(false);

  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState<Idea[] | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((t: Omit<Toast, "id">, ttl = 2500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, ttl);
  }, []);

  const loadAngles = useCallback(async () => {
    const r = await apiGet<AnglesResult>("/api/idea-feed/angles");
    if (r.ok) setAngles(r.angles || []);
  }, []);

  const loadIdeas = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setFeedError("");
      const b = brand.trim();
      const r = await apiGet<IdeasResult>(
        `/api/idea-feed/ideas?brand=${encodeURIComponent(b)}&force=${force ? 1 : 0}`,
      );
      setLoading(false);
      if (!r.ok) {
        setFeedError("Failed to load ideas.");
        return;
      }
      setIdeas(r.ideas || []);
      setCurrentIndex(0);
      setSource(r.source || null);
    },
    [brand],
  );

  useEffect(() => {
    loadAngles();
    loadIdeas(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = ideas.filter((i) => i.status === "pending");

  function applyAngle(angle: string) {
    const idx = pending.findIndex((i) => i.angle === angle);
    if (idx >= 0) setCurrentIndex(idx);
    setShowSaved(false);
  }

  function setStatus(id: number, status: string) {
    setIdeas((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i)),
    );
  }

  async function dismissIdea(id: number) {
    await apiPost(`/api/idea-feed/dismiss/${id}`, {});
    setStatus(id, "dismissed");
  }

  async function saveIdea(id: number) {
    await apiPost(`/api/idea-feed/save/${id}`, {});
    setStatus(id, "saved");
    pushToast({ text: "⭐ Idea saved!", color: "#10B981" });
  }

  async function toCalendar(idea: Idea) {
    const b = brand.trim() || "Brand";
    const tags = parseTags(idea.hashtags);
    const r = await apiPost("/api/content-calendar/add", {
      brand: b,
      channel: idea.channel,
      headline: idea.headline,
      copy: idea.copy + (tags.length ? "\n\n" + tags.join(" ") : ""),
      cta: idea.cta || "",
      note: `Angle: ${idea.angle} | Visual: ${idea.visual_concept || ""}`,
    });
    await apiPost(`/api/idea-feed/save/${idea.id}`, {});
    setStatus(idea.id, "saved");
    if (r.ok) {
      pushToast(
        {
          text: "📅 Added to Content Calendar! → view",
          color: "#6366F1",
          onClick: () => goToView(router, "content-calendar"),
        },
        4000,
      );
    } else {
      pushToast({ text: "⚠️ Calendar add failed", color: "#6366F1" }, 4000);
    }
  }

  async function openSaved() {
    setShowSaved(true);
    setSaved(null);
    const r = await apiGet<SavedResult>("/api/idea-feed/saved");
    if (!r.ok) setSaved([]);
    else setSaved(r.ideas || []);
  }

  const currentIdea = pending[Math.min(currentIndex, pending.length - 1)];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Idea Feed
              </div>
              <h2 className="view-title">💡 Daily Idea Feed</h2>
              <p className="view-sub">
                Fresh AI-generated content ideas every day — swipe to save or add
                straight to your calendar. Explore 20 proven content angles like
                Mythbuster, Before &amp; After, Us vs Them, and more.
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
            display: "grid",
            gridTemplateColumns: "300px 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* LEFT: controls */}
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              border: "1.5px solid #E2E8F0",
              padding: 22,
              position: "sticky",
              top: 80,
            }}
          >
            <h3
              style={{
                fontSize: "0.95rem",
                fontWeight: 700,
                color: "#1E293B",
                margin: "0 0 14px",
              }}
            >
              💡 Daily Idea Feed
            </h3>
            <label
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "#64748B",
                display: "block",
                marginBottom: 5,
              }}
            >
              BRAND NAME
            </label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. InfoGenie"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                border: "1.5px solid #E2E8F0",
                borderRadius: 8,
                fontSize: "0.8rem",
                marginBottom: 12,
              }}
            />
            <button
              onClick={() => loadIdeas(true)}
              disabled={loading}
              style={{
                width: "100%",
                padding: 11,
                background: "linear-gradient(135deg,#6366F1,#8B5CF6)",
                border: "none",
                borderRadius: 10,
                fontSize: "0.82rem",
                fontWeight: 700,
                color: "#fff",
                cursor: loading ? "default" : "pointer",
                marginBottom: 8,
                opacity: loading ? 0.7 : 1,
              }}
            >
              ✨ Generate Fresh Ideas
            </button>
            <button
              onClick={openSaved}
              style={{
                width: "100%",
                padding: 10,
                background: "#F1F5F9",
                border: "1.5px solid #E2E8F0",
                borderRadius: 10,
                fontSize: "0.8rem",
                fontWeight: 700,
                color: "#475569",
                cursor: "pointer",
                marginBottom: 18,
              }}
            >
              ⭐ Saved Ideas
            </button>

            <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 14 }}>
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "#64748B",
                  marginBottom: 10,
                }}
              >
                📚 CONTENT ANGLES LIBRARY
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {angles.map((a) => (
                  <div
                    key={a.angle}
                    onClick={() => applyAngle(a.angle)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      cursor: "pointer",
                      border: "1.5px solid #F1F5F9",
                      marginBottom: 6,
                      background: "#FAFAFA",
                      transition: "all .15s",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = "#6366F1";
                      e.currentTarget.style.background = "#EEF2FF";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "#F1F5F9";
                      e.currentTarget.style.background = "#FAFAFA";
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.77rem",
                        fontWeight: 700,
                        color: "#1E293B",
                      }}
                    >
                      {a.icon} {a.angle}
                    </div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "#64748B",
                        marginTop: 2,
                        lineHeight: 1.3,
                      }}
                    >
                      {a.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: swipe feed */}
          <div>
            {!showSaved && (
              <>
                <div style={{ marginBottom: 10 }}>
                  {loading ? (
                    <p style={{ color: "#6366F1", fontSize: "0.8rem" }}>
                      ✨ Generating fresh content ideas…
                    </p>
                  ) : feedError ? (
                    <p style={{ color: "#EF4444", fontSize: "0.8rem" }}>
                      {feedError}
                    </p>
                  ) : (
                    ideas.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: "0.8rem", color: "#64748B" }}>
                          <strong>{pending.length}</strong> ideas ready · swipe
                          or use buttons
                        </span>
                        <span
                          style={{
                            fontSize: "0.68rem",
                            padding: "3px 8px",
                            background:
                              source === "openai" ? "#D1FAE5" : "#FEF3C7",
                            color: source === "openai" ? "#065F46" : "#92400E",
                            borderRadius: 20,
                            fontWeight: 600,
                          }}
                        >
                          {source === "cached"
                            ? "📦 Cached"
                            : source === "openai"
                              ? "✨ AI Generated"
                              : "📋 Template"}
                        </span>
                      </div>
                    )
                  )}
                </div>

                <div style={{ position: "relative", minHeight: 200 }}>
                  {!loading && !feedError && !currentIdea && (
                    <div
                      style={{
                        background: "#fff",
                        borderRadius: 16,
                        border: "1.5px solid #E2E8F0",
                        padding: 40,
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>
                        🎉
                      </div>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 700,
                          color: "#1E293B",
                          marginBottom: 6,
                        }}
                      >
                        All ideas reviewed!
                      </div>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#64748B",
                          marginBottom: 16,
                        }}
                      >
                        Generate a fresh batch whenever you&apos;re ready.
                      </div>
                      <button
                        onClick={() => loadIdeas(true)}
                        style={{
                          padding: "10px 20px",
                          background: "linear-gradient(135deg,#6366F1,#8B5CF6)",
                          border: "none",
                          borderRadius: 10,
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        ✨ Fresh Batch
                      </button>
                    </div>
                  )}

                  {!loading && currentIdea && (
                    <IdeaCard
                      idea={currentIdea}
                      position={pending.indexOf(currentIdea) + 1}
                      total={pending.length}
                      onSkip={() => dismissIdea(currentIdea.id)}
                      onSave={() => saveIdea(currentIdea.id)}
                      onCalendar={() => toCalendar(currentIdea)}
                    />
                  )}
                </div>
              </>
            )}

            {showSaved && (
              <SavedView
                saved={saved}
                onBack={() => setShowSaved(false)}
                onCalendar={toCalendar}
              />
            )}
          </div>
        </div>
      </div>

      {/* Toasts */}
      {toasts.map((t, i) => (
        <div
          key={t.id}
          onClick={t.onClick}
          style={{
            position: "fixed",
            bottom: 24 + i * 52,
            right: 24,
            background: t.color,
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: "0.8rem",
            fontWeight: 700,
            zIndex: 9999,
            boxShadow: "0 4px 16px rgba(0,0,0,.2)",
            cursor: t.onClick ? "pointer" : "default",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

function IdeaCard({
  idea,
  position,
  total,
  onSkip,
  onSave,
  onCalendar,
}: {
  idea: Idea;
  position: number;
  total: number;
  onSkip: () => void;
  onSave: () => void;
  onCalendar: () => void;
}) {
  const chColor = CHANNEL_COLORS[idea.channel] || "#6366F1";
  const tags = parseTags(idea.hashtags);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 18,
        border: "1.5px solid #E2E8F0",
        padding: 28,
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        maxWidth: 600,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            background: "#EEF2FF",
            color: "#6366F1",
            padding: "4px 10px",
            borderRadius: 20,
            fontSize: "0.72rem",
            fontWeight: 700,
          }}
        >
          {idea.angle || "Idea"}
        </span>
        <span
          style={{
            background: chColor + "1A",
            color: chColor,
            padding: "4px 10px",
            borderRadius: 20,
            fontSize: "0.72rem",
            fontWeight: 700,
            textTransform: "capitalize",
          }}
        >
          {idea.channel}
        </span>
      </div>
      <h3
        style={{
          fontSize: "1.05rem",
          fontWeight: 800,
          color: "#1E293B",
          margin: "0 0 12px",
          lineHeight: 1.3,
        }}
      >
        {idea.headline}
      </h3>
      <p
        style={{
          fontSize: "0.82rem",
          color: "#475569",
          lineHeight: 1.6,
          margin: "0 0 14px",
        }}
      >
        {idea.copy}
      </p>
      {idea.cta && (
        <div
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#6366F1",
            marginBottom: 10,
          }}
        >
          CTA: {idea.cta}
        </div>
      )}
      {tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 5,
            marginBottom: 14,
          }}
        >
          {tags.map((t, i) => (
            <span
              key={i}
              style={{
                background: "#F1F5F9",
                color: "#64748B",
                padding: "3px 8px",
                borderRadius: 12,
                fontSize: "0.68rem",
                fontWeight: 600,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {idea.visual_concept && (
        <div
          style={{
            background: "#F8FAFC",
            borderRadius: 9,
            padding: 10,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              color: "#94A3B8",
              marginBottom: 3,
            }}
          >
            🎬 VISUAL DIRECTION
          </div>
          <div
            style={{ fontSize: "0.75rem", color: "#475569", lineHeight: 1.4 }}
          >
            {idea.visual_concept}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button
          onClick={onSkip}
          style={{
            flex: 1,
            padding: 11,
            background: "#FEF2F2",
            border: "1.5px solid #FCA5A5",
            borderRadius: 10,
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "#EF4444",
            cursor: "pointer",
          }}
        >
          ✕ Skip
        </button>
        <button
          onClick={onSave}
          style={{
            flex: 2,
            padding: 11,
            background: "linear-gradient(135deg,#10B981,#059669)",
            border: "none",
            borderRadius: 10,
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          ⭐ Save Idea
        </button>
        <button
          onClick={onCalendar}
          style={{
            flex: 2,
            padding: 11,
            background: "linear-gradient(135deg,#6366F1,#8B5CF6)",
            border: "none",
            borderRadius: 10,
            fontSize: "0.8rem",
            fontWeight: 700,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          📅 Add to Calendar
        </button>
      </div>
      <div
        style={{
          textAlign: "center",
          marginTop: 10,
          fontSize: "0.7rem",
          color: "#CBD5E1",
        }}
      >
        {position} of {total} pending ideas
      </div>
    </div>
  );
}

function SavedView({
  saved,
  onBack,
  onCalendar,
}: {
  saved: Idea[] | null;
  onBack: () => void;
  onCalendar: (idea: Idea) => void;
}) {
  if (saved === null) {
    return (
      <p style={{ color: "#94A3B8", fontSize: "0.8rem" }}>Loading saved ideas…</p>
    );
  }
  if (!saved.length) {
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3
            style={{
              fontSize: "0.9rem",
              fontWeight: 700,
              color: "#1E293B",
              margin: 0,
            }}
          >
            ⭐ Saved Ideas
          </h3>
          <button
            onClick={onBack}
            style={{
              fontSize: "0.75rem",
              color: "#6366F1",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ← Back to feed
          </button>
        </div>
        <p style={{ color: "#94A3B8", fontSize: "0.8rem" }}>
          No saved ideas yet — swipe right on ideas to save them.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <h3
          style={{
            fontSize: "0.9rem",
            fontWeight: 700,
            color: "#1E293B",
            margin: 0,
          }}
        >
          ⭐ Saved Ideas ({saved.length})
        </h3>
        <button
          onClick={onBack}
          style={{
            fontSize: "0.75rem",
            color: "#6366F1",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ← Back to feed
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {saved.map((idea) => {
          const tags = parseTags(idea.hashtags);
          return (
            <div
              key={idea.id}
              style={{
                background: "#fff",
                borderRadius: 12,
                border: "1.5px solid #E2E8F0",
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      background: "#EEF2FF",
                      color: "#6366F1",
                      padding: "2px 7px",
                      borderRadius: 12,
                      marginRight: 6,
                    }}
                  >
                    {idea.angle || ""}
                  </span>
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      background: "#F1F5F9",
                      color: "#64748B",
                      padding: "2px 7px",
                      borderRadius: 12,
                    }}
                  >
                    {idea.channel}
                  </span>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: "#1E293B",
                      marginTop: 6,
                    }}
                  >
                    {idea.headline}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#64748B",
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {(idea.copy || "").slice(0, 120)}…
                  </div>
                  {tags.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {tags.map((t, i) => (
                        <span
                          key={i}
                          style={{ fontSize: "0.65rem", color: "#94A3B8" }}
                        >
                          {t}{" "}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onCalendar(idea)}
                  style={{
                    flexShrink: 0,
                    padding: "7px 12px",
                    background: "#EEF2FF",
                    border: "none",
                    borderRadius: 8,
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#6366F1",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  📅 Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
