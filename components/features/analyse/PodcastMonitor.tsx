"use client";

// Native React port of the legacy `podcast-monitor` panel (was
// `window.buildPodcastMonitor` / `_pmGo` + `#view-podcast-monitor` in
// index.html / app.js). Finds podcast episodes mentioning a brand against the
// existing Express API (`POST /api/podcast-monitor/scan`) via `lib/api`. No
// fabricated data — the server response is rendered verbatim.

import { useState } from "react";
import { apiPost, type ApiResult } from "@/lib/api";
import { safeUrl } from "@/lib/utils";
import { showToast } from "@/hooks/useToast";

interface Episode {
  episode_title?: string;
  podcast?: string;
  host?: string;
  platform?: string;
  sentiment?: string;
  published?: string;
  summary?: string;
  url?: string;
}

interface ScanResult extends ApiResult {
  episodes: Episode[];
  count: number;
  days: number;
  source: string;
}

const SENT_COLOR: Record<string, string> = {
  positive: "#15803D",
  neutral: "#6B7280",
  negative: "#B91C1C",
};
const PLAT_COLOR: Record<string, string> = {
  apple: "#A855F7",
  spotify: "#1DB954",
  youtube: "#FF0000",
  other: "#6B7280",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontSize: "0.88rem",
};

export default function PodcastMonitor() {
  const [brand, setBrand] = useState("Nike");
  const [days, setDays] = useState("30");
  const [count, setCount] = useState("10");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">(
    "idle",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  async function run() {
    if (!brand.trim()) {
      showToast("⚠️ Brand required");
      return;
    }
    setStatus("loading");
    setError("");
    setResult(null);
    const r = await apiPost<ScanResult>("/api/podcast-monitor/scan", {
      brand: brand.trim(),
      days: Number(days) || 30,
      count: Number(count) || 10,
    });
    if (!r.ok) {
      setStatus("error");
      setError(r.error || "failed");
      return;
    }
    setResult(r);
    setStatus("done");
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Podcast Monitor
              </div>
              <h2 className="view-title">🎙️ Podcast Mention Monitor</h2>
              <p className="view-sub">
                Find podcast episodes that mention your brand — host, show,
                sentiment, and direct episode link. Powered by Perplexity live
                search.
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
              display: "grid",
              gridTemplateColumns: "1fr 110px 110px auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>Brand</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Nike"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Days back</label>
              <input
                type="number"
                min={1}
                max={180}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Max</label>
              <input
                type="number"
                min={3}
                max={20}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button
              onClick={run}
              disabled={status === "loading"}
              style={{
                padding: "10px 22px",
                background: "#F59E0B",
                border: "2px solid #F59E0B",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 800,
                color: "#fff",
                WebkitTextFillColor: "#fff",
                cursor: "pointer",
                textShadow: "0 1px 2px rgba(0,0,0,.4)",
              }}
            >
              🎙️ Scan
            </button>
          </div>
        </div>

        <div>
          {status === "loading" && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 12,
                padding: 20,
                color: "#6B7280",
              }}
            >
              ⏳ Searching live web for podcast episodes mentioning {brand}…
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
              {error}
            </div>
          )}
          {status === "done" && result && result.episodes.length === 0 && (
            <div
              style={{
                background: "#FEF3C7",
                color: "#92400E",
                padding: "14px 18px",
                borderRadius: 10,
                fontSize: "0.85rem",
              }}
            >
              No podcast episodes found in the last {days} days. Try a longer
              window or a more specific brand. (Source: {result.source})
            </div>
          )}
          {status === "done" && result && result.episodes.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 800, color: "#0A1628" }}>
                  🎧 {result.count} episodes found · last {result.days} days
                </div>
                <span
                  style={{
                    background:
                      result.source === "perplexity" ? "#7C3AED" : "#9CA3AF",
                    color: "#fff",
                    padding: "3px 9px",
                    borderRadius: 5,
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    textTransform: "uppercase",
                  }}
                >
                  {result.source}
                </span>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {result.episodes.map((ep, i) => {
                  const sc = SENT_COLOR[ep.sentiment || ""] || "#6B7280";
                  const pc = PLAT_COLOR[ep.platform || ""] || PLAT_COLOR.other;
                  return (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: "1px solid #E5E7EB",
                        borderLeft: `4px solid ${sc}`,
                        borderRadius: 10,
                        padding: "14px 18px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 14,
                          alignItems: "flex-start",
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 800,
                              color: "#0A1628",
                              fontSize: "0.95rem",
                            }}
                          >
                            {ep.episode_title || "(untitled)"}
                          </div>
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#374151",
                              marginTop: 3,
                            }}
                          >
                            🎙️ <strong>{ep.podcast || ""}</strong>
                            {ep.host ? ` · host: ${ep.host}` : ""}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              background: pc,
                              color: "#fff",
                              padding: "3px 9px",
                              borderRadius: 5,
                              fontSize: "0.62rem",
                              fontWeight: 800,
                              textTransform: "uppercase",
                            }}
                          >
                            {ep.platform || "other"}
                          </span>
                          <span
                            style={{
                              background: sc,
                              color: "#fff",
                              padding: "3px 9px",
                              borderRadius: 5,
                              fontSize: "0.62rem",
                              fontWeight: 800,
                              textTransform: "uppercase",
                            }}
                          >
                            {ep.sentiment || "neutral"}
                          </span>
                          <span
                            style={{ fontSize: "0.7rem", color: "#9CA3AF" }}
                          >
                            {ep.published || ""}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "#374151",
                          lineHeight: 1.5,
                          marginTop: 6,
                        }}
                      >
                        {ep.summary || ""}
                      </div>
                      {ep.url && (
                        <div style={{ marginTop: 8 }}>
                          <a
                            href={safeUrl(ep.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#7C3AED", fontSize: "0.78rem" }}
                          >
                            🔗 Open episode
                          </a>
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
