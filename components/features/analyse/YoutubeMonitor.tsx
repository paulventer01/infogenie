"use client";

// Native React port of the legacy `youtube-monitor` panel (was
// `window.buildYoutubeMonitor` + `#view-youtube-monitor` in index.html /
// ig_intel_pack_a.js). Tracks competitor YouTube channels — recent uploads,
// view velocity, comment sentiment — against the existing Express API
// (`GET/POST /api/youtube-monitor/channels`, `POST /api/youtube-monitor/scan/:id`,
// `GET /api/youtube-monitor/history/:id`, `DELETE
// /api/youtube-monitor/channels/:id`) via `lib/api`. The "Mine" button hands a
// channel off to the Comment Miner via the legacy `window._ycmPresetChannelId`
// global + `goToView`.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete, type ApiResult } from "@/lib/api";
import { safeUrl } from "@/lib/utils";
import { showToast } from "@/hooks/useToast";
import { goToView } from "@/lib/nav";

interface Channel {
  id: number;
  channel_name: string;
  brand: string;
  channel_url: string;
  last_scanned_at?: string | null;
}
interface ChannelsResult extends ApiResult {
  channels: Channel[];
}
interface Video {
  title?: string;
  url?: string;
  published_at?: string | number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  sentiment?: string;
  summary?: string;
}
interface ScanResult extends ApiResult {
  videos: Video[];
  note?: string;
}
interface Snapshot {
  video_title?: string;
  video_url?: string;
  published_at?: string | number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  sentiment?: string;
  summary?: string;
}
interface HistoryResult extends ApiResult {
  snapshots: Snapshot[];
}

const SENT_COLOR: Record<string, [string, string]> = {
  positive: ["#ECFDF5", "#065F46"],
  neutral: ["#F3F4F6", "#374151"],
  negative: ["#FEF2F2", "#991B1B"],
};

interface ResState {
  status: "idle" | "loading" | "error" | "videos";
  text?: string;
  videos?: Video[];
}

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: 7,
  border: "1px solid #D1D5DB",
  borderRadius: 5,
  fontSize: "0.82rem",
  boxSizing: "border-box",
};
const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 3,
};

