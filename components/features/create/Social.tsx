"use client";

// Native React port of the legacy `social` panel (was `buildSocialCalendar` +
// `openCreatePost` / `_buildSocialAnalytics` / `_buildSocialPublishing` /
// `socialToggleAutoPublish` / `_socialAutoPublishCheck` / `socialPublishNow` in
// public/js/ig_content_social.js + `#view-social` in index.html).
//
// The Social Content Generator, Calendar & Scheduling tool keeps its posts in the
// legacy `window._socialPosts` global, which app.js persists to/from
// localStorage (`ig-social-posts`). This port reads/writes that same global so it
// stays in sync with the rest of the legacy SPA. The only server call is AI
// caption generation: `POST /api/ai-social-caption`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api";

// ── Legacy constants (copied from app.js so the port is self-contained) ───────
interface Platform {
  name: string;
  icon: string;
  color: string;
  bg: string;
}
const SOCIAL_PLATFORMS: Platform[] = [
  { name: "Meta", icon: "📘", color: "#1877F2", bg: "#EBF3FF" },
  { name: "Instagram", icon: "📸", color: "#E1306C", bg: "#FFF0F5" },
  { name: "TikTok", icon: "⬛", color: "#010101", bg: "#F5F5F5" },
  { name: "LinkedIn", icon: "💼", color: "#0A66C2", bg: "#F0F7FF" },
  { name: "X", icon: "✖️", color: "#14171A", bg: "#F5F5F5" },
  { name: "YouTube", icon: "🎬", color: "#FF0000", bg: "#FFF5F5" },
  { name: "Pinterest", icon: "📌", color: "#E60023", bg: "#FFF0F0" },
  { name: "Snapchat", icon: "👻", color: "#FFCC00", bg: "#FFFDE0" },
  { name: "Threads", icon: "🧵", color: "#000000", bg: "#F5F5F5" },
];

interface FunnelStage {
  id: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  fmt: string;
  tip: string;
}
const FUNNEL_STAGES: FunnelStage[] = [
  { id: "awareness", label: "Awareness", icon: "🌱", color: "#10B981", bg: "#ECFDF5", fmt: "Reels", tip: "Story-driven reels, micro-education, trending angles — stop the scroll." },
  { id: "interest", label: "Interest", icon: "💡", color: "#3B82F6", bg: "#EFF6FF", fmt: "Carousels", tip: "Frameworks, before-after, step-by-step tutorials — convert attention to curiosity." },
  { id: "nurture", label: "Nurture", icon: "❤️", color: "#EC4899", bg: "#FDF2F8", fmt: "Stories", tip: "Process sharing, myth-breaking, polls, soft CTAs — build belief & trust." },
  { id: "conversion", label: "Conversion", icon: "💰", color: "#F59E0B", bg: "#FFFBEB", fmt: "DMs", tip: "Personalised DMs, testimonials, limited-spot urgency — turn trust into sales." },
  { id: "advocacy", label: "Advocacy", icon: "🌟", color: "#7C3AED", bg: "#F5F3FF", fmt: "Community", tip: "Client wins, UGC, referrals, private challenges — turn buyers into brand evangelists." },
];

interface Archetype {
  id: string;
  icon: string;
  title: string;
  hint: string;
  starter: string;
  prompt: string;
}
const POST_ARCHETYPES: Record<string, Archetype[]> = {
  awareness: [
    { id: "pattern_interrupt", icon: "🪝", title: "Pattern Interrupt Hook", hint: "POV-style opener that stops the scroll", starter: "POV: ", prompt: 'Write a pattern-interrupt hook caption for {brand} in {industry} starting with "POV:" — open with an uncomfortable truth or counter-intuitive observation about your audience. Keep it 2-3 short punchy lines ending on a cliffhanger. Add 2-3 relevant emojis. No hashtags except 2 niche ones at the end.' },
    { id: "contrarian", icon: "⚡", title: "Contrarian Take", hint: "Challenge a popular belief in your niche", starter: "Unpopular opinion: ", prompt: 'Write a contrarian-take caption for {brand} in {industry} starting with "Unpopular opinion:" — challenge a widely-accepted belief in the space. Back it up with one strong reason in 3-4 lines. Provocative but not insulting. End with a question to spark replies.' },
    { id: "micro_story", icon: "📖", title: "Relatable Micro-Story", hint: "A short personal moment that resonates", starter: "", prompt: 'Write a 2-3 sentence relatable micro-story caption for {brand} in {industry} that ends with a vulnerable admission ("I had X but still felt Y"). Raw and honest, not polished. Add one relatable emoji and a soft CTA.' },
    { id: "niche_callout", icon: "🎯", title: "Niche Call-Out", hint: "Speak directly to a specific sub-audience", starter: "This is for ", prompt: 'Write a niche call-out caption for {brand} in {industry} opening with "This is for [specific sub-audience stuck at a specific stage]" — laser-targeted so they feel seen. 4-5 lines, then a clear next step.' },
  ],
  interest: [
    { id: "if_then", icon: "🧩", title: '"If you\'re X, do Y" Framework', hint: "Diagnostic prescription matching reader to action", starter: "If you're ", prompt: 'Write an "If you\'re X, do Y" framework caption for {brand} in {industry}. Open with a diagnostic statement matching the reader to a specific action ("If you\'re a [role] doing [behaviour], stop and try [action]"). Personalised-prescription tone. 4-6 lines.' },
    { id: "mistake_based", icon: "❌", title: "Mistake-Based Content", hint: "Common error in your space + the fix", starter: "Why your ", prompt: 'Write a mistake-based caption for {brand} in {industry} naming a common error ("Why your X looks good but doesn\'t Y") and revealing the fix in 3-4 educational lines. End with one actionable takeaway.' },
    { id: "positioning", icon: "🎯", title: "Clear Positioning Post", hint: "One-line statement of who you help & how", starter: "I help ", prompt: 'Write a clear positioning caption for {brand} in {industry} opening with "I help [audience] [outcome] through [method]". Crisp, no jargon. Then 2-3 lines on what makes the approach different. End with an invitation.' },
    { id: "proof_story", icon: "📊", title: "Proof-Led Storytelling", hint: "Result-driven mini case study", starter: "How a ", prompt: 'Write a proof-led story caption for {brand} in {industry}: "How a [client type] [achieved specific result] from [single action]". Lead with the outcome, then the mechanism in 2-3 sentences. Specific numbers > vague claims.' },
  ],
  nurture: [
    { id: "bts_thinking", icon: "🔍", title: "Behind-the-Scenes Thinking", hint: "Reveal your process, not just outputs", starter: "How I ", prompt: 'Write a behind-the-scenes thinking caption for {brand} in {industry} revealing the process ("How I structure X for Y"). Show the framework in 3-4 numbered or bulleted steps, not just the result.' },
    { id: "decision_breakdown", icon: "⚖️", title: "Decision Breakdown", hint: "Walk through a real choice you made", starter: "Why we ", prompt: 'Write a decision-breakdown caption for {brand} in {industry}: "Why we [removed/added/changed] X" — show the trade-off, what data/observation drove it, and the lesson. 5-6 honest lines.' },
    { id: "journey_story", icon: "🛤️", title: "Client Journey Story", hint: "From → To, with the messy middle", starter: "From ", prompt: 'Write a client-journey caption for {brand} in {industry}: "From [starting state] → [ending state]". Include the messy middle and one specific turning point. End with the lesson others can apply.' },
    { id: "real_talk", icon: "🗣️", title: "Real Talk Content", hint: "Honest take no one says out loud", starter: "What no one tells you ", prompt: 'Write a real-talk caption for {brand} in {industry} opening "What no one tells you about [topic]". Strip the BS and share the uncomfortable truth in 4-5 lines. End with empathy, not preaching.' },
  ],
  conversion: [
    { id: "situation_cta", icon: "💬", title: "Situation-Based CTA", hint: "DM keyword trigger for warm leads", starter: 'DM "', prompt: 'Write a situation-based CTA caption for {brand} in {industry} ending with "DM [KEYWORD] if [specific situation]". Self-qualifying invitation — not a hard sell. 4-5 lines describing who it\'s for, then the trigger.' },
    { id: "callout_post", icon: "📣", title: "Call-Out Post", hint: "Direct address to your ideal buyer", starter: "If you're tired of ", prompt: 'Write a call-out conversion caption for {brand} in {industry} opening "If you\'re tired of [specific pain]" — name the frustration, show you understand, then offer a clear next step. Empathetic conversion tone.' },
    { id: "micro_offer", icon: "🎁", title: "Micro-Offer", hint: "Low-friction entry product or audit", starter: 'Reply "audit" ', prompt: 'Write a micro-offer caption for {brand} in {industry}: a free or low-friction offer ("Reply \'audit\' and I\'ll review your X"). Make the value crystal-clear in one line, then 2 short lines on what they\'ll get. Urgent but not pushy.' },
    { id: "objection_handle", icon: "🛡️", title: "Objection Handling", hint: "Tackle the #1 reason they hesitate", starter: "You don't need ", prompt: 'Write an objection-handling caption for {brand} in {industry} that flips a common objection ("You don\'t need more X, you need better Y"). Reframe and resolve in 3-4 lines. End with the action that costs them nothing.' },
  ],
  advocacy: [
    { id: "screenshot_proof", icon: "📸", title: "Screenshot-Based Proof", hint: "Real testimonial / DM screenshot caption", starter: "", prompt: "Write a caption to accompany a screenshot of a client win or DM testimonial for {brand} in {industry}. Frame the screenshot — what was the situation, what changed, what they did next. 4-5 lines of social proof." },
    { id: "client_led", icon: "🎤", title: "Client-Led Content", hint: "Hand the mic to a client", starter: "In their words: ", prompt: 'Write a client-led caption for {brand} in {industry} structured as "In their words:" + a quoted client takeaway, then your 1-line response. Authentic and low-ego — let the client be the hero.' },
    { id: "public_win", icon: "🏆", title: "Public Win", hint: "Celebrate a result transparently", starter: "Sharing this because ", prompt: 'Write a public-win caption for {brand} in {industry}: a transparent celebration ("Sharing this because it\'s proof that X works"). Specific numbers, not vague flexes. Credit the client and the system.' },
    { id: "referral_loop", icon: "🔁", title: "Referral Loop", hint: "Invite advocates to bring others in", starter: "If this helped you, ", prompt: "Write a referral-loop caption for {brand} in {industry} inviting current followers to tag/share with one person who needs it. Natural and warm, never pushy. End with what to do if someone tags them back." },
  ],
};

