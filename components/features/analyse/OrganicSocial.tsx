"use client";

// Native React port of the legacy `organic-social` panel (was
// `window.buildOrganic` + `#view-organic-social` in ig_apify.js). Tracks any
// brand/keyword's organic TikTok content via Apify against the existing Express
// API (`POST /api/apify/tiktok-organic`, `GET /api/apify/run-status`) through
// `lib/api`. See `docs/react-panel-migration.md` for the porting pattern.

import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface TikTokAuthor {
  name?: string;
  nickname?: string;
}
interface TikTokItem {
  playCount?: number | string;
  diggCount?: number | string;
  commentCount?: number | string;
  shareCount?: number | string;
  authorMeta?: TikTokAuthor;
  author?: TikTokAuthor;
  authorNickname?: string;
  text?: string;
  description?: string;
  webVideoUrl?: string;
  videoUrl?: string;
}
interface StartResponse {
  ok: boolean;
  error?: string;
  run_id?: string;
  dataset_id?: string;
}
interface StatusResponse {
  ok?: boolean;
  error?: string;
  status?: "pending" | "failed" | "succeeded" | string;
  items?: TikTokItem[];
}

type Banner = { kind: "spinner" | "error" | "info" | "success" | "nokey"; msg: string } | null;

function fmt(n: number | string | undefined): string {
  const v = parseInt(String(n)) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return String(v);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function OrganicSocial() {
  const [keyword, setKeyword] = useState("");
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [items, setItems] = useState<TikTokItem[] | null>(null);
  const [lastKeyword, setLastKeyword] = useState("");

  async function run() {
    const kw = keyword.trim();
    if (!kw) {
      setBanner({ kind: "error", msg: "Enter a keyword or hashtag" });
      return;
    }
    setRunning(true);
    setItems(null);
    setBanner({ kind: "spinner", msg: "Starting Apify TikTok Scraper…" });
    const d = await apiPost<StartResponse>("/api/apify/tiktok-organic", {
      keyword: kw,
      limit,
    });
    if (!d.ok) {
      setRunning(false);
      setBanner(
        d.error?.includes("APIFY_API_KEY")
          ? { kind: "nokey", msg: "Organic Social Monitor" }
          : { kind: "error", msg: d.error || "Failed to start" },
      );
      return;
    }
    setBanner({
      kind: "spinner",
      msg: "TikTok scrape running… checking every 8s (usually 30-90s)",
    });
    await poll(d.run_id || "", d.dataset_id || "", kw);
  }

  async function poll(runId: string, datasetId: string, kw: string) {
    const MAX = 40;
    for (let attempt = 0; attempt < MAX; attempt++) {
      await delay(8000);
      const url = `/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId || "")}&limit=${limit || 25}`;
      const d = await apiGet<StatusResponse>(url);
      if (d.error) {
        setRunning(false);
        setBanner({ kind: "error", msg: d.error });
        return;
      }
      if (d.status === "failed") {
        setRunning(false);
        setBanner({ kind: "error", msg: "Scrape failed: " + (d.error || "unknown") });
        return;
      }
      if (d.status === "pending") {
        setBanner({
          kind: "spinner",
          msg: `Still running… attempt ${attempt + 1}/${MAX} (${(attempt + 1) * 8}s elapsed)`,
        });
        continue;
      }
      // Complete
      setRunning(false);
      setBanner({
        kind: "success",
        msg: `✓ Scraped ${(d.items || []).length} results`,
      });
      setItems(d.items || []);
      setLastKeyword(kw);
      return;
    }
    setRunning(false);
    setBanner({
      kind: "error",
      msg: "Apify timed out — the scraper took too long. Try a smaller result count.",
    });
  }

  function exportCsv() {
    const list = items || [];
    const rows: (string | number)[][] = [
      [
        "Author",
        "Description",
        "Views",
        "Likes",
        "Comments",
        "Shares",
        "EngagementRate%",
        "URL",
      ],
    ];
    list.forEach((v) => {
      const views = parseInt(String(v.playCount)) || 0;
      const likes = parseInt(String(v.diggCount)) || 0;
      const er = views > 0 ? ((likes / views) * 100).toFixed(2) : "0";
      rows.push([
        v.authorMeta?.name || v.author?.nickname || "",
        '"' +
          (v.text || v.description || "").replace(/"/g, '""').replace(/\n/g, " ") +
          '"',
        views,
        likes,
        parseInt(String(v.commentCount)) || 0,
        parseInt(String(v.shareCount)) || 0,
        er,
        v.webVideoUrl || v.videoUrl || "",
      ]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download =
      "tiktok_organic_" + (lastKeyword || "export").replace(/\W+/g, "_") + ".csv";
    a.click();
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Organic Social Monitor
              </div>
              <h2 className="view-title">📱 Organic Social Monitor</h2>
              <p className="view-sub">
                Track any brand or keyword&apos;s organic TikTok content — views,
                engagement, top creators. Powered by Apify.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div className="ig-card" style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label className="ig-label">Brand · Keyword · Hashtag</label>
              <input
                className="ig-input"
                placeholder="e.g. Nike, #CleanTok, Stanley Cup"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !running && run()}
              />
            </div>
            <div>
              <label className="ig-label">Results</label>
              <select
                className="ig-select"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 20)}
              >
                <option value={10}>10 videos</option>
                <option value={20}>20 videos</option>
                <option value={30}>30 videos</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              disabled={running}
              onClick={run}
            >
              {running ? "⏳ Starting…" : "🔍 Search TikTok"}
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <StatusBanner banner={banner} />
          </div>
        </div>

        {items && (
          <ResultsView items={items} keyword={lastKeyword} onExport={exportCsv} />
        )}
      </div>
    </div>
  );
}

function StatusBanner({ banner }: { banner: Banner }) {
  if (!banner) return null;
  if (banner.kind === "nokey") {
    return (
      <div
        style={{
          background: "linear-gradient(135deg,#EEF2FF,#F5F3FF)",
          border: "1px solid #C7D2FE",
          borderRadius: 12,
          padding: 24,
          textAlign: "center",
          margin: "16px 0",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>🔑</div>
        <div
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            color: "#1E1B4B",
            marginBottom: 6,
          }}
        >
          APIFY_API_KEY required
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "#6B7280",
            maxWidth: 400,
            margin: "0 auto 16px",
          }}
        >
          {banner.msg} uses Apify&apos;s web scraping platform. Add your free
          Apify API key to unlock it.
        </div>
        <a
          href="https://console.apify.com/sign-up"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "10px 22px",
            background: "#667eea",
            color: "#fff",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: "0.85rem",
            textDecoration: "none",
          }}
        >
          Get Free Apify Key →
        </a>
        <div style={{ fontSize: "0.75rem", color: "#9CA3AF", marginTop: 10 }}>
          Then add it in <strong>Settings → Integrations → Apify</strong>
        </div>
      </div>
    );
  }
  if (banner.kind === "spinner") {
    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            border: "2px solid var(--ig-primary,#667eea)",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "_apSpin 0.8s linear infinite",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {banner.msg}
        </span>
        <style>{"@keyframes _apSpin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }
  const colors: Record<string, [string, string]> = {
    error: ["#FEE2E2", "#991B1B"],
    success: ["#D1FAE5", "#065F46"],
    info: ["#EFF6FF", "#1E40AF"],
  };
  const [bg, fg] = colors[banner.kind] || colors.info;
  return (
    <div
      style={{
        background: bg,
        color: fg,
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: "0.84rem",
      }}
    >
      {banner.msg}
    </div>
  );
}

function ResultsView({
  items,
  keyword,
  onExport,
}: {
  items: TikTokItem[];
  keyword: string;
  onExport: () => void;
}) {
  if (!items.length) {
    return (
      <div
        style={{
          background: "#EFF6FF",
          color: "#1E40AF",
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: "0.84rem",
        }}
      >
        No videos found — try a different keyword or hashtag
      </div>
    );
  }
  const totalViews = items.reduce((a, v) => a + (parseInt(String(v.playCount)) || 0), 0);
  const avgLikes = Math.round(
    items.reduce((a, v) => a + (parseInt(String(v.diggCount)) || 0), 0) / items.length,
  );

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {(
          [
            ["📹", items.length + " Videos", "Found"],
            ["👁", fmt(totalViews), "Total Views"],
            ["❤️", fmt(avgLikes) + " avg", "Likes/Video"],
          ] as [string, string, string][]
        ).map(([ic, v, l], i) => (
          <div
            key={i}
            style={{
              background: "var(--bg-card,#fff)",
              border: "1px solid #E5E7EB",
              borderRadius: 10,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "1.4rem" }}>{ic}</div>
            <div
              style={{ fontWeight: 800, fontSize: "1.1rem", color: "#0A1628" }}
            >
              {v}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>{l}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 700, color: "#0A1628" }}>
          TikTok results for &quot;
          <span style={{ color: "#667eea" }}>{keyword}</span>&quot;
        </div>
        <button
          onClick={onExport}
          className="btn btn-secondary"
          style={{ fontSize: "0.78rem" }}
        >
          ⬇ Export CSV
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))",
          gap: 12,
        }}
      >
        {items.map((v, i) => {
          const views = parseInt(String(v.playCount)) || 0;
          const likes = parseInt(String(v.diggCount)) || 0;
          const comments = parseInt(String(v.commentCount)) || 0;
          const shares = parseInt(String(v.shareCount)) || 0;
          const author =
            v.authorMeta?.name ||
            v.author?.nickname ||
            v.authorNickname ||
            "unknown";
          const desc = (v.text || v.description || "").slice(0, 220);
          const url = v.webVideoUrl || v.videoUrl || "";
          const erNum = views > 0 ? (likes / views) * 100 : 0;
          const er = views > 0 ? erNum.toFixed(2) + "%" : "—";
          const isTop = i === 0 && views > 0;
          return (
            <div
              key={i}
              style={{
                background: "var(--bg-card,#fff)",
                border: `1px solid ${isTop ? "#667eea" : "#E5E7EB"}`,
                borderRadius: 10,
                padding: 14,
                position: "relative",
              }}
            >
              {isTop && (
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    background: "#667eea",
                    color: "#fff",
                    fontSize: "0.65rem",
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 10,
                  }}
                >
                  👑 TOP
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "linear-gradient(135deg,#E21221,#FF0050)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {author.slice(0, 2).toUpperCase()}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    color: "#1E1B4B",
                  }}
                >
                  @{author}
                </div>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      marginLeft: "auto",
                      fontSize: "0.72rem",
                      color: "#FF0050",
                      fontWeight: 700,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ▶ Watch →
                  </a>
                )}
              </div>
              <div
                style={{
                  fontSize: "0.79rem",
                  color: "#374151",
                  lineHeight: 1.5,
                  marginBottom: 10,
                  minHeight: 36,
                }}
              >
                {desc}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 5,
                  fontSize: "0.7rem",
                  textAlign: "center",
                }}
              >
                {(
                  [
                    ["👁", fmt(views), "Views"],
                    ["❤️", fmt(likes), "Likes"],
                    ["💬", fmt(comments), "Comments"],
                    ["📤", fmt(shares), "Shares"],
                  ] as [string, string, string][]
                ).map(([ic, val, lbl], ci) => (
                  <div
                    key={ci}
                    style={{
                      background: "#F9FAFB",
                      borderRadius: 6,
                      padding: "5px 3px",
                    }}
                  >
                    <div style={{ fontSize: "0.95rem" }}>{ic}</div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: "#0A1628",
                        fontSize: "0.78rem",
                      }}
                    >
                      {val}
                    </div>
                    <div style={{ color: "#9CA3AF" }}>{lbl}</div>
                  </div>
                ))}
              </div>
              <div
                style={{ marginTop: 8, fontSize: "0.72rem", color: "#6B7280" }}
              >
                ER:{" "}
                <strong
                  style={{
                    color:
                      erNum > 2 ? "#16a34a" : erNum > 0.5 ? "#d97706" : "#dc2626",
                  }}
                >
                  {er}
                </strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
