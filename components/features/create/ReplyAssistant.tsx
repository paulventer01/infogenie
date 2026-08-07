"use client";

// Native React port of the legacy `reply-assistant` panel
// (`window.buildReplyAssistant` + `#view-reply-assistant` in index.html,
// builder in app.js). Loads the most-impactful unanswered brand mentions ranked
// by sentiment + source reach (`GET /api/reply-assistant/inbox`) and drafts an
// AI reply in a chosen tone (`POST /api/reply-assistant/draft`). Renders REAL
// API data only. Publishing reuses the legacy social-publish modal helpers on
// `window` when present.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface Mention {
  title?: string;
  snippet?: string;
  text?: string;
  url?: string;
  sentiment?: string;
  date?: string;
  _host?: string;
}
interface InboxResponse {
  ok: boolean;
  error?: string;
  count: number;
  mentions: Mention[];
}
interface Draft {
  reply?: string;
  alt_short?: string;
  confidence?: string;
}
interface DraftResponse {
  ok: boolean;
  error?: string;
  source?: string;
  draft: Draft;
}

type Tone = "neutral" | "supportive" | "firm" | "grateful" | "curious";

interface DraftState {
  open: boolean;
  tone: Tone;
  position: string;
  status: "idle" | "loading" | "error" | "done";
  error?: string;
  source?: string;
  draft?: Draft;
}