interface Post {
  id: string;
  platform: string;
  caption: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  funnelStage?: string | null;
  archetypeId?: string | null;
  archetypeTitle?: string | null;
  fileName?: string | null;
  createdAt?: string;
  publishedAt?: string;
}

interface AnalysisGlobal {
  url?: string;
  industry?: { name?: string };
}

type SocialTab = "calendar" | "analytics" | "publishing";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── window helpers ────────────────────────────────────────────────────────────
function readPosts(): Post[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as { _socialPosts?: Post[] };
  if (Array.isArray(w._socialPosts)) return w._socialPosts;
  try {
    const raw = localStorage.getItem("ig-social-posts");
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        w._socialPosts = v as Post[];
        return v as Post[];
      }
    }
  } catch {
    /* ignore */
  }
  w._socialPosts = [];
  return [];
}

function persistPosts(posts: Post[]): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { _socialPosts?: Post[] };
  w._socialPosts = posts;
  try {
    localStorage.setItem("ig-social-posts", JSON.stringify(posts));
  } catch {
    /* ignore */
  }
}

function getAnalysis(): AnalysisGlobal {
  if (typeof window === "undefined") return {};
  return (window as unknown as { analysisData?: AnalysisGlobal }).analysisData || {};
}

function toast(msg: string): void {
  if (typeof window === "undefined") return;
  const fn = (window as unknown as { showToast?: (m: string) => void }).showToast;
  if (typeof fn === "function") fn(msg);
}

function platMeta(name: string): Platform {
  return SOCIAL_PLATFORMS.find((p) => p.name === name) || { name, icon: "📣", color: "#6B7280", bg: "#F9FAFB" };
}

