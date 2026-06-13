"use client";

// Native React port of the legacy `social-publisher` panel (was
// `window.buildSocialPublisher` + its `_sp*` helpers + `#view-social-publisher`
// / `#spWrap` in public/js/ig_intel_pack_a.js). Posts & schedules across 15
// social platforms via Zernio against the existing Express API
// (`/api/social-publisher/*`) via `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface Platform {
  id: string;
  label: string;
  icon: string;
}

const SP_PLATFORMS: Platform[] = [
  { id: "twitter", label: "Twitter/X", icon: "𝕏" },
  { id: "instagram", label: "Instagram", icon: "📷" },
  { id: "facebook", label: "Facebook", icon: "📘" },
  { id: "linkedin", label: "LinkedIn", icon: "💼" },
  { id: "tiktok", label: "TikTok", icon: "🎵" },
  { id: "youtube", label: "YouTube", icon: "▶️" },
  { id: "pinterest", label: "Pinterest", icon: "📌" },
  { id: "reddit", label: "Reddit", icon: "👽" },
  { id: "bluesky", label: "Bluesky", icon: "🦋" },
  { id: "threads", label: "Threads", icon: "@" },
  { id: "googlebusiness", label: "Google Business", icon: "🏢" },
  { id: "telegram", label: "Telegram", icon: "✈️" },
  { id: "snapchat", label: "Snapchat", icon: "👻" },
  { id: "whatsapp", label: "WhatsApp", icon: "💬" },
  { id: "discord", label: "Discord", icon: "🎮" },
];

interface Profile {
  _id?: string;
  id?: string;
  name?: string;
}

interface Account {
  platform?: string;
  username?: string;
  handle?: string;
  name?: string;
  _id?: string;
  id?: string;
}

interface Post {
  _id?: string;
  id?: string;
  status?: string;
  scheduledFor?: string;
  createdAt?: string;
  created_at?: string;
  platforms?: string[];
  platform?: string;
  text?: string;
}

type StatusKind = "ok" | "err" | "info";
interface StatusMsg {
  msg: string;
  kind: StatusKind;
}

const STATUS_COLORS: Record<StatusKind, [string, string, string]> = {
  ok: ["#ECFDF5", "#A7F3D0", "#065F46"],
  err: ["#FEF2F2", "#FECACA", "#991B1B"],
  info: ["#FFF7ED", "#FED7AA", "#9A3412"],
};

