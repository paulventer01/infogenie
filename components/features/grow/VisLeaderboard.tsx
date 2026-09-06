"use client";

// Native React port of the legacy `vis-leaderboard` panel (was
// `buildVisLeaderboard()` in public/js/ig_content_traffic.js +
// `#view-vis-leaderboard` in index.html). Renders the AI Share-of-Voice rank
// table from the REAL `/api/ai-visibility/leaderboard` endpoint, with Δ vs the
// previous run. Pre-fills the brand filter from `window.analysisData.brandName`
// and links to the AI Visibility scan when there are no runs yet.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface LbRow {
  rank: number;
  brand: string;
  isYou?: boolean;
  mentions: number;
  share: number;
  deltaShare: number | null;
  rankDelta: number | null;
  firstCites: number;
}
interface LbRun {
  created_at?: string;
  providers?: string | string[];
}
interface LbResult {
  ok: boolean;
  error?: string;
  brand?: string;
  leaderboard?: LbRow[];
  run?: LbRun;
  prevRun?: { created_at?: string } | null;
  summary?: { youShare?: number };
}

export default function VisLeaderboard() {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LbResult | null>(null);

  const load = useCallback(async (b: string) => {
    setLoading(true);
    setError(null);
    const r = await apiGet<LbResult>(
      "/api/ai-visibility/leaderboard" + (b ? "?brand=" + encodeURIComponent(b) : ""),
    );
    if (!r.ok) {
      setError(r.error || "Failed to load leaderboard");
      setResult(null);
      setLoading(false);
      return;
    }
    setResult(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    const b =
      (
        (typeof window !== "undefined" &&
          (window as unknown as { analysisData?: { brandName?: string } }).analysisData
            ?.brandName) ||
        ""
      ).trim();
    setBrand(b);
    load(b);
  }, [load]);

  const renderTable = () => {
    if (loading) {
      return <div style={{ color: "#9CA3AF", padding: "12px 0" }}>⏳ Loading leaderboard…</div>;
    }
    if (error) {
      return <div style={{ color: "#991B1B" }}>{error}</div>;
    }
    if (!result) return null;
    if (!result.leaderboard || !result.leaderboard.length) {
      return (
        <div
          style={{
            background: "#F9FAFB",
            border: "1px dashed #D1D5DB",
            borderRadius: 10,
            padding: 28,
            textAlign: "center",
            color: "#6B7280",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>📊</div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>No AI Visibility runs yet</div>
          <div style={{ fontSize: "0.8rem" }}>
            Run an <strong>AI Visibility</strong> scan first — the leaderboard will appear here.
          </div>
          <button
            onClick={() => goToView(router, "search-intel")}
            style={{
              marginTop: 12,
              padding: "8px 18px",
              background: "#0f766e",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Go to AI Visibility →
          </button>
        </div>
      );
    }

    const rawProviders = result.run?.providers;
    let providers: string[] = [];
    if (Array.isArray(rawProviders)) providers = rawProviders;
    else if (typeof rawProviders === "string") {
      try {
        providers = JSON.parse(rawProviders);
      } catch {
        providers = [];
      }
    }
    const ts = result.run?.created_at ? new Date(result.run.created_at).toLocaleString() : "";
    const prevTs = result.prevRun?.created_at
      ? new Date(result.prevRun.created_at).toLocaleString()
      : null;
    const th: React.CSSProperties = {
      padding: "8px 12px",
      textAlign: "left",
      fontSize: "0.7rem",
      fontWeight: 700,
      color: "#6B7280",
      borderBottom: "1px solid #E5E7EB",
    };
    const thr: React.CSSProperties = { ...th, textAlign: "right" };

    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0A1628" }}>
              Brand: {result.brand}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
              Run: {ts}
              {prevTs ? " · vs " + prevTs : " · (no prior run for delta)"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
              Providers: {providers.join(", ") || "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0f766e" }}>
              {result.summary?.youShare || 0}%
            </div>
            <div style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 700 }}>YOUR SOV</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={th}>RANK</th>
                <th style={th}>BRAND</th>
                <th style={thr}>MENTIONS</th>
                <th style={thr}>SOV %</th>
                <th style={thr}>Δ SOV</th>
                <th style={thr}>RANK Δ</th>
                <th style={thr}>1ST CITES</th>
              </tr>
            </thead>
            <tbody>
              {result.leaderboard.map((row) => {
                const isYou = !!row.isYou;
                const rowBg = isYou ? "#F5F3FF" : "transparent";
                const deltaShareTxt =
                  row.deltaShare !== null
                    ? row.deltaShare >= 0
                      ? `+${row.deltaShare}pp`
                      : `${row.deltaShare}pp`
                    : "—";
                const deltaShareColor =
                  row.deltaShare !== null
                    ? row.deltaShare > 0
                      ? "#10B981"
                      : row.deltaShare < 0
                        ? "#EF4444"
                        : "#6B7280"
                    : "#9CA3AF";
                const rankDeltaTxt =
                  row.rankDelta !== null
                    ? row.rankDelta > 0
                      ? `↑${row.rankDelta}`
                      : row.rankDelta < 0
                        ? `↓${Math.abs(row.rankDelta)}`
                        : "—"
                    : "—";
                const rankDeltaColor =
                  row.rankDelta !== null
                    ? row.rankDelta > 0
                      ? "#10B981"
                      : row.rankDelta < 0
                        ? "#EF4444"
                        : "#6B7280"
                    : "#9CA3AF";
                return (
                  <tr key={row.rank + row.brand} style={{ background: rowBg, borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "9px 12px", fontWeight: 800, color: isYou ? "#0f766e" : "#374151" }}>
                      {row.rank}
                    </td>
                    <td
                      style={{
                        padding: "9px 12px",
                        fontWeight: isYou ? 800 : 600,
                        color: isYou ? "#0f766e" : "#0A1628",
                      }}
                    >
                      {row.brand}
                      {isYou ? " 👈" : ""}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#374151" }}>
                      {row.mentions}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: "#0A1628" }}>
                      {row.share}%
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: deltaShareColor }}>
                      {deltaShareTxt}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: rankDeltaColor }}>
                      {rankDeltaTxt}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#6B7280" }}>
                      {row.firstCites}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> Visibility
                Rank
              </div>
              <h2 className="view-title">🏆 Visibility Rank Table</h2>
              <p className="view-sub">
                See how you and your competitors rank by AI Share of Voice — with Δ vs your previous
                run so you can track momentum across ChatGPT, Perplexity, Gemini and Claude.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
            color: '#0f172a',
          }}
        >
          <h3 style={{ margin: "0 0 6px", fontFamily: "Sora,sans-serif", fontSize: "1rem" }}>
            🏆 Visibility Rank Table
          </h3>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#475569" }}>
            See how you and your competitors rank across AI engines — with Δ vs your last run.
          </p>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 16,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            alignItems: "end",
          }}
        >
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6B7280",
                marginBottom: 4,
              }}
            >
              FILTER BY BRAND
            </label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load(brand.trim());
              }}
              placeholder="Leave blank for latest run"
              style={{
                width: "100%",
                padding: 7,
                border: "1px solid #D1D5DB",
                borderRadius: 5,
                fontSize: "0.84rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={() => load(brand.trim())}
            style={{
              padding: "9px 20px",
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: "0.84rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Load
          </button>
        </div>
        <div>{renderTable()}</div>
      </div>
    </div>
  );
}
