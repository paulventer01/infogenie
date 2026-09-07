"use client";

// Native React port of the legacy `post-performance` panel (was
// `window.buildPostPerformance` in public/js/ig_intel_pack_b.js + `#view-post-performance`
// / `#ppWrap` in index.html). Ranks every published post by engagement,
// impressions, clicks, likes or date across all connected social accounts.
// Reads live data from the existing Express API:
//   GET /api/social-publisher/posts-performance?profileId=&range=&sort=
// The profile id is read from the legacy `window._socialProfileId` global set by
// the Social Publisher; when absent the panel shows the legacy "connect first"
// empty state.

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

interface Post {
  platform: string;
  username?: string;
  publishedAt?: string;
  text?: string;
  url?: string;
  impressions?: number;
  likes: number;
  comments: number;
  shares: number;
  clicks?: number;
  engTotal: number;
  engRate?: number;
}

interface Totals {
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  engTotal?: number;
}

interface PerfResponse {
  ok?: boolean;
  error?: string;
  note?: string;
  posts?: Post[];
  totals?: Totals;
}

type SortKey = "engagement" | "impressions" | "clicks" | "likes" | "date";
type RangeKey = "7d" | "30d" | "90d";

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: "📸", facebook: "📘", twitter: "🐦", linkedin: "💼", tiktok: "🎵",
  youtube: "▶️", pinterest: "📌", reddit: "🔴", bluesky: "🟦", threads: "🧵",
  googlebusiness: "🏢", telegram: "✈️", discord: "💬", snapchat: "👻", whatsapp: "💬",
};
const platEmoji = (p?: string) =>
  PLATFORM_EMOJI[String(p || "").toLowerCase()] || "🌐";

const fmtNum = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);

const fmtDate = (s?: string) => {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "2-digit",
    });
  } catch {
    return "";
  }
};

function safeUrl(u?: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

function getProfileId(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as unknown as { _socialProfileId?: string })._socialProfileId || ""
  ).trim();
}

const SORTS: SortKey[] = ["engagement", "impressions", "clicks", "likes", "date"];
const RANGES: RangeKey[] = ["7d", "30d", "90d"];

function MetaStat({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "14px 18px", textAlign: "center", minWidth: 100 }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 900, color }}>{fmtNum(val)}</div>
      <div style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function PostRow({ p, i }: { p: Post; i: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 16px", marginBottom: 8, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ fontSize: "1.4rem", lineHeight: 1, paddingTop: 2 }}>{platEmoji(p.platform)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "capitalize" }}>{p.platform}</span>
          {p.username && <span style={{ fontSize: "0.72rem", color: "#9CA3AF" }}>@{p.username}</span>}
          <span style={{ fontSize: "0.7rem", color: "#9CA3AF" }}>{fmtDate(p.publishedAt)}</span>
          {(p.engRate || 0) > 0 && (
            <span style={{ background: "#EDE9FE", color: "#0f766e", fontSize: "0.7rem", fontWeight: 700, padding: "2px 7px", borderRadius: 99 }}>{p.engRate}% ER</span>
          )}
          {p.url && (
            <a href={safeUrl(p.url)} target="_blank" rel="noopener noreferrer" style={{ color: "#6B7280", fontSize: "0.75rem", textDecoration: "none" }}>↗ View post</a>
          )}
        </div>
        <div style={{ fontSize: "0.83rem", color: "#374151", lineHeight: 1.4, marginBottom: 8, wordBreak: "break-word" }}>
          {p.text ? p.text.slice(0, 200) + (p.text.length > 200 ? "…" : "") : <em style={{ color: "#9CA3AF" }}>No text preview</em>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!!p.impressions && <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>👁 {fmtNum(p.impressions)}</span>}
          <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>❤️ {fmtNum(p.likes)}</span>
          <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>💬 {fmtNum(p.comments)}</span>
          <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>🔁 {fmtNum(p.shares)}</span>
          {!!p.clicks && <span style={{ fontSize: "0.72rem", color: "#6B7280" }}>🖱 {fmtNum(p.clicks)}</span>}
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#0A1628" }}>Total: {fmtNum(p.engTotal)}</span>
        </div>
      </div>
      <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#D1D5DB", minWidth: 28, textAlign: "right" }}>#{i + 1}</div>
    </div>
  );
}

