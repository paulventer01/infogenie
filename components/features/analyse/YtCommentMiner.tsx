"use client";

// Native React port of the legacy `yt-comment-miner` panel (was
// `window.buildYtCommentMiner` + `#view-yt-comment-miner` in index.html /
// ig_intel_pack_b.js). Mines YouTube comments for recurring questions, content
// themes, sentiment, and ready-to-film content ideas against the existing
// Express API (`GET /api/youtube-monitor/channels`,
// `POST /api/yt-comment-miner/mine`, `GET/DELETE /api/yt-comment-miner/runs`,
// `POST /api/content-calendar/add`) via `lib/api`. Honours the legacy
// `window._ycmPresetChannelId` global handed off by the YouTube Monitor.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete, type ApiResult } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

interface Channel {
  id: number;
  channel_name: string;
  brand?: string;
}
interface ChannelsResult extends ApiResult {
  channels: Channel[];
}
interface Question {
  text?: string;
  recurrence?: number;
}
interface Theme {
  theme?: string;
  count?: number;
  sentiment?: string;
}
interface Idea {
  title?: string;
  angle?: string;
  why_it_works?: string;
}
interface MineResult extends ApiResult {
  questions?: Question[];
  themes?: Theme[];
  content_ideas?: Idea[];
  sentiment_breakdown?: { positive?: number; neutral?: number; negative?: number };
  comment_count?: number;
  source?: string;
}
interface Run {
  id: number;
  channel_name?: string;
  video_url?: string;
  created_at: string;
  comment_count?: number;
  sentiment_breakdown?: { positive?: number; neutral?: number; negative?: number };
}
interface RunsResult extends ApiResult {
  runs: Run[];
}

const SENT_COL: Record<string, string> = {
  positive: "#065F46",
  neutral: "#374151",
  negative: "#991B1B",
};
const SENT_BG: Record<string, string> = {
  positive: "#ECFDF5",
  neutral: "#F3F4F6",
  negative: "#FEF2F2",
};

