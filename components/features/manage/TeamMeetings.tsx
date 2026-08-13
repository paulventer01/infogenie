"use client";

// Native React port of the legacy `team-meetings` panel (was
// `window.buildTeamMeetings` inline in app.js + `#view-team-meetings`).
// Read-only calendar of AI-team meetings pulled from the existing Express API
// (`GET /api/officer/meetings`); click a day or list row to view the minutes,
// and download any meeting as Markdown.

import { useEffect, useState } from "react";

interface ActionItem {
  action?: string;
  owner?: string;
  dueIn?: string;
}
interface Meeting {
  id: string;
  topic?: string;
  scheduledAt?: string | number;
  autonomous?: boolean;
  attendees?: string[];
  discussion?: string[];
  decisions?: string[];
  actionItems?: ActionItem[];
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PILL: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: ".68rem",
  fontWeight: 700,
  letterSpacing: ".02em",
};

function meetingToMarkdown(m: Meeting): string {
  const lines: string[] = [];
  lines.push(`# Meeting Minutes — ${m.topic || ""}`);
  lines.push(`_${new Date(m.scheduledAt || Date.now()).toLocaleString()}_\n`);
  lines.push(`**Attendees:** ${(m.attendees || []).join(", ")}\n`);
  lines.push(`## Discussion`);
  (m.discussion || []).forEach((p) => lines.push(`\n${p}`));
  lines.push(`\n## Decisions`);
  (m.decisions || []).forEach((d) => lines.push(`- ${d}`));
  if (!(m.decisions || []).length) lines.push(`_None_`);
  lines.push(`\n## Action Items / Plan of Action`);
  (m.actionItems || []).forEach((a) =>
    lines.push(`- **${a.owner || "?"}** — ${a.action || ""} _(due: ${a.dueIn || "—"})_`),
  );
  if (!(m.actionItems || []).length) lines.push(`_None_`);
  return lines.join("\n");
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function TeamMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  const [detail, setDetail] = useState<Meeting | null>(null);
  const [dayPick, setDayPick] = useState<Meeting[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/officer/meetings", { credentials: "same-origin" });
        const j = await res.json();
        if (!cancelled) setMeetings(Array.isArray(j.meetings) ? j.meetings : []);
      } catch {
        if (!cancelled) setMeetings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ textAlign: "center", color: "#64748B", padding: 40 }}>
          ⏳ Loading meetings…
        </div>
      </div>
    );
  }

  const [yr, mo] = ym;
  const monthStart = new Date(yr, mo, 1);
  const monthName = monthStart.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const firstDow = monthStart.getDay();

  const byDay: Record<number, Meeting[]> = {};
  meetings.forEach((m) => {
    const d = new Date(m.scheduledAt || Date.now());
    if (d.getFullYear() === yr && d.getMonth() === mo) {
      const k = d.getDate();
      (byDay[k] = byDay[k] || []).push(m);
    }
  });

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const items = byDay[d] || [];
    const t = new Date();
    const isToday =
      t.getFullYear() === yr && t.getMonth() === mo && t.getDate() === d;
    const hasMeetings = items.length > 0;
    cells.push(
      <button
        key={`d${d}`}
        disabled={!hasMeetings}
        onClick={() => {
          if (items.length === 1) setDetail(items[0]);
          else if (items.length > 1) setDayPick(items);
        }}
        style={{
          aspectRatio: "1",
          padding: 6,
          border: `1px solid ${isToday ? "#0f766e" : "#E2E8F0"}`,
          borderRadius: 8,
          background: hasMeetings ? "#F5F3FF" : "#fff",
          cursor: hasMeetings ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: ".78rem",
            fontWeight: isToday ? 800 : 600,
            color: hasMeetings ? "#0f766e" : "#64748B",
          }}
        >
          {d}
        </div>
        {hasMeetings ? (
          <div
            style={{
              fontSize: ".6rem",
              background: "#0f766e",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: 99,
              fontWeight: 700,
            }}
          >
            {items.length}
          </div>
        ) : null}
      </button>,
    );
  }

  const sorted = [...meetings].sort(
    (a, b) =>
      new Date(b.scheduledAt || 0).getTime() - new Date(a.scheduledAt || 0).getTime(),
  );

  function prevMonth() {
    setYm(([y, m]) => (m === 0 ? [y - 1, 11] : [y, m - 1]));
  }
  function nextMonth() {
    setYm(([y, m]) => (m === 11 ? [y + 1, 0] : [y, m + 1]));
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Minutes of Meeting
              </div>
              <h2 className="view-title">📋 Minutes of Meeting</h2>
              <p className="view-sub">
                Auto-generated minutes for your AI team meetings — decisions,
                action items, and owners captured in one shareable record.
              </p>
            </div>
          </div>
        </div>
      </div>
    <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: ".7rem",
              color: "#64748B",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Total meetings
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0F172A" }}>
            {meetings.length}
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: ".7rem",
              color: "#64748B",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Autonomous
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0F172A" }}>
            {meetings.filter((m) => m.autonomous).length}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: 18,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <button
            onClick={prevMonth}
            style={{
              padding: "7px 12px",
              background: "#F1F5F9",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ‹ Prev
          </button>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>
            {monthName}
          </div>
          <button
            onClick={nextMonth}
            style={{
              padding: "7px 12px",
              background: "#F1F5F9",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Next ›
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            gap: 4,
            marginBottom: 6,
          }}
        >
          {DOW.map((d) => (
            <div
              key={d}
              style={{
                textAlign: "center",
                fontSize: ".65rem",
                color: "#64748B",
                fontWeight: 700,
                padding: 4,
              }}
            >
              {d}
            </div>
          ))}
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}
        >
          {cells}
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: 18,
        }}
      >
        <div
          style={{
            fontSize: "1rem",
            fontWeight: 800,
            color: "#0F172A",
            marginBottom: 12,
          }}
        >
          All meetings (newest first)
        </div>
        {sorted.length === 0 ? (
          <div
            style={{
              color: "#94A3B8",
              fontStyle: "italic",
              padding: 20,
              textAlign: "center",
            }}
          >
            No meetings yet. Enable autonomous meetings on the AI Team page or schedule
            one manually.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {sorted.map((m) => (
              <div
                key={m.id}
                style={{
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div
                    style={{ fontSize: ".92rem", color: "#0F172A", fontWeight: 700 }}
                  >
                    {m.topic || ""}{" "}
                    {m.autonomous ? (
                      <span
                        style={{
                          ...PILL,
                          background: "#EDE9FE",
                          color: "#5B21B6",
                          marginLeft: 6,
                        }}
                      >
                        AUTO
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: ".72rem", color: "#64748B", marginTop: 3 }}>
                    {new Date(m.scheduledAt || Date.now()).toLocaleString()} ·{" "}
                    {(m.attendees || []).length} attendees ·{" "}
                    {(m.actionItems || []).length} action items
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setDetail(m)}
                    style={{
                      padding: "6px 12px",
                      background: '#eef4ff',
                      color: "#0f172a",
                      border: "none",
                      borderRadius: 7,
                      fontSize: ".74rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    View Minutes
                  </button>
                  <button
                    onClick={() =>
                      downloadFile(`meeting-${m.id}.md`, meetingToMarkdown(m))
                    }
                    style={{
                      padding: "6px 12px",
                      background: "#0EA5E9",
                      color: "#0f172a",
                      border: "none",
                      borderRadius: 7,
                      fontSize: ".74rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    📥 Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dayPick ? (
        <Overlay onClose={() => setDayPick(null)}>
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              width: 480,
              maxWidth: "100%",
              padding: 18,
            }}
          >
            <div
              style={{ fontWeight: 800, color: "#0F172A", marginBottom: 10 }}
            >
              {dayPick.length} meetings on {monthName.split(" ")[0]}{" "}
              {new Date(dayPick[0].scheduledAt || Date.now()).getDate()}
            </div>
            {dayPick.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setDayPick(null);
                  setDetail(m);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  background: "#fff",
                  cursor: "pointer",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{ fontWeight: 700, fontSize: ".86rem", color: "#0F172A" }}
                >
                  {m.topic}
                </div>
                <div style={{ fontSize: ".72rem", color: "#64748B" }}>
                  {new Date(m.scheduledAt || Date.now()).toLocaleTimeString()}
                </div>
              </button>
            ))}
            <button
              onClick={() => setDayPick(null)}
              style={{
                marginTop: 8,
                padding: "8px 16px",
                background: "#F1F5F9",
                border: "1px solid #CBD5E1",
                borderRadius: 7,
                fontWeight: 700,
                cursor: "pointer",
                float: "right",
              }}
            >
              Close
            </button>
          </div>
        </Overlay>
      ) : null}

      {detail ? (
        <MeetingDetail meeting={detail} onClose={() => setDetail(null)} />
      ) : null}
    </div>
    </div>
  );
}

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: 20,
      }}
    >
      {children}
    </div>
  );
}

