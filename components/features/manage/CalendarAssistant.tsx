"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface CalEvent {
  id: string;
  source: string;
  calendar: string;
  category: string;
  title: string;
  start: string;
  end: string;
  status?: string;
  notes?: string;
}

interface Conflict {
  id: string;
  type: string;
  severity: string;
  message: string;
  day?: string;
  count?: number;
  events?: CalEvent[];
}

interface Pick {
  start: string;
  end: string;
  score?: number;
  reason?: string;
}

interface Resolution {
  conflictId?: string;
  moveEventId: string;
  moveTitle?: string;
  currentStart?: string;
  newStart?: string | null;
  newEnd?: string | null;
  reason?: string;
  canApply?: boolean;
  source?: string;
}

const SEV: Record<string, string> = {
  high: "#DC2626",
  medium: "#D97706",
  low: "#64748B",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function CalendarAssistant() {
  const router = useRouter();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [health, setHealth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("mine");
  const [duration, setDuration] = useState(60);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [suggestSummary, setSuggestSummary] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [resolveSummary, setResolveSummary] = useState("");
  const [resolving, setResolving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [agenda, conf] = await Promise.all([
        apiGet<{ ok?: boolean; events?: CalEvent[]; healthScore?: number; error?: string }>("/api/calendar-assistant/agenda"),
        apiGet<{ ok?: boolean; conflicts?: Conflict[]; healthScore?: number }>("/api/calendar-assistant/conflicts"),
      ]);
      if (agenda.error) setErr(agenda.error);
      setEvents(agenda.events || []);
      setConflicts(conf.conflicts || []);
      setHealth(conf.healthScore ?? agenda.healthScore ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load agenda");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function suggest() {
    if (!title.trim()) return;
    setSuggesting(true);
    setMsg("");
    const r = await apiPost<{ ok?: boolean; picks?: Pick[]; summary?: string; error?: string }>(
      "/api/calendar-assistant/suggest",
      { title: title.trim(), category, duration_mins: duration },
    );
    setSuggesting(false);
    if (!r.ok) { setMsg(r.error || "Suggest failed"); return; }
    setPicks(r.picks || []);
    setSuggestSummary(r.summary || "");
  }

  async function applyCreate(pick: Pick) {
    const r = await apiPost<{ ok?: boolean; id?: string; error?: string }>("/api/calendar-assistant/apply", {
      title: title.trim(),
      category,
      new_start: pick.start,
      notes: "Scheduled via Calendar Assistant",
    });
    if (!r.ok) { setMsg(r.error || "Could not schedule"); return; }
    setMsg(`Scheduled on Brand Calendar (${r.id})`);
    setPicks([]);
    load();
  }

  async function resolveConflicts() {
    setResolving(true);
    setMsg("");
    const r = await apiPost<{ ok?: boolean; resolutions?: Resolution[]; summary?: string; error?: string }>(
      "/api/calendar-assistant/resolve",
      {},
    );
    setResolving(false);
    if (!r.ok) { setMsg(r.error || "Resolve failed"); return; }
    setResolutions(r.resolutions || []);
    setResolveSummary(r.summary || "");
  }

  async function applyMove(res: Resolution) {
    if (!res.moveEventId || !res.newStart) return;
    const r = await apiPost<{ ok?: boolean; error?: string }>("/api/calendar-assistant/apply", {
      event_id: res.moveEventId,
      new_start: res.newStart,
    });
    if (!r.ok) { setMsg(r.error || "Move failed"); return; }
    setMsg(`Moved "${res.moveTitle || res.moveEventId}" → ${fmt(res.newStart)}`);
    setResolutions((prev) => prev.filter((x) => x.moveEventId !== res.moveEventId));
    load();
  }

  return (
    <div>
      <div
        className="intel-header ig-panel-hero"
        style={{ background: "linear-gradient(135deg,#ecfdf5 0%,#e0f2fe 55%,#fef3c7 100%)" }}
      >
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Manage</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Calendar Assistant
        </div>
        <h1 className="ih-title">📅 Calendar Assistant</h1>
        <p className="ih-sub">
          AI scheduling and conflict resolution across Master, Brand, and Content calendars — find free slots, clear overlaps, and write back to Brand Calendar.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <button type="button" onClick={() => goToView(router, "master-calendar")} style={btnSec}>Master Calendar</button>
          <button type="button" onClick={() => goToView(router, "brand-calendar")} style={btnSec}>Brand Calendar</button>
          <button type="button" onClick={() => goToView(router, "content-calendar")} style={btnSec}>Content Calendar</button>
          <button type="button" onClick={load} style={btnSec}>Refresh</button>
          {health != null && (
            <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: "0.95rem", color: health >= 80 ? "#059669" : health >= 60 ? "#D97706" : "#DC2626" }}>
              Calendar health {health}/100
            </span>
          )}
        </div>

        {err && <p style={{ color: "#B91C1C", marginBottom: 12 }}>{err}</p>}
        {msg && <p style={{ color: "#0F766E", marginBottom: 12, fontWeight: 600 }}>{msg}</p>}

        {/* Schedule new */}
        <section style={card}>
          <h3 style={{ margin: "0 0 12px" }}>Schedule with AI</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting, launch, content drop…"
              style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8, border: "1px solid #D1D5DB" }}
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #D1D5DB" }}>
              {["mine", "brand", "content", "social", "ads", "email", "event", "website"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ padding: 10, borderRadius: 8, border: "1px solid #D1D5DB" }}>
              {[30, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <button type="button" disabled={suggesting || !title.trim()} onClick={suggest} style={btnPrimary}>
              {suggesting ? "Finding slots…" : "Find free slots"}
            </button>
          </div>
          {suggestSummary && <p style={{ fontSize: "0.85rem", color: "#475569", marginTop: 10 }}>{suggestSummary}</p>}
          {picks.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {picks.map((p) => (
                <div key={p.start} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 12, background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{fmt(p.start)}</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B" }}>{p.reason}{p.score != null ? ` · score ${p.score}` : ""}</div>
                  </div>
                  <button type="button" onClick={() => applyCreate(p)} style={btnPrimary}>Add to Brand Calendar</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Conflicts */}
        <section style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Conflicts & busy days</h3>
            <button type="button" disabled={resolving} onClick={resolveConflicts} style={btnPrimary}>
              {resolving ? "Resolving…" : "AI resolve overlaps"}
            </button>
          </div>
          {loading && <p style={{ color: "#64748B" }}>Loading…</p>}
          {!loading && conflicts.length === 0 && (
            <p style={{ color: "#059669", fontSize: "0.88rem" }}>No overlaps or busy-day warnings in the next 3 weeks.</p>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {conflicts.map((c) => (
              <div key={c.id} style={{ padding: 12, borderRadius: 10, border: "1px solid #E5E7EB", borderLeft: `4px solid ${SEV[c.severity] || "#64748B"}` }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{c.message}</div>
                <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 4 }}>{c.type} · {c.severity}</div>
              </div>
            ))}
          </div>
          {resolveSummary && <p style={{ fontSize: "0.85rem", marginTop: 12 }}>{resolveSummary}</p>}
          {resolutions.length > 0 && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {resolutions.map((r, i) => (
                <div key={`${r.moveEventId}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 12, background: "#FFFBEB", borderRadius: 10, border: "1px solid #FDE68A" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.moveTitle || r.moveEventId}</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
                      {fmt(r.currentStart)} → {fmt(r.newStart)}
                    </div>
                    <div style={{ fontSize: "0.78rem", marginTop: 4 }}>{r.reason}</div>
                  </div>
                  {r.canApply ? (
                    <button type="button" onClick={() => applyMove(r)} style={btnPrimary}>Apply move</button>
                  ) : (
                    <span style={{ fontSize: "0.75rem", color: "#92400E" }}>Content-run item — add to Brand Calendar to reschedule</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Agenda */}
        <section style={{ ...card, marginTop: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Unified agenda ({events.length})</h3>
          {events.length === 0 && !loading && (
            <p style={{ color: "#64748B", fontSize: "0.88rem" }}>
              No upcoming Brand or Content calendar items. Add events in Brand Calendar or generate a Content Calendar, then refresh.
            </p>
          )}
          <div style={{ display: "grid", gap: 6 }}>
            {events.slice(0, 40).map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #F1F5F9", fontSize: "0.84rem" }}>
                <span style={{ width: 150, color: "#64748B", flexShrink: 0 }}>{fmt(e.start)}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{e.title}</span>
                <span style={{ color: "#94A3B8", textTransform: "uppercase", fontSize: "0.7rem" }}>{e.source} · {e.category}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: 14,
  padding: 18,
};

const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "#0F766E",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnSec: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #D1D5DB",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};
