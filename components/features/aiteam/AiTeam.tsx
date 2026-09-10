"use client";

// Native React port of the legacy `ai-team` panel (was `window.buildAiTeam` +
// `#view-ai-team`). Mirrors the AI-officer roster (incl. Technical Manager), the avatar picker
// (emoji gallery + image upload), per-officer Tasks and Daily Report modals, the
// cross-functional Officer Meetings list + scheduler, the autonomous Daily
// Report scheduler, the autonomous Team Meetings scheduler, and the live
// system-status pill — all against the existing `/api/officer/*` endpoints via
// `lib/api`. Cross-tool links go through `lib/nav#goToView`.
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";
import BriefingRoom from "./BriefingRoom";

// ── Types ─────────────────────────────────────────────────────────────────
interface Officer {
  id: string;
  icon: string;
  title: string;
  role: string;
  links: [string, string][];
  isNew?: boolean;
}

interface ActionPlanItem {
  step?: string;
  action?: string;
  priority?: string;
  title?: string;
}
interface TaskReview {
  task?: string;
  status?: string;
  evidence?: string;
}
interface OfficerReport {
  summary?: string;
  tasksReviewed?: TaskReview[];
  successes?: string[];
  issues?: string[];
  actionPlan?: (string | ActionPlanItem)[];
}
interface DailyReportResponse {
  ok?: boolean;
  error?: string;
  report?: OfficerReport;
  snapshot?: unknown;
  generatedAt?: number;
}

interface ActionItem {
  id?: string;
  owner?: string;
  action?: string;
  dueIn?: string;
  /** agreed → in_progress → implemented */
  status?: "agreed" | "in_progress" | "implemented";
  implementedAt?: string | null;
}
interface DepartmentUpdate {
  officer?: string;
  whatWorks?: string;
  whatDoesNotWork?: string;
  why?: string;
  remedialAction?: string;
}
interface Meeting {
  id: string;
  topic?: string;
  scheduledAt?: string;
  attendees?: string[];
  discussion?: string[];
  decisions?: string[];
  departmentUpdates?: DepartmentUpdate[];
  actionItems?: ActionItem[];
  autonomous?: boolean;
  mandatoryAttendance?: boolean;
}

interface SystemCheck {
  ok?: boolean;
  label?: string;
}
interface SystemActivity {
  lastReportAt?: string | null;
  lastMeetingAt?: string | null;
  lastTickAt?: string | null;
  serverStartedAt?: string | null;
  uptimeSec?: number;
  totalReports?: number;
  totalMeetings?: number;
}
interface SystemStatus {
  ok?: boolean;
  checks?: Record<string, SystemCheck>;
  activity?: SystemActivity;
}

interface AutoMeetingSettings {
  enabled: boolean;
  frequency: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
  timezone: string;
}

interface AutoReportRunStatus {
  slackOk?: boolean;
  slackError?: string;
  emailOk?: boolean;
  emailError?: string;
}
interface AutoReportSettings {
  enabled: boolean;
  hour: number;
  minute: number;
  timezone: string;
  email: string;
  lastRunAt?: string | null;
  lastRunStatus?: AutoReportRunStatus | null;
}
interface AutoReportHistoryEntry {
  at: string;
  manualTrigger?: boolean;
  slackOk?: boolean;
  emailOk?: boolean;
}
interface AutoReportRun {
  ok?: boolean;
  error?: string;
  reports?: { title?: string; report?: OfficerReport }[];
  html?: string;
  fmtDate?: string;
  slackOk?: boolean;
  emailOk?: boolean;
  officerCount?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────
const OFFICERS: Officer[] = [
  {
    id: "marketing",
    icon: "📣",
    title: "Marketing Officer",
    role: "Runs your campaigns end-to-end",
    links: [
      ["optimizer", "AI Optimizer"],
      ["battleplan", "Battle Plan"],
      ["action-center", "Action Center"],
    ],
  },
  {
    id: "sales",
    icon: "🎯",
    title: "Sales Officer",
    role: "Finds, qualifies and re-engages leads",
    links: [
      ["lead-finder", "B2B Lead Finder"],
      ["lead-qualifier", "Lead Qualifier"],
      ["reengage", "Re-Engage"],
    ],
  },
  {
    id: "analyst",
    icon: "📊",
    title: "Analyst Officer",
    role: "Cross-channel reporting & attribution",
    links: [
      ["cross-channel", "Cross-Channel Report"],
      ["attribution", "Attribution & ROI"],
      ["analytics-hub", "Analytics Hub"],
    ],
  },
  {
    id: "content",
    icon: "✍️",
    title: "Content Officer",
    role: "Scores, plans and schedules content",
    links: [
      ["contentscorer", "Content Scorer"],
      ["content-calendar", "Content Calendar"],
      ["social", "Social Calendar"],
    ],
  },
  {
    id: "seo",
    icon: "🔎",
    title: "SEO Officer",
    role: "On-page, GEO and keyword strategy",
    links: [
      ["seo-auditor", "On-Page Auditor"],
      ["geo-audit", "GEO Audit"],
      ["search-intel", "AI Visibility & Search Pulse"],
      ["keyword-map", "Keyword Map"],
    ],
  },
  {
    id: "cro",
    icon: "🧪",
    title: "CRO Officer",
    role: "A/B testing and conversion lift",
    links: [
      ["cro-lab", "CRO Lab"],
      ["conversion-boosters", "Conversion Boosters"],
      ["ab-designer", "A/B Designer"],
    ],
  },
  {
    id: "finance",
    icon: "💼",
    title: "Finance Officer",
    role: "P&L, CAC, LTV, runway alerts",
    isNew: true,
    links: [["finance-officer", "Open Finance Office"]],
  },
  {
    id: "ops",
    icon: "🛠️",
    title: "Operations Officer",
    role: "Campaign QA, asset & lead hygiene",
    isNew: true,
    links: [["ops-officer", "Open Operations Office"]],
  },
  {
    id: "technical",
    icon: "🛡️",
    title: "Technical Manager",
    role: "Every page & feature live — APIs, LLMs, auth, vault, security, updates",
    isNew: true,
    links: [["technical-manager", "Open Technical Manager desk"]],
  },
];

/** Soft illustrated portraits shipped with the app — used until a custom avatar is saved. */
const DEFAULT_AVATARS: Record<string, string> = {
  marketing: "/avatars/ai-team/marketing.webp",
  sales: "/avatars/ai-team/sales.webp",
  analyst: "/avatars/ai-team/analyst.webp",
  content: "/avatars/ai-team/content.webp",
  seo: "/avatars/ai-team/seo.webp",
  cro: "/avatars/ai-team/cro.webp",
  finance: "/avatars/ai-team/finance.webp",
  ops: "/avatars/ai-team/ops.webp",
  technical: "/avatars/ai-team/technical.webp",
};

const COUNT_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

function rosterCountLabel(n: number): string {
  return COUNT_WORDS[n] || String(n);
}

function resolveAvatar(officerId: string, stored?: string, fallbackIcon = "👤"): string {
  if (typeof stored === "string" && stored.trim()) {
    const v = stored.trim();
    // Accept image URLs / data URIs, or short emoji glyphs. Reject path fragments
    // left behind by the old 8-char avatar save truncate bug (e.g. "/avatars").
    if (isAvatarImage(v)) return v;
    if (!v.startsWith("/") && !v.startsWith("http") && !v.startsWith("data:") && v.length <= 16) {
      return v;
    }
  }
  return DEFAULT_AVATARS[officerId] || fallbackIcon;
}

function isAvatarImage(value: string): boolean {
  return (
    value.startsWith("/avatars/") ||
    value.startsWith("/uploads/") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:image/")
  );
}

const AVATAR_GALLERY = [
  "📣", "🎯", "📊", "✍️", "🔎", "🧪", "💼", "🛠️", "🤖", "🦊",
  "🐺", "🐯", "🦁", "🐼", "🦄", "🦅", "👨‍💼", "👩‍💼", "👨‍🚀", "👩‍🚀",
  "🧙", "🥷", "🎨", "⚡", "🔥", "💎", "🚀", "🌟", "🧠", "💡",
];

const AUTO_MEETING_TZS = [
  "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago",
  "America/New_York", "America/Toronto", "America/Sao_Paulo", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Europe/Athens", "Europe/Moscow",
  "Africa/Cairo", "Africa/Johannesburg", "Asia/Dubai", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong",
  "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
];

const AUTO_REPORT_TZS = [
  "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago",
  "America/New_York", "America/Toronto", "America/Mexico_City",
  "America/Sao_Paulo", "Europe/London", "Europe/Dublin", "Europe/Paris",
  "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Athens",
  "Europe/Moscow", "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Bangkok",
  "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo",
  "Asia/Seoul", "Australia/Perth", "Australia/Sydney", "Pacific/Auckland",
];

const DOW_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Shared styles ─────────────────────────────────────────────────────────
const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: ".68rem",
  fontWeight: 700,
  letterSpacing: ".02em",
};
const card: React.CSSProperties = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: 14,
  padding: 18,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
};
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 99999,
  padding: 20,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function showToast(msg: string) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { showToast?: (m: string) => void };
  if (typeof w.showToast === "function") w.showToast(msg);
}

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function readTasks(officerId: string, limit = 200): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem("ig_officer_tasks_" + officerId) || "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string").slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

