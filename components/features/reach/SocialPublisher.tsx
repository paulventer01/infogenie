"use client";

// Unified Social Publisher — Calendar + Compose + Queue + Ideas.
// Publishing goes through Zernio (`/api/social-publisher/*`); planning drafts
// live in `/api/social-drafts/*` so the calendar and AI ideas share one path.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import SocialCalendarView, { type SocialDraft } from "./SocialCalendarView";
import SocialIdeasPanel from "./SocialIdeasPanel";
import SocialApprovalsPanel from "./SocialApprovalsPanel";
import SocialAutomationPanel from "./SocialAutomationPanel";
import SocialInboxPanel from "./SocialInboxPanel";

interface Platform {
  id: string;
  label: string;
  icon: string;
  color: string;
}

const SP_PLATFORMS: Platform[] = [
  { id: "twitter", label: "Twitter/X", icon: "𝕏", color: "#14171A" },
  { id: "instagram", label: "Instagram", icon: "📷", color: "#E1306C" },
  { id: "facebook", label: "Facebook", icon: "📘", color: "#1877F2" },
  { id: "linkedin", label: "LinkedIn", icon: "💼", color: "#0A66C2" },
  { id: "tiktok", label: "TikTok", icon: "🎵", color: "#010101" },
  { id: "youtube", label: "YouTube", icon: "▶️", color: "#FF0000" },
  { id: "pinterest", label: "Pinterest", icon: "📌", color: "#E60023" },
  { id: "reddit", label: "Reddit", icon: "👽", color: "#FF4500" },
  { id: "bluesky", label: "Bluesky", icon: "🦋", color: "#0085FF" },
  { id: "threads", label: "Threads", icon: "@", color: "#000000" },
  { id: "googlebusiness", label: "Google Business", icon: "🏢", color: "#4285F4" },
  { id: "telegram", label: "Telegram", icon: "✈️", color: "#26A5E4" },
  { id: "snapchat", label: "Snapchat", icon: "👻", color: "#FFFC00" },
  { id: "whatsapp", label: "WhatsApp", icon: "💬", color: "#25D366" },
  { id: "discord", label: "Discord", icon: "🎮", color: "#5865F2" },
];

const LEGACY_PLATFORM_MAP: Record<string, string> = {
  Meta: "facebook",
  Instagram: "instagram",
  TikTok: "tiktok",
  LinkedIn: "linkedin",
  X: "twitter",
  YouTube: "youtube",
  Pinterest: "pinterest",
  Snapchat: "snapchat",
  Threads: "threads",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  linkedin: "linkedin",
  twitter: "twitter",
  youtube: "youtube",
  pinterest: "pinterest",
  snapchat: "snapchat",
  threads: "threads",
};

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

type TabId = "calendar" | "compose" | "queue" | "ideas" | "approvals" | "automate" | "inbox";

const STATUS_COLORS: Record<StatusKind, [string, string, string]> = {
  ok: ["#ECFDF5", "#A7F3D0", "#065F46"],
  err: ["#FEF2F2", "#FECACA", "#991B1B"],
  info: ["#FFF7ED", "#FED7AA", "#9A3412"],
};

const TABS: { id: TabId; label: string }[] = [
  { id: "calendar", label: "📅 Calendar" },
  { id: "compose", label: "✍️ Compose" },
  { id: "queue", label: "📋 Queue" },
  { id: "approvals", label: "✅ Approvals" },
  { id: "automate", label: "🔁 Automate" },
  { id: "inbox", label: "💬 Inbox" },
  { id: "ideas", label: "💡 Ideas" },
];

