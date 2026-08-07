"use client";

// Native React port of the legacy `social-analytics` panel (was
// `window.buildSocialAnalytics` in public/js/ig_intel_pack_a.js + `#view-social-analytics`
// / `#saWrap` in index.html). Pulls per-account engagement, follower growth and
// top-performing posts for a connected Zernio (Social Publisher) profile from the
// existing Express API:
//   GET /api/social-publisher/profiles
//   GET /api/social-publisher/analytics?profileId=&range=
// Links to the Social Publisher tool via lib/nav when no profile exists.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Profile {
  _id: string;
  name: string;
  isDefault?: boolean;
}
interface ProfilesResponse {
  ok?: boolean;
  error?: string;
  profiles?: Profile[];
}

interface AccountStats {
  posts?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  engagementRate?: number;
  followerGrowth?: number;
}
interface TopPost {
  engagement?: number;
  text?: string;
  url?: string;
}
interface Account {
  platform: string;
  username?: string;
  analyticsSource?: string;
  stats?: AccountStats;
  topPost?: TopPost | null;
}
interface AnalyticsTotals {
  posts?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  followers?: number;
  engagementRate?: number;
}
interface AnalyticsResponse {
  ok?: boolean;
  error?: string;
  note?: string;
  range?: string;
  totals?: AnalyticsTotals;
  accounts?: Account[];
}

const PLAT_ICON: Record<string, string> = {
  twitter: "🐦", instagram: "📷", facebook: "📘", linkedin: "💼", tiktok: "🎵",
  youtube: "📺", pinterest: "📌", reddit: "🔥", bluesky: "🦋", threads: "🧵",
  googlebusiness: "🏪", telegram: "✈️", snapchat: "👻", whatsapp: "💚", discord: "🎮",
};
const _n = (v: unknown) => Number(v) || 0;
const _f = (v: unknown) => Number(v) || 0;

