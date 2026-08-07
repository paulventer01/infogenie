"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api";

export interface SocialDraft {
  id: number;
  profile_id: string;
  status: string;
  text: string;
  media_urls: string[];
  platforms: string[];
  scheduled_for: string | null;
  zernio_post_id?: string | null;
  meta?: Record<string, unknown>;
}

interface Platform {
  id: string;
  label: string;
  icon: string;
  color: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_STYLE: Record<string, [string, string]> = {
  draft: ["#F3F4F6", "#374151"],
  pending_approval: ["#FFF7ED", "#9A3412"],
  approved: ["#ECFDF5", "#065F46"],
  scheduled: ["#EFF6FF", "#1E40AF"],
  published: ["#ECFDF5", "#065F46"],
  failed: ["#FEF2F2", "#991B1B"],
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function draftDayKey(d: SocialDraft) {
  if (!d.scheduled_for) return null;
  const dt = new Date(d.scheduled_for);
  if (isNaN(dt.getTime())) return null;
  return dayKey(dt);
}

interface Props {
  profileId: string;
  platforms: Platform[];
  onComposeForDate?: (isoDate: string) => void;
  onEditDraft?: (draft: SocialDraft) => void;
  refreshKey?: number;
}

export default function SocialCalendarView({
  profileId,
  platforms,
  onComposeForDate,
  onEditDraft,
  refreshKey = 0,
}: Props) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [drafts, setDrafts] = useState<SocialDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!profileId) {
      setDrafts([]);
      return;
    }
    setLoading(true);
    setError(null);
    const from = new Date(viewYear, viewMonth, 1);
    const to = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59);
    const r = await apiGet<{ ok: boolean; error?: string; drafts?: SocialDraft[] }>(
      `/api/social-drafts/list?profileId=${encodeURIComponent(profileId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    );
    setLoading(false);
    if (!r.ok) {
      setError(r.error || "Failed to load drafts");
      setDrafts([]);
      return;
    }
    setDrafts(r.drafts || []);
  }, [profileId, viewYear, viewMonth]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const byDay = useMemo(() => {
    const map: Record<string, SocialDraft[]> = {};
    for (const d of drafts) {
      const k = draftDayKey(d);
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push(d);
    }
    return map;
  }, [drafts]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const out: Array<{ key: string; date: Date | null; inMonth: boolean }> = [];
    for (let i = 0; i < startPad; i++) out.push({ key: `pad-${i}`, date: null, inMonth: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      out.push({ key: dayKey(date), date, inMonth: true });
    }
    while (out.length % 7 !== 0) out.push({ key: `trail-${out.length}`, date: null, inMonth: false });
    return out;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else setViewMonth((m) => m + 1);
  }

  async function moveDraft(id: number, targetDate: Date) {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;
    const prev = draft.scheduled_for ? new Date(draft.scheduled_for) : new Date(targetDate);
    const next = new Date(targetDate);
    next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    setBusyId(id);
    const r = await apiPatch<{ ok: boolean; error?: string; draft?: SocialDraft }>(
      `/api/social-drafts/${id}`,
      { scheduled_for: next.toISOString() },
    );
    setBusyId(null);
    setDragId(null);
    if (!r.ok) {
      setError(r.error || "Reschedule failed");
      return;
    }
    load();
  }

  async function publishDraft(id: number) {
    setBusyId(id);
    const r = await apiPost<{ ok: boolean; error?: string }>(`/api/social-drafts/${id}/publish`, {});
    setBusyId(null);
    if (!r.ok) {
      setError(r.error || "Publish failed");
      return;
    }
    load();
  }

  async function deleteDraft(id: number) {
    if (!confirm("Delete this draft?")) return;
    setBusyId(id);
    await apiDelete(`/api/social-drafts/${id}`);
    setBusyId(null);
    load();
  }

  const platMeta = (id: string) => platforms.find((p) => p.id === id) || { id, label: id, icon: "•", color: "#6B7280" };

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, color: "#0A1628", fontSize: "0.95rem", fontFamily: "Sora,sans-serif" }}>
            📅 Content calendar
          </h3>
          <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 2 }}>
            Drag drafts between days · click a day to compose · publish from here to Zernio
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={prevMonth} style={navBtn}>‹</button>
          <div style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, color: "#0A1628", minWidth: 160, textAlign: "center" }}>
            {MONTHS[viewMonth]} {viewYear}
          </div>
          <button type="button" onClick={nextMonth} style={navBtn}>›</button>
          <button type="button" onClick={load} style={{ ...navBtn, padding: "5px 10px" }}>↻</button>
        </div>
      </div>

      {!profileId && <div style={{ color: "#9CA3AF", fontSize: "0.82rem" }}>Pick a profile above to load the calendar.</div>}
      {error && <div style={{ color: "#991B1B", fontSize: "0.78rem", marginBottom: 8 }}>⚠ {error}</div>}
      {loading && <div style={{ color: "#9CA3AF", fontSize: "0.78rem", marginBottom: 8 }}>Loading drafts…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ fontSize: "0.68rem", fontWeight: 800, color: "#6B7280", textAlign: "center", padding: "4px 0" }}>{d}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {cells.map((cell) => {
          const items = cell.date ? byDay[dayKey(cell.date)] || [] : [];
          const isToday = cell.date && dayKey(cell.date) === dayKey(now);
          return (
            <div
              key={cell.key}
              onDragOver={(e) => { if (cell.date) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                if (!cell.date || dragId == null) return;
                moveDraft(dragId, cell.date);
              }}
              onClick={() => {
                if (!cell.date || !onComposeForDate) return;
                const iso = `${dayKey(cell.date)}T10:00`;
                onComposeForDate(iso);
              }}
              style={{
                minHeight: 92,
                background: cell.inMonth ? (isToday ? "#FFF7ED" : "#F9FAFB") : "#F3F4F6",
                border: `1px solid ${isToday ? "#FDBA74" : "#E5E7EB"}`,
                borderRadius: 8,
                padding: 6,
                cursor: cell.date ? "pointer" : "default",
                opacity: cell.inMonth ? 1 : 0.45,
              }}
            >
              {cell.date && (
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: isToday ? "#C2410C" : "#0A1628", marginBottom: 4 }}>
                  {cell.date.getDate()}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {items.slice(0, 3).map((d) => {
                  const sc = STATUS_STYLE[d.status] || STATUS_STYLE.draft;
                  const firstPlat = platMeta((d.platforms || [])[0] || "");
                  return (
                    <div
                      key={d.id}
                      draggable={d.status === "draft" || d.status === "approved"}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDragId(d.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditDraft?.(d);
                      }}
                      title={d.text}
                      style={{
                        background: sc[0],
                        color: sc[1],
                        borderRadius: 4,
                        padding: "3px 5px",
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        lineHeight: 1.3,
                        cursor: "grab",
                        opacity: busyId === d.id ? 0.5 : 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {firstPlat.icon} {(d.text || "Untitled").slice(0, 28)}
                    </div>
                  );
                })}
                {items.length > 3 && (
                  <div style={{ fontSize: "0.6rem", color: "#6B7280", fontWeight: 700 }}>+{items.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drafts.filter((d) => !d.scheduled_for).length > 0 && (
        <div style={{ marginTop: 16, borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#0A1628", marginBottom: 8 }}>Unscheduled drafts</div>
          <div style={{ display: "grid", gap: 6 }}>
            {drafts.filter((d) => !d.scheduled_for).map((d) => {
              const sc = STATUS_STYLE[d.status] || STATUS_STYLE.draft;
              return (
                <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ flex: 1, fontSize: "0.78rem", color: "#0A1628" }}>{(d.text || "").slice(0, 120)}</div>
                  <span style={{ background: sc[0], color: sc[1], padding: "2px 7px", borderRadius: 4, fontSize: "0.68rem", fontWeight: 700 }}>{d.status}</span>
                  {(d.status === "draft" || d.status === "approved") && (
                    <button type="button" onClick={() => publishDraft(d.id)} disabled={busyId === d.id} style={smallBtn("#FF5722", "#fff")}>Publish</button>
                  )}
                  <button type="button" onClick={() => onEditDraft?.(d)} style={smallBtn("#F3F4F6", "#374151")}>Edit</button>
                  <button type="button" onClick={() => deleteDraft(d.id)} style={smallBtn("#FEF2F2", "#991B1B")}>Delete</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn: CSSProperties = {
  background: "#F3F4F6",
  border: "1px solid #E5E7EB",
  color: "#374151",
  padding: "5px 12px",
  borderRadius: 6,
  fontSize: "0.82rem",
  fontWeight: 800,
  cursor: "pointer",
};

function smallBtn(bg: string, color: string): CSSProperties {
  return {
    background: bg,
    color,
    border: "1px solid transparent",
    padding: "4px 8px",
    borderRadius: 5,
    fontSize: "0.68rem",
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  };
}
