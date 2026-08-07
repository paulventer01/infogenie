"use client";

// Master Calendar — unified agenda from `/api/calendar-assistant/master`
// (brand + content + campaigns + social + SEO). Legacy window state is still
// merged as a fallback for in-memory SPA data that has not been persisted yet.

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { pathToViewId } from "@/lib/viewRoutes";
import BrandCalendar from "@/components/features/manage/BrandCalendar";
import ContentCalendar from "@/components/features/create/ContentCalendar";
import Social from "@/components/features/create/Social";
import Launches from "@/components/features/manage/Launches";
import CalendarAssistant from "@/components/features/manage/CalendarAssistant";
import SocialPublisher from "@/components/features/reach/SocialPublisher";

type LayerId =
  | "agenda"
  | "brand-calendar"
  | "content-calendar"
  | "social"
  | "launches"
  | "calendar-assistant"
  | "social-publisher";

const CALENDAR_LAYERS: Array<{ id: LayerId; view: string; icon: string; label: string; desc: string }> = [
  { id: "agenda", view: "master-calendar", icon: "📆", label: "Unified Agenda", desc: "All sources" },
  { id: "brand-calendar", view: "brand-calendar", icon: "🏷️", label: "Brand", desc: "10 categories" },
  { id: "content-calendar", view: "content-calendar", icon: "🗓️", label: "Content", desc: "Editorial plan" },
  { id: "social", view: "social", icon: "📱", label: "Social", desc: "Local planner" },
  { id: "launches", view: "launches", icon: "🚀", label: "Launches", desc: "Go-live dates" },
  { id: "calendar-assistant", view: "calendar-assistant", icon: "✨", label: "AI Assistant", desc: "Conflicts · suggest" },
  { id: "social-publisher", view: "social-publisher", icon: "📤", label: "Publisher", desc: "Drafts · post" },
];

function viewToLayer(view: string | null): LayerId {
  if (view === "brand-calendar") return "brand-calendar";
  if (view === "content-calendar") return "content-calendar";
  if (view === "social") return "social";
  if (view === "launches") return "launches";
  if (view === "calendar-assistant") return "calendar-assistant";
  if (view === "social-publisher") return "social-publisher";
  return "agenda";
}

interface LegacyArticle {
  title?: string;
  status?: string;
  customDate?: string;
}
interface LegacyCampaign {
  name?: string;
  platform?: string;
  launchedAt?: string;
  status?: string;
  budget?: number;
  metrics?: { roas?: string | number };
}
interface LegacySocialPost {
  id?: string | number;
  caption?: string;
  scheduledDate?: string;
  status?: string;
  platform?: string;
}
interface AutoSeoSchedule {
  startDate?: string;
  [k: string]: unknown;
}
interface LegacyState {
  _autoSeoArticles?: LegacyArticle[];
  _autoSeoSchedule?: AutoSeoSchedule;
  _launchedCampaigns?: LegacyCampaign[];
  _socialPosts?: LegacySocialPost[];
  _artDate?: (i: number, sch: AutoSeoSchedule) => string;
}

type McFilter = "all" | "article" | "campaign" | "social" | "brand" | "content";
type EventType = "article" | "campaign" | "social" | "brand" | "content";

interface CalEvent {
  date: string;
  type: EventType;
  title: string;
  status: string;
  risk: boolean;
  color: string;
  bg: string;
  label: string;
  budget?: number;
  roas?: string | number;
}

interface ApiAgendaEvent {
  id?: string;
  source?: string;
  title?: string;
  start?: string;
  status?: string;
  channel?: string | null;
  notes?: string;
}

function readLegacy(): LegacyState {
  if (typeof window === "undefined") return {};
  return window as unknown as LegacyState;
}

function isoOf(d: Date): string {
  return d.toISOString().split("T")[0];
}

