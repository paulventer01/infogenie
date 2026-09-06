"use client";

// Native React port of the legacy `roadmap` panel (was `window.buildRoadmap` +
// `#view-roadmap` in app.js / index.html). Renders the 90-day plan, weekly
// social cadence and five principles against the existing Express API
// (`GET /api/roadmap/catalog`, `GET /api/roadmap/progress`,
// `POST|DELETE /api/roadmap/progress/:id`, `POST /api/roadmap/reset`) via
// `lib/api`. Cross-tool links use `goToView`. See
// `docs/react-panel-migration.md`.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { showToast } from "@/hooks/useToast";

interface PlanTask {
  id: string;
  day: number;
  focus: string;
  learn: string;
  action: string;
  view?: string;
  viewLabel?: string;
}
interface CadenceDay {
  day: string;
  task: string;
}
interface CadencePlatform {
  name: string;
  icon: string;
  color: string;
  days: CadenceDay[];
  key?: string;
  connected?: boolean;
}
interface Principle {
  label: string;
  icon: string;
  body: string;
}
interface CatalogResult {
  ok?: boolean;
  error?: string;
  plan?: PlanTask[];
  socialCadence?: Record<string, CadencePlatform>;
  principles?: Principle[];
}
interface ProgressResult {
  ok?: boolean;
  error?: string;
  completed?: Record<string, string>;
}

type Tab = "plan" | "cadence" | "principles";
type Filter = "ALL" | "SEO" | "SMM" | "PPC";