export default function PostPerformance() {
  const [profileId, setProfileId] = useState("");
  const [sort, setSort] = useState<SortKey>("engagement");
  const [range, setRange] = useState<RangeKey>("30d");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "note">("loading");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [totals, setTotals] = useState<Totals>({});

  useEffect(() => {
    setProfileId(getProfileId());
  }, []);

  const load = useCallback(async () => {
    const pid = getProfileId();
    if (!pid) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError("");
    setNote("");
    const r = await apiGet<PerfResponse>(
      `/api/social-publisher/posts-performance?profileId=${encodeURIComponent(pid)}&range=${range}&sort=${sort}`,
    );
    if (r.note) {
      setNote(r.note);
      setStatus("note");
      return;
    }
    if (!r.ok) {
      setError(r.error || "API error");
      setStatus("error");
      return;
    }
    setPosts(r.posts || []);
    setTotals(r.totals || {});
    setStatus("idle");
  }, [range, sort]);

  useEffect(() => {
    if (profileId) load();
  }, [profileId, load]);

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> Post Performance
              </div>
              <h2 className="view-title">📈 Post Performance</h2>
              <p className="view-sub">
                See every published post ranked by engagement, impressions, clicks, or date — across all your connected social accounts in one place. Spot your best content at a glance and replicate what works.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {!profileId && (
          <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 10, padding: 20, fontSize: "0.88rem", color: "#92400E" }}>
            Connect a social account in <strong>Social Publisher</strong> first — your profile ID is needed to load post analytics.
          </div>
        )}
        {profileId && status === "loading" && (
          <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>Loading post analytics…</div>
        )}
        {profileId && status === "note" && (
          <div style={{ background: "#F9FAFB", border: "1px dashed #D1D5DB", borderRadius: 10, padding: 20, textAlign: "center", color: "#6B7280", fontSize: "0.88rem" }}>{note}</div>
        )}
        {profileId && status === "error" && (
          <div style={{ color: "#991B1B", padding: 16 }}>Error: {error}</div>
        )}
        {profileId && status === "idle" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
              <MetaStat label="Total Posts" val={posts.length} color="#0A1628" />
              <MetaStat label="Impressions" val={totals.impressions || 0} color="#0066FF" />
              <MetaStat label="Likes" val={totals.likes || 0} color="#EF4444" />
              <MetaStat label="Comments" val={totals.comments || 0} color="#F59E0B" />
              <MetaStat label="Shares" val={totals.shares || 0} color="#10B981" />
              <MetaStat label="Clicks" val={totals.clicks || 0} color="#0f766e" />
              <MetaStat label="Total Eng." val={totals.engTotal || 0} color="#0A1628" />
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginRight: 4 }}>Sort by:</span>
                {SORTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSort(s)}
                    style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.76rem", fontWeight: 700, border: `1px solid ${sort === s ? "#0f766e" : "#E5E7EB"}`, background: sort === s ? "#EDE9FE" : "#fff", color: sort === s ? "#0f766e" : "#374151", cursor: "pointer" }}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
                <span style={{ marginLeft: "auto", fontSize: "0.8rem", fontWeight: 700, color: "#374151" }}>Range:</span>
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    style={{ padding: "5px 10px", borderRadius: 6, fontSize: "0.76rem", fontWeight: 700, border: `1px solid ${range === r ? "#0066FF" : "#E5E7EB"}`, background: range === r ? "#EFF6FF" : "#fff", color: range === r ? "#0066FF" : "#374151", cursor: "pointer" }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              {posts.length === 0 ? (
                <div style={{ textAlign: "center", padding: 48, color: "#6B7280", fontSize: "0.9rem" }}>No posts found for this period.</div>
              ) : (
                posts.map((p, i) => <PostRow key={i} p={p} i={i} />)
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