function articleDate(
  snap: LegacyState,
  i: number,
  sch: AutoSeoSchedule,
  todayIso: string,
): string {
  const arts = snap._autoSeoArticles;
  if (arts && arts[i] && arts[i].customDate) return arts[i].customDate as string;
  if (typeof snap._artDate === "function") {
    try {
      return snap._artDate(i, sch);
    } catch {
      /* fall through to fallback */
    }
  }
  return todayIso;
}

const TYPE_ICON: Record<EventType, string> = {
  article: "📝",
  campaign: "🚀",
  social: "📱",
  brand: "🏷️",
  content: "🗓️",
};
const TYPE_LABEL: Record<EventType, string> = {
  article: "📝 Article",
  campaign: "🚀 Campaign",
  social: "📱 Social",
  brand: "🏷️ Brand",
  content: "🗓️ Content",
};
const FILTERS: { key: McFilter; label: string }[] = [
  { key: "all", label: "All Events" },
  { key: "article", label: "📝 Articles" },
  { key: "campaign", label: "🚀 Campaigns" },
  { key: "social", label: "📱 Social" },
  { key: "brand", label: "🏷️ Brand" },
  { key: "content", label: "🗓️ Content" },
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function mapSource(source?: string): EventType {
  if (source === "campaign") return "campaign";
  if (source === "social") return "social";
  if (source === "article") return "article";
  if (source === "content") return "content";
  return "brand";
}

function styleFor(type: EventType, status: string, risk: boolean) {
  if (risk) return { color: "#D97706", bg: "#FEF3C7", label: "⚠️ At Risk" };
  if (type === "campaign") {
    const live = status === "active" || status === "live";
    return { color: live ? "#7C3AED" : "#6B7280", bg: live ? "#F5F3FF" : "#F3F4F6", label: live ? "🔵 Live" : "Ended" };
  }
  if (type === "social" || type === "content") {
    const done = status === "published" || status === "done";
    return { color: done ? "#059669" : "#9333EA", bg: done ? "#DCFCE7" : "#F5F3FF", label: done ? "Published" : "📅 Scheduled" };
  }
  if (type === "article") {
    if (status === "published") return { color: "#059669", bg: "#DCFCE7", label: "Published" };
    if (status === "generated") return { color: "#1D4ED8", bg: "#DBEAFE", label: "Written" };
    return { color: "#6B7280", bg: "#F3F4F6", label: "Pending" };
  }
  return { color: "#0F766E", bg: "#CCFBF1", label: status || "Planned" };
}

export default function MasterCalendar() {
  const router = useRouter();
  const pathname = usePathname();
  const layer = viewToLayer(pathToViewId(pathname || "") || "master-calendar");
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => isoOf(today), [today]);

  const [snap, setSnap] = useState<LegacyState>({});
  const [apiEvents, setApiEvents] = useState<CalEvent[]>([]);
  const [filter, setFilter] = useState<McFilter>("all");
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  useEffect(() => {
    setSnap(readLegacy());
    let cancelled = false;
    (async () => {
      const from = new Date(Date.now() - 45 * 864e5).toISOString();
      const to = new Date(Date.now() + 60 * 864e5).toISOString();
      const r = await apiGet<{ ok?: boolean; events?: ApiAgendaEvent[] }>(
        `/api/calendar-assistant/master?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      if (cancelled || !r?.events) return;
      const mapped: CalEvent[] = r.events.map((e) => {
        const date = (e.start || todayIso).slice(0, 10);
        const type = mapSource(e.source);
        const status = e.status || "planned";
        const risk = type === "campaign" && /paused|risk/i.test(status);
        const sty = styleFor(type, status, risk);
        return {
          date,
          type,
          title: e.title || "Untitled",
          status: type === "campaign" && (status === "active" || status === "live") ? "live" : status,
          risk,
          color: sty.color,
          bg: sty.bg,
          label: sty.label,
        };
      });
      setApiEvents(mapped);
    })().catch(() => { /* keep legacy */ });
    return () => { cancelled = true; };
  }, [todayIso]);

  const events = useMemo<CalEvent[]>(() => {
    const sch: AutoSeoSchedule = snap._autoSeoSchedule || {};
    const out: CalEvent[] = [...apiEvents];
    const seen = new Set(out.map((e) => `${e.type}:${e.date}:${e.title}`));

    (snap._autoSeoArticles || []).forEach((a, i) => {
      const d = articleDate(snap, i, sch, todayIso);
      const title = a.title || "Article #" + (i + 1);
      const key = `article:${d}:${title}`;
      if (seen.has(key)) return;
      const isPast = d < todayIso;
      const risk = isPast && a.status !== "published" && a.status !== "generated";
      const sty = styleFor("article", a.status || "pending", risk);
      out.push({ date: d, type: "article", title, status: a.status || "pending", risk, ...sty });
    });

    (snap._launchedCampaigns || []).forEach((c) => {
      const raw = c.launchedAt || "";
      let d = todayIso;
      try {
        const dt = new Date(raw);
        if (!isNaN(dt.getTime())) d = isoOf(dt);
      } catch { /* keep todayIso */ }
      const title = (c.name || "Campaign") + " · " + (c.platform || "");
      const key = `campaign:${d}:${title}`;
      if (seen.has(key)) return;
      const roas = parseFloat(String(c.metrics && c.metrics.roas)) || 0;
      const risk = roas > 0 && roas < 2;
      const isLive = c.status === "active";
      const sty = styleFor("campaign", isLive ? "live" : "ended", risk);
      out.push({
        date: d, type: "campaign", title,
        status: isLive ? "live" : "ended", risk,
        color: sty.color, bg: sty.bg, label: sty.label,
        budget: c.budget, roas: c.metrics && c.metrics.roas,
      });
    });

    (snap._socialPosts || []).forEach((p) => {
      const d = p.scheduledDate || todayIso;
      const title = (p.caption || "Social post").substring(0, 45);
      const key = `social:${d}:${title}`;
      if (seen.has(key)) return;
      const isPast = d < todayIso;
      const status = p.status || (isPast ? "published" : "scheduled");
      const sty = styleFor("social", status, false);
      out.push({ date: d, type: "social", title, status, risk: false, ...sty });
    });

    return out;
  }, [snap, todayIso, apiEvents]);

  const in7Iso = useMemo(
    () => isoOf(new Date(Date.now() + 7 * 864e5)),
    [],
  );
  const inNext7 = events.filter((e) => e.date > todayIso && e.date <= in7Iso);
  const liveNow = events.filter(
    (e) => e.status === "live" || (e.date === todayIso && e.type !== "article"),
  );
  const atRisk = events.filter((e) => e.risk);
  const done = events.filter(
    (e) => e.status === "published" || e.status === "ended",
  );

  const filtered =
    filter === "all" ? events : events.filter((e) => e.type === filter);

  const dateMap = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    filtered.forEach((e) => {
      if (!m[e.date]) m[e.date] = [];
      m[e.date].push(e);
    });
    return m;
  }, [filtered]);

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const rows = useMemo(() => {
    const cells: (number | null)[] = [];
    for (let p = 0; p < firstDay; p++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const r: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) r.push(cells.slice(i, i + 7));
    return r;
  }, [firstDay, daysInMonth]);

  const upcoming = filtered
    .filter((e) => e.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  const summaryCards: [string, string, number, string, string][] = [
    ["🗓️", "Going Live (7d)", inNext7.length, "#0066FF", "#EFF6FF"],
    ["🟢", "Live Now", liveNow.length, "#059669", "#DCFCE7"],
    ["⚠️", "At Risk", atRisk.length, "#D97706", "#FEF3C7"],
    ["✅", "Completed", done.length, "#6B7280", "#F3F4F6"],
  ];

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  return (
    <div className="view-header-wrap">
      <div
        className="intel-header ig-panel-hero"
        style={{
          background:
            "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        }}
      >
        <div className="breadcrumb" style={{ color: '#475569' }}>
          <span className="bc-group" style={{ color: '#475569', opacity: 0.85 }}>
            Manage
          </span>{" "}
          <span className="bc-sep" style={{ color: '#475569', opacity: 0.55 }}>
            ›
          </span>{" "}
          Master Calendar
        </div>
        <h1 className="ih-title">🗓️ Master Calendar</h1>
        <p className="ih-sub">
          Unified agenda plus embedded layer editors — switch tabs to edit Brand, Content, Social, Launches, Assistant, or Publisher without leaving this shell.
        </p>
      </div>

      <div style={{ padding: "16px 28px 0", maxWidth: 1200, margin: "0 auto" }}>
        <div
          role="tablist"
          aria-label="Calendar layers"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderBottom: "2px solid #E2E8F0",
            marginBottom: 4,
          }}
        >
          {CALENDAR_LAYERS.map((l) => {
            const on = l.id === layer;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => goToView(router, l.view)}
                title={l.desc}
                style={{
                  padding: "10px 12px",
                  marginBottom: -2,
                  border: "none",
                  borderBottom: on ? "3px solid #0F766E" : "3px solid transparent",
                  background: "transparent",
                  color: on ? "#0F766E" : "#64748B",
                  fontWeight: on ? 800 : 600,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {l.icon} {l.label}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "8px 0 4px", fontSize: 12, color: "#64748B" }}>
          {CALENDAR_LAYERS.find((l) => l.id === layer)?.desc}
        </p>
      </div>

      {layer !== "agenda" ? (
        <div data-master-calendar-layer={layer} style={{ paddingBottom: 24 }}>
          {layer === "brand-calendar" ? <BrandCalendar embedded /> : null}
          {layer === "content-calendar" ? <ContentCalendar embedded /> : null}
          {layer === "social" ? <Social embedded /> : null}
          {layer === "launches" ? <Launches embedded /> : null}
          {layer === "calendar-assistant" ? <CalendarAssistant embedded /> : null}
          {layer === "social-publisher" ? <SocialPublisher embedded /> : null}
        </div>
      ) : null}

      {layer === "agenda" ? (
      <div style={{ padding: "16px 28px 24px" }}>
        {/* Summary cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
            gap: 14,
            marginBottom: 24,
          }}
        >
          {summaryCards.map(([ic, lb, val, col, bg]) => (
            <div
              key={lb}
              style={{
                background: bg,
                border: `1.5px solid ${col}30`,
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: "1.3rem" }}>{ic}</span>
              <div>
                <div
                  style={{
                    fontFamily: "Sora,sans-serif",
                    fontSize: "1.4rem",
                    fontWeight: 800,
                    color: col,
                    lineHeight: 1,
                  }}
                >
                  {val}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    color: `${col}90`,
                    marginTop: 2,
                  }}
                >
                  {lb}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter tabs + month nav */}
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "7px 14px",
                border: "none",
                borderRadius: 8,
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
                background: filter === f.key ? "#0066FF" : "#F3F4F6",
                color: filter === f.key ? "white" : "#374151",
              }}
            >
              {f.label}
            </button>
          ))}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              onClick={prevMonth}
              style={{
                width: 32,
                height: 32,
                background: "#F3F4F6",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              ‹
            </button>
            <span
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "#111827",
                whiteSpace: "nowrap",
              }}
            >
              {monthName}
            </span>
            <button
              onClick={nextMonth}
              style={{
                width: 32,
                height: 32,
                background: "#F3F4F6",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              ›
            </button>
          </div>
        </div>

        {/* Calendar grid */}
        <div
          style={{
            background: "white",
            borderRadius: 14,
            padding: 16,
            marginBottom: 24,
            boxShadow: "0 1px 6px rgba(0,0,0,.05)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 3,
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr>
                {DAY_NAMES.map((d) => (
                  <th
                    key={d}
                    style={{
                      textAlign: "center",
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      color: "#9CA3AF",
                      padding: "5px 2px",
                      textTransform: "uppercase",
                    }}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((day, di) => {
                    if (!day) {
                      return (
                        <td
                          key={di}
                          style={{
                            padding: 4,
                            height: 90,
                            background: "#FAFAFA",
                            borderRadius: 6,
                            opacity: 0.3,
                          }}
                        />
                      );
                    }
                    const iso =
                      viewYear +
                      "-" +
                      String(viewMonth + 1).padStart(2, "0") +
                      "-" +
                      String(day).padStart(2, "0");
                    const dayEvents = dateMap[iso] || [];
                    const isToday = iso === todayIso;
                    const hasRisk = dayEvents.some((e) => e.risk);
                    const cellBg = isToday
                      ? "#EFF6FF"
                      : hasRisk
                        ? "#FFFBEB"
                        : dayEvents.length
                          ? "#F9FAFB"
                          : "white";
                    return (
                      <td
                        key={di}
                        style={{
                          padding: 5,
                          verticalAlign: "top",
                          height: 90,
                          background: cellBg,
                          border: `1.5px solid ${
                            isToday ? "#3B82F6" : hasRisk ? "#FCD34D" : "#F3F4F6"
                          }`,
                          borderRadius: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: isToday ? 800 : 600,
                            color: isToday ? "#1D4ED8" : "#374151",
                            textAlign: "right",
                            marginBottom: 3,
                          }}
                        >
                          {isToday ? (
                            <span
                              style={{
                                background: "#1D4ED8",
                                color: "white",
                                borderRadius: "50%",
                                width: 19,
                                height: 19,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "0.67rem",
                              }}
                            >
                              {day}
                            </span>
                          ) : (
                            day
                          )}
                        </div>
                        {dayEvents.slice(0, 4).map((e, ei) => (
                          <div
                            key={ei}
                            title={e.title.replace(/"/g, "'")}
                            style={{
                              fontSize: "0.58rem",
                              fontWeight: 600,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: e.bg,
                              color: e.color,
                              marginBottom: 2,
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              cursor: "default",
                            }}
                          >
                            {TYPE_ICON[e.type]} {e.title.substring(0, 20)}
                          </div>
                        ))}
                        {dayEvents.length > 4 ? (
                          <div
                            style={{
                              fontSize: "0.58rem",
                              color: "#9CA3AF",
                              padding: "1px 4px",
                            }}
                          >
                            +{dayEvents.length - 4} more
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Upcoming events list */}
        <div
          style={{
            background: "white",
            borderRadius: 14,
            padding: 20,
            boxShadow: "0 1px 6px rgba(0,0,0,.05)",
          }}
        >
          <div
            style={{
              fontFamily: "Sora,sans-serif",
              fontSize: "0.88rem",
              fontWeight: 800,
              color: "#111827",
              marginBottom: 14,
            }}
          >
            📋 Upcoming Events
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcoming.length ? (
              upcoming.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    border: "1px solid #F3F4F6",
                    borderRadius: 10,
                    background: e.risk ? "#FFFBEB" : "white",
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      textAlign: "center",
                      minWidth: 40,
                      background: "#F9FAFB",
                      borderRadius: 8,
                      padding: "4px 6px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        color: "#6B7280",
                        textTransform: "uppercase",
                      }}
                    >
                      {new Date(e.date + "T00:00:00").toLocaleDateString(
                        "en-US",
                        { month: "short" },
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "1.1rem",
                        fontWeight: 800,
                        color: "#111827",
                        lineHeight: 1,
                      }}
                    >
                      {parseInt(e.date.split("-")[2], 10)}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "#111827",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {TYPE_ICON[e.type]} {e.title}
                    </div>
                    <div
                      style={{
                        fontSize: "0.68rem",
                        color: "#6B7280",
                        marginTop: 2,
                      }}
                    >
                      {TYPE_LABEL[e.type]} · {e.label}
                      {e.budget
                        ? " · $" + e.budget.toLocaleString() + " budget"
                        : ""}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: 6,
                      background: e.bg,
                      color: e.color,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.label}
                  </span>
                </div>
              ))
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: 30,
                  color: "#9CA3AF",
                  fontSize: "0.82rem",
                }}
              >
                No upcoming events — launch campaigns or generate article topics
                to populate the calendar.
              </div>
            )}
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
}