export default function YoutubeMonitor() {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [listStatus, setListStatus] = useState<
    "loading" | "error" | "done"
  >("loading");
  const [listError, setListError] = useState("");
  const [res, setRes] = useState<Record<number, ResState>>({});

  async function load() {
    setListStatus("loading");
    const r = await apiGet<ChannelsResult>("/api/youtube-monitor/channels");
    if (!r.ok) {
      setListStatus("error");
      setListError(r.error || "Failed");
      return;
    }
    setChannels(r.channels);
    setListStatus("done");
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!brand.trim() || !name.trim() || !url.trim()) {
      showToast("⚠ All fields required");
      return;
    }
    const r = await apiPost<ApiResult>("/api/youtube-monitor/channels", {
      brand: brand.trim(),
      channel_name: name.trim(),
      channel_url: url.trim(),
    });
    if (!r.ok) {
      showToast("❌ " + r.error);
      return;
    }
    setName("");
    setUrl("");
    await load();
    showToast("✅ Channel tracked");
  }

  async function scan(id: number) {
    setRes((s) => ({ ...s, [id]: { status: "loading" } }));
    const r = await apiPost<ScanResult>(`/api/youtube-monitor/scan/${id}`, {});
    if (!r.ok) {
      setRes((s) => ({ ...s, [id]: { status: "error", text: r.error } }));
      return;
    }
    if (!r.videos.length) {
      setRes((s) => ({
        ...s,
        [id]: { status: "idle", text: r.note || "No videos" },
      }));
      return;
    }
    setRes((s) => ({ ...s, [id]: { status: "videos", videos: r.videos } }));
    await load();
  }

  async function history(id: number) {
    setRes((s) => ({ ...s, [id]: { status: "loading" } }));
    const r = await apiGet<HistoryResult>(
      `/api/youtube-monitor/history/${id}`,
    );
    if (!r.ok) {
      setRes((s) => ({ ...s, [id]: { status: "error", text: r.error } }));
      return;
    }
    if (!r.snapshots.length) {
      setRes((s) => ({
        ...s,
        [id]: { status: "idle", text: "No history yet — click Scan now." },
      }));
      return;
    }
    setRes((s) => ({
      ...s,
      [id]: {
        status: "videos",
        videos: r.snapshots.map((sn) => ({
          title: sn.video_title,
          url: sn.video_url,
          published_at: sn.published_at,
          view_count: sn.view_count,
          like_count: sn.like_count,
          comment_count: sn.comment_count,
          sentiment: sn.sentiment,
          summary: sn.summary,
        })),
      },
    }));
  }

  async function remove(id: number) {
    if (!window.confirm("Stop tracking this channel? (history retained)")) return;
    await apiDelete(`/api/youtube-monitor/channels/${id}`);
    await load();
  }

  function mine(id: number) {
    (window as unknown as { _ycmPresetChannelId?: string })._ycmPresetChannelId =
      String(id);
    goToView(router, "yt-comment-miner");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> YouTube Monitor
              </div>
              <h2 className="view-title">▶️ YouTube Channel Monitor</h2>
              <p className="view-sub">
                Track competitor YouTube channels — recent uploads,
                view-velocity, comment sentiment. Real-time data via Perplexity
                (no Google API key needed).
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
            ➕ Track a YouTube Channel
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1.4fr auto",
              gap: 8,
              alignItems: "end",
            }}
          >
            <div>
              <label style={fieldLabel}>BRAND</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
                style={fieldInput}
              />
            </div>
            <div>
              <label style={fieldLabel}>CHANNEL NAME</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. MrBeast"
                style={fieldInput}
              />
            </div>
            <div>
              <label style={fieldLabel}>CHANNEL URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/@MrBeast"
                style={fieldInput}
              />
            </div>
            <button
              onClick={add}
              style={{
                background: "linear-gradient(135deg,#FF0000,#FF4444)",
                color: "#fff",
                border: "none",
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ➕ Track
            </button>
          </div>
        </div>

        <div>
          {listStatus === "loading" && (
            <div style={{ color: "#9CA3AF" }}>Loading…</div>
          )}
          {listStatus === "error" && (
            <div style={{ color: "#991B1B" }}>⚠ {listError}</div>
          )}
          {listStatus === "done" && channels && channels.length === 0 && (
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
              No channels tracked yet. Add one above (e.g.{" "}
              <code>https://www.youtube.com/@MrBeast</code>).
            </div>
          )}
          {listStatus === "done" &&
            channels &&
            channels.map((c) => {
              const r = res[c.id];
              return (
                <div
                  key={c.id}
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
                    <div>
                      <div
                        style={{
                          fontWeight: 800,
                          color: "#0A1628",
                          fontSize: "1rem",
                        }}
                      >
                        ▶️ {c.channel_name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.72rem",
                          color: "#6B7280",
                          marginTop: 2,
                        }}
                      >
                        {c.brand} ·{" "}
                        {safeUrl(c.channel_url) !== "#" ? (
                          <a
                            href={safeUrl(c.channel_url)}
                            target="_blank"
                            rel="noopener"
                            style={{ color: "#0066FF" }}
                          >
                            {c.channel_url}
                          </a>
                        ) : (
                          c.channel_url
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "0.68rem",
                          color: "#9CA3AF",
                          marginTop: 2,
                        }}
                      >
                        {c.last_scanned_at
                          ? "Last scanned " +
                            new Date(c.last_scanned_at).toLocaleString()
                          : "Never scanned"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => scan(c.id)}
                        style={{
                          background: "linear-gradient(135deg,#FF0000,#FF4444)",
                          color: "#fff",
                          border: "none",
                          padding: "7px 14px",
                          borderRadius: 6,
                          fontSize: "0.74rem",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        🔍 Scan now
                      </button>
                      <button
                        onClick={() => history(c.id)}
                        style={{
                          background: "#F3F4F6",
                          border: "1px solid #E5E7EB",
                          color: "#374151",
                          padding: "7px 12px",
                          borderRadius: 6,
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        📜 History
                      </button>
                      <button
                        onClick={() => mine(c.id)}
                        style={{
                          background: "#EFF6FF",
                          border: "1px solid #BFDBFE",
                          color: "#1D4ED8",
                          padding: "7px 12px",
                          borderRadius: 6,
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        💬 Mine
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        style={{
                          background: "#FEF2F2",
                          border: "1px solid #FECACA",
                          color: "#991B1B",
                          padding: "7px 12px",
                          borderRadius: 6,
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: "0.82rem",
                      color: "#9CA3AF",
                    }}
                  >
                    {r?.status === "loading" && "⏳ Working…"}
                    {r?.status === "error" && (
                      <div style={{ color: "#991B1B" }}>❌ {r.text}</div>
                    )}
                    {r?.status === "idle" && r.text}
                    {r?.status === "videos" && r.videos && (
                      <VideoList videos={r.videos} />
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function VideoList({ videos }: { videos: Video[] }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {videos.map((v, i) => {
        const sc =
          SENT_COLOR[(v.sentiment || "neutral").toLowerCase()] ||
          SENT_COLOR.neutral;
        const views = v.view_count
          ? Number(v.view_count).toLocaleString()
          : "?";
        return (
          <div
            key={i}
            style={{
              background: "#F9FAFB",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
              padding: "10px 12px",
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
                    lineHeight: 1.35,
                  }}
                >
                  {v.url && safeUrl(v.url) !== "#" ? (
                    <a
                      href={safeUrl(v.url)}
                      target="_blank"
                      rel="noopener"
                      style={{ color: "#0A1628", textDecoration: "none" }}
                    >
                      {v.title || ""}
                    </a>
                  ) : (
                    v.title || ""
                  )}
                </div>
                <div
                  style={{
                    fontSize: "0.74rem",
                    color: "#6B7280",
                    marginTop: 3,
                  }}
                >
                  {String(v.published_at || "")} · 👁 {views}
                  {v.like_count
                    ? ` · 👍 ${Number(v.like_count).toLocaleString()}`
                    : ""}
                  {v.comment_count
                    ? ` · 💬 ${Number(v.comment_count).toLocaleString()}`
                    : ""}
                </div>
                {v.summary && (
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#374151",
                      marginTop: 4,
                      lineHeight: 1.45,
                    }}
                  >
                    {v.summary}
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
                {v.sentiment || "neutral"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
