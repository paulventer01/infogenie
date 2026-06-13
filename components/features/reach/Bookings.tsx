"use client";

// Native React port of the legacy `bookings` panel (was
// `window.buildBookings` + `#view-bookings` in index.html, built in
// public/js/ig_studio.js). Manages a public booking page via the existing
// Express API:
//   GET  /api/bookings/schedule/:slug  — load availability schedule
//   POST /api/bookings/schedule/:slug  — save availability schedule
//   GET  /api/bookings/list/:slug      — list received bookings
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

const SLUG = "default";
const DEFAULT_TIMES = ["09:00", "10:00", "11:00", "14:00", "15:00"];

interface Schedule {
  title?: string;
  description?: string;
  durationMin?: number;
  notifyEmail?: string;
  weekly?: Record<string, string[]>;
}

interface ScheduleResult {
  ok?: boolean;
  error?: string;
  schedule?: Schedule;
}

interface Booking {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  starts_at?: string;
}

interface ListResult {
  ok?: boolean;
  error?: string;
  bookings?: Booking[];
}

export default function Bookings() {
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationMin, setDurationMin] = useState(30);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [weeklyStr, setWeeklyStr] = useState(DEFAULT_TIMES.join(","));
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    (async () => {
      const s = await apiGet<ScheduleResult>("/api/bookings/schedule/" + SLUG);
      const sched = s.schedule || {};
      setTitle(sched.title || "");
      setDescription(sched.description || "");
      setDurationMin(sched.durationMin || 30);
      setNotifyEmail(sched.notifyEmail || "");
      setWeeklyStr((sched.weekly?.["1"] || DEFAULT_TIMES).join(","));
      setLoaded(true);
      const l = await apiGet<ListResult>("/api/bookings/list/" + SLUG);
      setBookings(l.bookings || []);
    })();
  }, []);

  async function save() {
    const times = weeklyStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const weekly: Record<string, string[]> = {
      "1": times,
      "2": times,
      "3": times,
      "4": times,
      "5": times,
    };
    setSaving(true);
    const r = await apiPost<ScheduleResult>("/api/bookings/schedule/" + SLUG, {
      title,
      description,
      durationMin: Number(durationMin) || 30,
      notifyEmail,
      weekly,
    });
    setSaving(false);
    if (r.ok === false) showToast(r.error || "Save failed");
    else showToast("Saved ✓");
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    border: "1.5px solid #E5E7EB",
    borderRadius: 8,
    margin: "6px 0 10px",
    boxSizing: "border-box",
  };

  return (
    <>
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>📅 Bookings</h1>
              <p style={{ margin: "6px 0 0", color: "#64748B" }}>
                Configure your availability and share a public booking page.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ padding: "24px 0 64px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px" }}>Your schedule</h3>
            {!loaded ? (
              <div>Loading…</div>
            ) : (
              <>
                <label>
                  Title
                  <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} />
                </label>
                <label>
                  Description
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    style={{ ...fieldStyle, fontFamily: "inherit" }}
                  />
                </label>
                <label>
                  Duration (min)
                  <input
                    type="number"
                    value={durationMin}
                    onChange={(e) => setDurationMin(parseInt(e.target.value, 10) || 0)}
                    style={fieldStyle}
                  />
                </label>
                <label>
                  Notify on booking (email)
                  <input
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <label>
                  Weekly availability (Mon-Fri, comma-separated HH:MM)
                  <input
                    value={weeklyStr}
                    onChange={(e) => setWeeklyStr(e.target.value)}
                    style={fieldStyle}
                  />
                </label>
                <button
                  onClick={save}
                  disabled={saving}
                  style={{
                    background: "#0066FF",
                    color: "white",
                    border: 0,
                    padding: "10px 18px",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Save schedule
                </button>
              </>
            )}
          </div>

          <div
            style={{
              background: "white",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h3 style={{ margin: "0 0 12px" }}>Recent bookings</h3>
            <div
              style={{
                background: "#F0F9FF",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              Public link:{" "}
              <a
                href={`/book/${SLUG}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#0066FF", fontWeight: 600 }}
              >
                {origin}/book/{SLUG}
              </a>
            </div>
            <div>
              {bookings === null ? (
                <div>Loading…</div>
              ) : bookings.length === 0 ? (
                <p style={{ color: "#94A3B8", fontSize: 13 }}>No bookings yet.</p>
              ) : (
                bookings.map((b, i) => (
                  <div
                    key={i}
                    style={{ borderBottom: "1px solid #F1F5F9", padding: "10px 0", fontSize: 13 }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {b.name} · {b.starts_at ? new Date(b.starts_at).toLocaleString() : ""}
                    </div>
                    <div style={{ color: "#64748B" }}>
                      {b.email}
                      {b.phone ? " · " + b.phone : ""}
                    </div>
                    {b.notes && (
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{b.notes}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