function downloadFile(
  filename: string,
  content: string,
  mime = "text/markdown;charset=utf-8",
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function reportToMarkdown(title: string, j: DailyReportResponse): string {
  const r = j.report || {};
  const lines: string[] = [];
  lines.push(`# Daily Report — ${title}`);
  lines.push(`_Generated ${new Date(j.generatedAt || Date.now()).toLocaleString()}_\n`);
  lines.push(`## Summary\n${r.summary || ""}\n`);
  lines.push(`## Tasks Reviewed`);
  (r.tasksReviewed || []).forEach((tr) =>
    lines.push(
      `- **[${tr.status || "—"}]** ${tr.task || ""}\n  - _Evidence:_ ${tr.evidence || ""}`,
    ),
  );
  lines.push(`\n## Successes`);
  (r.successes || []).forEach((s) => lines.push(`- ${s}`));
  if (!(r.successes || []).length) lines.push(`_None recorded_`);
  lines.push(`\n## Issues`);
  (r.issues || []).forEach((s) => lines.push(`- ${s}`));
  if (!(r.issues || []).length) lines.push(`_None recorded_`);
  lines.push(`\n## Action Plan`);
  (r.actionPlan || []).forEach((a) => {
    if (typeof a === "string") lines.push(`- **[med]** ${a}`);
    else lines.push(`- **[${a.priority || "med"}]** ${a.step || a.action || ""}`);
  });
  lines.push(
    `\n## Raw Platform Snapshot\n\`\`\`json\n${JSON.stringify(j.snapshot || {}, null, 2)}\n\`\`\``,
  );
  return lines.join("\n");
}

function meetingToMarkdown(m: Meeting): string {
  const lines: string[] = [];
  lines.push(`# Meeting Minutes — ${m.topic || ""}`);
  lines.push(`_${new Date(m.scheduledAt || Date.now()).toLocaleString()}_\n`);
  lines.push(`**Attendees:** ${(m.attendees || []).join(", ")}\n`);
  if (m.mandatoryAttendance) lines.push(`_Mandatory full-team attendance_\n`);
  lines.push(`## Discussion`);
  (m.discussion || []).forEach((p) => lines.push(`\n${p}`));
  if ((m.departmentUpdates || []).length) {
    lines.push(`\n## Department Updates`);
    (m.departmentUpdates || []).forEach((u) => {
      lines.push(`\n### ${u.officer || "Officer"}`);
      lines.push(`- **What works:** ${u.whatWorks || "—"}`);
      lines.push(`- **What does not work:** ${u.whatDoesNotWork || "—"}`);
      lines.push(`- **Why:** ${u.why || "—"}`);
      lines.push(`- **Remedial action:** ${u.remedialAction || "—"}`);
    });
  }
  lines.push(`\n## Decisions`);
  (m.decisions || []).forEach((d) => lines.push(`- ${d}`));
  if (!(m.decisions || []).length) lines.push(`_None_`);
  lines.push(`\n## Action Items / Plan of Action`);
  (m.actionItems || []).forEach((a) =>
    lines.push(
      `- **${a.owner || "?"}** — ${a.action || ""} _(due: ${a.dueIn || "—"} · ${a.status || "agreed"}${a.implementedAt ? ` · done ${a.implementedAt}` : ""})_`,
    ),
  );
  if (!(m.actionItems || []).length) lines.push(`_None_`);
  return lines.join("\n");
}

function autoReportToMarkdown(j: AutoReportRun): string {
  const lines: string[] = [
    `# AI Team — Daily Stand-up`,
    `_${j.fmtDate || new Date().toLocaleDateString()}_`,
    "",
    `**Officers reporting:** ${(j.reports || []).length}`,
    "",
  ];
  (j.reports || []).forEach((r) => {
    const rep = r.report || {};
    const tr = rep.tasksReviewed || [];
    const done = tr.filter((t) => t.status === "done").length;
    const ip = tr.filter((t) => t.status === "in_progress").length;
    const blk = tr.filter((t) => t.status === "blocked").length;
    const ns = tr.filter((t) => t.status === "not_started").length;
    lines.push(
      `## ${r.title}`,
      "",
      rep.summary || "(no summary)",
      "",
      `**Status:** ✓ ${done} done · ◐ ${ip} in progress · ⚠ ${blk} blocked · ○ ${ns} not started`,
      "",
    );
    if ((rep.successes || []).length) {
      lines.push("### Wins");
      rep.successes!.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if ((rep.issues || []).length) {
      lines.push("### Issues");
      rep.issues!.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if ((rep.actionPlan || []).length) {
      lines.push("### Action Plan");
      rep.actionPlan!.forEach((a) => {
        if (typeof a === "string") lines.push(`- **[med]** ${a}`);
        else lines.push(`- **[${a.priority || "med"}]** ${a.step || a.action || ""}`);
      });
      lines.push("");
    }
    if (tr.length) {
      lines.push("### Responsibilities reviewed");
      tr.forEach((t) => lines.push(`- [${t.status}] ${t.task} — _${t.evidence || ""}_`));
      lines.push("");
    }
    lines.push("---", "");
  });
  return lines.join("\n");
}

function agoFrom(iso?: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function fmtIso(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}
function fmtUptime(sec?: number): string {
  const s = sec || 0;
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
}

function computePill(j: SystemStatus | null): { color: string; label: string } {
  if (!j || !j.checks) return { color: "#EF4444", label: "OFFLINE — unreachable" };
  const checks = j.checks;
  const blockers = ["server", "database", "aiProvider", "scheduler"].filter(
    (k) => !checks[k]?.ok,
  );
  const off = ["autoReport", "autoMeetings"].filter((k) => !checks[k]?.ok);
  if (blockers.length)
    return {
      color: "#EF4444",
      label: `OFFLINE — ${blockers.length} issue${blockers.length > 1 ? "s" : ""}`,
    };
  if (off.length === 2) return { color: "#F59E0B", label: "LIVE — schedulers paused" };
  if (off.length === 1) return { color: "#10B981", label: "LIVE — partial schedule" };
  return { color: "#10B981", label: "LIVE — fully autonomous" };
}

// Render a bullet list mirroring the legacy `list()` helper (strings or objects).
function BulletList({
  items,
  tone,
}: {
  items?: (string | ActionPlanItem)[];
  tone?: string;
}) {
  const arr = items || [];
  if (!arr.length)
    return (
      <div style={{ fontSize: ".82rem", color: "#94A3B8", fontStyle: "italic" }}>
        None
      </div>
    );
  return (
    <ul
      style={{
        margin: "6px 0 0 18px",
        padding: 0,
        fontSize: ".86rem",
        color: tone || "#0F172A",
        lineHeight: 1.6,
      }}
    >
      {arr.map((x, i) => {
        const text =
          typeof x === "string"
            ? x
            : String(x.step || x.title || JSON.stringify(x));
        const priority = typeof x === "object" ? x.priority : undefined;
        return (
          <li key={i}>
            {text}
            {priority ? (
              <span style={{ fontSize: ".65rem", color: "#64748B" }}>
                {" "}
                ({priority})
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════════
export default function AiTeam() {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<"officers" | "briefing">("officers");
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [statusPill, setStatusPill] = useState<{ color: string; label: string }>({
    color: "#94A3B8",
    label: "Checking…",
  });
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  // Modal / overlay state
  const [tasksModal, setTasksModal] = useState<{ id: string; title: string } | null>(null);
  const [reportModal, setReportModal] = useState<{ id: string; title: string } | null>(null);
  const [avatarPicker, setAvatarPicker] = useState<{ id: string; x: number; y: number } | null>(null);
  const [showStatusPanel, setShowStatusPanel] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [meetingDetail, setMeetingDetail] = useState<Meeting | null>(null);
  const [autoMeetingSettings, setAutoMeetingSettings] = useState<AutoMeetingSettings | null>(null);
  const [autoReportSettings, setAutoReportSettings] = useState<AutoReportSettings | null>(null);
  const [autoReportViewer, setAutoReportViewer] = useState<AutoReportRun | null>(null);

  // Refresh counters per panel
  const [meetingsRefresh, setMeetingsRefresh] = useState(0);
  const [autoMeetingRefresh, setAutoMeetingRefresh] = useState(0);
  const [autoReportRefresh, setAutoReportRefresh] = useState(0);

  const recomputeTaskCounts = useCallback(() => {
    const counts: Record<string, number> = {};
    OFFICERS.forEach((o) => {
      counts[o.id] = readTasks(o.id).length;
    });
    setTaskCounts(counts);
  }, []);

  const loadAvatars = useCallback(async () => {
    const j = await apiGet<{ avatars?: Record<string, string> }>(
      "/api/officer/avatars",
    );
    if (j && typeof j.avatars === "object" && !Array.isArray(j.avatars)) {
      setAvatars(j.avatars as Record<string, string>);
    } else {
      setAvatars({});
    }
  }, []);

  const refreshStatusPill = useCallback(async () => {
    const j = await apiGet<SystemStatus>("/api/officer/system-status");
    if (j && j.checks) {
      setSystemStatus(j);
      setStatusPill(computePill(j));
    } else {
      setStatusPill({ color: "#EF4444", label: "OFFLINE — unreachable" });
    }
  }, []);

  useEffect(() => {
    loadAvatars();
    recomputeTaskCounts();
  }, [loadAvatars, recomputeTaskCounts]);

  useEffect(() => {
    refreshStatusPill();
    const int = setInterval(refreshStatusPill, 30000);
    return () => clearInterval(int);
  }, [refreshStatusPill]);

  const onAvatarChanged = useCallback(
    (officerId: string, avatar: string) => {
      setAvatars((prev) => ({ ...prev, [officerId]: avatar }));
      setAvatarPicker(null);
    },
    [],
  );

  return (
    <div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}`}</style>

      {/* Top-level tab bar: AI Officers vs Briefing Room */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--border,#E5E7EB)", marginBottom: 22, paddingLeft: 4, gap: 0 }}>
        {([["officers", "🤖 AI Officer Team"], ["briefing", "🧠 Briefing Room"]] as ["officers" | "briefing", string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setMainTab(t)}
            style={{
              padding: "12px 22px", border: "none",
              borderBottom: mainTab === t ? "2px solid #7C3AED" : "2px solid transparent",
              marginBottom: -2,
              background: "none", cursor: "pointer", fontSize: ".88rem",
              fontWeight: mainTab === t ? 800 : 600,
              color: mainTab === t ? "#7C3AED" : "var(--text-muted,#6B7280)",
              transition: "color .15s, border-color .15s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mainTab === "briefing" && <BriefingRoom />}
      {mainTab === "officers" && <>

      {/* Header */}
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto 22px",
          padding: "24px 28px",
          background:
            "radial-gradient(ellipse 80% 70% at 8% 20%, rgba(15,118,110,0.16), transparent 55%), radial-gradient(ellipse 60% 50% at 92% 80%, rgba(2,132,199,0.14), transparent 50%), linear-gradient(135deg, #e8f6f3 0%, #eaf2fb 48%, #eef4ff 100%)",
          color: "#0f172a",
          borderRadius: 18,
          border: "1px solid rgba(15, 118, 110, 0.16)",
          boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: ".72rem",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "#0f766e",
                fontWeight: 800,
              }}
            >
              YOUR AI TEAM
            </div>
            <h1 style={{ margin: "8px 0 6px", fontSize: "1.85rem", fontWeight: 800, color: "#0f172a" }}>
              {rosterCountLabel(OFFICERS.length)} AI executives, one team
            </h1>
            <p style={{ margin: 0, fontSize: ".92rem", color: "#475569", maxWidth: 720 }}>
              Each officer handles a function full-time. Click any role to open their
              office. Pick an avatar, assign tasks, run daily reports, and schedule
              cross-functional meetings — all minutes downloadable.
            </p>
          </div>
          <button
            title="Click for full system status"
            onClick={() => setShowStatusPanel(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.72)",
              border: "1px solid rgba(15, 118, 110, 0.22)",
              color: "#0f172a",
              padding: "8px 14px",
              borderRadius: 99,
              fontSize: ".78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: statusPill.color,
                boxShadow: `0 0 0 3px ${statusPill.color}33`,
                animation: "pulse 2s infinite",
              }}
            />
            <span>{statusPill.label}</span>
          </button>
        </div>
      </div>

      {/* Officer grid */}
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 28px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
          gap: 18,
        }}
      >
        {OFFICERS.map((o) => (
          <OfficerCard
            key={o.id}
            officer={o}
            avatar={resolveAvatar(o.id, avatars[o.id], o.icon)}
            taskCount={taskCounts[o.id] || 0}
            onNav={(v) => goToView(router, v)}
            onAvatar={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setAvatarPicker({ id: o.id, x: rect.left, y: rect.bottom + 6 });
            }}
            onTasks={() => setTasksModal({ id: o.id, title: o.title })}
            onReport={() => setReportModal({ id: o.id, title: o.title })}
          />
        ))}
      </div>

      {/* Autonomous Daily Report scheduler */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 28px 0" }}>
        <AutoReportPanel
          refresh={autoReportRefresh}
          onSettings={(s) => setAutoReportSettings(s)}
          onView={(j) => setAutoReportViewer(j)}
        />
      </div>

      {/* Autonomous Team Meetings scheduler */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
        <AutoMeetingsPanel
          refresh={autoMeetingRefresh}
          onSettings={(s) => setAutoMeetingSettings(s)}
          onMeetingCreated={(m) => {
            setMeetingsRefresh((n) => n + 1);
            if (m) setMeetingDetail(m);
          }}
          onSelfRefresh={() => setAutoMeetingRefresh((n) => n + 1)}
        />
      </div>

      {/* Officer Meetings */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
        <MeetingsPanel
          refresh={meetingsRefresh}
          onSchedule={() => setScheduleOpen(true)}
          onView={(m) => setMeetingDetail(m)}
          onChanged={() => setMeetingsRefresh((n) => n + 1)}
        />
      </div>

      {/* Modals */}
      {avatarPicker && (
        <AvatarPicker
          officerId={avatarPicker.id}
          x={avatarPicker.x}
          y={avatarPicker.y}
          onClose={() => setAvatarPicker(null)}
          onChanged={onAvatarChanged}
        />
      )}
      {tasksModal && (
        <TasksModal
          officerId={tasksModal.id}
          officerTitle={tasksModal.title}
          onClose={() => {
            setTasksModal(null);
            recomputeTaskCounts();
          }}
        />
      )}
      {reportModal && (
        <DailyReportModal
          officerId={reportModal.id}
          officerTitle={reportModal.title}
          onClose={() => setReportModal(null)}
        />
      )}
      {showStatusPanel && (
        <SystemStatusPanel
          status={systemStatus}
          onClose={() => setShowStatusPanel(false)}
          onRefresh={async () => {
            await refreshStatusPill();
          }}
        />
      )}
      {scheduleOpen && (
        <ScheduleMeetingModal
          avatars={avatars}
          onClose={() => setScheduleOpen(false)}
          onCreated={(m) => {
            setScheduleOpen(false);
            setMeetingsRefresh((n) => n + 1);
            if (m) setMeetingDetail(m);
          }}
        />
      )}
      {meetingDetail && (
        <MeetingDetailModal
          meeting={meetingDetail}
          onClose={() => setMeetingDetail(null)}
          onUpdated={(m) => {
            setMeetingDetail(m);
            setMeetingsRefresh((n) => n + 1);
          }}
        />
      )}
      {autoMeetingSettings && (
        <AutoMeetingSettingsModal
          current={autoMeetingSettings}
          onClose={() => setAutoMeetingSettings(null)}
          onSaved={() => {
            setAutoMeetingSettings(null);
            setAutoMeetingRefresh((n) => n + 1);
          }}
        />
      )}
      {autoReportSettings && (
        <AutoReportSettingsModal
          current={autoReportSettings}
          onClose={() => setAutoReportSettings(null)}
          onSaved={() => {
            setAutoReportSettings(null);
            setAutoReportRefresh((n) => n + 1);
          }}
        />
      )}
      {autoReportViewer && (
        <AutoReportViewer run={autoReportViewer} onClose={() => setAutoReportViewer(null)} />
      )}
      </>}
    </div>
  );
}

// ── Officer card ─────────────────────────────────────────────────────────────
function OfficerCard({
  officer,
  avatar,
  taskCount,
  onNav,
  onAvatar,
  onTasks,
  onReport,
}: {
  officer: Officer;
  avatar?: string;
  taskCount: number;
  onNav: (view: string) => void;
  onAvatar: (e: React.MouseEvent) => void;
  onTasks: () => void;
  onReport: () => void;
}) {
  const av = typeof avatar === "string" && avatar ? avatar : officer.icon;
  const isImg = typeof av === "string" && isAvatarImage(av);
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 10 }}>
        <button
          title="Change avatar"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAvatar(e);
          }}
          style={{
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: isImg
              ? "#e2e8f0"
              : "linear-gradient(135deg,#0f766e,#0284c7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            flexShrink: 0,
            border: "2px solid rgba(15, 118, 110, 0.18)",
            cursor: "pointer",
            padding: 0,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
          }}
        >
          {isImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={av}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
            />
          ) : (
            av
          )}
          <span
            style={{
              position: "absolute",
              bottom: -1,
              right: -1,
              background: "#fff",
              border: "1px solid #E2E8F0",
              borderRadius: "50%",
              width: 18,
              height: 18,
              fontSize: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748B",
            }}
          >
            ✏️
          </span>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>
            {officer.title}
            {officer.isNew && (
              <span style={{ ...pill, background: "#DCFCE7", color: "#166534", marginLeft: 6 }}>
                NEW
              </span>
            )}
          </div>
          <div style={{ fontSize: ".78rem", color: "#64748B", marginTop: 2 }}>
            {officer.role}
          </div>
        </div>
        <span style={{ ...pill, background: "#DCFCE7", color: "#166534" }}>● ON DUTY</span>
      </div>
      <div style={{ marginTop: 10 }}>
        {officer.links.map(([v, l]) => (
          <a
            key={v}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNav(v);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 11px",
              background: "#F1F5F9",
              border: "1px solid #E2E8F0",
              borderRadius: 8,
              fontSize: ".74rem",
              fontWeight: 700,
              color: "#1E293B",
              textDecoration: "none",
              margin: "3px 4px 0 0",
            }}
          >
            → {l}
          </a>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px dashed #E2E8F0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: ".72rem", color: "#64748B" }}>
          <strong style={{ color: "#0F172A" }}>{taskCount}</strong>{" "}
          {taskCount === 1 ? "task" : "tasks"} assigned
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={onTasks}
            style={{
              padding: "6px 11px",
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: ".72rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📋 Tasks
          </button>
          <button
            onClick={onReport}
            style={{
              padding: "6px 11px",
              background: '#eef4ff',
              color: "#0f172a",
              border: "none",
              borderRadius: 8,
              fontSize: ".72rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📊 Daily Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Avatar picker popover ────────────────────────────────────────────────────
function AvatarPicker({
  officerId,
  x,
  y,
  onClose,
  onChanged,
}: {
  officerId: string;
  x: number;
  y: number;
  onClose: () => void;
  onChanged: (officerId: string, avatar: string) => void;
}) {
  const [status, setStatus] = useState("");
  // Portrait grid + emoji grid + upload controls — keep on-screen for bottom cards
  // (Technical Manager) by flipping above the anchor when needed.
  const PICKER_H = 420;
  const left = useMemo(
    () => Math.max(8, Math.min((typeof window !== "undefined" ? window.innerWidth : 1024) - 280, x)),
    [x],
  );
  const top = useMemo(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    if (y + PICKER_H > vh - 8) return Math.max(8, y - PICKER_H - 52);
    return Math.max(8, Math.min(y, vh - PICKER_H - 8));
  }, [y]);

  useEffect(() => {
    const onDocClick = () => onClose();
    const t = setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick, true);
    };
  }, [onClose]);

  async function pickEmoji(em: string) {
    onChanged(officerId, em);
    await apiPost("/api/officer/avatars", { role: officerId, avatar: em });
  }

  async function uploadImage(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setStatus("❌ Image must be under 5MB");
      return;
    }
    setStatus("⏳ Uploading…");
    try {
      const fd = new FormData();
      fd.append("role", officerId);
      fd.append("image", file);
      const r = await fetch("/api/officer/avatar-upload", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !j.url) {
        setStatus("❌ " + (j.error || "upload failed"));
        return;
      }
      onChanged(officerId, j.url);
    } catch (e) {
      setStatus("❌ " + (e instanceof Error ? e.message : "upload failed"));
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top,
        left,
        background: "#fff",
        border: "1px solid #E2E8F0",
        borderRadius: 12,
        padding: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        zIndex: 99998,
        width: 268,
        maxHeight: "min(420px, calc(100vh - 16px))",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          fontSize: ".7rem",
          color: "#64748B",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 8,
        }}
      >
        Team portraits
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 6,
          marginBottom: 12,
        }}
      >
        {Object.entries(DEFAULT_AVATARS).map(([id, src]) => (
          <button
            key={id}
            title={id}
            onClick={() => pickEmoji(src)}
            style={{
              width: 52,
              height: 52,
              border: "1px solid #E2E8F0",
              background: "#fff",
              borderRadius: "50%",
              cursor: "pointer",
              padding: 0,
              overflow: "hidden",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </button>
        ))}
      </div>
      <div
        style={{
          fontSize: ".7rem",
          color: "#64748B",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 8,
        }}
      >
        Or pick an emoji
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,1fr)",
          gap: 4,
          marginBottom: 12,
        }}
      >
        {AVATAR_GALLERY.map((em) => (
          <button
            key={em}
            onClick={() => pickEmoji(em)}
            style={{
              width: 36,
              height: 36,
              border: "1px solid #F1F5F9",
              background: "#fff",
              borderRadius: 8,
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {em}
          </button>
        ))}
      </div>
      <div
        style={{
          fontSize: ".7rem",
          color: "#64748B",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 6,
        }}
      >
        Or upload an image
      </div>
      <label
        style={{
          display: "block",
          width: "100%",
          padding: "9px 12px",
          background: "linear-gradient(135deg,#0f766e,#0284c7)",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontSize: ".8rem",
          fontWeight: 700,
          cursor: "pointer",
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        📷 Choose image…
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) uploadImage(f);
          }}
        />
      </label>
      {status && (
        <div
          style={{
            fontSize: ".7rem",
            color: "#64748B",
            marginTop: 6,
            textAlign: "center",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

// ── Tasks modal ──────────────────────────────────────────────────────────────
function TasksModal({
  officerId,
  officerTitle,
  onClose,
}: {
  officerId: string;
  officerTitle: string;
  onClose: () => void;
}) {
  const storeKey = "ig_officer_tasks_" + officerId;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>(() => readTasks(officerId, 200));
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState("");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const j = await apiPost<{ tasks?: string[] }>("/api/officer/tasks", {
      role: officerId,
      title: officerTitle,
    });
    setSuggestions(Array.isArray(j.tasks) ? j.tasks : []);
    setLoading(false);
  }, [officerId, officerTitle]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const all = useMemo(
    () => [...new Set([...suggestions, ...saved])],
    [suggestions, saved],
  );

  function toggle(t: string, checked: boolean) {
    setSaved((prev) =>
      checked ? (prev.includes(t) ? prev : [...prev, t]) : prev.filter((x) => x !== t),
    );
  }
  function addCustom() {
    const v = custom.trim();
    if (!v) return;
    setSaved((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setCustom("");
  }
  async function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(saved));
    } catch {
      /* ignore quota */
    }
    await apiPost("/api/officer/tasks-store", { role: officerId, tasks: saved });
    showToast(
      `✓ Saved ${saved.length} ${saved.length === 1 ? "task" : "tasks"} for ${officerTitle}`,
    );
    onClose();
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 640,
          maxWidth: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#fff" }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.9 }}>
            📋 Job Responsibilities
          </div>
          <h3 style={{ margin: "6px 0 4px", fontSize: "1.3rem", fontWeight: 800 }}>{officerTitle}</h3>
          <p style={{ margin: 0, fontSize: ".85rem", opacity: 0.95 }}>
            Pick the tasks you want this AI employee to own. You can add custom ones too.
          </p>
        </div>
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ fontSize: ".84rem", color: "#64748B" }}>
            <strong style={{ color: "#0F172A" }}>{saved.length}</strong> selected ·{" "}
            <strong>{loading ? "—" : suggestions.length}</strong> suggested
          </div>
          <button
            onClick={fetchTasks}
            style={{
              padding: "7px 14px",
              background: "#F1F5F9",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              fontSize: ".78rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🔄 Regenerate with AI
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "#64748B", padding: 30 }}>
              ⏳ Asking AI for relevant tasks…
            </div>
          ) : all.length === 0 ? (
            <div style={{ textAlign: "center", color: "#94A3B8", padding: 30 }}>
              No suggestions returned.
            </div>
          ) : (
            all.map((t, i) => {
              const checked = saved.includes(t);
              const isCustom = !suggestions.includes(t);
              return (
                <label
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    border: `1px solid ${checked ? "#7C3AED" : "#E2E8F0"}`,
                    borderRadius: 9,
                    marginBottom: 6,
                    cursor: "pointer",
                    background: checked ? "#FAF5FF" : "#fff",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggle(t, e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: ".88rem", color: "#0F172A", fontWeight: 600 }}>{t}</div>
                    {isCustom && (
                      <div style={{ fontSize: ".66rem", color: "#7C3AED", marginTop: 2, fontWeight: 700 }}>
                        CUSTOM
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="+ Add custom responsibility…"
            style={{ flex: 1, padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: ".86rem" }}
          />
          <button
            onClick={addCustom}
            style={{
              padding: "9px 14px",
              background: "#0EA5E9",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            background: "#F8FAFC",
          }}
        >
          <button
            onClick={onClose}
            style={{ padding: "10px 18px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{
              padding: "10px 22px",
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Save Responsibilities
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Daily report modal ───────────────────────────────────────────────────────
function statusPillNode(s?: string) {
  const map: Record<string, [string, string, string]> = {
    done: ["#15803D", "#DCFCE7", "✓ Done"],
    in_progress: ["#A16207", "#FEF3C7", "◐ In progress"],
    blocked: ["#B91C1C", "#FEE2E2", "⚠ Blocked"],
    not_started: ["#64748B", "#F1F5F9", "○ Not started"],
  };
  const [c, bg, lab] = map[s || "not_started"] || map.not_started;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: ".68rem",
        fontWeight: 700,
        color: c,
        background: bg,
      }}
    >
      {lab}
    </span>
  );
}

function DailyReportModal({
  officerId,
  officerTitle,
  onClose,
}: {
  officerId: string;
  officerTitle: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<DailyReportResponse | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const tasks = readTasks(officerId, 40);
      const j = await apiPost<DailyReportResponse>("/api/officer/daily-report", {
        role: officerId,
        title: officerTitle,
        tasks,
      });
      if (!live) return;
      if (j.error) {
        setError(j.error);
        setLoading(false);
        return;
      }
      setData(j);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [officerId, officerTitle]);

  const rep = data?.report || {};

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 760,
          maxWidth: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", color: '#0f172a' }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.8 }}>
            📊 Daily Report
          </div>
          <h3 style={{ margin: "6px 0 4px", fontSize: "1.3rem", fontWeight: 800 }}>{officerTitle}</h3>
          <p style={{ margin: 0, fontSize: ".85rem", opacity: 0.85 }}>{new Date().toLocaleString()}</p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          {loading && (
            <div style={{ textAlign: "center", color: "#64748B", padding: 40 }}>
              ⏳ Cross-checking your tasks against real platform data…
            </div>
          )}
          {error && (
            <div style={{ color: "#B91C1C", padding: 30, textAlign: "center" }}>
              Failed to generate report: {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              <div
                style={{
                  background: "#F8FAFC",
                  borderLeft: "3px solid #7C3AED",
                  padding: "12px 14px",
                  borderRadius: 6,
                  marginBottom: 18,
                }}
              >
                <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>
                  Executive Summary
                </div>
                <div style={{ fontSize: ".92rem", color: "#0F172A", lineHeight: 1.5 }}>
                  {rep.summary || "No summary"}
                </div>
              </div>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: ".78rem", color: "#0F172A", fontWeight: 800, marginBottom: 8 }}>
                  Tasks reviewed ({(rep.tasksReviewed || []).length})
                </div>
                {(rep.tasksReviewed || []).length ? (
                  (rep.tasksReviewed || []).map((tr, i) => (
                    <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                        <div style={{ fontSize: ".86rem", color: "#0F172A", fontWeight: 600, flex: 1 }}>{tr.task || ""}</div>
                        {statusPillNode(tr.status)}
                      </div>
                      <div style={{ fontSize: ".74rem", color: "#64748B" }}>{tr.evidence || ""}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#94A3B8", fontStyle: "italic" }}>No tasks assigned yet.</div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: ".78rem", color: "#15803D", fontWeight: 800, marginBottom: 4 }}>✓ Successes</div>
                  <BulletList items={rep.successes} tone="#15803D" />
                </div>
                <div>
                  <div style={{ fontSize: ".78rem", color: "#B91C1C", fontWeight: 800, marginBottom: 4 }}>⚠ Issues</div>
                  <BulletList items={rep.issues} tone="#B91C1C" />
                </div>
              </div>
              <div>
                <div style={{ fontSize: ".78rem", color: "#0F172A", fontWeight: 800, marginBottom: 4 }}>📋 Action Plan</div>
                <BulletList items={rep.actionPlan} />
              </div>
              <details style={{ marginTop: 18 }}>
                <summary style={{ cursor: "pointer", fontSize: ".74rem", color: "#64748B" }}>
                  View raw platform snapshot
                </summary>
                <pre style={{ fontSize: ".7rem", background: "#F8FAFC", padding: 10, borderRadius: 6, overflow: "auto" }}>
                  {JSON.stringify(data.snapshot || {}, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            background: "#F8FAFC",
          }}
        >
          <button
            onClick={onClose}
            style={{ padding: "10px 18px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Close
          </button>
          <button
            disabled={!data}
            onClick={() => {
              if (!data) return;
              downloadFile(
                `${officerId}-daily-report-${new Date().toISOString().slice(0, 10)}.md`,
                reportToMarkdown(officerTitle, data),
              );
            }}
            style={{
              padding: "10px 22px",
              background: '#eef4ff',
              color: "#0f172a",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              cursor: "pointer",
              opacity: data ? 1 : 0.4,
            }}
          >
            📥 Download Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Meetings panel ───────────────────────────────────────────────────────────
function MeetingsPanel({
  refresh,
  onSchedule,
  onView,
  onChanged,
}: {
  refresh: number;
  onSchedule: () => void;
  onView: (m: Meeting) => void;
  onChanged: () => void;
}) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const j = await apiGet<{ meetings?: Meeting[] }>("/api/officer/meetings");
      if (live) setMeetings(Array.isArray(j.meetings) ? j.meetings : []);
    })();
    return () => {
      live = false;
    };
  }, [refresh]);

  async function del(id: string) {
    if (!confirm("Delete this meeting?")) return;
    await apiFetchDelete("/api/officer/meetings/" + encodeURIComponent(id));
    onChanged();
  }

  return (
    <div style={{ ...card, marginTop: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Cross-functional
          </div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A" }}>🗓️ Officer Meetings</div>
        </div>
        <button
          onClick={onSchedule}
          style={{
            padding: "9px 16px",
            background: "linear-gradient(135deg,#0f766e,#0284c7)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Schedule Meeting
        </button>
      </div>
      {meetings.length === 0 ? (
        <div style={{ color: "#94A3B8", fontStyle: "italic", padding: 20, textAlign: "center", background: "#F8FAFC", borderRadius: 8 }}>
          No meetings yet. Schedule one to get cross-functional alignment + AI-drafted minutes.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {meetings.map((m) => (
            <div key={m.id} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: ".95rem", color: "#0F172A", fontWeight: 700, marginBottom: 3 }}>{m.topic || ""}</div>
                  <div style={{ fontSize: ".72rem", color: "#64748B" }}>
                    {new Date(m.scheduledAt || Date.now()).toLocaleString()} ·{" "}
                    {(m.attendees || []).join(" · ")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => onView(m)}
                    style={{ padding: "6px 12px", background: '#eef4ff', color: "#0f172a", border: "none", borderRadius: 7, fontSize: ".74rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => downloadFile(`meeting-${m.id}.md`, meetingToMarkdown(m))}
                    style={{ padding: "6px 12px", background: "#0EA5E9", color: "#0f172a", border: "none", borderRadius: 7, fontSize: ".74rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    📥 Minutes
                  </button>
                  <button
                    title="Delete"
                    onClick={() => del(m.id)}
                    style={{ padding: "6px 10px", background: "#FEE2E2", color: "#B91C1C", border: "none", borderRadius: 7, fontSize: ".74rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// DELETE helper kept local (lib/api exposes apiDelete, but the legacy panel uses
// a path-only DELETE with no body).
async function apiFetchDelete(path: string): Promise<void> {
  try {
    await fetch(path, { method: "DELETE", credentials: "same-origin" });
  } catch {
    /* best-effort, mirrors legacy */
  }
}

// ── Schedule meeting modal ───────────────────────────────────────────────────
function ScheduleMeetingModal({
  avatars,
  onClose,
  onCreated,
}: {
  avatars: Record<string, string>;
  onClose: () => void;
  onCreated: (m: Meeting | null) => void;
}) {
  const [topic, setTopic] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  async function go() {
    const attendees = OFFICERS.filter((o) => picked[o.id]).map((o) => o.title);
    if (!topic.trim() || attendees.length < 2) {
      alert("Pick at least 2 attendees and enter a topic.");
      return;
    }
    const tasksByRole: Record<string, string[]> = {};
    OFFICERS.filter((o) => picked[o.id]).forEach((o) => {
      tasksByRole[o.title] = readTasks(o.id, 15);
    });
    setBusy(true);
    const j = await apiPost<{ meeting?: Meeting; error?: string }>("/api/officer/meetings", {
      topic: topic.trim(),
      attendees,
      tasksByRole,
    });
    if (j.error) {
      setBusy(false);
      alert("Failed: " + j.error);
      return;
    }
    onCreated(j.meeting || null);
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 560,
          maxWidth: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#fff" }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.9 }}>
            🗓️ Schedule Meeting
          </div>
          <h3 style={{ margin: "6px 0 0", fontSize: "1.25rem", fontWeight: 800 }}>Cross-functional alignment</h3>
        </div>
        <div style={{ padding: "18px 24px", flex: 1, overflowY: "auto" }}>
          <label style={{ display: "block", fontSize: ".78rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
            Topic
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Q4 launch readiness across Marketing, Sales and Content"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: ".88rem", marginBottom: 14, boxSizing: "border-box" }}
          />
          <label style={{ display: "block", fontSize: ".78rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
            Attendees (pick at least 2)
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {OFFICERS.map((o) => {
              const av = resolveAvatar(o.id, avatars[o.id], o.icon);
              const img = isAvatarImage(av);
              return (
              <label
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: ".84rem",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!picked[o.id]}
                  onChange={(e) => setPicked((p) => ({ ...p, [o.id]: e.target.checked }))}
                  style={{ margin: 0 }}
                />
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={av} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <span>{av}</span>
                )}{" "}
                {o.title}
              </label>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8, background: "#F8FAFC" }}>
          <button
            onClick={onClose}
            style={{ padding: "10px 18px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={go}
            disabled={busy}
            style={{
              padding: "10px 22px",
              background: "linear-gradient(135deg,#0f766e,#0284c7)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {busy ? "⏳ Drafting minutes…" : "Schedule + Draft Minutes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Meeting detail modal ─────────────────────────────────────────────────────
function MeetingDetailModal({
  meeting,
  onClose,
  onUpdated,
}: {
  meeting: Meeting;
  onClose: () => void;
  onUpdated?: (m: Meeting) => void;
}) {
  const [m, setM] = useState(meeting);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setM(meeting);
  }, [meeting]);

  async function setActionStatus(actionId: string, status: "agreed" | "in_progress" | "implemented") {
    setBusyId(actionId);
    const j = await apiPost<{ ok?: boolean; meeting?: Meeting; error?: string }>(
      `/api/officer/meetings/${encodeURIComponent(m.id)}/action-status`,
      { actionId, status },
    );
    setBusyId(null);
    if (j.error || !j.meeting) {
      alert(j.error || "Failed to update action");
      return;
    }
    setM(j.meeting);
    onUpdated?.(j.meeting);
    showToast(status === "implemented" ? "✓ Action marked implemented" : "✓ Action status updated");
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 760,
          maxWidth: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", color: '#0f172a' }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.8 }}>
            📝 Meeting Minutes
          </div>
          <h3 style={{ margin: "6px 0 4px", fontSize: "1.3rem", fontWeight: 800 }}>{m.topic || ""}</h3>
          <p style={{ margin: 0, fontSize: ".8rem", opacity: 0.85 }}>
            {new Date(m.scheduledAt || Date.now()).toLocaleString()} · {(m.attendees || []).join(" · ")}
          </p>
          {m.mandatoryAttendance ? (
            <p style={{ margin: "8px 0 0", fontSize: ".75rem", opacity: 0.9 }}>
              Full-team attendance required · each officer reports what works / what doesn’t / why / remedy
            </p>
          ) : null}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: ".78rem", fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>💬 Discussion</div>
            {(m.discussion || []).length ? (
              (m.discussion || []).map((p, i) => (
                <p key={i} style={{ fontSize: ".88rem", color: "#0F172A", lineHeight: 1.6, margin: "0 0 10px" }}>
                  {p}
                </p>
              ))
            ) : (
              <div style={{ color: "#94A3B8", fontStyle: "italic" }}>No discussion notes</div>
            )}
          </div>

          {(m.departmentUpdates || []).length ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: ".78rem", fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                Department updates (mandatory)
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {(m.departmentUpdates || []).map((u, i) => (
                  <div
                    key={`${u.officer || "officer"}-${i}`}
                    style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 14px", background: "#F8FAFC" }}
                  >
                    <div style={{ fontWeight: 800, fontSize: ".9rem", color: "#0F172A", marginBottom: 8 }}>
                      {u.officer || "Officer"}
                    </div>
                    <div style={{ display: "grid", gap: 6, fontSize: ".82rem", lineHeight: 1.45, color: "#334155" }}>
                      <div>
                        <strong style={{ color: "#047857" }}>What works:</strong> {u.whatWorks || "—"}
                      </div>
                      <div>
                        <strong style={{ color: "#B45309" }}>What does not work:</strong> {u.whatDoesNotWork || "—"}
                      </div>
                      <div>
                        <strong>Why:</strong> {u.why || "—"}
                      </div>
                      <div>
                        <strong style={{ color: "#0F766E" }}>Remedial action:</strong> {u.remedialAction || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: ".78rem", fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>✅ Decisions (agreed)</div>
            {(m.decisions || []).length ? (
              <ul style={{ margin: "0 0 0 18px", padding: 0, fontSize: ".88rem", lineHeight: 1.7, color: "#0F172A" }}>
                {(m.decisions || []).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <div style={{ color: "#94A3B8", fontStyle: "italic" }}>None</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: ".78rem", fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
              📋 Plan of Action — implement once agreed
            </div>
            {(m.actionItems || []).length ? (
              <div style={{ display: "grid", gap: 6 }}>
                {(m.actionItems || []).map((a, i) => {
                  const id = a.id || `idx_${i}`;
                  const status = a.status || "agreed";
                  const done = status === "implemented";
                  return (
                    <div
                      key={id}
                      style={{
                        border: "1px solid #E2E8F0",
                        borderRadius: 8,
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 10,
                        background: done ? "#ECFDF5" : "#fff",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: ".86rem", color: "#0F172A", fontWeight: 600 }}>{a.action || ""}</div>
                        <div style={{ fontSize: ".7rem", color: "#64748B", marginTop: 2 }}>
                          Owner: {a.owner || "?"} · due {a.dueIn || "—"}
                          {a.implementedAt ? ` · implemented ${new Date(a.implementedAt).toLocaleString()}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                        <span
                          style={{
                            ...pill,
                            background: done ? "#DCFCE7" : status === "in_progress" ? "#FEF3C7" : "#E0E7FF",
                            color: done ? "#166534" : status === "in_progress" ? "#92400E" : "#3730A3",
                          }}
                        >
                          {status}
                        </span>
                        {!done ? (
                          <button
                            type="button"
                            disabled={busyId === id}
                            onClick={() => setActionStatus(id, "implemented")}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "none",
                              background: "linear-gradient(135deg,#0f766e,#0284c7)",
                              color: "#fff",
                              fontSize: ".72rem",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            {busyId === id ? "…" : "Mark implemented"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: "#94A3B8", fontStyle: "italic" }}>None</div>
            )}
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", gap: 8, background: "#F8FAFC" }}>
          <button
            onClick={onClose}
            style={{ padding: "10px 18px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            Close
          </button>
          <button
            onClick={() => downloadFile(`meeting-${m.id}.md`, meetingToMarkdown(m))}
            style={{ padding: "10px 22px", background: "#0EA5E9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}
          >
            📥 Download Minutes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── System status panel ──────────────────────────────────────────────────────
function SystemStatusPanel({
  status,
  onClose,
  onRefresh,
}: {
  status: SystemStatus | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const j = status || { checks: {}, activity: {} };
  const checks = j.checks || {};
  const act = j.activity || {};
  const aiMissing = checks.aiProvider && !checks.aiProvider.ok;
  return (
    <div
      style={{ ...overlayStyle, background: "rgba(15,23,42,0.65)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 600,
          maxWidth: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            color: '#0f172a',
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.85 }}>
              AI Team Health
            </div>
            <h3 style={{ margin: "4px 0 0", fontSize: "1.2rem", fontWeight: 800 }}>
              {j.ok ? "🟢 System Live" : "🔴 System Degraded"}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#0f172a", width: 34, height: 34, borderRadius: "50%", fontSize: "1.1rem", cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
            Checks
          </div>
          {Object.entries(checks).map(([k, c]) => (
            <div
              key={k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                marginBottom: 6,
                background: c.ok ? "#F0FDF4" : "#FEF2F2",
              }}
            >
              <span style={{ fontSize: "1.1rem" }}>{c.ok ? "✅" : "❌"}</span>
              <span style={{ fontSize: ".84rem", fontWeight: 700, color: "#0F172A", textTransform: "capitalize", minWidth: 110 }}>
                {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </span>
              <span style={{ fontSize: ".8rem", color: c.ok ? "#166534" : "#991B1B", flex: 1 }}>{c.label || ""}</span>
            </div>
          ))}
          {aiMissing && (
            <div
              style={{
                marginTop: 10,
                padding: "14px 14px",
                borderRadius: 10,
                border: "1px solid #FCD34D",
                background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)",
              }}
            >
              <div style={{ fontWeight: 800, color: "#92400E", fontSize: ".9rem", marginBottom: 4 }}>
                Where to add your OpenAI API key
              </div>
              <div style={{ fontSize: ".82rem", color: "#78350F", lineHeight: 1.45, marginBottom: 10 }}>
                Go to <strong>Manage → Admin Portal → Platform APIs</strong>, open the{" "}
                <strong>AI Models</strong> group, paste your key into <strong>OpenAI API Key</strong>, then Save + Test.
                (AI Team → AI Providers is for optional BYO models — not this platform key.)
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push("/manage/admin?tab=platform-keys");
                }}
                style={{
                  padding: "9px 14px",
                  background: "#0f766e",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: ".82rem",
                  cursor: "pointer",
                }}
              >
                Open Platform APIs →
              </button>
            </div>
          )}
          <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", margin: "14px 0 8px" }}>
            Recent Activity
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8 }}>
              <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700 }}>LAST DAILY REPORT</div>
              <div style={{ fontSize: ".86rem", fontWeight: 700, color: "#0F172A", marginTop: 2 }}>{agoFrom(act.lastReportAt)}</div>
              <div style={{ fontSize: ".7rem", color: "#64748B", marginTop: 2 }}>
                {fmtIso(act.lastReportAt)} · {act.totalReports || 0} total
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8 }}>
              <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700 }}>LAST MEETING</div>
              <div style={{ fontSize: ".86rem", fontWeight: 700, color: "#0F172A", marginTop: 2 }}>{agoFrom(act.lastMeetingAt)}</div>
              <div style={{ fontSize: ".7rem", color: "#64748B", marginTop: 2 }}>
                {fmtIso(act.lastMeetingAt)} · {act.totalMeetings || 0} total
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8 }}>
              <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700 }}>LAST SCHEDULER TICK</div>
              <div style={{ fontSize: ".86rem", fontWeight: 700, color: "#0F172A", marginTop: 2 }}>{agoFrom(act.lastTickAt)}</div>
              <div style={{ fontSize: ".7rem", color: "#64748B", marginTop: 2 }}>runs every 60s</div>
            </div>
            <div style={{ padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8 }}>
              <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700 }}>SERVER UPTIME</div>
              <div style={{ fontSize: ".86rem", fontWeight: 700, color: "#0F172A", marginTop: 2 }}>{fmtUptime(act.uptimeSec)}</div>
              <div style={{ fontSize: ".7rem", color: "#64748B", marginTop: 2 }}>since {fmtIso(act.serverStartedAt)}</div>
            </div>
          </div>
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8, background: "#F8FAFC" }}>
          <button
            onClick={() => onRefresh()}
            style={{ padding: "9px 16px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Autonomous meetings panel ────────────────────────────────────────────────
function AutoMeetingsPanel({
  refresh,
  onSettings,
  onMeetingCreated,
  onSelfRefresh,
}: {
  refresh: number;
  onSettings: (s: AutoMeetingSettings) => void;
  onMeetingCreated: (m: Meeting | null) => void;
  onSelfRefresh: () => void;
}) {
  const [s, setS] = useState<AutoMeetingSettings>({
    enabled: false,
    frequency: "weekly",
    dayOfWeek: 1,
    hour: 9,
    minute: 30,
    timezone: "UTC",
  });
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const j = await apiGet<{ settings?: Partial<AutoMeetingSettings> }>(
        "/api/officer/auto-meetings",
      );
      if (live && j.settings) setS((prev) => ({ ...prev, ...j.settings }));
    })();
    return () => {
      live = false;
    };
  }, [refresh]);

  const dowName = DOW_SHORT[s.dayOfWeek | 0] || "Mon";
  const scheduleLabel = s.enabled
    ? `${s.frequency === "weekly" ? dowName + " " : ""}${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} ${s.timezone}`
    : "Scheduler idle";

  async function toggleEnabled() {
    if (toggling) return;
    setToggling(true);
    const nextEnabled = !s.enabled;
    const j = await apiPost<{ ok?: boolean; settings?: AutoMeetingSettings; error?: string }>(
      "/api/officer/auto-meetings",
      {
        enabled: nextEnabled,
        frequency: s.frequency,
        dayOfWeek: s.dayOfWeek,
        hour: s.hour,
        minute: s.minute,
        timezone: s.timezone,
      },
    );
    setToggling(false);
    if (j.error || !j.settings) {
      alert(j.error || "Failed to update switch");
      return;
    }
    setS((prev) => ({ ...prev, ...j.settings }));
    showToast(nextEnabled ? "✓ Auto team meetings ON — full roster attends" : "○ Auto team meetings OFF");
    onSelfRefresh();
  }

  async function runNow() {
    setBusy(true);
    const j = await apiPost<{ meeting?: Meeting; error?: string }>(
      "/api/officer/auto-meetings/run-now",
    );
    setBusy(false);
    if (j.error) {
      alert("Failed: " + j.error);
      onSelfRefresh();
      return;
    }
    showToast("✓ Full-team meeting created with department updates");
    onMeetingCreated(j.meeting || null);
    onSelfRefresh();
  }

  return (
    <div style={{ ...card, marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Autonomous
          </div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>🗓️ Auto-Scheduled Team Meetings</span>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              aria-label="Auto-scheduled team meetings"
              title={s.enabled ? "Turn off auto-scheduled team meetings" : "Turn on auto-scheduled team meetings"}
              disabled={toggling}
              onClick={toggleEnabled}
              style={{
                position: "relative",
                width: 56,
                height: 32,
                borderRadius: 999,
                border: "none",
                cursor: toggling ? "wait" : "pointer",
                background: s.enabled ? "#0f766e" : "#CBD5E1",
                transition: "background 0.18s ease",
                flexShrink: 0,
                padding: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: s.enabled ? 27 : 3,
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 4px rgba(15,23,42,0.25)",
                  transition: "left 0.18s ease",
                }}
              />
            </button>
            <span
              style={{
                ...pill,
                background: s.enabled ? "#DCFCE7" : "#F1F5F9",
                color: s.enabled ? "#166534" : "#475569",
              }}
            >
              {s.enabled ? `ON · ${scheduleLabel}` : "OFF"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onSettings(s)}
            style={{ padding: "9px 16px", background: '#eef4ff', color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            ⚙️ Settings
          </button>
          <button
            onClick={runNow}
            disabled={busy}
            style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            {busy ? "⏳ Drafting…" : "▶ Run Now"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: ".82rem", color: "#475569", lineHeight: 1.5 }}>
        {s.enabled ? (
          <>
            <strong style={{ color: "#0F172A" }}>ON:</strong> the entire AI executive team (including the
            Technical Manager) must attend every auto-scheduled meeting. Each officer reports what works,
            what does not work, why, and the remedial action. Once agreed, actions are tracked until
            implemented. Browse minutes via <strong>Manage → Minutes of Meeting</strong>.
          </>
        ) : (
          <>
            <strong style={{ color: "#0F172A" }}>OFF:</strong> flip the switch to require full-team attendance
            with department updates (what works / what doesn’t / why / remedy) and implementation tracking
            for agreed actions. Schedule time in Settings.
          </>
        )}
      </div>
    </div>
  );
}

function AutoMeetingSettingsModal({
  current,
  onClose,
  onSaved,
}: {
  current: AutoMeetingSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(current.enabled);
  const [frequency, setFrequency] = useState(current.frequency);
  const [dayOfWeek, setDayOfWeek] = useState(current.dayOfWeek);
  const [hour, setHour] = useState(current.hour);
  const [minute, setMinute] = useState(current.minute);
  const [timezone, setTimezone] = useState(current.timezone || "UTC");
  const detectedTz = useMemo(detectedTimezone, []);

  const tzs = useMemo(() => {
    const list = [...AUTO_MEETING_TZS];
    if (detectedTz && !list.includes(detectedTz)) list.unshift(detectedTz);
    if (current.timezone && !list.includes(current.timezone)) list.unshift(current.timezone);
    return list;
  }, [detectedTz, current.timezone]);

  async function save() {
    const j = await apiPost<{ error?: string }>("/api/officer/auto-meetings", {
      enabled,
      frequency,
      dayOfWeek,
      hour,
      minute,
      timezone,
    });
    if (j.error) {
      alert(j.error || "Save failed");
      return;
    }
    showToast("✓ Auto-meeting schedule saved");
    onSaved();
  }

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #CBD5E1",
    borderRadius: 8,
    fontSize: ".88rem",
  };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 560,
          maxWidth: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", color: '#0f172a' }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.85 }}>
            🗓️ Autonomous Meetings
          </div>
          <h3 style={{ margin: "6px 0 0", fontSize: "1.25rem", fontWeight: 800 }}>Recurring AI Team Standup</h3>
        </div>
        <div style={{ padding: "20px 24px", flex: 1, overflowY: "auto" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              cursor: "pointer",
              marginBottom: 16,
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: ".92rem", color: "#0F172A" }}>Auto-schedule team meetings</div>
              <div style={{ fontSize: ".76rem", color: "#64748B" }}>
                Full roster attends. Each officer reports what works / what doesn’t / why / remedy; agreed actions are tracked to implementation.
              </div>
            </div>
          </label>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
              Frequency
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["daily", "weekly"] as const).map((f) => (
                <label
                  key={f}
                  style={{
                    flex: 1,
                    padding: 10,
                    border: `2px solid ${frequency === f ? "#7C3AED" : "#E2E8F0"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: ".84rem",
                  }}
                >
                  <input
                    type="radio"
                    name="amFreq"
                    value={f}
                    checked={frequency === f}
                    onChange={() => setFrequency(f)}
                    style={{ display: "none" }}
                  />
                  {f === "daily" ? "Daily" : "Weekly"}
                </label>
              ))}
            </div>
          </div>
          {frequency === "weekly" && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
                Day of week
              </label>
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(+e.target.value)} style={selectStyle}>
                {DOW_FULL.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Hour (24h)</label>
              <select value={hour} onChange={(e) => setHour(+e.target.value)} style={selectStyle}>
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Minute</label>
              <select value={minute} onChange={(e) => setMinute(+e.target.value)} style={selectStyle}>
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Timezone</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...selectStyle, marginBottom: 4 }}>
            {tzs.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div style={{ fontSize: ".7rem", color: "#64748B" }}>
            Detected: <strong>{detectedTz || "UTC"}</strong>
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8, background: "#F8FAFC" }}>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={save}
            style={{ padding: "10px 22px", background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Autonomous daily report panel ────────────────────────────────────────────
function AutoReportPanel({
  refresh,
  onSettings,
  onView,
}: {
  refresh: number;
  onSettings: (s: AutoReportSettings) => void;
  onView: (j: AutoReportRun) => void;
}) {
  const [s, setS] = useState<AutoReportSettings>({
    enabled: false,
    hour: 8,
    minute: 0,
    timezone: "UTC",
    email: "",
    lastRunAt: null,
    lastRunStatus: null,
  });
  const [history, setHistory] = useState<AutoReportHistoryEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await apiGet<{ settings?: Partial<AutoReportSettings>; history?: AutoReportHistoryEntry[] }>(
      "/api/officer/autoreport",
    );
    if (j.settings) setS((prev) => ({ ...prev, ...j.settings }));
    setHistory(Array.isArray(j.history) ? j.history : []);
  }, []);

  useEffect(() => {
    load();
  }, [load, refresh]);

  const statusNode = s.enabled ? (
    <span style={{ ...pill, background: "#DCFCE7", color: "#166534" }}>
      ● ON · {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")} {s.timezone}
    </span>
  ) : (
    <span style={{ ...pill, background: "#F1F5F9", color: "#475569" }}>○ OFF</span>
  );
  const last = s.lastRunAt ? `Last run: ${new Date(s.lastRunAt).toLocaleString()}` : "No autonomous runs yet";

  async function runSend() {
    setBusy("send");
    const j = await apiPost<{ officerCount?: number; slackOk?: boolean; emailOk?: boolean; error?: string }>(
      "/api/officer/autoreport/run-now",
    );
    if (j.error) alert("Run failed: " + j.error);
    else
      showToast(
        `Sent to ${j.officerCount || 8} officers · Slack ${j.slackOk ? "✓" : "✕"} · Email ${j.emailOk ? "✓" : "✕"}`,
      );
    setBusy(null);
    load();
  }
  async function viewNow() {
    setBusy("view");
    const j = await apiPost<AutoReportRun>("/api/officer/autoreport/run-now?skipDelivery=1");
    setBusy(null);
    if (j.error) {
      alert("Failed: " + j.error);
      return;
    }
    onView(j);
  }
  async function downloadNow() {
    setBusy("dl");
    const j = await apiPost<AutoReportRun>("/api/officer/autoreport/run-now?skipDelivery=1");
    setBusy(null);
    if (j.error) {
      alert("Failed: " + j.error);
      return;
    }
    downloadFile(
      `ai-team-daily-report-${new Date().toISOString().slice(0, 10)}.md`,
      autoReportToMarkdown(j),
    );
    showToast("✓ Report downloaded");
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Autonomous
          </div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A" }}>
            ⏰ Daily Report Scheduler {statusNode}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onSettings(s)}
            style={{ padding: "9px 16px", background: '#eef4ff', color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            ⚙️ Settings
          </button>
          <button
            title="Generate now and view in browser — no email, no Slack"
            onClick={viewNow}
            disabled={busy !== null}
            style={{ padding: "9px 16px", background: "#0EA5E9", color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            {busy === "view" ? "⏳ Drafting…" : "👁️ View Report"}
          </button>
          <button
            title="Generate now and download as Markdown — no email, no Slack"
            onClick={downloadNow}
            disabled={busy !== null}
            style={{ padding: "9px 16px", background: "#10B981", color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            {busy === "dl" ? "⏳ Drafting…" : "📥 Download Report"}
          </button>
          <button
            title="Generate now and send via email + Slack"
            onClick={runSend}
            disabled={busy !== null}
            style={{ padding: "9px 16px", background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
          >
            {busy === "send" ? "⏳ Running…" : "▶ Run + Send"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: ".82rem", color: "#475569", lineHeight: 1.5 }}>
        When ON, the AI Team auto-generates a report for every officer at{" "}
        <strong>
          {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}
        </strong>{" "}
        in <strong>{s.timezone || "UTC"}</strong> and sends a digest to{" "}
        <strong>{s.email || "(no email set)"}</strong> + Slack. {last}.
      </div>
      {s.lastRunStatus && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", fontSize: ".74rem" }}>
          <span
            style={{
              ...pill,
              background: s.lastRunStatus.slackOk ? "#DCFCE7" : "#FEE2E2",
              color: s.lastRunStatus.slackOk ? "#166534" : "#991B1B",
            }}
          >
            Slack: {s.lastRunStatus.slackOk ? "✓ sent" : "✕ " + (s.lastRunStatus.slackError || "failed")}
          </span>
          <span
            style={{
              ...pill,
              background: s.lastRunStatus.emailOk ? "#DCFCE7" : "#FEE2E2",
              color: s.lastRunStatus.emailOk ? "#166534" : "#991B1B",
            }}
          >
            Email: {s.lastRunStatus.emailOk ? "✓ sent" : "✕ " + (s.lastRunStatus.emailError || "failed")}
          </span>
        </div>
      )}
      {history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: ".74rem", color: "#64748B" }}>
            Run history ({history.length})
          </summary>
          <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
            {history.map((h, i) => (
              <div
                key={i}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderTop: "1px solid #F1F5F9", fontSize: ".74rem" }}
              >
                <span style={{ color: "#0F172A" }}>{new Date(h.at).toLocaleString()}</span>
                <span style={{ color: "#64748B" }}>
                  {h.manualTrigger ? "manual" : "scheduled"} · Slack {h.slackOk ? "✓" : "✕"} · Email{" "}
                  {h.emailOk ? "✓" : "✕"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AutoReportViewer({ run, onClose }: { run: AutoReportRun; onClose: () => void }) {
  return (
    <div
      style={{ ...overlayStyle, background: "rgba(15,23,42,0.7)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 760,
          maxWidth: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            color: '#0f172a',
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.85 }}>
              AI Team Daily Stand-up
            </div>
            <h3 style={{ margin: "4px 0 0", fontSize: "1.2rem", fontWeight: 800 }}>{run.fmtDate || ""}</h3>
            <div style={{ fontSize: ".72rem", opacity: 0.85, marginTop: 2 }}>
              {(run.reports || []).length} officers · view-only · not sent
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => {
                downloadFile(
                  `ai-team-daily-report-${new Date().toISOString().slice(0, 10)}.md`,
                  autoReportToMarkdown(run),
                );
                showToast("✓ Report downloaded");
              }}
              style={{ padding: "8px 14px", background: "#10B981", color: "#fff", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer", fontSize: ".78rem" }}
            >
              📥 Download
            </button>
            <button
              onClick={onClose}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 34, height: 34, borderRadius: "50%", fontSize: "1.1rem", cursor: "pointer" }}
            >
              ×
            </button>
          </div>
        </div>
        <div
          style={{ flex: 1, overflowY: "auto", background: "#F1F5F9" }}
          dangerouslySetInnerHTML={{
            __html:
              run.html ||
              '<div style="padding:30px;text-align:center;color:#64748B">No report HTML returned.</div>',
          }}
        />
      </div>
    </div>
  );
}

// ── Autonomous report settings modal ─────────────────────────────────────────
function AutoReportSettingsModal({
  current,
  onClose,
  onSaved,
}: {
  current: AutoReportSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(current.enabled);
  const [hour, setHour] = useState(current.hour);
  const [minute, setMinute] = useState(current.minute);
  const [timezone, setTimezone] = useState(current.timezone || "UTC");
  const [email, setEmail] = useState(current.email || "");
  const detectedTz = useMemo(detectedTimezone, []);

  const tzs = useMemo(() => {
    const list = [...AUTO_REPORT_TZS];
    if (detectedTz && !list.includes(detectedTz)) list.unshift(detectedTz);
    if (current.timezone && !list.includes(current.timezone)) list.unshift(current.timezone);
    return list;
  }, [detectedTz, current.timezone]);

  async function save() {
    const j = await apiPost<{ error?: string }>("/api/officer/autoreport", {
      enabled,
      hour,
      minute,
      timezone,
      email: email.trim(),
    });
    if (j.error) {
      alert(j.error || "Save failed");
      return;
    }
    showToast("✓ Schedule saved");
    onSaved();
  }

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #CBD5E1",
    borderRadius: 8,
    fontSize: ".88rem",
  };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 560,
          maxWidth: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)", color: '#0f172a' }}>
          <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, opacity: 0.85 }}>
            ⏰ Autonomous Reporting
          </div>
          <h3 style={{ margin: "6px 0 0", fontSize: "1.25rem", fontWeight: 800 }}>Daily Stand-up Schedule</h3>
        </div>
        <div style={{ padding: "20px 24px", flex: 1, overflowY: "auto" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: 10,
              cursor: "pointer",
              marginBottom: 16,
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: ".92rem", color: "#0F172A" }}>Enable autonomous daily reports</div>
              <div style={{ fontSize: ".76rem", color: "#64748B" }}>
                When ON, the server fires reports automatically — your browser doesn&apos;t need to be open.
              </div>
            </div>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Hour (24h)</label>
              <select value={hour} onChange={(e) => setHour(+e.target.value)} style={selectStyle}>
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Minute</label>
              <select value={minute} onChange={(e) => setMinute(+e.target.value)} style={selectStyle}>
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Timezone</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...selectStyle, marginBottom: 4 }}>
            {tzs.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div style={{ fontSize: ".7rem", color: "#64748B", marginBottom: 14 }}>
            Detected: <strong>{detectedTz || "UTC"}</strong>
          </div>
          <label style={{ display: "block", fontSize: ".76rem", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Recipient email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: ".88rem", marginBottom: 6, boxSizing: "border-box" }}
          />
          <div style={{ fontSize: ".72rem", color: "#64748B", lineHeight: 1.4 }}>
            Reports also go to Slack via the configured webhook. Email needs Resend configured.
          </div>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "flex-end", gap: 8, background: "#F8FAFC" }}>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={save}
            style={{ padding: "10px 22px", background: "linear-gradient(135deg,#0f766e,#0284c7)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