function toDatetimeLocal(isoOrLocal: string): string {
  const d = new Date(isoOrLocal);
  if (isNaN(d.getTime())) return isoOrLocal.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SocialPublisher({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<TabId>("calendar");
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
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [draftMeta, setDraftMeta] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<{ color: string; text: string; html?: boolean } | null>(null);
  const [calRefresh, setCalRefresh] = useState(0);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [bestTimes, setBestTimes] = useState<Array<{ label: string; hour: number; dow: number; default?: boolean }>>([]);

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

  const loadBestTimes = useCallback(async (pid: string) => {
    if (!pid) {
      setBestTimes([]);
      return;
    }
    const r = await apiGet<{
      ok: boolean;
      slots?: Array<{ label: string; hour: number; dow: number; default?: boolean }>;
    }>(`/api/social-publisher/best-times?profileId=${encodeURIComponent(pid)}`);
    if (r.ok) setBestTimes(r.slots || []);
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
    setProfileId((prev) => prev || first);
    setStatusMsg(null);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (profileId) {
      loadAccounts(profileId);
      loadPosts(profileId);
      loadBestTimes(profileId);
    }
  }, [profileId, loadAccounts, loadPosts, loadBestTimes]);

  // One-time import of legacy localStorage Social Calendar posts
  useEffect(() => {
    if (!profileId || typeof window === "undefined") return;
    const flag = `ig-social-drafts-imported:${profileId}`;
    if (localStorage.getItem(flag)) return;
    let raw: unknown = null;
    try {
      const stored = localStorage.getItem("ig-social-posts");
      if (stored) raw = JSON.parse(stored);
    } catch {
      return;
    }
    if (!Array.isArray(raw) || !raw.length) {
      localStorage.setItem(flag, "1");
      return;
    }
    const items = (raw as Array<Record<string, unknown>>).map((p) => {
      const platName = String(p.platform || "");
      const mapped = LEGACY_PLATFORM_MAP[platName] || LEGACY_PLATFORM_MAP[platName.toLowerCase()] || null;
      return {
        text: String(p.caption || p.text || ""),
        platforms: mapped ? [mapped] : [],
        scheduledDate: p.scheduledDate,
        scheduledTime: p.scheduledTime || "09:00",
        funnelStage: p.funnelStage,
        archetypeId: p.archetypeId,
      };
    }).filter((x) => x.text);
    if (!items.length) {
      localStorage.setItem(flag, "1");
      return;
    }
    (async () => {
      const r = await apiPost<{ ok: boolean; created?: number; error?: string }>("/api/social-drafts/bulk", {
        profileId,
        items,
      });
      if (r.ok) {
        localStorage.setItem(flag, "1");
        setImportNote(`Imported ${r.created || items.length} planned posts from the legacy Social Calendar.`);
        setCalRefresh((n) => n + 1);
      }
    })();
  }, [profileId]);

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

  function applyBestTime(slot: { dow: number; hour: number }) {
    const d = new Date();
    const diff = (slot.dow - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    d.setHours(slot.hour, 0, 0, 0);
    setSchedule(toDatetimeLocal(d.toISOString()));
  }

  async function saveDraft(andPublish = false) {
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
    setResult({ color: "#6B7280", text: andPublish ? "📤 Saving & publishing…" : "💾 Saving draft…" });

    const body: Record<string, unknown> = {
      profileId,
      text: t,
      platforms,
      meta: draftMeta,
    };
    if (schedule) body.scheduled_for = new Date(schedule).toISOString();
    if (m) body.media_urls = [m];

    let draftId = editingDraftId;
    if (editingDraftId) {
      const pr = await apiPatch<{ ok: boolean; error?: string; draft?: SocialDraft }>(
        `/api/social-drafts/${editingDraftId}`,
        body,
      );
      if (!pr.ok) {
        setResult({ color: "#991B1B", text: `❌ ${pr.error}` });
        return;
      }
      draftId = editingDraftId;
    } else {
      const r = await apiPost<{ ok: boolean; error?: string; draft?: SocialDraft }>("/api/social-drafts", body);
      if (!r.ok || !r.draft) {
        setResult({ color: "#991B1B", text: `❌ ${r.error || "save failed"}` });
        return;
      }
      draftId = r.draft.id;
      setEditingDraftId(draftId);
    }

    if (andPublish && draftId) {
      const pub = await apiPost<{ ok: boolean; error?: string; scheduled?: boolean }>(
        `/api/social-drafts/${draftId}/publish`,
        {},
      );
      if (!pub.ok) {
        setResult({ color: "#991B1B", html: true, text: `❌ ${pub.error}` });
        return;
      }
      setResult({
        color: "#065F46",
        html: true,
        text: `✅ ${pub.scheduled ? "Scheduled" : "Published"} to ${platforms.length} platform${platforms.length > 1 ? "s" : ""}!`,
      });
      setText("");
      setSchedule("");
      setMedia("");
      setSelected(new Set());
      setEditingDraftId(null);
      setDraftMeta({});
      setTimeout(() => loadPosts(profileId), 700);
    } else {
      setResult({ color: "#065F46", text: `✅ Draft saved (#${draftId}).` });
    }
    setCalRefresh((n) => n + 1);
  }

  async function submitForApproval() {
    // Ensure draft exists then submit
    const t = text.trim();
    const platforms = Array.from(selected);
    if (!profileId || (!t && !media.trim()) || !platforms.length) {
      setResult({ color: "#991B1B", text: "⚠ Profile, text, and platforms required." });
      return;
    }
    setResult({ color: "#6B7280", text: "Submitting for approval…" });
    let draftId = editingDraftId;
    const body: Record<string, unknown> = {
      profileId,
      text: t,
      platforms,
      meta: draftMeta,
    };
    if (schedule) body.scheduled_for = new Date(schedule).toISOString();
    if (media.trim()) body.media_urls = [media.trim()];

    if (draftId) {
      const pr = await apiPatch<{ ok: boolean; error?: string }>(`/api/social-drafts/${draftId}`, body);
      if (!pr.ok) {
        setResult({ color: "#991B1B", text: `❌ ${pr.error}` });
        return;
      }
    } else {
      const r = await apiPost<{ ok: boolean; error?: string; draft?: SocialDraft }>("/api/social-drafts", body);
      if (!r.ok || !r.draft) {
        setResult({ color: "#991B1B", text: `❌ ${r.error || "save failed"}` });
        return;
      }
      draftId = r.draft.id;
      setEditingDraftId(draftId);
    }

    const sub = await apiPost<{
      ok: boolean;
      error?: string;
      hint?: string;
      draft?: SocialDraft;
      self_heal?: { passed?: boolean; final_verdict?: string; attempts?: unknown[] };
    }>(`/api/social-drafts/${draftId}/submit-approval`, {});
    if (!sub.ok) {
      if (sub.error === "self_heal_failed") {
        if (sub.draft?.text) setText(sub.draft.text);
        setResult({
          color: "#991B1B",
          text: `❌ Self-heal blocked submit (${sub.self_heal?.final_verdict || "fail"}). Edit the caption, run Self-heal, or fix claims manually.`,
        });
        return;
      }
      setResult({ color: "#991B1B", text: `❌ ${sub.error}` });
      return;
    }
    const healNote = sub.self_heal
      ? ` · self-heal ${sub.self_heal.passed ? "passed" : sub.self_heal.final_verdict || "caution"}`
      : "";
    if (sub.draft?.text && sub.draft.text !== t) setText(sub.draft.text);
    setResult({ color: "#9A3412", text: `✅ Submitted for approval (draft #${draftId})${healNote}.` });
    setCalRefresh((n) => n + 1);
    setTab("approvals");
  }

  async function runSelfHeal() {
    const t = text.trim();
    if (!profileId || !t) {
      setResult({ color: "#991B1B", text: "⚠ Profile and text required for self-heal." });
      return;
    }
    setResult({ color: "#6B7280", text: "Running self-heal (verify → fix → re-verify)…" });
    let draftId = editingDraftId;
    if (!draftId) {
      const r = await apiPost<{ ok: boolean; error?: string; draft?: SocialDraft }>("/api/social-drafts", {
        profileId,
        text: t,
        platforms: Array.from(selected).length ? Array.from(selected) : ["instagram"],
        meta: draftMeta,
      });
      if (!r.ok || !r.draft) {
        setResult({ color: "#991B1B", text: `❌ ${r.error || "save failed"}` });
        return;
      }
      draftId = r.draft.id;
      setEditingDraftId(draftId);
    } else {
      await apiPatch(`/api/social-drafts/${draftId}`, { text: t, profileId, platforms: Array.from(selected), meta: draftMeta });
    }
    const heal = await apiPost<{
      ok: boolean;
      error?: string;
      draft?: SocialDraft;
      self_heal?: { passed?: boolean; final_verdict?: string; text?: string; attempts?: unknown[] };
    }>(`/api/social-drafts/${draftId}/self-heal`, {});
    if (!heal.ok) {
      setResult({ color: "#991B1B", text: `❌ ${heal.error || "self-heal failed"}` });
      return;
    }
    if (heal.draft?.text) setText(heal.draft.text);
    else if (heal.self_heal?.text) setText(heal.self_heal.text);
    const v = heal.self_heal?.final_verdict || (heal.self_heal?.passed ? "pass" : "caution");
    setResult({
      color: heal.self_heal?.passed ? "#065F46" : v === "fail" ? "#991B1B" : "#92400E",
      text: `🩹 Self-heal ${heal.self_heal?.passed ? "passed" : v} (${heal.self_heal?.attempts?.length || 0} attempt(s)).`,
    });
    setCalRefresh((n) => n + 1);
  }

  async function publishDirect() {
    // Legacy path: post straight to Zernio without draft (still available)
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
    // Also keep a draft record for calendar visibility
    await apiPost("/api/social-drafts", {
      profileId,
      text: t,
      platforms,
      media_urls: m ? [m] : [],
      scheduled_for: schedule ? new Date(schedule).toISOString() : null,
      status: schedule ? "scheduled" : "published",
      meta: { ...draftMeta, direct_publish: true },
    }).catch(() => null);
    setResult({
      color: "#065F46",
      html: true,
      text: `✅ ${r.scheduled ? "Scheduled" : "Published"} to ${platforms.length} platform${platforms.length > 1 ? "s" : ""}!`,
    });
    setText("");
    setSchedule("");
    setMedia("");
    setSelected(new Set());
    setEditingDraftId(null);
    setDraftMeta({});
    setCalRefresh((n) => n + 1);
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

  function loadDraftIntoCompose(d: SocialDraft) {
    setText(d.text || "");
    setSchedule(d.scheduled_for ? toDatetimeLocal(d.scheduled_for) : "");
    setMedia((d.media_urls || [])[0] || "");
    setSelected(new Set(d.platforms || []));
    setEditingDraftId(d.id);
    setDraftMeta(d.meta || {});
    setTab("compose");
    setResult({ color: "#1E40AF", text: `Editing draft #${d.id}` });
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
      {!embedded ? (
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> Social Publisher
              </div>
              <h2 className="view-title">📤 Social Publisher</h2>
              <p className="view-sub">
                Plan on the calendar, generate AI captions, and publish across 15 platforms — one surface powered by Zernio.
              </p>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      <div className="container" style={{ paddingTop: embedded ? 8 : 24, paddingBottom: 56 }}>
        {embedded ? (
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "#0F766E" }}>
            Social Publisher
          </div>
        ) : null}
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
                Unified calendar · drafts · Zernio · 15 platforms
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
              <button onClick={newProfile} style={headerBtnGhost}>＋ New profile</button>
              <button onClick={test} style={headerBtnSolid}>⚡ Test connection</button>
            </div>
          </div>
          {status && statusColor && (
            <div style={{ padding: "10px 20px", background: statusColor[0], borderBottom: `1px solid ${statusColor[1]}`, color: statusColor[2], fontSize: "0.78rem" }}>
              {status.msg}
            </div>
          )}
          {importNote && (
            <div style={{ padding: "10px 20px", background: "#ECFDF5", borderBottom: "1px solid #A7F3D0", color: "#065F46", fontSize: "0.78rem", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{importNote}</span>
              <button type="button" onClick={() => setImportNote(null)} style={{ background: "transparent", border: "none", color: "#065F46", fontWeight: 800, cursor: "pointer" }}>✕</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #E5E7EB", overflowX: "auto" }}>
            {TABS.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  style={{
                    background: on ? "#FFF7ED" : "transparent",
                    border: "none",
                    borderBottom: on ? "2px solid #FF5722" : "2px solid transparent",
                    color: on ? "#0b5f59" : "#6B7280",
                    padding: "12px 18px",
                    fontSize: "0.8rem",
                    fontWeight: 800,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === "calendar" && (
          <SocialCalendarView
            profileId={profileId}
            platforms={SP_PLATFORMS}
            refreshKey={calRefresh}
            onComposeForDate={(iso) => {
              setSchedule(toDatetimeLocal(iso));
              setEditingDraftId(null);
              setTab("compose");
            }}
            onEditDraft={loadDraftIntoCompose}
          />
        )}

        {tab === "ideas" && (
          <SocialIdeasPanel
            platforms={SP_PLATFORMS}
            onUseCaption={({ text: caption, platforms: plats, meta }) => {
              setText(caption);
              setSelected(new Set(plats));
              setDraftMeta(meta);
              setEditingDraftId(null);
              setTab("compose");
              setResult({ color: "#1E40AF", text: "Caption loaded into Compose — save as draft or publish." });
            }}
          />
        )}

        {tab === "approvals" && (
          <SocialApprovalsPanel
            refreshKey={calRefresh}
            onEditDraft={loadDraftIntoCompose}
          />
        )}

        {tab === "automate" && (
          <SocialAutomationPanel
            profileId={profileId}
            platforms={SP_PLATFORMS}
            draftText={text}
            draftPlatforms={Array.from(selected)}
          />
        )}

        {tab === "inbox" && <SocialInboxPanel />}

        {tab === "compose" && (
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
                    No accounts connected yet. Use &quot;＋ Connect a new platform&quot; below.
                  </div>
                ) : (
                  accounts.map((a, i) => {
                    const plat = (a.platform || "").toLowerCase();
                    const meta = SP_PLATFORMS.find((p) => p.id === plat) || { icon: "•", label: plat, id: plat };
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, marginBottom: 5 }}>
                        <div>
                          <span style={{ fontSize: "0.95rem" }}>{meta.icon}</span>{" "}
                          <strong style={{ color: "#0A1628" }}>{meta.label}</strong> ·{" "}
                          <span style={{ color: "#6B7280", fontSize: "0.78rem" }}>{a.username || a.handle || a.name || a._id || a.id || ""}</span>
                        </div>
                        <span style={{ background: "#ECFDF5", color: "#065F46", padding: "2px 7px", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700 }}>connected</span>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
                <div style={{ fontSize: "0.78rem", color: "#374151", fontWeight: 700, marginBottom: 8 }}>＋ Connect a new platform</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SP_PLATFORMS.map((p) => (
                    <button key={p.id} onClick={() => connect(p.id)} title={`Connect ${p.label}`} style={{ background: "#FFF", border: "1px solid #E5E7EB", color: "#374151", padding: "6px 10px", borderRadius: 6, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
                      {p.icon} {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
              <h3 style={{ margin: "0 0 10px", color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
                ✍️ Compose {editingDraftId ? <span style={{ fontSize: "0.72rem", color: "#FF5722" }}>· draft #{editingDraftId}</span> : null}
              </h3>
              <textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What do you want to post?"
                style={{ width: "100%", padding: 10, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.82rem", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
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
              {bestTimes.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700, marginBottom: 6 }}>⏰ BEST TIMES</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {bestTimes.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => applyBestTime(s)}
                        style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF", padding: "5px 9px", borderRadius: 6, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        {s.label}{s.default ? " · default" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <div>
                  <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700, marginBottom: 4 }}>📅 SCHEDULE FOR</div>
                  <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} style={{ width: "100%", padding: 7, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.74rem", color: "#6B7280", fontWeight: 700, marginBottom: 4 }}>🖼 MEDIA URL</div>
                  <input type="url" value={media} onChange={(e) => setMedia(e.target.value)} placeholder="https://example.com/image.jpg" style={{ width: "100%", padding: 7, border: "1px solid #D1D5DB", borderRadius: 6, fontSize: "0.78rem", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                <button onClick={() => saveDraft(false)} style={{ background: "#F3F4F6", color: "#0A1628", border: "1px solid #E5E7EB", padding: 11, borderRadius: 8, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}>
                  💾 Save draft
                </button>
                <button onClick={runSelfHeal} style={{ background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0", padding: 11, borderRadius: 8, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}>
                  🩹 Self-heal
                </button>
                <button onClick={submitForApproval} style={{ background: "#f3f6fb", color: "#0b5f59", border: "1px solid #FDBA74", padding: 11, borderRadius: 8, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}>
                  ✅ Submit for approval
                </button>
                <button onClick={() => saveDraft(true)} style={{ background: "linear-gradient(135deg,#0D9488 0%,#14B8A6 100%)", color: "#fff", border: "none", padding: 11, borderRadius: 8, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}>
                  📤 Save &amp; publish
                </button>
                <button onClick={publishDirect} style={{ background: "linear-gradient(135deg,#FF5722 0%,#FF7043 100%)", color: "#fff", border: "none", padding: 11, borderRadius: 8, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer", gridColumn: "1 / -1" }}>
                  ⚡ Publish now
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: "0.78rem" }}>
                {result && (
                  <div style={{ background: result.color === "#065F46" ? "#ECFDF5" : result.color === "#1E40AF" ? "#EFF6FF" : "#FEF2F2", border: "1px solid #E5E7EB", color: result.color, padding: 10, borderRadius: 6 }}>
                    {result.text}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "queue" && (
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
                📋 Scheduled &amp; recent posts (Zernio)
              </h3>
              <button onClick={() => loadPosts(profileId)} style={{ background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151", padding: "5px 10px", borderRadius: 5, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>
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
                          <span style={{ background: sc[0], color: sc[1], padding: "2px 8px", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700, flexShrink: 0 }}>{st}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: "0.72rem", color: "#6B7280", flexWrap: "wrap" }}>
                          <div>
                            {plats.map((pl) => {
                              const m = SP_PLATFORMS.find((x) => x.id === String(pl).toLowerCase());
                              return m ? `${m.icon} ${m.label}` : String(pl);
                            }).join(" · ")}
                            {when ? " · " + new Date(when).toLocaleString() : ""}
                          </div>
                          {id && (st === "scheduled" || st === "draft") ? (
                            <button onClick={() => deletePost(id)} style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", padding: "3px 8px", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>
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
        )}
      </div>
    </div>
  );
}

const headerBtnGhost: CSSProperties = {
  background: "rgba(255,255,255,.18)",
  border: "1px solid rgba(255,255,255,.3)",
  color: "#fff",
  padding: "7px 12px",
  borderRadius: 6,
  fontSize: "0.74rem",
  fontWeight: 700,
  cursor: "pointer",
};

const headerBtnSolid: CSSProperties = {
  background: "#fff",
  color: "#FF5722",
  border: "none",
  padding: "7px 14px",
  borderRadius: 6,
  fontSize: "0.74rem",
  fontWeight: 800,
  cursor: "pointer",
};
