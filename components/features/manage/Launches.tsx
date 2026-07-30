"use client";

// Native React port of the legacy `launches` panel (was `buildLaunches` /
// `_renderLaunches` in public/js/ig_mentions_gaps.js + `#view-launches`).
// Schedules campaign go-live dates with 24h/1h/live reminders, reading and
// writing the existing Express API (`/api/launches/list|add|remove`).

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface LaunchReminders {
  h24?: boolean;
  h1?: boolean;
  live?: boolean;
}

interface Launch {
  id: string;
  name: string;
  datetimeISO: string;
  channel: string;
  status: string;
  notes?: string;
  reminders: LaunchReminders;
}

interface LaunchesResult {
  ok: boolean;
  error?: string;
  launches: Launch[];
  channels?: string[];
  dataSource?: string;
  confidence?: string;
  dataOrigin?: string;
}

interface AddResult {
  ok: boolean;
  error?: string;
  launch?: Launch;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "live now";
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000) % 24;
  const d = Math.floor(ms / 86400000);
  if (d > 0) return `in ${d}d ${h}h ${m}m`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

type Group = "today" | "week" | "later" | "past";

export default function Launches() {
  const [data, setData] = useState<LaunchesResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [dt, setDt] = useState("");
  const [channel, setChannel] = useState("");
  const [notes, setNotes] = useState("");
  const [minDate, setMinDate] = useState("");
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);

  async function load() {
    setLoadError(null);
    const j = await apiGet<LaunchesResult>("/api/launches/list");
    if (j.ok) {
      setData(j);
      if (!channel) {
        const channels = j.channels || ["Email", "Social", "Paid Ad", "PR", "Mixed", "Other"];
        setChannel(channels[0] || "");
      }
    } else {
      setLoadError(j.error || "load failed");
    }
  }

  useEffect(() => {
    setMinDate(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addLaunch() {
    const nm = name.trim();
    const dtLocal = dt.trim();
    if (!nm || !dtLocal) {
      setMsg({ color: "#B91C1C", text: "Name and date/time are required." });
      return;
    }
    const datetimeISO = new Date(dtLocal).toISOString();
    setMsg({ color: "#64748B", text: "Scheduling…" });
    const j = await apiPost<AddResult>("/api/launches/add", {
      name: nm,
      datetimeISO,
      channel,
      notes: notes.trim(),
    });
    if (!j.ok) {
      setMsg({ color: "#B91C1C", text: j.error || "Failed" });
      return;
    }
    setName("");
    setDt("");
    setNotes("");
    setMsg({
      color: "#059669",
      text: `Scheduled — ${j.launch ? new Date(j.launch.datetimeISO).toLocaleString() : ""}`,
    });
    load();
  }

  async function removeLaunch(id: string) {
    if (!confirm("Remove this launch from the calendar?")) return;
    const j = await apiPost<{ ok: boolean }>("/api/launches/remove", { id });
    if (j.ok) load();
    else alert("Failed to remove");
  }

  const channels = (data && data.channels) || ["Email", "Social", "Paid Ad", "PR", "Mixed", "Other"];

  function renderBody() {
    if (loadError) {
      return (
        <div
          style={{
            background: "white",
            border: "1px solid #FECACA",
            borderRadius: 10,
            padding: 18,
            color: "#B91C1C",
          }}
        >
          Failed to load: {loadError}
        </div>
      );
    }
    if (!data) {
      return <div style={{ padding: 32, textAlign: "center", color: "#64748B" }}>Loading launches…</div>;
    }

    const now = Date.now();
    const groups: Record<Group, Array<{ l: Launch; ms: number }>> = {
      today: [],
      week: [],
      later: [],
      past: [],
    };
    data.launches.forEach((l) => {
      const ts = Date.parse(l.datetimeISO);
      const ms = ts - now;
      if (ms < 0) groups.past.push({ l, ms });
      else if (ms < 24 * 60 * 60 * 1000) groups.today.push({ l, ms });
      else if (ms < 7 * 24 * 60 * 60 * 1000) groups.week.push({ l, ms });
      else groups.later.push({ l, ms });
    });

    const card = (entry: { l: Launch; ms: number }, group: Group) => {
      const { l, ms } = entry;
      const cdColor =
        group === "past" ? "#94A3B8" : group === "today" ? "#DC2626" : group === "week" ? "#D97706" : "#0F766E";
      const pendingStyle: React.CSSProperties = {
        background: "#F1F5F9",
        color: "#94A3B8",
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 99,
      };
      const doneStyle: React.CSSProperties = {
        background: "#DCFCE7",
        color: "#166534",
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 99,
      };
      return (
        <div
          key={l.id}
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 10,
            padding: 14,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            marginBottom: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
              <span
                style={{
                  background: "#EEF2FF",
                  color: "#4338CA",
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "2px 8px",
                  borderRadius: 99,
                  letterSpacing: ".04em",
                }}
              >
                {l.channel.toUpperCase()}
              </span>
              <span style={{ color: cdColor, fontSize: 11, fontWeight: 800 }}>{formatCountdown(ms)}</span>
            </div>
            <div style={{ fontWeight: 700, color: "#0F172A", fontSize: 14, marginBottom: 3 }}>{l.name}</div>
            <div style={{ color: "#64748B", fontSize: 11, marginBottom: 6 }}>
              {new Date(l.datetimeISO).toLocaleString()} · status: <strong>{l.status}</strong>
            </div>
            {l.notes ? (
              <div style={{ color: "#475569", fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}>{l.notes}</div>
            ) : null}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={l.reminders.h24 ? doneStyle : pendingStyle}>{l.reminders.h24 ? "24h ✓" : "24h pending"}</span>
              <span style={l.reminders.h1 ? doneStyle : pendingStyle}>{l.reminders.h1 ? "1h ✓" : "1h pending"}</span>
              {l.reminders.live ? (
                <span
                  style={{
                    background: "#FEE2E2",
                    color: "#991B1B",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 99,
                  }}
                >
                  LIVE 🚀
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => removeLaunch(l.id)}
            style={{
              background: "#FEF2F2",
              color: "#B91C1C",
              border: "1px solid #FECACA",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Remove
          </button>
        </div>
      );
    };

    const section = (title: string, arr: Array<{ l: Launch; ms: number }>, group: Group, emoji: string) =>
      arr.length ? (
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "#64748B",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {emoji} {title} ({arr.length})
          </div>
          {arr.map((e) => card(e, group))}
        </div>
      ) : null;

    return (
      <>
        <div
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", marginBottom: 12 }}>📅 Schedule a launch</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Launch name (e.g. Q2 product launch)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
            />
            <input
              type="datetime-local"
              min={minDate}
              value={dt}
              onChange={(e) => setDt(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13 }}
            />
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13, background: "white" }}
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            placeholder="Optional notes — what's launching, owner, success metric…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              border: "1px solid #CBD5E1",
              borderRadius: 6,
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              Reminders fire automatically: 24h before, 1h before, and at go-live. Stakeholders get an email at every
              reminder.
            </div>
            <button
              onClick={addLaunch}
              style={{
                background: "#7C3AED",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Schedule launch
            </button>
          </div>
          {msg && <div style={{ fontSize: 11, marginTop: 8, minHeight: 14, color: msg.color }}>{msg.text}</div>}
        </div>
        {section("Today & next 24h", groups.today, "today", "🔥")}
        {section("This week", groups.week, "week", "📅")}
        {section("Later", groups.later, "later", "🗓️")}
        {section("Past launches", groups.past, "past", "✅")}
        {data.launches.length === 0 && (
          <div
            style={{
              background: "white",
              border: "1px dashed #CBD5E1",
              borderRadius: 10,
              padding: 32,
              textAlign: "center",
              color: "#94A3B8",
            }}
          >
            No launches scheduled yet — schedule your first one above.
          </div>
        )}
        <div
          style={{
            marginTop: 14,
            padding: "8px 12px",
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            fontSize: 11,
            color: "#64748B",
          }}
        >
          Source: {data.dataSource} · {data.confidence} confidence · {data.dataOrigin}
        </div>
      </>
    );
  }

  return (
    <div className="view" id="view-launches">
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(110deg,#7C3AED 0%,#A855F7 50%,#EC4899 100%)" }}>
        <div className="breadcrumb" style={{ color: "#FBCFE8" }}>
          <span className="bc-group" style={{ color: "#FBCFE8", opacity: 0.85 }}>
            Manage
          </span>{" "}
          <span className="bc-sep" style={{ color: "#FBCFE8", opacity: 0.55 }}>
            ›
          </span>{" "}
          Launch Calendar
        </div>
        <h1 className="ih-title">🚀 Launch Calendar</h1>
        <p className="ih-sub">
          Schedule campaign go-live dates — get 24h &amp; 1h reminders in your bell + stakeholder inboxes
        </p>
      </div>
      <div id="launchesWrap" style={{ padding: "24px 28px" }}>
        {renderBody()}
      </div>
    </div>
  );
}