export default function SocialPublisher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsError, setPostsError] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusMsg | null>(null);
  const [profileSelError, setProfileSelError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [schedule, setSchedule] = useState("");
  const [media, setMedia] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ color: string; text: string; html?: boolean } | null>(null);

  function setStatusMsg(msg: string | null, kind: StatusKind = "info") {
    if (!msg) setStatus(null);
    else setStatus({ msg, kind });
  }

  const loadAccounts = useCallback(async (pid: string) => {
    if (!pid) {
      setAccounts(null);
      return;
    }
    setAccounts(null);
    setAccountsError(null);
    const r = await apiGet<{ ok: boolean; error?: string; accounts?: Account[] }>(
      `/api/social-publisher/accounts?profileId=${encodeURIComponent(pid)}`,
    );
    if (!r.ok) {
      setAccountsError(r.error || "failed");
      setAccounts([]);
      return;
    }
    setAccounts(r.accounts || []);
  }, []);

  const loadPosts = useCallback(async (pid: string) => {
    if (!pid) {
      setPosts(null);
      return;
    }
    setPosts(null);
    setPostsError(null);
    const r = await apiGet<{ ok: boolean; error?: string; posts?: Post[] }>(
      `/api/social-publisher/posts?profileId=${encodeURIComponent(pid)}`,
    );
    if (!r.ok) {
      setPostsError(r.error || "failed");
      setPosts([]);
      return;
    }
    setPosts(r.posts || []);
  }, []);

  const loadProfiles = useCallback(async () => {
    const r = await apiGet<{ ok: boolean; error?: string; profiles?: Profile[] }>("/api/social-publisher/profiles");
    if (!r.ok) {
      setProfileSelError(r.error || "failed");
      setStatusMsg(r.error || "failed", "err");
      return;
    }
    const profs = r.profiles || [];
    setProfiles(profs);
    if (!profs.length) {
      setProfileSelError(null);
      setStatusMsg('No profiles yet. Click "＋ New profile" to create one (e.g. "InfoGenie main").', "info");
      return;
    }
    const first = profs[0]._id || profs[0].id || "";
    setProfileId(first);
    setStatusMsg(null);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (profileId) {
      loadAccounts(profileId);
      loadPosts(profileId);
    }
  }, [profileId, loadAccounts, loadPosts]);

  async function test() {
    setStatusMsg("Testing Zernio connection…", "info");
    const r = await apiPost<{ ok: boolean; error?: string; profile_count?: number }>("/api/social-publisher/test", {});
    if (r.ok) setStatusMsg(`✅ Connected to Zernio · ${r.profile_count} profile(s) found`, "ok");
    else setStatusMsg(`❌ ${r.error}`, "err");
  }

  async function newProfile() {
    const name = prompt('Profile name (e.g. "InfoGenie main"):');
    if (!name || !name.trim()) return;
    setStatusMsg("Creating profile…", "info");
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/social-publisher/profiles", { name: name.trim() });
    if (!r.ok) {
      setStatusMsg(`❌ ${r.error}`, "err");
      return;
    }
    setStatusMsg(`✅ Profile "${name}" created`, "ok");
    loadProfiles();
  }

  async function connect(platform: string) {
    if (!profileId) {
      setStatusMsg("Pick a profile first.", "err");
      return;
    }
    setStatusMsg(`Getting OAuth URL for ${platform}…`, "info");
    const r = await apiPost<{ ok: boolean; error?: string; authUrl?: { url?: string } | string }>(
      "/api/social-publisher/connect-url",
      { platform, profileId },
    );
    if (!r.ok) {
      setStatusMsg(`❌ ${r.error}`, "err");
      return;
    }
    const url = typeof r.authUrl === "object" && r.authUrl ? r.authUrl.url : r.authUrl;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      setStatusMsg(`✅ Opening ${platform} authorization in a new tab…`, "ok");
      window.open(url, "_blank", "noopener");
    } else {
      setStatusMsg(`Got response but no auth URL: ${JSON.stringify(r.authUrl).slice(0, 200)}`, "err");
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function publish() {
    const t = text.trim();
    const platforms = Array.from(selected);
    const m = media.trim();
    if (!profileId) {
      setResult({ color: "#991B1B", text: "⚠ Pick a profile first." });
      return;
    }
    if (!t && !m) {
      setResult({ color: "#991B1B", text: "⚠ Enter text or a media URL." });
      return;
    }
    if (!platforms.length) {
      setResult({ color: "#991B1B", text: "⚠ Select at least one platform." });
      return;
    }
    setResult({ color: "#6B7280", text: "📤 Sending to Zernio…" });
    const body: Record<string, unknown> = { text: t, platforms, profileId };
    if (schedule) body.scheduledFor = new Date(schedule).toISOString();
    if (m) body.mediaUrls = [m];
    const r = await apiPost<{ ok: boolean; error?: string; scheduled?: boolean }>("/api/social-publisher/post", body);
    if (!r.ok) {
      setResult({ color: "#991B1B", html: true, text: `❌ ${r.error}` });
      return;
    }
    setResult({
      color: "#065F46",
      html: true,
      text: `✅ ${r.scheduled ? "Scheduled" : "Published"} to ${platforms.length} platform${platforms.length > 1 ? "s" : ""}!`,
    });
    setText("");
    setSchedule("");
    setMedia("");
    setTimeout(() => loadPosts(profileId), 700);
  }

  async function deletePost(id: string) {
    if (!confirm("Cancel this scheduled post?")) return;
    const r = await apiDelete<{ ok: boolean; error?: string }>(`/api/social-publisher/posts/${encodeURIComponent(id)}`);
    if (!r.ok) {
      alert("Failed: " + r.error);
      return;
    }
    loadPosts(profileId);
  }

  const statusColor = status ? STATUS_COLORS[status.kind] : null;
  const postStatusColors: Record<string, [string, string]> = {
    scheduled: ["#EFF6FF", "#1E40AF"],
    posted: ["#ECFDF5", "#065F46"],
    published: ["#ECFDF5", "#065F46"],
    draft: ["#F3F4F6", "#374151"],
    failed: ["#FEF2F2", "#991B1B"],
    error: ["#FEF2F2", "#991B1B"],
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Social Publisher
              </div>
              <h2 className="view-title">📤 Social Publisher</h2>
              <p className="view-sub">
                Post &amp; schedule across 15 social platforms (Twitter/X, Instagram, Facebook, LinkedIn, TikTok,
                YouTube, Pinterest, Reddit, Bluesky, Threads, Google Business, Telegram, Snapchat, WhatsApp, Discord) —
                one click from any AI draft you&apos;ve generated. Powered by Zernio.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 0, overflow: "hidden", marginBottom: 18 }}>
          <div
            style={{
              background: "linear-gradient(135deg,#FF5722 0%,#FF7043 100%)",
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.05rem", fontWeight: 800, color: "#fff" }}>
                📤 Social Publisher
              </div>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,.85)", marginTop: 2 }}>
                Zernio · 15 platforms · post now or schedule
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                style={{
                  padding: "7px 10px",
                  border: "1px solid rgba(255,255,255,.3)",
                  background: "rgba(255,255,255,.15)",
                  color: "#fff",
                  borderRadius: 6,
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  minWidth: 160,
                }}
              >
                {profileSelError ? (
                  <option value="">⚠ {profileSelError}</option>
                ) : !profiles.length ? (
                  <option value="">No profiles — click ＋ New profile</option>
                ) : (
                  profiles.map((p) => {
                    const id = p._id || p.id || "";
                    return (
                      <option key={id} value={id}>
                        {p.name || id}
                      </option>
                    );
                  })
                )}
              </select>
              <button
                onClick={newProfile}
                style={{
                  background: "rgba(255,255,255,.18)",
                  border: "1px solid rgba(255,255,255,.3)",
                  color: "#fff",
                  padding: "7px 12px",
                  borderRadius: 6,
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ＋ New profile
              </button>
              <button
                onClick={test}
                style={{
                  background: "#fff",
                  color: "#FF5722",
                  border: "none",
                  padding: "7px 14px",
                  borderRadius: 6,
                  fontSize: "0.74rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                ⚡ Test connection
              </button>
            </div>
          </div>
          {status && statusColor && (
            <div
              style={{
                padding: "10px 20px",
                background: statusColor[0],
                borderBottom: `1px solid ${statusColor[1]}`,
                color: statusColor[2],
                fontSize: "0.78rem",
              }}
            >
              {status.msg}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: "0 0 10px", color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
              🔌 Connected accounts
            </h3>
            <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
              {!profileId ? (
                <div style={{ color: "#9CA3AF" }}>Pick a profile above.</div>
              ) : accountsError ? (
                <div style={{ color: "#991B1B" }}>⚠ {accountsError}</div>
              ) : accounts === null ? (
                <div style={{ color: "#9CA3AF" }}>Loading…</div>
              ) : accounts.length === 0 ? (
                <div style={{ color: "#9CA3AF", fontStyle: "italic" }}>
                  No accounts connected yet. Use &quot;＋ Connect a new platform&quot; below to authorize one.
                </div>
              ) : (
                accounts.map((a, i) => {
                  const plat = (a.platform || "").toLowerCase();
                  const meta = SP_PLATFORMS.find((p) => p.id === plat) || { icon: "•", label: plat, id: plat };
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 10px",
                        background: "#F9FAFB",
                        border: "1px solid #E5E7EB",
                        borderRadius: 6,
                        marginBottom: 5,
                      }}
                    >
                      <div>
                        <span style={{ fontSize: "0.95rem" }}>{meta.icon}</span>{" "}
                        <strong style={{ color: "#0A1628" }}>{meta.label}</strong> ·{" "}
                        <span style={{ color: "#6B7280", fontSize: "0.78rem" }}>
                          {a.username || a.handle || a.name || a._id || a.id || ""}
                        </span>
                      </div>
                      <span
                        style={{
                          background: "#ECFDF5",
                          color: "#065F46",
                          padding: "2px 7px",
                          borderRadius: 4,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                        }}
                      >
                        connected
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
              <div style={{ fontSize: "0.78rem", color: "#374151", fontWeight: 700, marginBottom: 8 }}>
                ＋ Connect a new platform
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {SP_PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => connect(p.id)}
                    title={`Connect ${p.label}`}
                    style={{
                      background: "#FFF",
                      border: "1px solid #E5E7EB",
                      color: "#374151",
                      padding: "6px 10px",
                      borderRadius: 6,
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: "0 0 10px", color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
              ✍️ Compose
            </h3>
            <textarea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What do you want to post? (or paste an AI draft from Reply Assistant, Press Release, Counter-Message, A/B Designer…)"
              style={{
                width: "100%",
                padding: 10,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                fontSize: "0.82rem",
                fontFamily: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700, marginBottom: 6 }}>PUBLISH TO:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {SP_PLATFORMS.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleSelected(p.id)}
                      style={{
                        background: on ? "#FF5722" : "#F3F4F6",
                        border: `1px solid ${on ? "#FF5722" : "#E5E7EB"}`,
                        color: on ? "#fff" : "#374151",
                        padding: "6px 10px",
                        borderRadius: 16,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {p.icon} {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <div>
                <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700, marginBottom: 4 }}>
                  📅 SCHEDULE FOR (optional)
                </div>
                <input
                  type="datetime-local"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  style={{ width: "100%", padding: 7, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700, marginBottom: 4 }}>
                  🖼 MEDIA URL (optional)
                </div>
                <input
                  type="url"
                  value={media}
                  onChange={(e) => setMedia(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  style={{ width: "100%", padding: 7, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <button
              onClick={publish}
              style={{
                marginTop: 12,
                width: "100%",
                background: "linear-gradient(135deg,#FF5722 0%,#FF7043 100%)",
                color: "#fff",
                border: "none",
                padding: 11,
                borderRadius: 8,
                fontSize: "0.86rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              📤 Publish now
            </button>
            <div style={{ marginTop: 10, fontSize: "0.78rem" }}>
              {result &&
                (result.html ? (
                  <div
                    style={{
                      background: result.color === "#065F46" ? "#ECFDF5" : "#FEF2F2",
                      border: `1px solid ${result.color === "#065F46" ? "#A7F3D0" : "#FECACA"}`,
                      color: result.color,
                      padding: 10,
                      borderRadius: 6,
                    }}
                  >
                    {result.text}
                  </div>
                ) : (
                  <div style={{ color: result.color }}>{result.text}</div>
                ))}
            </div>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0, color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
              📅 Scheduled &amp; recent posts
            </h3>
            <button
              onClick={() => loadPosts(profileId)}
              style={{
                background: "#F3F4F6",
                border: "1px solid #E5E7EB",
                color: "#374151",
                padding: "5px 10px",
                borderRadius: 5,
                fontSize: "0.72rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🔄 Refresh
            </button>
          </div>
          <div style={{ fontSize: "0.82rem", color: "#6B7280" }}>
            {!profileId ? (
              <div style={{ color: "#9CA3AF" }}>Pick a profile above.</div>
            ) : postsError ? (
              <div style={{ color: "#991B1B" }}>⚠ {postsError}</div>
            ) : posts === null ? (
              <div style={{ color: "#9CA3AF" }}>Loading…</div>
            ) : posts.length === 0 ? (
              <div style={{ color: "#9CA3AF", fontStyle: "italic" }}>No posts yet for this profile.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {posts.slice(0, 30).map((p, i) => {
                  const id = p._id || p.id || "";
                  const st = (p.status || "unknown").toLowerCase();
                  const sc = postStatusColors[st] || ["#F3F4F6", "#374151"];
                  const when = p.scheduledFor || p.createdAt || p.created_at || "";
                  const plats = Array.isArray(p.platforms) ? p.platforms : p.platform ? [p.platform] : [];
                  return (
                    <div key={id || i} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: 11 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10, marginBottom: 6 }}>
                        <div style={{ flex: 1, color: "#0A1628", fontSize: "0.82rem", lineHeight: 1.45 }}>
                          {(p.text || "").slice(0, 200)}
                          {(p.text || "").length > 200 ? "…" : ""}
                        </div>
                        <span
                          style={{
                            background: sc[0],
                            color: sc[1],
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {st}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "0.72rem",
                          color: "#6B7280",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          {plats
                            .map((pl) => {
                              const m = SP_PLATFORMS.find((x) => x.id === String(pl).toLowerCase());
                              return m ? `${m.icon} ${m.label}` : String(pl);
                            })
                            .join(" · ")}
                          {when ? " · " + new Date(when).toLocaleString() : ""}
                        </div>
                        {id && (st === "scheduled" || st === "draft") ? (
                          <button
                            onClick={() => deletePost(id)}
                            style={{
                              background: "#FEF2F2",
                              border: "1px solid #FECACA",
                              color: "#991B1B",
                              padding: "3px 8px",
                              borderRadius: 4,
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            🗑 Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