const FOCUS_COLOR: Record<string, string> = { SEO: "#0891B2", SMM: "#EC4899", PPC: "#0f766e" };
const PRINCIPLE_LINK: Record<string, { view: string; label: string }> = {
  PLAN: { view: "content-calendar", label: "Open Content Calendar" },
  CREATE: { view: "creative", label: "Open Creative Studio" },
  ENGAGE: { view: "unified-inbox", label: "Open Unified Inbox" },
  ANALYZE: { view: "cross-channel", label: "Open Cross-Channel Report" },
  GROW: { view: "campaigns", label: "Open Campaigns" },
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const LS_EXTRA_CHANNELS = "ig-roadmap-extra-channels-v1";

/** Extra channels the user can add beyond the catalog defaults. */
const ADDABLE_CHANNELS: Record<
  string,
  { name: string; icon: string; color: string; platformId: string; tasks: string[] }
> = {
  tiktok: {
    name: "TikTok",
    icon: "🎵",
    color: "#111111",
    platformId: "tiktok",
    tasks: ["Short Video", "Trending Sound Clip", "Duets / Stitches", "Stories", "Educational Clip", "Behind-the-Scenes", "Weekly Recap Reel"],
  },
  youtube: {
    name: "YouTube",
    icon: "▶️",
    color: "#FF0000",
    platformId: "youtube",
    tasks: ["Shorts", "Community Post", "Long-form Publish / Promo", "Shorts", "Community Engagement", "Thumbnail A/B", "Weekly Recap Short"],
  },
  twitter: {
    name: "Twitter/X",
    icon: "𝕏",
    color: "#0F1419",
    platformId: "twitter",
    tasks: ["Thread / Insight", "Engagement replies", "Link Post", "Poll / Question", "Industry News", "Community engagement", "Weekly Recap"],
  },
  threads: {
    name: "Threads",
    icon: "@",
    color: "#101010",
    platformId: "threads",
    tasks: ["Feed Post", "Reply engagement", "Carousel text", "Hot take", "Behind-the-scenes", "Community replies", "Weekly Recap"],
  },
  pinterest: {
    name: "Pinterest",
    icon: "📌",
    color: "#E60023",
    platformId: "pinterest",
    tasks: ["Idea Pin", "Static Pin", "Board curation", "Idea Pin", "Product / Offer Pin", "Inspiration board", "Weekly Recap Pin"],
  },
  bluesky: {
    name: "Bluesky",
    icon: "🦋",
    color: "#0085FF",
    platformId: "bluesky",
    tasks: ["Feed Post", "Engagement", "Thread", "Link share", "Community reply", "Light post", "Weekly Recap"],
  },
};

function defaultDays(tasks: string[]): CadenceDay[] {
  return DAYS.map((day, i) => ({ day, task: tasks[i % tasks.length] }));
}

function loadExtraChannels(): Record<string, CadencePlatform> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_EXTRA_CHANNELS) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveExtraChannels(map: Record<string, CadencePlatform>) {
  try {
    localStorage.setItem(LS_EXTRA_CHANNELS, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

export default function Roadmap() {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanTask[]>([]);
  const [cadence, setCadence] = useState<Record<string, CadencePlatform>>({});
  const [principles, setPrinciples] = useState<Principle[]>([]);
  const [completed, setCompleted] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("plan");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState("");
  const [inflight, setInflight] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectMsg, setConnectMsg] = useState("");

  async function load() {
    setStatus("loading");
    const [cat, prog] = await Promise.all([
      apiGet<CatalogResult>("/api/roadmap/catalog"),
      apiGet<ProgressResult>("/api/roadmap/progress"),
    ]);
    if (cat.error) {
      setStatus("error");
      setError(cat.error);
      return;
    }
    const base: Record<string, CadencePlatform> = {};
    Object.entries(cat.socialCadence || {}).forEach(([k, v]) => {
      base[k] = { ...v, key: k };
    });
    const extras = typeof window !== "undefined" ? loadExtraChannels() : {};
    setCadence({ ...base, ...extras });
    setPlan(Array.isArray(cat.plan) ? cat.plan : []);
    setPrinciples(Array.isArray(cat.principles) ? cat.principles : []);
    setCompleted(prog.completed || {});
    setStatus("idle");
  }

  useEffect(() => {
    load();
  }, []);

  const availableToAdd = useMemo(() => {
    return Object.entries(ADDABLE_CHANNELS).filter(([key]) => !cadence[key]);
  }, [cadence]);

  async function ensurePublisherProfile(): Promise<string | null> {
    const pr = await apiGet<{ ok?: boolean; profiles?: { _id?: string; id?: string; name?: string }[]; error?: string }>(
      "/api/social-publisher/profiles",
    );
    const list = pr.profiles || [];
    if (list.length) {
      return String(list[0]._id || list[0].id || "");
    }
    const created = await apiPost<{ ok?: boolean; error?: string; profile?: { _id?: string; id?: string } }>(
      "/api/social-publisher/profiles",
      { name: "Primary Social Profile" },
    );
    if (created.ok === false) {
      showToast(created.error || "Could not create publisher profile");
      return null;
    }
    const again = await apiGet<{ profiles?: { _id?: string; id?: string }[] }>("/api/social-publisher/profiles");
    const first = (again.profiles || [])[0];
    return first ? String(first._id || first.id || "") : null;
  }

  async function connectPlatform(platformId: string, label: string) {
    setConnecting(platformId);
    setConnectMsg(`Preparing ${label} connection…`);
    try {
      const profileId = await ensurePublisherProfile();
      if (!profileId) {
        setConnectMsg("Could not prepare a publisher profile. Open Social Publisher to finish setup.");
        return;
      }
      setConnectMsg(`Opening ${label} authorization — approve access, then you’re done.`);
      const r = await apiPost<{ ok?: boolean; error?: string; authUrl?: { url?: string } | string }>(
        "/api/social-publisher/connect-url",
        { platform: platformId, profileId },
      );
      if (r.ok === false) {
        setConnectMsg(r.error || "Connect URL failed");
        showToast(r.error || "Could not start channel connect");
        return;
      }
      const url = typeof r.authUrl === "object" && r.authUrl ? r.authUrl.url : r.authUrl;
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        window.open(url, "_blank", "noopener");
        setConnectMsg(`${label} auth opened in a new tab. Approve once — InfoGenie handles the rest.`);
        showToast(`${label}: approve access in the new tab`);
      } else {
        setConnectMsg("No auth URL returned. Check Social Publisher integrations in Settings.");
        showToast("No OAuth URL — check Social Publisher setup");
      }
    } finally {
      setConnecting(null);
    }
  }

  async function addChannel(key: string) {
    const def = ADDABLE_CHANNELS[key];
    if (!def) return;
    const entry: CadencePlatform = {
      key,
      name: def.name,
      icon: def.icon,
      color: def.color,
      days: defaultDays(def.tasks),
      connected: false,
    };
    setCadence((prev) => {
      const next = { ...prev, [key]: entry };
      const extras: Record<string, CadencePlatform> = {};
      Object.entries(next).forEach(([k, v]) => {
        if (ADDABLE_CHANNELS[k]) extras[k] = v;
      });
      saveExtraChannels(extras);
      return next;
    });
    setAddOpen(false);
    showToast(`${def.name} added to your weekly cadence`);
    // Minimal intervention: immediately start OAuth connect.
    await connectPlatform(def.platformId, def.name);
  }

  function removeExtraChannel(key: string) {
    if (!ADDABLE_CHANNELS[key]) return;
    if (!confirm(`Remove ${cadence[key]?.name || key} from your weekly cadence?`)) return;
    setCadence((prev) => {
      const next = { ...prev };
      delete next[key];
      const extras: Record<string, CadencePlatform> = {};
      Object.entries(next).forEach(([k, v]) => {
        if (ADDABLE_CHANNELS[k]) extras[k] = v;
      });
      saveExtraChannels(extras);
      return next;
    });
  }

  async function toggle(taskId: string, checked: boolean) {
    if (inflight.has(taskId)) return;
    setInflight((s) => new Set(s).add(taskId));
    const path = "/api/roadmap/progress/" + encodeURIComponent(taskId);
    const r = checked ? await apiPost(path) : await apiDelete(path);
    setInflight((s) => {
      const n = new Set(s);
      n.delete(taskId);
      return n;
    });
    if (r.ok === false) {
      alert("⚠️ Could not save: " + (r.error || "unknown error"));
      return;
    }
    setCompleted((c) => {
      const n = { ...c };
      if (checked) n[taskId] = new Date().toISOString();
      else delete n[taskId];
      return n;
    });
  }

  async function reset() {
    if (!confirm("Reset all 90-day progress? This cannot be undone.")) return;
    const r = await apiPost("/api/roadmap/reset");
    if (r.ok === false) {
      alert("⚠️ Could not reset: " + (r.error || "unknown error"));
      return;
    }
    setCompleted({});
  }

  const total = plan.length || 90;
  const done = Object.keys(completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const filteredPlan = filter === "ALL" ? plan : plan.filter((p) => p.focus === filter);

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "10px 18px",
        border: "none",
        background: tab === id ? "#0066FF" : "#E2E8F0",
        color: tab === id ? "white" : "#0F172A",
        fontWeight: 700,
        borderRadius: 10,
        cursor: "pointer",
        marginRight: 8,
      }}
    >
      {label}
    </button>
  );

  const filterBtn = (f: Filter, label: string, color: string) => (
    <button
      onClick={() => setFilter(f)}
      style={{
        padding: "7px 14px",
        border: `1px solid ${filter === f ? color : "#CBD5E1"}`,
        background: filter === f ? color : "white",
        color: filter === f ? "white" : "#475569",
        borderRadius: 999,
        fontSize: "0.78rem",
        fontWeight: 700,
        cursor: "pointer",
        marginRight: 6,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Analyse</span>{" "}
                <span className="bc-sep">›</span> Roadmap
              </div>
              <h2 className="view-title">🗺️ 90-Day Marketing Roadmap</h2>
              <p className="view-sub">
                Stop reading SEO articles. Click each task — InfoGenie does the
                actual work.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {status === "loading" && (
          <div style={{ padding: 48, textAlign: "center", color: "#64748B" }}>⏳ Loading your roadmap…</div>
        )}
        {status === "error" && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14, padding: 24, color: "#991B1B" }}>
            ⚠️ Could not load: {error}
          </div>
        )}
        {status === "idle" && (
          <>
            <div style={{ background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", borderRadius: 18, padding: "28px 32px", color: "#0f172a", boxShadow: "0 8px 28px rgba(15,23,42,.35)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                <span style={{ fontSize: "1.4rem" }}>🗺️</span>
                <div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>Your 90-Day Marketing Roadmap</div>
                  <div style={{ fontSize: "0.78rem", color: "#475569", marginTop: 2 }}>
                    Click each task — InfoGenie does the actual work.
                  </div>
                </div>
                <button onClick={reset} style={{ marginLeft: "auto", background: "rgba(255,255,255,.1)", color: "white", border: "1px solid rgba(255,255,255,.2)", padding: "8px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                  ↻ Reset progress
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1, color: "#0f172a" }}>
                  {done}
                  <span style={{ color: "#475569", fontSize: "1.4rem" }}>/{total}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ background: "rgba(255,255,255,.1)", borderRadius: 999, height: 14, overflow: "hidden" }}>
                    <div style={{ background: "linear-gradient(90deg,#34D399,#0066FF)", width: `${pct}%`, height: "100%", transition: "width .4s" }} />
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 6 }}>{pct}% complete</div>
                </div>
              </div>
            </div>

            <div style={{ margin: "24px 0 16px" }}>
              {tabBtn("plan", "📅 90-Day Plan")}
              {tabBtn("cadence", "📲 Weekly Social Cadence")}
              {tabBtn("principles", "🧭 Five Principles")}
            </div>

            {tab === "plan" && (
              <div>
                <div style={{ marginBottom: 14 }}>
                  {filterBtn("ALL", "All 90 days", "#0066FF")}
                  {filterBtn("SEO", "SEO (Days 1-30)", "#0891B2")}
                  {filterBtn("SMM", "Social (Days 31-60)", "#EC4899")}
                  {filterBtn("PPC", "Paid Ads (Days 61-90)", "#0f766e")}
                </div>
                {filteredPlan.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", color: "#64748B" }}>No tasks in this filter.</div>
                ) : (
                  filteredPlan.map((p) => {
                    const isDone = !!completed[p.id];
                    const fc = FOCUS_COLOR[p.focus] || "#64748B";
                    return (
                      <div
                        key={p.id}
                        style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px", background: isDone ? "#F0FDF4" : "white", border: `1px solid ${isDone ? "#BBF7D0" : "#E2E8F0"}`, borderRadius: 12, marginBottom: 8 }}
                      >
                        <input type="checkbox" checked={isDone} onChange={(e) => toggle(p.id, e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, cursor: "pointer", accentColor: "#10B981" }} />
                        <div style={{ flex: "0 0 56px", textAlign: "center" }}>
                          <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#94A3B8", letterSpacing: ".5px" }}>DAY</div>
                          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0F172A", lineHeight: 1 }}>{p.day}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ background: fc, color: "white", padding: "2px 8px", borderRadius: 6, fontSize: "0.65rem", fontWeight: 700, letterSpacing: ".5px" }}>{p.focus}</span>
                            <span style={{ fontWeight: 700, color: "#0F172A", textDecoration: isDone ? "line-through" : "none", opacity: isDone ? 0.6 : 1 }}>{p.learn}</span>
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "#475569", opacity: isDone ? 0.6 : 1 }}>{p.action}</div>
                        </div>
                        {p.view && (
                          <button onClick={() => goToView(router, p.view as string)} style={{ flex: "0 0 auto", background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", padding: "8px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            {p.viewLabel || "Open"} →
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "cadence" && (
              <div>
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "14px 18px", marginBottom: 14, fontSize: "0.88rem", color: "#1E3A8A", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 280px" }}>
                    💡 A recommended weekly cadence — balancing reach, engagement and authority. Add more channels anytime; we’ll open a one-click connect so you barely lift a finger.
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    style={{
                      background: "linear-gradient(135deg,#0f766e,#0284c7)",
                      color: "#fff",
                      border: "none",
                      padding: "10px 14px",
                      borderRadius: 10,
                      fontWeight: 800,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    + Add Channel
                  </button>
                </div>

                {connectMsg && (
                  <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: "0.82rem", fontWeight: 600 }}>
                    {connecting ? "⏳ " : "✅ "}{connectMsg}
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
                  {Object.entries(cadence).map(([key, p]) => (
                    <div key={key} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 14, padding: 18, flex: 1, minWidth: 240, position: "relative" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: `linear-gradient(135deg,${p.color},${p.color}99)`, color: "white", padding: "10px 14px", borderRadius: 10, margin: "-18px -18px 12px" }}>
                        <span style={{ fontSize: "1.2rem" }}>{p.icon}</span>
                        <span style={{ fontWeight: 800, letterSpacing: ".5px" }}>{String(p.name).toUpperCase()}</span>
                        {ADDABLE_CHANNELS[key] && (
                          <button
                            type="button"
                            title="Remove channel"
                            onClick={() => removeExtraChannel(key)}
                            style={{ marginLeft: "auto", background: "rgba(255,255,255,.18)", border: "1px solid rgba(255,255,255,.35)", color: "#fff", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontWeight: 800 }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {p.days.map((d, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: i === p.days.length - 1 ? "none" : "1px solid #F1F5F9" }}>
                          <span style={{ background: `linear-gradient(135deg,${p.color},${p.color}99)`, color: "white", width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.78rem", marginRight: 12 }}>{d.day[0]}</span>
                          <span style={{ fontSize: "0.88rem", color: "#0F172A" }}>{d.task}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => goToView(router, "social-publisher")} style={{ flex: 1, background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", padding: "8px 10px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}>📤 Schedule in Publisher</button>
                          <button onClick={() => goToView(router, "content-calendar")} style={{ flex: 1, background: "#F1F5F9", color: "#0F172A", border: "1px solid #CBD5E1", padding: "8px 10px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}>📅 Plan in Calendar</button>
                        </div>
                        <button
                          type="button"
                          disabled={!!connecting}
                          onClick={() => {
                            const platformId = ADDABLE_CHANNELS[key]?.platformId || key;
                            void connectPlatform(platformId, p.name);
                          }}
                          style={{ width: "100%", background: "#fff", color: "#0f766e", border: "1.5px solid rgba(15,118,110,.35)", padding: "8px 10px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 800, cursor: connecting ? "wait" : "pointer" }}
                        >
                          {connecting === (ADDABLE_CHANNELS[key]?.platformId || key) ? "Connecting…" : "🔗 Connect / Reconnect channel"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Dashed add card */}
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    style={{
                      flex: 1,
                      minWidth: 240,
                      minHeight: 220,
                      border: "2px dashed rgba(15,118,110,.35)",
                      borderRadius: 14,
                      background: "linear-gradient(180deg,#f0fdfa,#eff6ff)",
                      color: "#0f766e",
                      fontWeight: 800,
                      fontSize: "0.95rem",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: 18,
                    }}
                  >
                    <span style={{ fontSize: "1.8rem", lineHeight: 1 }}>+</span>
                    Add Channel
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", maxWidth: 200 }}>
                      TikTok, YouTube, X, Threads & more — one-click connect
                    </span>
                  </button>
                </div>

                {addOpen && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Add social channel"
                    onClick={() => setAddOpen(false)}
                    style={{
                      position: "fixed",
                      inset: 0,
                      background: "rgba(15,23,42,.45)",
                      zIndex: 80,
                      display: "grid",
                      placeItems: "center",
                      padding: 16,
                    }}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: "min(560px, 100%)",
                        background: "#fff",
                        borderRadius: 16,
                        border: "1px solid #E2E8F0",
                        boxShadow: "0 24px 60px rgba(15,23,42,.25)",
                        padding: 22,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>Add a channel</h3>
                          <p style={{ margin: "6px 0 0", fontSize: "0.84rem", color: "#64748b", lineHeight: 1.45 }}>
                            Pick a platform. We’ll add a weekly cadence and open the connect screen — you only approve access.
                          </p>
                        </div>
                        <button type="button" onClick={() => setAddOpen(false)} style={{ border: "none", background: "#F1F5F9", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontWeight: 800 }}>×</button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 14 }}>
                        {availableToAdd.length === 0 ? (
                          <div style={{ gridColumn: "1 / -1", padding: 18, textAlign: "center", color: "#64748b", fontSize: "0.88rem" }}>
                            All available channels are already in your cadence.
                          </div>
                        ) : (
                          availableToAdd.map(([key, def]) => (
                            <button
                              key={key}
                              type="button"
                              disabled={!!connecting}
                              onClick={() => void addChannel(key)}
                              style={{
                                textAlign: "left",
                                border: "1px solid #E2E8F0",
                                borderRadius: 12,
                                padding: "12px 12px 14px",
                                background: "#fff",
                                cursor: connecting ? "wait" : "pointer",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: "1.25rem" }}>{def.icon}</span>
                                <span style={{ fontWeight: 800, color: "#0f172a" }}>{def.name}</span>
                              </div>
                              <div style={{ fontSize: "0.72rem", color: "#64748b", lineHeight: 1.4 }}>
                                Adds 7-day plan · then one-click OAuth
                              </div>
                            </button>
                          ))
                        )}
                      </div>

                      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #F1F5F9", fontSize: "0.75rem", color: "#94a3b8" }}>
                        Steps automated for you: create publisher profile (if needed) → generate connect URL → open auth tab. You only click Approve.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "principles" && (
              <div>
                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px 18px", marginBottom: 18, fontSize: "0.88rem", color: "#475569" }}>
                  The 5 principles every social marketer should drill into muscle memory. Tap each card to jump to the InfoGenie tools that help you live by it.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
                  {principles.map((x, i) => {
                    const link = PRINCIPLE_LINK[x.label];
                    return (
                      <div key={i} style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: 14, padding: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: "1.6rem" }}>{x.icon}</span>
                          <span style={{ fontWeight: 800, fontSize: "1.05rem", letterSpacing: ".5px" }}>{x.label}</span>
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#475569", marginBottom: 14, minHeight: 42 }}>{x.body}</div>
                        {link && (
                          <button onClick={() => goToView(router, link.view)} style={{ background: "linear-gradient(135deg,#0066FF,#00C9C8)", color: "white", border: "none", padding: "8px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", width: "100%" }}>
                            {link.label} →
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