function safeUrl(u?: string): string {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

function sourceTag(src?: string) {
  if (src === "zernio_analytics_endpoint")
    return { bg: "#D1FAE5", color: "#065F46", label: "LIVE" };
  if (src === "derived_from_posts")
    return { bg: "#FEF3C7", color: "#78350F", label: "DERIVED" };
  return { bg: "#F3F4F6", color: "#6B7280", label: "NO DATA" };
}

function AccountCard({ a }: { a: Account }) {
  const s = a.stats || {};
  const icon = PLAT_ICON[String(a.platform || "").toLowerCase()] || "🌐";
  const tag = sourceTag(a.analyticsSource);
  const stat = (val: string, label: string, color: string) => (
    <div>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color }}>{val}</div>
      <div style={{ fontSize: "0.62rem", color: "#6B7280", fontWeight: 700 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: "#0A1628", fontSize: "1rem" }}>
          {icon} {a.username || a.platform}{" "}
          <span style={{ color: "#9CA3AF", fontSize: "0.78rem", fontWeight: 500, marginLeft: 6 }}>{a.platform}</span>
          <span style={{ background: tag.bg, color: tag.color, padding: "2px 8px", borderRadius: 10, fontSize: "0.66rem", fontWeight: 700, marginLeft: 8 }}>{tag.label}</span>
        </h3>
        {!!s.followerGrowth && (
          <span style={{ color: (s.followerGrowth || 0) > 0 ? "#0E9F6E" : "#DC2626", fontWeight: 800, fontSize: "0.84rem" }}>
            {(s.followerGrowth || 0) > 0 ? "▲" : "▼"} {Math.abs(s.followerGrowth || 0)}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, textAlign: "center", marginBottom: a.topPost ? 12 : 0 }}>
        {stat(_n(s.posts).toLocaleString(), "POSTS", "#0066FF")}
        {stat(_n(s.impressions).toLocaleString(), "IMPRESS.", "#7C3AED")}
        {stat(_n(s.likes).toLocaleString(), "LIKES", "#EC4899")}
        {stat(_n(s.comments).toLocaleString(), "COMMENTS", "#0E9F6E")}
        {stat(_n(s.shares).toLocaleString(), "SHARES", "#F59E0B")}
        {stat((_f(s.engagementRate) || 0).toFixed(2) + "%", "ENG. RATE", "#374151")}
      </div>
      {a.topPost && (
        <div style={{ background: "#F9FAFB", borderLeft: "3px solid #FBBF24", padding: "10px 14px", borderRadius: 6, marginTop: 8 }}>
          <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#92400E", textTransform: "uppercase", marginBottom: 4 }}>
            🏆 Top Post · {_n(a.topPost.engagement).toLocaleString()} engagements
          </div>
          <div style={{ fontSize: "0.84rem", color: "#0A1628", lineHeight: 1.5 }}>
            {a.topPost.text}
            {a.topPost.url && (
              <a href={safeUrl(a.topPost.url)} target="_blank" rel="noopener noreferrer" style={{ color: "#0066FF", fontWeight: 700, textDecoration: "none", marginLeft: 6 }}>View ↗</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SocialAnalytics() {
  const router = useRouter();
  const [profStatus, setProfStatus] = useState<"loading" | "error" | "empty" | "ready">("loading");
  const [profError, setProfError] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [range, setRange] = useState("30d");

  const [outStatus, setOutStatus] = useState<"idle" | "loading" | "error" | "note" | "ready">("idle");
  const [outError, setOutError] = useState("");
  const [note, setNote] = useState("");
  const [data, setData] = useState<AnalyticsResponse | null>(null);

  const loadProfiles = useCallback(async () => {
    setProfStatus("loading");
    const pr = await apiGet<ProfilesResponse>("/api/social-publisher/profiles");
    if (pr.error && pr.ok === false) {
      setProfError(pr.error);
      setProfStatus("error");
      return;
    }
    const list = pr.profiles || [];
    if (!list.length) {
      setProfStatus("empty");
      return;
    }
    setProfiles(list);
    setProfileId(list[0]._id);
    setProfStatus("ready");
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const loadAnalytics = useCallback(async () => {
    if (!profileId) return;
    setOutStatus("loading");
    setOutError("");
    setNote("");
    const r = await apiGet<AnalyticsResponse>(
      `/api/social-publisher/analytics?profileId=${encodeURIComponent(profileId)}&range=${encodeURIComponent(range)}`,
    );
    if (!r.ok) {
      setOutError(r.error || "Failed to load analytics");
      setOutStatus("error");
      return;
    }
    if (r.note) {
      setNote(r.note);
      setOutStatus("note");
      return;
    }
    setData(r);
    setOutStatus("ready");
  }, [profileId, range]);

  const t = data?.totals || {};
  const accounts = data?.accounts || [];

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> Social Analytics
              </div>
              <h2 className="view-title">📈 Social Analytics</h2>
              <p className="view-sub">
                Per-account engagement, follower growth and top-performing posts across every social account connected to Zernio. Pulls live data from your Social Publisher profile.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {profStatus === "loading" && <div style={{ color: "#9CA3AF" }}>⏳ Loading Zernio profiles…</div>}
        {profStatus === "error" && <div style={{ color: "#991B1B" }}>Network error: {profError}</div>}
        {profStatus === "empty" && (
          <div style={{ background: "#FEF3C7", color: "#78350F", padding: 16, borderRadius: 10 }}>
            No Zernio profile yet.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); goToView(router, "social-publisher"); }} style={{ fontWeight: 700, color: "#B45309" }}>
              Open Social Publisher to create one →
            </a>
          </div>
        )}
        {profStatus === "ready" && (
          <>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 18, marginBottom: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, alignItems: "end" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>PROFILE</label>
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid #D1D5DB", borderRadius: 5, fontSize: "0.84rem", boxSizing: "border-box" }}>
                    {profiles.map((p) => (
                      <option key={p._id} value={p._id}>{p.name}{p.isDefault ? " (default)" : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: "#6B7280", marginBottom: 3 }}>RANGE</label>
                  <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: "100%", padding: 8, border: "1px solid #D1D5DB", borderRadius: 5, fontSize: "0.84rem", boxSizing: "border-box" }}>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                  </select>
                </div>
                <div>
                  <button onClick={loadAnalytics} style={{ width: "100%", background: "linear-gradient(135deg,#0066FF,#7C3AED)", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 6, fontSize: "0.84rem", fontWeight: 800, cursor: "pointer" }}>
                    📈 Load Analytics
                  </button>
                </div>
              </div>
            </div>

            <div>
              {outStatus === "loading" && <div style={{ color: "#9CA3AF" }}>⏳ Pulling per-account engagement from Zernio (10-30s)…</div>}
              {outStatus === "error" && <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: 14, borderRadius: 10 }}>{outError}</div>}
              {outStatus === "note" && (
                <div style={{ background: "#FEF3C7", color: "#78350F", padding: 16, borderRadius: 10 }}>
                  <strong>{note}</strong>{" "}
                  <a href="#" onClick={(e) => { e.preventDefault(); goToView(router, "social-publisher"); }} style={{ fontWeight: 700, color: "#B45309", marginLeft: 8 }}>Open Social Publisher →</a>
                </div>
              )}
              {outStatus === "ready" && data && (
                <>
                  <div style={{ background: "linear-gradient(135deg,#0066FF,#7C3AED)", color: "#fff", borderRadius: 12, padding: 18, marginBottom: 14 }}>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, textTransform: "uppercase", opacity: 0.85, marginBottom: 8 }}>
                      📊 Totals across {_n(accounts.length)} account(s) · last {data.range}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, textAlign: "center" }}>
                      <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{_n(t.posts).toLocaleString()}</div><div style={{ fontSize: "0.68rem", opacity: 0.85, fontWeight: 700 }}>POSTS</div></div>
                      <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{_n(t.impressions).toLocaleString()}</div><div style={{ fontSize: "0.68rem", opacity: 0.85, fontWeight: 700 }}>IMPRESSIONS</div></div>
                      <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{(_n(t.likes) + _n(t.comments) + _n(t.shares) + _n(t.clicks)).toLocaleString()}</div><div style={{ fontSize: "0.68rem", opacity: 0.85, fontWeight: 700 }}>ENGAGEMENT</div></div>
                      <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{(_f(t.engagementRate) || 0).toFixed(2)}%</div><div style={{ fontSize: "0.68rem", opacity: 0.85, fontWeight: 700 }}>ENG. RATE</div></div>
                      <div><div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{_n(t.followers).toLocaleString()}</div><div style={{ fontSize: "0.68rem", opacity: 0.85, fontWeight: 700 }}>FOLLOWERS</div></div>
                    </div>
                  </div>
                  {accounts.length ? (
                    <div style={{ display: "grid", gap: 14 }}>
                      {accounts.map((a, i) => <AccountCard key={i} a={a} />)}
                    </div>
                  ) : (
                    <div style={{ background: "#F9FAFB", color: "#6B7280", padding: 20, borderRadius: 10, textAlign: "center" }}>No accounts yet</div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
