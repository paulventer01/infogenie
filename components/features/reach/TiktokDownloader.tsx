"use client";

// Native React port of the legacy `tiktok-downloader` panel (was
// `window.buildTiktokDownloader` + `#view-tiktok-downloader` / `#ttdlWrap` in
// index.html). Paste TikTok URLs and pull the no-watermark mp4, caption,
// hashtags, music and engagement stats against the existing Express API
// (`POST /api/tiktok-downloader/parse`, video proxied via
// `/api/tiktok-downloader/proxy`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiPost } from "@/lib/api";

interface TtVideo {
  videoUrl?: string;
  coverUrl?: string;
  url?: string;
  author?: string;
  authorName?: string;
  caption?: string;
  hashtags?: string[];
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  duration?: number;
  music?: string;
  musicAuthor?: string;
}

interface TtError {
  url: string;
  error?: string;
}

interface ParseResult {
  ok: boolean;
  error?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  results?: TtVideo[];
  errors?: TtError[];
}

function n(x: unknown, d = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round(v) : d;
}

function safeUrl(u?: string): string {
  try {
    const p = new URL(String(u));
    return /^(https?|mailto):$/i.test(p.protocol) ? p.toString() : "#";
  } catch {
    return "#";
  }
}

export default function TiktokDownloader() {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function run() {
    const u = urls.trim();
    if (!u) {
      setErrorMsg("⚠ Paste at least one TikTok URL");
      setResult(null);
      return;
    }
    setErrorMsg(null);
    setResult(null);
    setLoading(true);
    const r = await apiPost<ParseResult>("/api/tiktok-downloader/parse", { urls: u });
    setLoading(false);
    if (!r.ok) {
      setErrorMsg(r.error || "failed");
      return;
    }
    setResult(r);
  }

  function copyCaption(caption: string, idx: number) {
    navigator.clipboard.writeText(caption).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    });
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> TikTok Downloader
              </div>
              <h2 className="view-title">⬇️ TikTok Downloader</h2>
              <p className="view-sub">
                Paste TikTok URLs (one per line) and pull the no-watermark mp4, caption, hashtags, music and
                engagement stats. Pairs with Ad Library Spy — turn the URLs you discover there into a swipe file
                you can study and remix.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 18, marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 6 }}>
            TIKTOK URLS (one per line · max 25)
          </label>
          <textarea
            rows={6}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={"https://www.tiktok.com/@username/video/1234567890\nhttps://vm.tiktok.com/abc123/"}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: "0.84rem",
              fontFamily: "ui-monospace,monospace",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <div style={{ fontSize: "0.74rem", color: "#6B7280" }}>
              Supports tiktok.com, vm.tiktok.com, vt.tiktok.com — short links auto-resolve.
            </div>
            <button
              onClick={run}
              style={{
                background: "linear-gradient(135deg,#FE2C55,#25F4EE)",
                color: "#000",
                border: "none",
                padding: "9px 18px",
                borderRadius: 6,
                fontSize: "0.84rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              ⬇️ Pull videos
            </button>
          </div>
        </div>

        <div>
          {loading && <div style={{ color: "#9CA3AF" }}>⏳ Resolving (5-20s, depends on URL count)…</div>}
          {errorMsg && (
            <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{errorMsg}</div>
          )}
          {result && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "14px 18px",
                  marginBottom: 14,
                }}
              >
                <strong style={{ color: "#0A1628", fontSize: "0.96rem" }}>
                  {n(result.succeeded)} of {n(result.total)} resolved
                </strong>
                {result.failed ? (
                  <span style={{ color: "#B91C1C", marginLeft: 10, fontSize: "0.8rem" }}>· {n(result.failed)} failed</span>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                {(result.results || []).map((v, i) => {
                  const proxyUrl = "/api/tiktok-downloader/proxy?url=" + encodeURIComponent(v.videoUrl || "");
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: 12,
                        padding: 0,
                        overflow: "hidden",
                        display: "grid",
                        gridTemplateColumns: "200px 1fr",
                        gap: 0,
                      }}
                    >
                      <div style={{ background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {v.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={safeUrl(v.coverUrl)}
                            alt=""
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", maxHeight: 280 }}
                          />
                        ) : (
                          <div style={{ color: "#fff", fontSize: "0.7rem", padding: "40px 0" }}>no cover</div>
                        )}
                      </div>
                      <div style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10, marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <strong style={{ color: "#0A1628", fontSize: "0.92rem" }}>@{v.author || "unknown"}</strong>
                            {v.authorName ? (
                              <span style={{ color: "#6B7280", fontSize: "0.78rem", marginLeft: 6 }}>{v.authorName}</span>
                            ) : null}
                          </div>
                          <a
                            href={safeUrl(v.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#6B7280", fontSize: "0.72rem", textDecoration: "none" }}
                          >
                            View on TikTok ↗
                          </a>
                        </div>
                        <div style={{ fontSize: "0.84rem", color: "#0A1628", lineHeight: 1.5, marginBottom: 8 }}>
                          {(v.caption || "").slice(0, 240)}
                          {(v.caption || "").length > 240 ? "…" : ""}
                        </div>
                        {(v.hashtags || []).length ? (
                          <div style={{ marginBottom: 10 }}>
                            {(v.hashtags || []).slice(0, 8).map((h, hi) => (
                              <span
                                key={hi}
                                style={{
                                  background: "#F3F4F6",
                                  color: "#374151",
                                  padding: "2px 8px",
                                  borderRadius: 10,
                                  fontSize: "0.7rem",
                                  marginRight: 4,
                                }}
                              >
                                {h}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div style={{ display: "flex", gap: 14, fontSize: "0.74rem", color: "#6B7280", marginBottom: 10 }}>
                          <span>👁 {n(v.views).toLocaleString()}</span>
                          <span>❤️ {n(v.likes).toLocaleString()}</span>
                          <span>💬 {n(v.comments).toLocaleString()}</span>
                          <span>↗ {n(v.shares).toLocaleString()}</span>
                          <span>⏱ {n(v.duration)}s</span>
                        </div>
                        {v.music ? (
                          <div style={{ fontSize: "0.74rem", color: "#6B7280", marginBottom: 10 }}>
                            🎵 {v.music}
                            {v.musicAuthor ? ` · ${v.musicAuthor}` : ""}
                          </div>
                        ) : null}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {v.videoUrl ? (
                            <a
                              href={proxyUrl}
                              download
                              style={{
                                background: "#0066FF",
                                color: "#fff",
                                padding: "6px 14px",
                                borderRadius: 6,
                                fontSize: "0.78rem",
                                fontWeight: 700,
                                textDecoration: "none",
                              }}
                            >
                              ⬇ Download mp4 (no watermark)
                            </a>
                          ) : (
                            <span style={{ color: "#9CA3AF", fontSize: "0.78rem" }}>no mp4 available</span>
                          )}
                          <button
                            onClick={() => copyCaption(v.caption || "", i)}
                            style={{
                              background: "#fff",
                              border: "1px solid #D1D5DB",
                              color: "#374151",
                              padding: "6px 12px",
                              borderRadius: 6,
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {copiedIdx === i ? "✓ Copied" : "📋 Copy caption"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {(result.errors || []).length ? (
                <div
                  style={{
                    background: "#FEF3C7",
                    border: "1px solid #FCD34D",
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginTop: 14,
                  }}
                >
                  <strong style={{ color: "#92400E", fontSize: "0.84rem" }}>
                    ⚠ {n((result.errors || []).length)} URL(s) failed
                  </strong>
                  <div style={{ marginTop: 6, fontSize: "0.76rem", color: "#78350F" }}>
                    {(result.errors || []).map((e, ei) => (
                      <div key={ei} style={{ marginTop: 3 }}>
                        • <code style={{ fontSize: "0.72rem" }}>{e.url}</code> — {e.error || "unknown"}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