function toast(msg: string) {
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

function safeUrl(u: string): string {
  const w = window as unknown as { _safeUrl?: (u: string) => string };
  if (typeof w._safeUrl === "function") return w._safeUrl(u);
  return /^https?:\/\//i.test(u) ? u : "";
}

function publishFromEl(elId: string, label: string, platforms: string[]) {
  const w = window as unknown as {
    _spPublishFromEl?: (id: string, label: string, platforms: string[]) => void;
    _spOpenPublishModal?: (o: {
      text: string;
      sourceLabel: string;
      platforms: string[];
    }) => void;
  };
  if (typeof w._spPublishFromEl === "function") {
    w._spPublishFromEl(elId, label, platforms);
    return;
  }
  const el = document.getElementById(elId);
  if (el && typeof w._spOpenPublishModal === "function") {
    w._spOpenPublishModal({
      text: el.innerText || el.textContent || "",
      sourceLabel: label,
      platforms,
    });
  }
}

export default function ReplyAssistant() {
  const [brand, setBrand] = useState("Nike");
  const [days, setDays] = useState("3");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [count, setCount] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, DraftState>>({});

  async function load() {
    setStatus("loading");
    setErrorMsg("");
    setDrafts({});
    const r = await apiGet<InboxResponse>(
      `/api/reply-assistant/inbox?brand=${encodeURIComponent(
        brand,
      )}&days=${encodeURIComponent(days)}`,
    );
    if (!r.ok) {
      setStatus("error");
      setErrorMsg(r.error || "failed");
      return;
    }
    if (!r.mentions.length) {
      setMentions([]);
      setStatus("empty");
      return;
    }
    setMentions(r.mentions);
    setCount(r.count);
    setStatus("idle");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDraft(i: number) {
    setDrafts((d) => ({
      ...d,
      [i]: {
        open: true,
        tone: d[i]?.tone || "neutral",
        position: d[i]?.position || "",
        status: d[i]?.status || "idle",
        error: d[i]?.error,
        source: d[i]?.source,
        draft: d[i]?.draft,
      },
    }));
  }

  function setDraftField(i: number, patch: Partial<DraftState>) {
    setDrafts((d) => ({ ...d, [i]: { ...d[i], ...patch } }));
  }

  async function draftGo(i: number) {
    const m = mentions[i];
    if (!m) return;
    const ds = drafts[i];
    setDraftField(i, { status: "loading", error: "" });
    const r = await apiPost<DraftResponse>("/api/reply-assistant/draft", {
      brand,
      tone: ds?.tone || "neutral",
      ourPosition: ds?.position || "",
      mention: {
        title: m.title,
        snippet: m.snippet || m.text,
        url: m.url,
        sentiment: m.sentiment,
      },
    });
    if (!r.ok) {
      setDraftField(i, { status: "error", error: r.error || "failed" });
      return;
    }
    setDraftField(i, {
      status: "done",
      source: r.source,
      draft: r.draft,
    });
  }

  async function copyText(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.innerText || el.textContent || "");
      toast("✅ Copied");
    } catch (e) {
      toast("❌ " + (e instanceof Error ? e.message : "copy failed"));
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
                <span className="bc-sep">›</span> Reply Assistant
              </div>
              <h2 className="view-title">💬 Reply Assistant</h2>
              <p className="view-sub">
                Your most-impactful unanswered mentions, ranked by sentiment +
                source reach. Click any mention to draft an AI reply in the tone
                you want, then copy + post.
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
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "end",
            }}
          >
            <div style={{ flex: 1, minWidth: 180 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Brand
              </label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                }}
              />
            </div>
            <div style={{ width: 100 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                Days back
              </label>
              <input
                type="number"
                min={1}
                max={14}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 8,
                  fontSize: "0.88rem",
                }}
              />
            </div>
            <button
              onClick={load}
              style={{
                padding: "10px 20px",
                background: "#7C3AED",
                border: "2px solid #7C3AED",
                borderRadius: 8,
                fontSize: "0.82rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              🔍 Load Inbox
            </button>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 8 }}>
            Mentions ranked by sentiment (negative first) + source reach (Reuters
            / Bloomberg / Twitter etc weighted up).
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div style={{ color: "#6B7280", fontSize: "0.85rem" }}>
              ⏳ Loading mentions…
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
              {errorMsg}
            </div>
          )}
          {status === "empty" && (
            <div
              style={{
                background: "#F9FAFB",
                border: "1px dashed #D1D5DB",
                borderRadius: 10,
                padding: 24,
                textAlign: "center",
                color: "#6B7280",
                fontSize: "0.88rem",
              }}
            >
              No mentions found. Try a wider window or a different brand.
            </div>
          )}
          {status === "idle" && (
            <>
              <div
                style={{
                  fontWeight: 800,
                  color: "#0A1628",
                  fontSize: "0.95rem",
                  marginBottom: 10,
                }}
              >
                📥 Inbox — {count} mentions ranked
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {mentions.map((m, i) => {
                  const sc = (m.sentiment || "neutral").toLowerCase();
                  const cl =
                    sc === "negative"
                      ? "#B91C1C"
                      : sc === "positive"
                        ? "#15803D"
                        : "#6B7280";
                  const bg =
                    sc === "negative"
                      ? "#FEE2E2"
                      : sc === "positive"
                        ? "#D1FAE5"
                        : "#F3F4F6";
                  const ds = drafts[i];
                  const url = m.url ? safeUrl(m.url) : "";
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: `4px solid ${cl}`,
                        borderRadius: 8,
                        padding: "14px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 14,
                          alignItems: "start",
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#0A1628",
                              fontSize: "0.9rem",
                              lineHeight: 1.3,
                            }}
                          >
                            {m.title || "(no title)"}
                          </div>
                          <div
                            style={{
                              fontSize: "0.7rem",
                              color: "#6B7280",
                              marginTop: 3,
                            }}
                          >
                            {m._host || "unknown source"}
                            {m.date
                              ? " · " + String(m.date).slice(0, 10)
                              : ""}
                          </div>
                        </div>
                        <div
                          style={{
                            background: bg,
                            color: cl,
                            fontSize: "0.66rem",
                            fontWeight: 800,
                            padding: "3px 8px",
                            borderRadius: 10,
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {sc}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "#374151",
                          lineHeight: 1.45,
                          marginBottom: 10,
                        }}
                      >
                        {(m.snippet || m.text || "").slice(0, 260)}
                      </div>
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        <button
                          onClick={() => openDraft(i)}
                          style={{
                            padding: "7px 14px",
                            background: "#7C3AED",
                            border: "2px solid #7C3AED",
                            borderRadius: 6,
                            fontSize: "0.74rem",
                            fontWeight: 800,
                            color: "#fff",
                            WebkitTextFillColor: "#fff",
                            cursor: "pointer",
                            textShadow: "0 1px 2px rgba(0,0,0,.4)",
                          }}
                        >
                          ✨ Draft Reply
                        </button>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: "7px 14px",
                              background: "#fff",
                              border: "2px solid #D1D5DB",
                              borderRadius: 6,
                              fontSize: "0.74rem",
                              fontWeight: 700,
                              color: "#374151",
                              textDecoration: "none",
                            }}
                          >
                            🔗 Open source
                          </a>
                        )}
                      </div>
                      {ds?.open && (
                        <div
                          style={{
                            marginTop: 12,
                            padding: 14,
                            background: "#F9FAFB",
                            borderRadius: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              marginBottom: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <label
                              style={{
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                color: "#6B7280",
                              }}
                            >
                              Tone:
                            </label>
                            <select
                              value={ds.tone}
                              onChange={(e) =>
                                setDraftField(i, {
                                  tone: e.target.value as Tone,
                                })
                              }
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #D1D5DB",
                                borderRadius: 6,
                                fontSize: "0.78rem",
                              }}
                            >
                              <option value="neutral">Neutral</option>
                              <option value="supportive">Supportive</option>
                              <option value="firm">Firm</option>
                              <option value="grateful">Grateful</option>
                              <option value="curious">Curious</option>
                            </select>
                            <input
                              value={ds.position}
                              onChange={(e) =>
                                setDraftField(i, { position: e.target.value })
                              }
                              placeholder="Optional: our position / context"
                              style={{
                                flex: 1,
                                padding: "6px 10px",
                                border: "1px solid #D1D5DB",
                                borderRadius: 6,
                                fontSize: "0.78rem",
                              }}
                            />
                            <button
                              onClick={() => draftGo(i)}
                              style={{
                                padding: "7px 14px",
                                background: "#15803D",
                                border: "2px solid #15803D",
                                borderRadius: 6,
                                fontSize: "0.74rem",
                                fontWeight: 800,
                                color: "#fff",
                                WebkitTextFillColor: "#fff",
                                cursor: "pointer",
                                textShadow: "0 1px 2px rgba(0,0,0,.4)",
                              }}
                            >
                              Draft
                            </button>
                          </div>
                          <div
                            style={{ fontSize: "0.82rem", color: "#6B7280" }}
                          >
                            {ds.status === "idle" &&
                              "Pick a tone, optionally add context, then click Draft."}
                            {ds.status === "loading" && "⏳ Drafting…"}
                            {ds.status === "error" && (
                              <span style={{ color: "#B91C1C" }}>
                                ❌ {ds.error}
                              </span>
                            )}
                          </div>
                          {ds.status === "done" && ds.draft && (
                            <>
                              <div
                                style={{
                                  background: "#fff",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: 8,
                                  padding: 14,
                                  marginBottom: 8,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.7rem",
                                    fontWeight: 700,
                                    color: "#7C3AED",
                                    letterSpacing: ".06em",
                                    marginBottom: 6,
                                  }}
                                >
                                  REPLY · {(ds.source || "").toUpperCase()} ·{" "}
                                  {ds.draft.confidence || ""}
                                </div>
                                <div
                                  id={`raReplyText-${i}`}
                                  style={{
                                    fontSize: "0.86rem",
                                    color: "#0A1628",
                                    lineHeight: 1.55,
                                    whiteSpace: "pre-wrap",
                                  }}
                                >
                                  {ds.draft.reply || ""}
                                </div>
                                <div
                                  style={{
                                    marginTop: 10,
                                    display: "flex",
                                    gap: 6,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      copyText(`raReplyText-${i}`)
                                    }
                                    style={{
                                      padding: "6px 12px",
                                      background: "#fff",
                                      border: "2px solid #D1D5DB",
                                      borderRadius: 5,
                                      fontSize: "0.72rem",
                                      fontWeight: 700,
                                      color: "#374151",
                                      cursor: "pointer",
                                    }}
                                  >
                                    📋 Copy
                                  </button>
                                  <button
                                    onClick={() =>
                                      publishFromEl(
                                        `raReplyText-${i}`,
                                        "Publish reply",
                                        [],
                                      )
                                    }
                                    style={{
                                      padding: "6px 12px",
                                      background:
                                        "linear-gradient(135deg,#FF5722,#FF7043)",
                                      border: "none",
                                      borderRadius: 5,
                                      fontSize: "0.72rem",
                                      fontWeight: 800,
                                      color: "#fff",
                                      cursor: "pointer",
                                    }}
                                  >
                                    📤 Publish to Social
                                  </button>
                                </div>
                              </div>
                              {ds.draft.alt_short && (
                                <div
                                  style={{
                                    background: "#fff",
                                    border: "1px solid #E5E7EB",
                                    borderRadius: 8,
                                    padding: 14,
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "0.7rem",
                                      fontWeight: 700,
                                      color: "#0891B2",
                                      letterSpacing: ".06em",
                                      marginBottom: 6,
                                    }}
                                  >
                                    SHORT (TWITTER/X)
                                  </div>
                                  <div
                                    id={`raReplyShort-${i}`}
                                    style={{
                                      fontSize: "0.86rem",
                                      color: "#0A1628",
                                      lineHeight: 1.55,
                                    }}
                                  >
                                    {ds.draft.alt_short}
                                  </div>
                                  <div
                                    style={{
                                      marginTop: 10,
                                      display: "flex",
                                      gap: 6,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <button
                                      onClick={() =>
                                        copyText(`raReplyShort-${i}`)
                                      }
                                      style={{
                                        padding: "6px 12px",
                                        background: "#fff",
                                        border: "2px solid #D1D5DB",
                                        borderRadius: 5,
                                        fontSize: "0.72rem",
                                        fontWeight: 700,
                                        color: "#374151",
                                        cursor: "pointer",
                                      }}
                                    >
                                      📋 Copy
                                    </button>
                                    <button
                                      onClick={() =>
                                        publishFromEl(
                                          `raReplyShort-${i}`,
                                          "Publish to X/Twitter",
                                          ["twitter", "threads", "bluesky"],
                                        )
                                      }
                                      style={{
                                        padding: "6px 12px",
                                        background:
                                          "linear-gradient(135deg,#FF5722,#FF7043)",
                                        border: "none",
                                        borderRadius: 5,
                                        fontSize: "0.72rem",
                                        fontWeight: 800,
                                        color: "#fff",
                                        cursor: "pointer",
                                      }}
                                    >
                                      📤 Publish to X
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