function MeetingDetail({
  meeting: m,
  onClose,
}: {
  meeting: Meeting;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
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
        <div
          style={{
            padding: "20px 24px",
            background: "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
            color: '#0f172a',
          }}
        >
          <div
            style={{
              fontSize: ".7rem",
              letterSpacing: ".18em",
              textTransform: "uppercase",
              fontWeight: 700,
              opacity: 0.8,
            }}
          >
            📝 Meeting Minutes
          </div>
          <h3 style={{ margin: "6px 0 4px", fontSize: "1.3rem", fontWeight: 800 }}>
            {m.topic || ""}
          </h3>
          <p style={{ margin: 0, fontSize: ".8rem", opacity: 0.85 }}>
            {new Date(m.scheduledAt || Date.now()).toLocaleString()} ·{" "}
            {(m.attendees || []).join(" · ")}
          </p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: ".78rem",
                fontWeight: 800,
                color: "#0F172A",
                marginBottom: 6,
              }}
            >
              💬 Discussion
            </div>
            {(m.discussion || []).length ? (
              (m.discussion || []).map((p, i) => (
                <p
                  key={i}
                  style={{
                    fontSize: ".88rem",
                    color: "#0F172A",
                    lineHeight: 1.6,
                    margin: "0 0 10px",
                  }}
                >
                  {p}
                </p>
              ))
            ) : (
              <div style={{ color: "#94A3B8", fontStyle: "italic" }}>
                No discussion notes
              </div>
            )}
          </div>
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: ".78rem",
                fontWeight: 800,
                color: "#0F172A",
                marginBottom: 6,
              }}
            >
              ✅ Decisions
            </div>
            {(m.decisions || []).length ? (
              <ul
                style={{
                  margin: "0 0 0 18px",
                  padding: 0,
                  fontSize: ".88rem",
                  lineHeight: 1.7,
                  color: "#0F172A",
                }}
              >
                {(m.decisions || []).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <div style={{ color: "#94A3B8", fontStyle: "italic" }}>None</div>
            )}
          </div>
          <div>
            <div
              style={{
                fontSize: ".78rem",
                fontWeight: 800,
                color: "#0F172A",
                marginBottom: 6,
              }}
            >
              📋 Plan of Action
            </div>
            {(m.actionItems || []).length ? (
              <div style={{ display: "grid", gap: 6 }}>
                {(m.actionItems || []).map((a, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #E2E8F0",
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 10,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: ".86rem",
                          color: "#0F172A",
                          fontWeight: 600,
                        }}
                      >
                        {a.action || ""}
                      </div>
                      <div
                        style={{ fontSize: ".7rem", color: "#64748B", marginTop: 2 }}
                      >
                        Owner: {a.owner || "?"}
                      </div>
                    </div>
                    <span style={{ ...PILL, background: "#F1F5F9", color: "#0F172A" }}>
                      due {a.dueIn || "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#94A3B8", fontStyle: "italic" }}>None</div>
            )}
          </div>
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
            style={{
              padding: "10px 18px",
              background: "#F1F5F9",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            onClick={() => downloadFile(`meeting-${m.id}.md`, meetingToMarkdown(m))}
            style={{
              padding: "10px 22px",
              background: "#0EA5E9",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            📥 Download Minutes
          </button>
        </div>
      </div>
    </Overlay>
  );
}