// Deterministic hash for seeded sample analytics (mirrors legacy `seed`).
function seed(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Social() {
  const [tab, setTab] = useState<SocialTab>("calendar");
  const [posts, setPosts] = useState<Post[]>([]);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [autoPublish, setAutoPublish] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | undefined>(undefined);

  // Sync helpers wrapping the shared global.
  const refresh = useCallback(() => setPosts([...readPosts()]), []);

  useEffect(() => {
    setPosts([...readPosts()]);
    const w = window as unknown as { _socialViewYear?: number; _socialViewMonth?: number; _autoPublishEnabled?: boolean };
    if (typeof w._socialViewYear === "number") setViewYear(w._socialViewYear);
    if (typeof w._socialViewMonth === "number") setViewMonth(w._socialViewMonth);
    if (typeof w._autoPublishEnabled === "boolean") setAutoPublish(w._autoPublishEnabled);
  }, []);

  // Keep the legacy month globals in sync so re-entering the legacy view matches.
  useEffect(() => {
    const w = window as unknown as { _socialViewYear?: number; _socialViewMonth?: number };
    w._socialViewYear = viewYear;
    w._socialViewMonth = viewMonth;
  }, [viewYear, viewMonth]);

  const mutate = useCallback(
    (next: Post[]) => {
      persistPosts(next);
      setPosts([...next]);
    },
    [],
  );

  const removePost = useCallback(
    (id: string) => {
      mutate(readPosts().filter((p) => p.id !== id));
    },
    [mutate],
  );

  const publishNow = useCallback(
    (id: string) => {
      const list = readPosts();
      const p = list.find((x) => x.id === id);
      if (!p) return;
      p.status = "published";
      p.publishedAt = new Date().toLocaleString();
      mutate(list);
      toast(`🚀 "${(p.caption || "").substring(0, 30)}…" published to ${platMeta(p.platform).name}!`);
    },
    [mutate],
  );

  // Auto-publish engine — checks every 60s and flips due scheduled posts to live.
  useEffect(() => {
    (window as unknown as { _autoPublishEnabled?: boolean })._autoPublishEnabled = autoPublish;
    if (!autoPublish) return;
    const check = () => {
      const list = readPosts();
      const nowDt = new Date();
      let published = 0;
      list.forEach((p) => {
        if (p.status === "scheduled") {
          const dt = new Date(p.scheduledDate + "T" + (p.scheduledTime || "09:00"));
          if (dt <= nowDt) {
            p.status = "published";
            p.publishedAt = nowDt.toLocaleString();
            published++;
          }
        }
      });
      if (published > 0) {
        mutate(list);
        toast(`🚀 Auto-published ${published} post${published > 1 ? "s" : ""} across social platforms!`);
      }
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, [autoPublish, mutate]);

  function toggleAutoPublish() {
    setAutoPublish((v) => {
      const next = !v;
      toast(next ? "✅ Auto-publish enabled — posts will go live at their scheduled time" : "⏸ Auto-publish paused");
      return next;
    });
  }

  function openCreate(date?: string) {
    setModalDate(date);
    setModalOpen(true);
  }

  function onSaved() {
    setModalOpen(false);
    refresh();
  }

  const tabs: { id: SocialTab; icon: string; label: string }[] = [
    { id: "calendar", icon: "📅", label: "Calendar" },
    { id: "analytics", icon: "📊", label: "Analytics" },
    { id: "publishing", icon: "🚀", label: "Auto-Publishing" },
  ];

  const tabBar = (
    <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #E5E7EB", marginBottom: 24, background: "white", borderRadius: "14px 14px 0 0", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{ flex: 1, padding: "14px 10px", border: "none", borderBottom: `3px solid ${tab === t.id ? "#7C3AED" : "transparent"}`, background: tab === t.id ? "#F5F3FF" : "white", fontSize: "0.82rem", fontWeight: tab === t.id ? 800 : 600, color: tab === t.id ? "#7C3AED" : "#6B7280", cursor: "pointer", transition: "all .15s" }}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="view" id="view-social-react">
      <div
        className="view-header ig-panel-hero"
        data-ig-light-hero="1"
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 10% 15%, rgba(124,58,237,0.12), transparent 55%), radial-gradient(ellipse 55% 50% at 92% 85%, rgba(79,70,229,0.10), transparent 50%), linear-gradient(135deg, #f5f3ff 0%, #eef2ff 55%, #eef4ff 100%)",
          border: "1px solid rgba(124, 58, 237, 0.18)",
          color: "#0f172a",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#0f766e" }}>
                <span className="bc-group" style={{ color: "#7c3aed" }}>Create</span>{" "}
                <span className="bc-sep" style={{ color: "#94a3b8" }}>›</span> Social
              </div>
              <h2 className="view-title" style={{ color: "#0f172a" }}>Social Content Generator, Calendar &amp; Scheduling</h2>
              <p className="view-sub" style={{ color: "#334155" }}>Create, schedule, and publish AI-generated content across all social platforms from one place</p>
            </div>
            <div className="vh-actions">
              <button className="btn-primary" style={{ background: "white", color: "#7C3AED" }} onClick={() => openCreate()}>
                + Create Post
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container">
        <div style={{ padding: "28px 0" }}>
          {tabBar}
          {tab === "calendar" && (
            <CalendarTab
              posts={posts}
              viewYear={viewYear}
              viewMonth={viewMonth}
              setViewYear={setViewYear}
              setViewMonth={setViewMonth}
              onCreate={openCreate}
              onRemove={removePost}
              onPublish={publishNow}
            />
          )}
          {tab === "analytics" && <AnalyticsTab posts={posts} />}
          {tab === "publishing" && (
            <PublishingTab
              posts={posts}
              autoPublish={autoPublish}
              onToggleAutoPublish={toggleAutoPublish}
              onRemove={removePost}
              onPublish={publishNow}
              goToCalendar={() => setTab("calendar")}
              onCreate={openCreate}
            />
          )}
        </div>
      </div>

      {modalOpen && <CreatePostModal preDate={modalDate} onClose={() => setModalOpen(false)} onSaved={onSaved} />}
    </div>
  );
}

// ── CALENDAR TAB ──────────────────────────────────────────────────────────────
function CalendarTab({
  posts,
  viewYear,
  viewMonth,
  setViewYear,
  setViewMonth,
  onCreate,
  onRemove,
  onPublish,
}: {
  posts: Post[];
  viewYear: number;
  viewMonth: number;
  setViewYear: (n: number) => void;
  setViewMonth: (n: number) => void;
  onCreate: (date?: string) => void;
  onRemove: (id: string) => void;
  onPublish: (id: string) => void;
}) {
  const now = new Date();
  const mName = MONTHS[viewMonth];
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = now.getDate();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`blank-${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const dayPosts = posts.filter((p) => {
      const pd = new Date(p.scheduledDate);
      return pd.getFullYear() === viewYear && pd.getMonth() === viewMonth && pd.getDate() === d;
    });
    const isToday = isCurrentMonth && d === today;
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push(
      <div
        key={`d-${d}`}
        onClick={() => onCreate(dateStr)}
        style={{ minHeight: 70, border: `1px solid ${isToday ? "#7C3AED" : "#E5E7EB"}`, borderRadius: 10, padding: 8, cursor: "pointer", background: isToday ? "#F3E8FF" : "white" }}
      >
        <div style={{ fontSize: "0.78rem", fontWeight: isToday ? 800 : 600, color: isToday ? "#7C3AED" : "#374151", marginBottom: 4 }}>{d}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {dayPosts.slice(0, 4).map((p, i) => (
            <div key={i} style={{ width: 7, height: 7, background: platMeta(p.platform).color, borderRadius: "50%", flexShrink: 0 }} />
          ))}
        </div>
        {dayPosts.length > 4 && <div style={{ fontSize: "0.6rem", color: "#9CA3AF", marginTop: 2 }}>+{dayPosts.length - 4} more</div>}
      </div>,
    );
  }

  const upcomingPosts = posts
    .filter((p) => new Date(p.scheduledDate + " " + p.scheduledTime) >= now)
    .sort((a, b) => +new Date(a.scheduledDate + " " + a.scheduledTime) - +new Date(b.scheduledDate + " " + b.scheduledTime))
    .slice(0, 8);

  // Stats
  const stats: [string, number, string, string, string][] = [
    ["Scheduled", posts.filter((p) => p.status === "scheduled").length, "#0066FF", "📅", "Posts queued and ready to publish — click any day on the calendar to see what's planned."],
    ["Published", posts.filter((p) => p.status === "published").length, "#10B981", "✅", "Posts that have already gone live across your connected social channels."],
    ["Drafts", posts.filter((p) => p.status === "draft").length, "#F59E0B", "✏️", "Posts saved as drafts — not yet scheduled or published."],
    ["This Month", posts.filter((p) => { const dd = new Date(p.scheduledDate); return dd.getFullYear() === viewYear && dd.getMonth() === viewMonth; }).length, "#7C3AED", "📊", "Total posts (any status) scheduled or published in the currently viewed calendar month."],
  ];

  // Funnel balance
  const funnelCounts: Record<string, number> = {};
  FUNNEL_STAGES.forEach((s) => { funnelCounts[s.id] = 0; });
  let taggedTotal = 0;
  posts.forEach((p) => { if (p.funnelStage && funnelCounts[p.funnelStage] !== undefined) { funnelCounts[p.funnelStage]++; taggedTotal++; } });
  const totalPosts = posts.length;
  const weakStages = FUNNEL_STAGES.filter((s) => funnelCounts[s.id] === 0);
  const maxCount = Math.max(...Object.values(funnelCounts), 1);

  return (
    <>
      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {stats.map(([l, v, c, ic, tip]) => (
          <div key={l} title={tip} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "1.6rem", marginBottom: 4 }}>{ic}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: "0.65rem", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Funnel balance */}
      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 18, padding: "20px 24px", marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "Sora,sans-serif", fontSize: "0.9rem", fontWeight: 800, color: "#0A1628" }}>🎯 Funnel Content Balance</div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>{taggedTotal} of {totalPosts} posts tagged · Tag posts when creating to track funnel coverage</div>
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, color: weakStages.length > 0 ? "#F59E0B" : "#10B981" }}>{weakStages.length === 0 && taggedTotal > 0 ? "✅" : weakStages.length + "⚠️"}</div>
        </div>
        {FUNNEL_STAGES.map((s) => {
          const cnt = funnelCounts[s.id];
          const pct = taggedTotal > 0 ? Math.round((cnt / taggedTotal) * 100) : 0;
          const barW = taggedTotal > 0 ? Math.round((cnt / maxCount) * 100) : 0;
          return (
            <div key={s.id} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: s.color }}>{s.icon} {s.label}</span>
                <span style={{ fontSize: "0.68rem", color: "#6B7280", fontWeight: 600 }}>{cnt} post{cnt !== 1 ? "s" : ""} · {pct}%</span>
              </div>
              <div style={{ background: "#F3F4F6", borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${barW}%`, background: s.color, borderRadius: 6, transition: "width .4s ease" }} />
              </div>
            </div>
          );
        })}
        {weakStages.length > 0 ? (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, fontSize: "0.72rem", color: "#92400E", lineHeight: 1.5 }}>
            <strong>⚠️ Gaps detected:</strong> {weakStages.map((s) => `${s.icon} ${s.label} (${s.fmt})`).join(", ")} — add content here to move leads through your funnel.
          </div>
        ) : taggedTotal > 0 ? (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, fontSize: "0.72rem", color: "#065F46" }}>
            ✅ <strong>Balanced funnel!</strong> Content is spread across all 5 stages — great coverage.
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "flex-start" }}>
        {/* Calendar */}
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 18, padding: 22, boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <button
              onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); }}
              style={{ width: 34, height: 34, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: "50%", fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              ‹
            </button>
            <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "#0A1628" }}>{mName} {viewYear}</div>
            <button
              onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); }}
              style={{ width: 34, height: 34, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: "50%", fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              ›
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 6 }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: "0.65rem", fontWeight: 700, color: "#9CA3AF", padding: "6px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 }}>{cells}</div>
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SOCIAL_PLATFORMS.map((p) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.65rem", color: "#374151" }}>
                <div style={{ width: 8, height: 8, background: p.color, borderRadius: "50%" }} />
                {p.name}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button onClick={() => onCreate()} style={{ width: "100%", padding: 13, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", border: "none", borderRadius: 12, fontSize: "0.9rem", fontWeight: 700, color: "white", cursor: "pointer" }}>
            + Create Post
          </button>
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>📅 Upcoming Posts</div>
            {upcomingPosts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "#9CA3AF" }}>
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>📅</div>
                <div style={{ fontSize: "0.82rem" }}>No posts scheduled yet — click any day or the Create Post button</div>
              </div>
            ) : (
              upcomingPosts.map((p) => (
                <UpcomingCard
                  key={p.id}
                  post={p}
                  onRemove={onRemove}
                  onPublish={onPublish}
                  onJump={(y, m) => { setViewYear(y); setViewMonth(m); }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function UpcomingCard({
  post: p,
  onRemove,
  onPublish,
  onJump,
}: {
  post: Post;
  onRemove: (id: string) => void;
  onPublish: (id: string) => void;
  onJump: (year: number, month: number) => void;
}) {
  const pl = platMeta(p.platform);
  let goLiveLabel = `${p.scheduledDate} ${p.scheduledTime || ""}`.trim();
  let relHint = "";
  let jumpY: number | null = null;
  let jumpM: number | null = null;
  try {
    const dt = new Date(p.scheduledDate + "T" + (p.scheduledTime || "09:00"));
    if (!isNaN(dt.getTime())) {
      jumpY = dt.getFullYear();
      jumpM = dt.getMonth();
      const diffMin = Math.round((+dt - Date.now()) / 60000);
      if (diffMin < 0) relHint = "overdue";
      else if (diffMin < 60) relHint = `in ${diffMin}m`;
      else if (diffMin < 60 * 24) relHint = `in ${Math.round(diffMin / 60)}h`;
      else relHint = `in ${Math.round(diffMin / (60 * 24))}d`;
      goLiveLabel = dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  } catch {
    /* ignore */
  }
  const canJump = jumpY !== null && jumpM !== null;
  const isPublished = p.status === "published";
  const fs = p.funnelStage ? FUNNEL_STAGES.find((s) => s.id === p.funnelStage) : undefined;

  return (
    <div style={{ background: pl.bg, border: `1px solid ${pl.color}33`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: pl.color, background: "white", borderRadius: 5, padding: "2px 7px" }}>{pl.icon} {p.platform}</span>
        <button
          onClick={() => { if (canJump && jumpY !== null && jumpM !== null) onJump(jumpY, jumpM); }}
          title={canJump ? "Show this date on the calendar" : undefined}
          style={{ fontSize: "0.65rem", fontWeight: 700, color: "#0A1628", background: "white", border: `1px solid ${pl.color}55`, borderRadius: 5, padding: "3px 8px", cursor: canJump ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          🕐 {goLiveLabel}
          {relHint && <span style={{ color: relHint === "overdue" ? "#DC2626" : "#6B7280", fontWeight: 600 }}> · {relHint}</span>}
        </button>
      </div>
      <div style={{ fontSize: "0.8rem", color: "#374151", lineHeight: 1.4, marginBottom: 8 }}>{p.caption.substring(0, 100)}{p.caption.length > 100 ? "…" : ""}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: p.status === "scheduled" ? "#EFF6FF" : isPublished ? "#F0FDF4" : "#F9FAFB", color: p.status === "scheduled" ? "#0066FF" : isPublished ? "#059669" : "#6B7280", textTransform: "uppercase" }}>{p.status || "scheduled"}</span>
        {fs && <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: fs.bg, color: fs.color }}>{fs.icon} {fs.label}</span>}
        {p.archetypeTitle && <span title={`2026 Post Archetype: ${p.archetypeTitle}`} style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE" }}>✨ {p.archetypeTitle}</span>}
        <span style={{ flex: 1 }} />
        {isPublished ? (
          <span style={{ fontSize: "0.62rem", color: "#059669", fontWeight: 700, padding: "2px 7px" }}>✅ Live</span>
        ) : (
          <button onClick={() => onPublish(p.id)} title={`Publish this post immediately to ${pl.name}`} style={{ fontSize: "0.62rem", fontWeight: 800, color: "white", background: "linear-gradient(135deg,#10B981,#059669)", border: "none", borderRadius: 5, padding: "4px 9px", cursor: "pointer", boxShadow: "0 1px 2px rgba(16,185,129,0.3)" }}>⚡ Activate Post Now</button>
        )}
        <button onClick={() => onRemove(p.id)} style={{ fontSize: "0.62rem", color: "#DC2626", background: "white", border: "1px solid #FCA5A5", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>Remove</button>
      </div>
    </div>
  );
}

// ── ANALYTICS TAB ─────────────────────────────────────────────────────────────
type ChartInstance = { destroy: () => void };
type ChartCtor = new (ctx: CanvasRenderingContext2D, cfg: Record<string, unknown>) => ChartInstance;

function AnalyticsTab({ posts }: { posts: Post[] }) {
  const reachRef = useRef<HTMLCanvasElement | null>(null);
  const platRef = useRef<HTMLCanvasElement | null>(null);
  const engageRef = useRef<HTMLCanvasElement | null>(null);

  const domain = getAnalysis().url || "yourdomain.com";
  const published = posts.filter((p) => p.status === "published");

  const platCounts: Record<string, number> = {};
  const platReach: Record<string, number> = {};
  posts.forEach((p) => {
    platCounts[p.platform] = (platCounts[p.platform] || 0) + 1;
    const s = seed(p.id || p.platform);
    platReach[p.platform] = (platReach[p.platform] || 0) + 800 + (s % 4200);
  });

  const defaultPlats = ["Instagram", "TikTok", "LinkedIn", "Meta", "X", "YouTube"];
  const defaultReach = [5200, 8400, 3100, 4700, 1900, 6300];
  const defaultEngage = [4.2, 5.8, 3.1, 3.9, 1.8, 4.5];

  const hasData = posts.length > 0;
  const chartPlats = hasData ? Object.keys(platCounts) : defaultPlats;
  const chartReach = hasData ? chartPlats.map((p) => platReach[p] || 0) : defaultReach;
  const chartEngage = hasData ? chartPlats.map((p) => +(2.5 + (seed(p) % 35) / 10).toFixed(1)) : defaultEngage;
  const chartColors = chartPlats.map((p) => platMeta(p).color);

  const weekLabels = Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (7 - i) * 7);
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getDate();
  });
  const weekReach = weekLabels.map((_, i) => 8000 + i * 900 + Math.round(seed("week" + i) % 3000));

  const topPosts = published.length > 0
    ? published.slice(0, 5).map((p) => ({ ...p, reach: 900 + (seed(p.id) % 4500), likes: 40 + (seed(p.id + "l") % 300), comments: 5 + (seed(p.id + "c") % 40), er: +(2 + (seed(p.id + "e") % 35) / 10).toFixed(1) }))
    : defaultPlats.slice(0, 4).map((pl, i) => ({ id: "demo" + i, platform: pl, caption: `Sample post — ${domain} ${["growth", "launch", "update", "offer"][i]}`, reach: defaultReach[i], likes: 80 + i * 30, comments: 12 + i * 5, er: defaultEngage[i], scheduledDate: "" }));

  const totalReach = chartReach.reduce((a, b) => a + b, 0);
  const totalPosts = posts.length || 45;
  const avgER = chartEngage.length ? +(chartEngage.reduce((a, b) => a + b, 0) / chartEngage.length).toFixed(1) : 3.8;
  const followerGrow = 240 + Math.round(seed(domain) % 380);

  const kpis = [
    { icon: "👁️", label: "Total Reach", value: hasData ? totalReach.toLocaleString() : "28,600", color: "#7C3AED", sub: "Last 30 days" },
    { icon: "💬", label: "Avg Engagement", value: avgER + "%", color: "#0066FF", sub: "Across platforms" },
    { icon: "📝", label: "Posts Published", value: String(published.length || totalPosts), color: "#10B981", sub: "All time" },
    { icon: "📈", label: "Follower Growth", value: "+" + followerGrow, color: "#F59E0B", sub: "This month" },
  ];

  useEffect(() => {
    const ChartCtorRef = (window as unknown as { Chart?: ChartCtor }).Chart;
    if (!ChartCtorRef) return;
    const dataMode = (window as unknown as { _applyChartDataMode?: (id: string, sample: boolean, label: string) => boolean })._applyChartDataMode;
    const instances: ChartInstance[] = [];

    if (reachRef.current && !(dataMode && dataMode("socialReachChart", !hasData, "Sample data"))) {
      const ctx = reachRef.current.getContext("2d");
      if (ctx) instances.push(new ChartCtorRef(ctx, {
        type: "line",
        data: { labels: weekLabels, datasets: [{ label: "Total Reach", data: weekReach, borderColor: "#7C3AED", backgroundColor: "rgba(124,58,237,0.08)", tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: "#7C3AED" }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false, ticks: { callback: (v: number) => (v >= 1000 ? (v / 1000).toFixed(0) + "K" : v), font: { size: 10 } }, grid: { color: "rgba(0,0,0,.04)" } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } } },
      }));
    }
    if (platRef.current && !(dataMode && dataMode("socialPlatChart", !hasData, "Sample data"))) {
      const ctx = platRef.current.getContext("2d");
      if (ctx) instances.push(new ChartCtorRef(ctx, {
        type: "doughnut",
        data: { labels: chartPlats, datasets: [{ data: chartReach, backgroundColor: chartColors, borderWidth: 2, borderColor: "white" }] },
        options: { responsive: true, plugins: { legend: { position: "bottom", labels: { font: { size: 10 }, padding: 8 } } }, cutout: "60%" },
      }));
    }
    if (engageRef.current && !(dataMode && dataMode("socialEngageChart", !hasData, "Sample data"))) {
      const ctx = engageRef.current.getContext("2d");
      if (ctx) instances.push(new ChartCtorRef(ctx, {
        type: "bar",
        data: { labels: chartPlats, datasets: [{ label: "Engagement Rate (%)", data: chartEngage, backgroundColor: chartColors, borderRadius: 6, borderWidth: 0 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: (v: number) => v + "%", font: { size: 10 } }, grid: { color: "rgba(0,0,0,.04)" } }, x: { ticks: { font: { size: 10 } }, grid: { display: false } } } },
      }));
    }
    return () => instances.forEach((c) => { try { c.destroy(); } catch { /* ignore */ } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const times = ["6am", "9am", "12pm", "3pm", "6pm", "9pm"];
  const heatScores = [[2, 4, 3, 2, 1, 1], [3, 5, 4, 4, 2, 2], [2, 4, 5, 5, 3, 2], [1, 3, 4, 5, 4, 2], [2, 4, 5, 4, 3, 1], [3, 3, 2, 3, 4, 3], [2, 2, 1, 2, 3, 2]];
  const heatColor = (s: number) => (s === 5 ? "#7C3AED" : s === 4 ? "#A78BFA" : s === 3 ? "#DDD6FE" : s === 2 ? "#F3F4F6" : "#F9FAFB");

  return (
    <>
      <div id="socialKpiHeader" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628" }}>📊 Performance Overview</div>
      </div>
      <div id="socialKpiBody" style={{ marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: "18px 16px", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
              <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>{k.icon}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: k.color, marginBottom: 2 }}>{k.value}</div>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151" }}>{k.label}</div>
              <div style={{ fontSize: "0.64rem", color: "#9CA3AF", marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>📈 Weekly Reach Trend</div>
          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginBottom: 14 }}>Total post reach across all platforms — last 8 weeks</div>
          <canvas id="socialReachChart" ref={reachRef} height={120} />
        </div>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>📱 Reach by Platform</div>
          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginBottom: 14 }}>Distribution of total reach</div>
          <canvas id="socialPlatChart" ref={platRef} height={160} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>💬 Engagement Rate by Platform</div>
          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginBottom: 14 }}>Average % engagement per post per platform</div>
          <canvas id="socialEngageChart" ref={engageRef} height={140} />
        </div>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>⏰ Best Times to Post</div>
          <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginBottom: 12 }}>Optimal scheduling windows by day of week</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 3, fontSize: "0.6rem" }}>
              <tbody>
                <tr>
                  <th></th>
                  {times.map((t) => <th key={t} style={{ color: "#9CA3AF", fontWeight: 600, textAlign: "center", padding: 2 }}>{t}</th>)}
                </tr>
                {days.map((d, di) => (
                  <tr key={d}>
                    <td style={{ color: "#374151", fontWeight: 700, padding: "2px 6px", whiteSpace: "nowrap" }}>{d}</td>
                    {heatScores[di].map((s, si) => (
                      <td key={si} style={{ background: heatColor(s), color: s >= 4 ? "white" : "#9CA3AF", textAlign: "center", borderRadius: 4, padding: "4px 2px", fontWeight: s >= 4 ? 700 : 400 }}>{s >= 4 ? "●" : ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              {([["#7C3AED", "Best"], ["#A78BFA", "Good"], ["#DDD6FE", "OK"]] as [string, string][]).map(([c, l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.62rem", color: "#6B7280" }}>
                  <div style={{ width: 10, height: 10, background: c, borderRadius: 2 }} />{l}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.88rem", fontWeight: 800, color: "#0A1628", marginBottom: 14 }}>🏆 Top Performing Posts</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E5E7EB" }}>
                {["Platform", "Caption", "Reach", "Likes", "Comments", "Eng. Rate"].map((h, i) => (
                  <th key={h} style={{ textAlign: i <= 1 ? "left" : "center", padding: "10px 12px", color: "#6B7280", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topPosts.map((p) => {
                const pl = platMeta(p.platform);
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "10px 12px" }}><span style={{ background: pl.bg, color: pl.color, borderRadius: 6, padding: "3px 8px", fontSize: "0.65rem", fontWeight: 700 }}>{pl.icon} {p.platform}</span></td>
                    <td style={{ padding: "10px 12px", color: "#374151", maxWidth: 250 }}><div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(p.caption || "").substring(0, 60)}{(p.caption || "").length > 60 ? "…" : ""}</div></td>
                    <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#7C3AED" }}>{p.reach.toLocaleString()}</td>
                    <td style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#0066FF" }}>{p.likes.toLocaleString()}</td>
                    <td style={{ textAlign: "center", padding: "10px 12px", color: "#374151" }}>{p.comments}</td>
                    <td style={{ textAlign: "center", padding: "10px 12px" }}><span style={{ background: p.er >= 4 ? "#F0FDF4" : p.er >= 3 ? "#FFFBEB" : "#F9FAFB", color: p.er >= 4 ? "#059669" : p.er >= 3 ? "#D97706" : "#6B7280", borderRadius: 6, padding: "2px 8px", fontWeight: 700, fontSize: "0.72rem" }}>{p.er}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!hasData && <div style={{ textAlign: "center", padding: 12, fontSize: "0.75rem", color: "#9CA3AF", borderTop: "1px solid #F3F4F6", marginTop: 8 }}>📊 Showing sample data — publish posts to see real analytics</div>}
      </div>
    </>
  );
}

// ── AUTO-PUBLISHING TAB ───────────────────────────────────────────────────────
function PublishingTab({
  posts,
  autoPublish,
  onToggleAutoPublish,
  onRemove,
  onPublish,
  goToCalendar,
  onCreate,
}: {
  posts: Post[];
  autoPublish: boolean;
  onToggleAutoPublish: () => void;
  onRemove: (id: string) => void;
  onPublish: (id: string) => void;
  goToCalendar: () => void;
  onCreate: (date?: string) => void;
}) {
  const now = new Date();
  const scheduled = posts.filter((p) => p.status === "scheduled");
  const published = posts.filter((p) => p.status === "published");
  const overdue = scheduled.filter((p) => new Date(p.scheduledDate + "T" + p.scheduledTime) <= now);
  const upcoming = scheduled
    .filter((p) => new Date(p.scheduledDate + "T" + p.scheduledTime) > now)
    .sort((a, b) => +new Date(a.scheduledDate + "T" + a.scheduledTime) - +new Date(b.scheduledDate + "T" + b.scheduledTime));

  const connPlatforms = [
    { name: "Meta (Facebook)", icon: "📘", color: "#1877F2", bg: "#EBF3FF", status: "connected", note: "Via Meta Ads API token" },
    { name: "Instagram", icon: "📸", color: "#E1306C", bg: "#FFF0F5", status: "connected", note: "Via Meta Graph API" },
    { name: "TikTok", icon: "⬛", color: "#010101", bg: "#F5F5F5", status: "connected", note: "Via TikTok Ads token" },
    { name: "LinkedIn", icon: "💼", color: "#0A66C2", bg: "#F0F7FF", status: "requires_auth", note: "OAuth required" },
    { name: "YouTube", icon: "🎬", color: "#FF0000", bg: "#FFF5F5", status: "requires_auth", note: "Google OAuth required" },
    { name: "X (Twitter)", icon: "✖️", color: "#14171A", bg: "#F5F5F5", status: "requires_auth", note: "API v2 key required" },
  ];

  const postRow = (p: Post, isOverdue: boolean) => {
    const pl = platMeta(p.platform);
    const dt = new Date(p.scheduledDate + "T" + (p.scheduledTime || "09:00"));
    const dtStr = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " at " + (p.scheduledTime || "09:00");
    return (
      <div key={p.id} style={{ background: isOverdue ? "#FFF7ED" : "white", border: `1px solid ${isOverdue ? "#FED7AA" : "#E5E7EB"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ background: pl.bg, color: pl.color, borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>{pl.icon} {p.platform}</span>
              {isOverdue ? (
                <span style={{ background: "#FEF3C7", color: "#D97706", borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>⚠️ Overdue</span>
              ) : (
                <span style={{ background: "#EFF6FF", color: "#0066FF", borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>⏰ {dtStr}</span>
              )}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(p.caption || "").substring(0, 90)}{(p.caption || "").length > 90 ? "…" : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <button onClick={() => onPublish(p.id)} style={{ padding: "6px 14px", background: "linear-gradient(135deg,#7C3AED,#4F46E5)", border: "none", borderRadius: 8, fontSize: "0.7rem", fontWeight: 700, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>🚀 Publish Now</button>
            <button onClick={() => onRemove(p.id)} style={{ padding: "6px 10px", background: "white", border: "1px solid #FCA5A5", borderRadius: 8, fontSize: "0.7rem", color: "#DC2626", cursor: "pointer" }}>✕</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "linear-gradient(135deg,rgba(124,58,237,.06),rgba(79,70,229,.04))", border: "1px solid rgba(124,58,237,.2)", borderRadius: 16, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.92rem", fontWeight: 800, color: "#0A1628", marginBottom: 4 }}>⚡ Auto-Publish Engine</div>
              <div style={{ fontSize: "0.75rem", color: "#6B7280", maxWidth: 380 }}>When enabled, InfoGenie automatically publishes your scheduled posts at their exact time — no manual action needed.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: autoPublish ? "#059669" : "#9CA3AF" }}>{autoPublish ? "● Active" : "○ Inactive"}</span>
              <button onClick={onToggleAutoPublish} style={{ padding: "10px 20px", background: autoPublish ? "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)" : "linear-gradient(135deg,#7C3AED,#4F46E5)", border: "none", borderRadius: 10, fontSize: "0.8rem", fontWeight: 700, color: "white", cursor: "pointer" }}>{autoPublish ? "⏸ Pause Auto-Publish" : "▶ Enable Auto-Publish"}</button>
            </div>
          </div>
          {autoPublish && <div style={{ marginTop: 12, background: "rgba(5,150,105,.08)", border: "1px solid rgba(5,150,105,.2)", borderRadius: 8, padding: "10px 14px", fontSize: "0.75rem", color: "#065F46" }}>✅ Auto-publish is ON — InfoGenie checks every 60 seconds and publishes posts at their scheduled time</div>}
        </div>

        {overdue.length > 0 && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 10 }}>⚠️ Overdue — {overdue.length} Post{overdue.length > 1 ? "s" : ""} Ready to Publish</div>
            {overdue.map((p) => postRow(p, true))}
          </div>
        )}

        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 10 }}>📅 Upcoming Queue — {upcoming.length} Post{upcoming.length !== 1 ? "s" : ""}</div>
          {upcoming.length === 0 ? (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 32, textAlign: "center", color: "#9CA3AF" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: "0.82rem" }}>No upcoming posts — go to Calendar to create and schedule posts</div>
              <button onClick={() => { goToCalendar(); onCreate(); }} style={{ marginTop: 12, padding: "8px 18px", background: "linear-gradient(135deg,#7C3AED,#4F46E5)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: "pointer" }}>+ Create Post</button>
            </div>
          ) : (
            upcoming.map((p) => postRow(p, false))
          )}
        </div>

        {published.length > 0 && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 10 }}>✅ Published — {published.length} Post{published.length > 1 ? "s" : ""}</div>
            {published.slice(0, 5).map((p) => {
              const pl = platMeta(p.platform);
              return (
                <div key={p.id} style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "12px 16px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ background: pl.bg, color: pl.color, borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>{pl.icon} {p.platform}</span>
                  <span style={{ flex: 1, fontSize: "0.75rem", color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(p.caption || "").substring(0, 70)}…</span>
                  <span style={{ fontSize: "0.62rem", color: "#059669", fontWeight: 700, flexShrink: 0 }}>✓ Live</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 14 }}>🔌 Platform Connections</div>
          {connPlatforms.map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 30, height: 30, background: p.bg, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem" }}>{p.icon}</div>
                <div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0A1628" }}>{p.name}</div>
                  <div style={{ fontSize: "0.62rem", color: "#9CA3AF" }}>{p.note}</div>
                </div>
              </div>
              {p.status === "connected" ? (
                <span style={{ background: "#F0FDF4", color: "#059669", borderRadius: 6, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>✓ Connected</span>
              ) : (
                <button onClick={() => toast(`🔑 Connect ${p.name} in Settings → Platform Connections to enable auto-publishing`)} style={{ background: "#F3F4F6", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: "0.62rem", fontWeight: 700, color: "#6B7280", cursor: "pointer" }}>Connect →</button>
              )}
            </div>
          ))}
        </div>

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 16, padding: 18, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>📊 Publishing Stats</div>
          {([["Total Scheduled", scheduled.length, "#7C3AED"], ["Total Published", published.length, "#059669"], ["Overdue", overdue.length, "#D97706"], ["Drafts", posts.filter((p) => p.status === "draft").length, "#6B7280"]] as [string, number, string][]).map(([l, v, c]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F9FAFB" }}>
              <span style={{ fontSize: "0.75rem", color: "#6B7280" }}>{l}</span>
              <span style={{ fontSize: "0.88rem", fontWeight: 800, color: c }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── CREATE POST MODAL ─────────────────────────────────────────────────────────
function CreatePostModal({ preDate, onClose, onSaved }: { preDate?: string; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [selPlats, setSelPlats] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState("");
  const [date, setDate] = useState(preDate || today);
  const [time, setTime] = useState("09:00");
  const [status, setStatus] = useState("scheduled");
  const [funnelStage, setFunnelStage] = useState("");
  const [archetype, setArchetype] = useState<Archetype | null>(null);
  const [fileName, setFileName] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const stage = useMemo(() => FUNNEL_STAGES.find((s) => s.id === funnelStage), [funnelStage]);
  const archetypeList = funnelStage ? POST_ARCHETYPES[funnelStage] || [] : [];

  function togglePlat(name: string) {
    setSelPlats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function onStageChange(v: string) {
    setFunnelStage(v);
    setArchetype(null);
  }

  function selectArchetype(a: Archetype) {
    setArchetype(a);
    if (!caption.trim() && a.starter) setCaption(a.starter);
  }

  async function generateAi() {
    setAiBusy(true);
    const ad = getAnalysis();
    const domain = ad.url || "your brand";
    const industry = ad.industry?.name || "your industry";
    const platforms = Array.from(selPlats);
    const platLine = `Target platforms: ${platforms.join(", ") || "Instagram, TikTok"}.`;
    let prompt: string;
    if (archetype) {
      const archPrompt = archetype.prompt.replace(/\{brand\}/g, domain).replace(/\{industry\}/g, industry);
      prompt = `${archPrompt} ${platLine} Return only the caption text, no extra commentary, no quotation marks around the caption.`;
    } else {
      prompt = `Write an engaging social media post caption for ${domain} in the ${industry} industry. ${platLine} Make it compelling, use relevant emojis, include a clear call-to-action, and keep it under 200 words. Return only the caption text, no extra commentary.`;
    }
    const ind = industry.replace(/\s/g, "");
    const r = await apiPost<{ caption?: string; error?: string }>("/api/ai-social-caption", { prompt, domain, industry, platforms });
    if (r.caption) {
      setCaption(r.caption);
      toast("✅ AI caption generated!");
    } else {
      setCaption(`Unlock the power of ${domain} — the smarter way to grow in ${industry}. Join thousands of businesses already winning with us. Tap the link in bio to get started today! 🚀 #growth #${ind} #results`);
    }
    setAiBusy(false);
  }

  function save() {
    const cap = caption.trim();
    if (!cap) { toast("⚠️ Please write or generate a caption first"); return; }
    if (!date) { toast("⚠️ Please set a schedule date"); return; }
    if (selPlats.size === 0) { toast("⚠️ Select at least one platform"); return; }
    const list = readPosts();
    Array.from(selPlats).forEach((name) => {
      list.push({
        id: "post_" + Date.now() + "_" + name,
        platform: name,
        caption: cap,
        scheduledDate: date,
        scheduledTime: time || "09:00",
        status,
        funnelStage: funnelStage || null,
        archetypeId: archetype?.id || null,
        archetypeTitle: archetype?.title || null,
        fileName: fileName || null,
        createdAt: new Date().toLocaleString(),
      });
    });
    persistPosts(list);
    toast(`✅ Post scheduled on ${selPlats.size} platform${selPlats.size > 1 ? "s" : ""}!`);
    onSaved();
  }

  const aiLabel = archetype ? `✨ Generate “${archetype.title.includes('"') ? archetype.title.replace(/"/g, "") : archetype.title}” with AI` : "✨ Generate Caption with AI";

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 18, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.3)" }}>
        <div style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5)", borderRadius: "18px 18px 0 0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#C4B5FD", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 3 }}>New Post</div>
            <div style={{ fontFamily: "Sora,sans-serif", fontSize: "1.1rem", fontWeight: 800, color: "#FFFFFF" }}>Create &amp; Schedule Post</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 32, height: 32, fontSize: "1.1rem", color: "white", cursor: "pointer", lineHeight: "32px", textAlign: "center" }}>✕</button>
        </div>
        <div style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Platforms</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SOCIAL_PLATFORMS.map((p) => {
                const on = selPlats.has(p.name);
                return (
                  <label key={p.name} onClick={() => togglePlat(p.name)} style={{ display: "flex", alignItems: "center", gap: 6, background: p.bg, border: `1.5px solid ${on ? p.color : "transparent"}`, borderRadius: 8, padding: "7px 11px", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: p.color, userSelect: "none" }}>
                    <input type="checkbox" readOnly checked={on} style={{ accentColor: p.color, width: 13, height: 13, pointerEvents: "none" }} /> {p.icon} {p.name}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Caption</div>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="Write your post caption here, or let AI generate it…" style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", border: "1.5px solid #E2E8F0", borderRadius: 10, fontSize: "0.82rem", color: "#0A1628", fontFamily: "'Inter',sans-serif", resize: "vertical", outline: "none", lineHeight: 1.5 }} />
          </div>
          <button onClick={generateAi} disabled={aiBusy} style={{ padding: 9, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", border: "none", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, color: "white", cursor: aiBusy ? "default" : "pointer", opacity: aiBusy ? 0.7 : 1 }}>{aiBusy ? "⏳ Generating…" : aiLabel}</button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Schedule Date</div>
              <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", outline: "none", fontFamily: "'Inter',sans-serif" }} />
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Time</div>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", outline: "none", fontFamily: "'Inter',sans-serif" }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Attach Image / Video</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ padding: "8px 16px", background: "#F9FAFB", border: "1.5px dashed #E2E8F0", borderRadius: 9, fontSize: "0.78rem", fontWeight: 600, color: "#374151", cursor: "pointer" }}>
                📎 Choose File
                <input type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => setFileName(e.target.files?.[0]?.name || "")} />
              </label>
              <span style={{ fontSize: "0.72rem", color: "#9CA3AF", fontStyle: "italic" }}>{fileName || "No file selected"}</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", outline: "none", background: "white", fontFamily: "'Inter',sans-serif" }}>
              <option value="scheduled">Scheduled</option>
              <option value="draft">Save as Draft</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>🎯 Funnel Stage <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#9CA3AF" }}>(optional)</span></div>
            <select value={funnelStage} onChange={(e) => onStageChange(e.target.value)} style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: "0.82rem", color: "#0A1628", outline: "none", background: "white", fontFamily: "'Inter',sans-serif" }}>
              <option value="">— Choose funnel stage —</option>
              {FUNNEL_STAGES.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label} — {s.fmt}</option>)}
            </select>
            {stage && <div style={{ marginTop: 5, fontSize: "0.68rem", color: "#6B7280", lineHeight: 1.4 }}>💡 {stage.tip}</div>}
          </div>
          {archetypeList.length > 0 && (
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>✨ Pick a Proven Archetype <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#9CA3AF" }}>(2026 formats)</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {archetypeList.map((a) => {
                  const on = archetype?.id === a.id;
                  return (
                    <button key={a.id} type="button" onClick={() => selectArchetype(a)} style={{ textAlign: "left", padding: "8px 10px", background: on ? stage?.bg || "#F5F3FF" : "white", border: `1.5px solid ${on ? stage?.color || "#7C3AED" : "#E5E7EB"}`, borderRadius: 9, cursor: "pointer", transition: "all .15s", fontFamily: "'Inter',sans-serif", boxShadow: on ? `0 0 0 3px ${stage?.color || "#7C3AED"}22` : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: "0.95rem" }}>{a.icon}</span>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0A1628", lineHeight: 1.2 }}>{a.title}</span>
                      </div>
                      <div style={{ fontSize: "0.62rem", color: "#6B7280", lineHeight: 1.3 }}>{a.hint}</div>
                    </button>
                  );
                })}
              </div>
              {archetype && <div style={{ marginTop: 6, fontSize: "0.66rem", color: stage?.color || "#7C3AED", fontWeight: 700 }}>{archetype.icon} <strong>{archetype.title}</strong> selected — AI will write in this format</div>}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={onClose} style={{ flex: 1, padding: 11, background: "#F3F4F6", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>Cancel</button>
            <button onClick={save} style={{ flex: 2, padding: 11, background: "linear-gradient(135deg,#7C3AED,#4F46E5)", border: "none", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, color: "white", cursor: "pointer" }}>📅 Schedule Post</button>
          </div>
        </div>
      </div>
    </div>
  );
}
