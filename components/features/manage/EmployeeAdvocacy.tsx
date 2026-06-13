"use client";

// Native React port of the legacy `employee-advocacy` panel (was
// `window.buildEmployeeAdvocacy` in public/js/ig_intel_pack_b.js +
// `#view-employee-advocacy`). Builds a pre-approved content queue, generates
// employee share links, and tracks share analytics against the existing Express
// API (`/api/advocacy/posts`, `/api/advocacy/share-keys`, `/api/advocacy/stats`)
// via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

interface Post {
  id: number | string;
  title: string;
  body: string;
  platforms?: string[];
  cta_url?: string | null;
  status: string;
}
interface ShareKey {
  share_key: string;
  label: string;
}
interface Stat {
  post_id: number | string;
  platform: string;
  shares: number | string;
}

type Tab = "queue" | "share" | "analytics";

function platformIcon(p: string): string {
  return (
    ({ linkedin: "💼", twitter: "🐦", facebook: "📘", instagram: "📸" } as Record<string, string>)[
      p
    ] || "🌐"
  );
}

export default function EmployeeAdvocacy() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [shareKeys, setShareKeys] = useState<ShareKey[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("queue");
  const [origin, setOrigin] = useState("");

  // create-post form
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [li, setLi] = useState(true);
  const [tw, setTw] = useState(true);
  const [fb, setFb] = useState(false);
  const [cta, setCta] = useState("");

  // share-key form
  const [keyLabel, setKeyLabel] = useState("");

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  async function load() {
    const [pr, kr, sr] = await Promise.all([
      apiGet<{ posts?: Post[] }>("/api/advocacy/posts"),
      apiGet<{ keys?: ShareKey[] }>("/api/advocacy/share-keys"),
      apiGet<{ stats?: Stat[] }>("/api/advocacy/stats"),
    ]);
    setPosts(pr.posts || []);
    setShareKeys(kr.keys || []);
    setStats(sr.stats || []);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pr, kr, sr] = await Promise.all([
        apiGet<{ posts?: Post[] }>("/api/advocacy/posts"),
        apiGet<{ keys?: ShareKey[] }>("/api/advocacy/share-keys"),
        apiGet<{ stats?: Stat[] }>("/api/advocacy/stats"),
      ]);
      if (cancelled) return;
      setPosts(pr.posts || []);
      setShareKeys(kr.keys || []);
      setStats(sr.stats || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function getShareCount(postId: Post["id"]): number {
    return stats
      .filter((s) => String(s.post_id) === String(postId))
      .reduce((a, s) => a + Number(s.shares), 0);
  }

  async function createPost() {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      alert("Title and post copy are required.");
      return;
    }
    const platforms = [
      li ? "linkedin" : null,
      tw ? "twitter" : null,
      fb ? "facebook" : null,
    ].filter(Boolean) as string[];
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/advocacy/posts", {
      title: t,
      body: b,
      platforms,
      cta_url: cta.trim() || null,
    });
    if (!r.ok) {
      toast("⚠ " + (r.error || "unknown"));
      return;
    }
    setTitle("");
    setBody("");
    setCta("");
    await load();
    toast("✅ Post added to advocacy queue");
  }

  async function togglePost(id: Post["id"], status: string) {
    await apiPut(`/api/advocacy/posts/${id}`, { status });
    await load();
  }

  async function deletePost(id: Post["id"]) {
    if (!confirm("Delete this post?")) return;
    await apiDelete(`/api/advocacy/posts/${id}`);
    await load();
  }

  async function genKey() {
    const label = keyLabel.trim() || "Team Share Link";
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/advocacy/share-keys", {
      label,
    });
    if (!r.ok) {
      toast("⚠ " + (r.error || "unknown"));
      return;
    }
    setKeyLabel("");
    await load();
    toast("✅ Share link generated");
  }

  async function deleteKey(key: string) {
    if (!confirm("Delete this share link? Employees using it will lose access.")) return;
    await apiDelete(`/api/advocacy/share-keys/${key}`);
    await load();
  }

  function copyText(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }

  const shareBase = origin + "/advocacy/share/";

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>⏳ Loading…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            {(["queue", "share", "analytics"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: "9px 20px",
                  borderRadius: 8,
                  border: `2px solid ${activeTab === t ? "#3B82F6" : "#E5E7EB"}`,
                  background: activeTab === t ? "#EFF6FF" : "#fff",
                  color: activeTab === t ? "#1D4ED8" : "#374151",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "0.86rem",
                }}
              >
                {t === "queue"
                  ? "📋 Content Queue"
                  : t === "share"
                    ? "🔗 Share Links"
                    : "📊 Analytics"}
              </button>
            ))}
          </div>

          {activeTab === "queue" && (
            <>
              <div
                style={{
                  background: "#EFF6FF",
                  border: "1.5px solid #BFDBFE",
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 20,
                }}
              >
                <h3
                  style={{
                    margin: "0 0 14px",
                    fontSize: "0.95rem",
                    fontWeight: 800,
                    color: "#1E40AF",
                  }}
                >
                  ✏️ Create Approved Post
                </h3>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Post title (internal reference)"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "9px 12px",
                    border: "1.5px solid #BFDBFE",
                    borderRadius: 8,
                    fontSize: "0.85rem",
                    marginBottom: 8,
                  }}
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Post copy — what employees will copy and share…"
                  rows={4}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "9px 12px",
                    border: "1.5px solid #BFDBFE",
                    borderRadius: 8,
                    fontSize: "0.85rem",
                    resize: "vertical",
                    marginBottom: 8,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    marginBottom: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: "#1E40AF",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} />{" "}
                    💼 LinkedIn
                  </label>
                  <label
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: "#1E40AF",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <input type="checkbox" checked={tw} onChange={(e) => setTw(e.target.checked)} />{" "}
                    🐦 Twitter/X
                  </label>
                  <label
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: "#1E40AF",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} />{" "}
                    📘 Facebook
                  </label>
                </div>
                <input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder="Optional CTA URL (e.g. blog post link)"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "9px 12px",
                    border: "1.5px solid #BFDBFE",
                    borderRadius: 8,
                    fontSize: "0.85rem",
                    marginBottom: 10,
                  }}
                />
                <button
                  onClick={createPost}
                  style={{
                    padding: "10px 24px",
                    background: "#3B82F6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Add to Queue
                </button>
              </div>
              {!posts.length ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "#9CA3AF",
                    background: "#F9FAFB",
                    borderRadius: 12,
                    border: "2px dashed #E5E7EB",
                  }}
                >
                  No posts yet — create your first approved post above
                </div>
              ) : (
                posts.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      background: "#fff",
                      border: "1.5px solid #E5E7EB",
                      borderLeft: `4px solid ${p.status === "active" ? "#3B82F6" : "#9CA3AF"}`,
                      borderRadius: 10,
                      padding: "16px 18px",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "0.9rem",
                            color: "#111",
                            marginBottom: 4,
                          }}
                        >
                          {p.title}
                        </div>
                        <div
                          style={{
                            fontSize: "0.82rem",
                            color: "#374151",
                            lineHeight: 1.5,
                            marginBottom: 8,
                          }}
                        >
                          {p.body}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {(p.platforms || []).map((pl) => (
                            <span
                              key={pl}
                              style={{
                                background: "#EFF6FF",
                                color: "#1D4ED8",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: "0.72rem",
                                fontWeight: 700,
                              }}
                            >
                              {platformIcon(pl)} {pl}
                            </span>
                          ))}
                          {p.cta_url ? (
                            <span
                              style={{
                                background: "#F0FDF4",
                                color: "#166534",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: "0.72rem",
                                fontWeight: 700,
                              }}
                            >
                              🔗 CTA
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          flexShrink: 0,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            background: p.status === "active" ? "#DCFCE7" : "#F3F4F6",
                            color: p.status === "active" ? "#166534" : "#6B7280",
                            padding: "3px 10px",
                            borderRadius: 10,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                          }}
                        >
                          {p.status}
                        </span>
                        <span
                          style={{
                            background: "#FEF3C7",
                            color: "#92400E",
                            padding: "3px 10px",
                            borderRadius: 10,
                            fontSize: "0.72rem",
                            fontWeight: 700,
                          }}
                        >
                          📤 {getShareCount(p.id)} shares
                        </span>
                        <button
                          onClick={() => {
                            copyText(p.body);
                            toast("✅ Copied!");
                          }}
                          style={{
                            padding: "5px 10px",
                            background: "#F5F3FF",
                            color: "#7B68EE",
                            border: "1px solid #DDD6FE",
                            borderRadius: 6,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          📋 Copy
                        </button>
                        <button
                          onClick={() =>
                            togglePost(p.id, p.status === "active" ? "archived" : "active")
                          }
                          style={{
                            padding: "5px 10px",
                            background: "#F9FAFB",
                            color: "#6B7280",
                            border: "1px solid #E5E7EB",
                            borderRadius: 6,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {p.status === "active" ? "Archive" : "Restore"}
                        </button>
                        <button
                          onClick={() => deletePost(p.id)}
                          style={{
                            padding: "5px 10px",
                            background: "#FEF2F2",
                            color: "#DC2626",
                            border: "1px solid #FECACA",
                            borderRadius: 6,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === "share" && (
            <>
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1.5px solid #BBF7D0",
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 20,
                }}
              >
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: "0.95rem",
                    fontWeight: 800,
                    color: "#166534",
                  }}
                >
                  🔗 Generate Employee Share Link
                </h3>
                <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "#15803D" }}>
                  Each link gives employees read-only access to your active posts. No login
                  required — just copy and share.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={keyLabel}
                    onChange={(e) => setKeyLabel(e.target.value)}
                    placeholder="Label (e.g. Sales Team, Marketing)"
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      border: "1.5px solid #BBF7D0",
                      borderRadius: 8,
                      fontSize: "0.84rem",
                    }}
                  />
                  <button
                    onClick={genKey}
                    style={{
                      padding: "9px 20px",
                      background: "#10B981",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Generate
                  </button>
                </div>
              </div>
              {!shareKeys.length ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 30,
                    color: "#9CA3AF",
                    background: "#F9FAFB",
                    borderRadius: 12,
                    border: "2px dashed #E5E7EB",
                  }}
                >
                  No share links yet — generate your first above
                </div>
              ) : (
                shareKeys.map((k) => {
                  const url = shareBase + k.share_key;
                  return (
                    <div
                      key={k.share_key}
                      style={{
                        background: "#fff",
                        border: "1.5px solid #E5E7EB",
                        borderRadius: 10,
                        padding: "14px 16px",
                        marginBottom: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#111" }}>
                          {k.label}
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#6B7280",
                            marginTop: 2,
                            wordBreak: "break-all",
                          }}
                        >
                          {url}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          copyText(url);
                          setCopiedKey(k.share_key);
                          setTimeout(() => setCopiedKey(null), 1500);
                        }}
                        style={{
                          padding: "7px 14px",
                          background: "#EFF6FF",
                          color: "#1D4ED8",
                          border: "1.5px solid #BFDBFE",
                          borderRadius: 7,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {copiedKey === k.share_key ? "✅ Copied!" : "📋 Copy Link"}
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener"
                        style={{
                          padding: "7px 14px",
                          background: "#F5F3FF",
                          color: "#7B68EE",
                          border: "1.5px solid #DDD6FE",
                          borderRadius: 7,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        🔍 Preview
                      </a>
                      <button
                        onClick={() => deleteKey(k.share_key)}
                        style={{
                          padding: "7px 12px",
                          background: "#FEF2F2",
                          color: "#DC2626",
                          border: "1px solid #FECACA",
                          borderRadius: 7,
                          fontSize: "0.8rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  );
                })
              )}
            </>
          )}

          {activeTab === "analytics" && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                  gap: 14,
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    background: "#EFF6FF",
                    borderRadius: 12,
                    padding: 18,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: "#1D4ED8" }}>
                    {posts.filter((p) => p.status === "active").length}
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#1D4ED8",
                      fontWeight: 700,
                      marginTop: 4,
                    }}
                  >
                    Active Posts
                  </div>
                </div>
                <div
                  style={{
                    background: "#F0FDF4",
                    borderRadius: 12,
                    padding: 18,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: "#166534" }}>
                    {stats.reduce((a, s) => a + Number(s.shares), 0)}
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#166534",
                      fontWeight: 700,
                      marginTop: 4,
                    }}
                  >
                    Total Shares
                  </div>
                </div>
                <div
                  style={{
                    background: "#FEF3C7",
                    borderRadius: 12,
                    padding: 18,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "2rem", fontWeight: 800, color: "#92400E" }}>
                    {shareKeys.length}
                  </div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#92400E",
                      fontWeight: 700,
                      marginTop: 4,
                    }}
                  >
                    Active Links
                  </div>
                </div>
              </div>
              {!stats.length ? (
                <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF" }}>
                  No share activity yet. Send your share links to the team to start tracking.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB" }}>
                      {["Post ID", "Platform", "Shares"].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "10px 12px",
                            textAlign: "left",
                            fontWeight: 700,
                            color: "#374151",
                            borderBottom: "1px solid #E5E7EB",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "9px 12px" }}>#{s.post_id}</td>
                        <td style={{ padding: "9px 12px" }}>
                          {platformIcon(s.platform)} {s.platform}
                        </td>
                        <td style={{ padding: "9px 12px", fontWeight: 700 }}>{s.shares}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