export default function YtCommentMiner() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [mineStatus, setMineStatus] = useState<
    "idle" | "loading" | "error" | "done"
  >("idle");
  const [mineError, setMineError] = useState("");
  const [result, setResult] = useState<MineResult | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    (async () => {
      const r = await apiGet<ChannelsResult>("/api/youtube-monitor/channels");
      if (r.ok && r.channels && r.channels.length) {
        setChannels(r.channels);
        const preset = (
          window as unknown as { _ycmPresetChannelId?: string | null }
        )._ycmPresetChannelId;
        if (preset) {
          setChannelId(String(preset));
          (
            window as unknown as { _ycmPresetChannelId?: string | null }
          )._ycmPresetChannelId = null;
        }
      }
    })();
    loadHistory();
  }, []);

  async function loadHistory() {
    const r = await apiGet<RunsResult>("/api/yt-comment-miner/runs");
    if (r.ok && r.runs && r.runs.length) setRuns(r.runs);
    else setRuns([]);
  }

  async function mine() {
    if (!channelId && !videoUrl.trim()) {
      showToast("⚠ Select a channel or paste a video URL");
      return;
    }
    setMineStatus("loading");
    setMineError("");
    setResult(null);
    const body: { channelId?: number; videoUrl?: string } = {};
    if (channelId) body.channelId = parseInt(channelId, 10);
    if (videoUrl.trim()) body.videoUrl = videoUrl.trim();
    const r = await apiPost<MineResult>("/api/yt-comment-miner/mine", body);
    if (!r.ok) {
      setMineStatus("error");
      setMineError(r.error || "Failed");
      return;
    }
    setResult(r);
    setMineStatus("done");
    loadHistory();
  }

  async function addToCalendar(idea: Idea) {
    const payload = {
      brand: "",
      channel: "YouTube",
      headline: idea.title || "",
      copy: idea.angle || idea.title || "",
      cta: "Watch Now",
      date: new Date(Date.now() + 7 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10),
    };
    const r = await apiPost<ApiResult>("/api/content-calendar/add", payload);
    if (r.ok) showToast("✅ Added to Content Calendar");
    else showToast("❌ Failed to add to Calendar");
  }

  async function deleteRun(id: number) {
    if (!window.confirm("Delete this mining run?")) return;
    await apiDelete(`/api/yt-comment-miner/runs/${id}`);
    loadHistory();
    showToast("🗑 Run deleted");
  }

  const sb = result?.sentiment_breakdown || {};
  const pos = sb.positive || 0;
  const neu = sb.neutral || 0;
  const neg = sb.negative || 0;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Comment Miner
              </div>
              <h2 className="view-title">💬 YouTube Comment Miner</h2>
              <p className="view-sub">
                Mine YouTube comments to surface what your audience is actually
                asking for — recurring questions, content gaps, sentiment, and
                6-10 ready-to-film content ideas. Send any idea to the Content
                Calendar in one click.
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
            marginBottom: 20,
          }}
        >
          <h3
            style={{
              margin: "0 0 14px",
              color: "#0A1628",
              fontFamily: "Sora,sans-serif",
              fontSize: "1rem",
              fontWeight: 800,
            }}
          >
            ⛏ Mine Comments
          </h3>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                TRACKED CHANNEL (from YouTube Monitor)
              </label>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  background: "#fff",
                }}
              >
                <option value="">— Select a tracked channel —</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.channel_name}
                    {c.brand ? " — " + c.brand : ""}
                  </option>
                ))}
              </select>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#6B7280",
                fontSize: "0.8rem",
              }}
            >
              <div style={{ flex: 1, height: 1, background: "#E5E7EB" }}></div>
              <span>OR</span>
              <div style={{ flex: 1, height: 1, background: "#E5E7EB" }}></div>
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#6B7280",
                  marginBottom: 4,
                }}
              >
                PASTE A VIDEO URL
              </label>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <button
                onClick={mine}
                disabled={mineStatus === "loading"}
                style={{
                  background: "linear-gradient(135deg,#FF0000,#FF4444)",
                  color: "#fff",
                  border: "none",
                  padding: "10px 28px",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                ⛏ Mine Comments
              </button>
            </div>
          </div>
        </div>

        <div>
          {mineStatus === "loading" && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                background: "#FFF7F7",
                borderRadius: 12,
                color: "#991B1B",
              }}
            >
              <div style={{ fontSize: "1.8rem", marginBottom: 10 }}>💬</div>
              <div style={{ fontSize: "0.85rem" }}>
                Mining YouTube comments…
                <br />
                <span style={{ opacity: 0.7 }}>
                  Perplexity Sonar + GPT-4o-mini · 30-60s
                </span>
              </div>
            </div>
          )}
          {mineStatus === "error" && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#B91C1C",
                padding: 14,
                borderRadius: 10,
              }}
            >
              ⚠ {mineError}
            </div>
          )}
          {mineStatus === "done" && result && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 18,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: "#0A1628",
                      fontSize: "0.88rem",
                      marginBottom: 10,
                    }}
                  >
                    ❓ Recurring Questions ({(result.questions || []).length})
                  </div>
                  {(result.questions || []).length ? (
                    (result.questions || []).map((q, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#F9FAFB",
                          borderLeft: "3px solid #3B82F6",
                          borderRadius: "0 6px 6px 0",
                          padding: "8px 12px",
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.82rem",
                            color: "#1E3A5F",
                            fontWeight: 600,
                          }}
                        >
                          {q.text || ""}
                        </div>
                        {q.recurrence && (
                          <div
                            style={{
                              fontSize: "0.68rem",
                              color: "#6B7280",
                              marginTop: 2,
                            }}
                          >
                            ~{q.recurrence} mentions
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>
                      No questions found
                    </div>
                  )}
                </div>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: "#0A1628",
                      fontSize: "0.88rem",
                      marginBottom: 10,
                    }}
                  >
                    🗂 Content Themes ({(result.themes || []).length})
                  </div>
                  {(result.themes || []).length ? (
                    (result.themes || []).map((t, i) => {
                      const s = (t.sentiment || "neutral").toLowerCase();
                      return (
                        <div
                          key={i}
                          style={{
                            background: "#F9FAFB",
                            border: "1px solid #E5E7EB",
                            borderRadius: 8,
                            padding: "10px 12px",
                            marginBottom: 6,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: "0.82rem",
                                fontWeight: 700,
                                color: "#0A1628",
                              }}
                            >
                              {t.theme || ""}
                            </div>
                            {t.count && (
                              <div
                                style={{
                                  fontSize: "0.7rem",
                                  color: "#6B7280",
                                  marginTop: 2,
                                }}
                              >
                                {t.count} comments
                              </div>
                            )}
                          </div>
                          <span
                            style={{
                              background: SENT_BG[s] || SENT_BG.neutral,
                              color: SENT_COL[s] || SENT_COL.neutral,
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t.sentiment || "neutral"}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>
                      No themes found
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    color: "#0A1628",
                    fontSize: "0.88rem",
                    marginBottom: 12,
                  }}
                >
                  😊 Sentiment Breakdown ({result.comment_count || 0} comments
                  mined{result.source === "template" ? " · demo data" : ""})
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div
                    style={{
                      flex: 1,
                      height: 16,
                      borderRadius: 8,
                      overflow: "hidden",
                      display: "flex",
                    }}
                  >
                    {pos > 0 && (
                      <div style={{ width: `${pos}%`, background: "#10B981" }} />
                    )}
                    {neu > 0 && (
                      <div style={{ width: `${neu}%`, background: "#9CA3AF" }} />
                    )}
                    {neg > 0 && (
                      <div style={{ width: `${neg}%`, background: "#EF4444" }} />
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: "0.74rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span>
                      <span style={{ color: "#10B981", fontWeight: 800 }}>
                        {pos}%
                      </span>{" "}
                      positive
                    </span>
                    <span>
                      <span style={{ color: "#9CA3AF", fontWeight: 800 }}>
                        {neu}%
                      </span>{" "}
                      neutral
                    </span>
                    <span>
                      <span style={{ color: "#EF4444", fontWeight: 800 }}>
                        {neg}%
                      </span>{" "}
                      negative
                    </span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    color: "#0A1628",
                    fontSize: "0.88rem",
                    marginBottom: 14,
                  }}
                >
                  💡 Content Ideas ({(result.content_ideas || []).length}) —
                  click <em>Add to Calendar</em> to schedule any idea
                </div>
                {(result.content_ideas || []).length ? (
                  (result.content_ideas || []).map((idea, i) => (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 12,
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
                        <div
                          style={{
                            fontWeight: 800,
                            color: "#0A1628",
                            fontSize: "0.9rem",
                            lineHeight: 1.35,
                          }}
                        >
                          {idea.title || ""}
                        </div>
                        <button
                          onClick={() => addToCalendar(idea)}
                          style={{
                            background: "#F0FDF4",
                            border: "1px solid #BBF7D0",
                            color: "#065F46",
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          → Add to Calendar
                        </button>
                      </div>
                      {idea.angle && (
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "#374151",
                            marginBottom: 6,
                          }}
                        >
                          <strong>Angle:</strong> {idea.angle}
                        </div>
                      )}
                      {idea.why_it_works && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#6B7280",
                            background: "#F9FAFB",
                            borderRadius: 6,
                            padding: "6px 8px",
                            borderLeft: "2px solid #D1D5DB",
                          }}
                        >
                          <strong>Why it works:</strong> {idea.why_it_works}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>
                    No ideas generated
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {runs.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  color: "#0A1628",
                  fontSize: "0.88rem",
                  marginBottom: 12,
                }}
              >
                🕑 Recent Mining Runs
              </div>
              <div>
                {runs.map((row) => {
                  const rsb = row.sentiment_breakdown || {};
                  return (
                    <div
                      key={row.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 0",
                        borderBottom: "1px solid #F3F4F6",
                        gap: 10,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "0.82rem",
                            fontWeight: 700,
                            color: "#0A1628",
                          }}
                        >
                          {row.channel_name || row.video_url || "Unknown"}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>
                          {new Date(row.created_at).toLocaleString()} ·{" "}
                          {row.comment_count || 0} comments
                        </div>
                        {rsb.positive !== undefined && (
                          <div
                            style={{
                              fontSize: "0.68rem",
                              color: "#6B7280",
                              marginTop: 2,
                            }}
                          >
                            😊 {rsb.positive}% · 😐 {rsb.neutral}% · 😠{" "}
                            {rsb.negative}%
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => deleteRun(row.id)}
                        style={{
                          background: "#FEF2F2",
                          border: "1px solid #FECACA",
                          color: "#991B1B",
                          padding: "5px 10px",
                          borderRadius: 6,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
