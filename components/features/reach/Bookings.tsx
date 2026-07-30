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

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { showToast } from "@/hooks/useToast";
import PanelHero from "@/components/layout/PanelHero";

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

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(15, 118, 110, 0.14)",
  borderRadius: 14,
  padding: "20px 20px 22px",
  boxShadow: "0 8px 22px rgba(15, 23, 42, 0.04)",
};

const sectionTitle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: "1.05rem",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.01em",
};

const btnPrimary: CSSProperties = {
  background: "linear-gradient(135deg, #0f766e, #0284c7)",
  color: "#fff",
  border: 0,
  padding: "11px 18px",
  borderRadius: 10,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.9rem",
  alignSelf: "flex-start",
  marginTop: 4,
};

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

  async function save(e?: FormEvent) {
    e?.preventDefault();
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

  return (
    <div className="view active" style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 40px" }}>
      <PanelHero
        group="Reach"
        title="📅 Bookings"
        subtitle="Configure your availability and share a public booking page."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <section style={card}>
          <h3 style={sectionTitle}>Your schedule</h3>
          {!loaded ? (
            <div style={{ color: "#64748b", fontSize: "0.9rem" }}>Loading…</div>
          ) : (
            <form className="form" onSubmit={save} style={{ gap: 14 }}>
              <div className="field-row" style={{ alignItems: "stretch" }}>
                <div className="ig-field">
                  <label htmlFor="bk-title">Title</label>
                  <input
                    id="bk-title"
                    className="ig-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. 30-min discovery call"
                  />
                </div>
                <div className="ig-field">
                  <label htmlFor="bk-desc">Description</label>
                  <textarea
                    id="bk-desc"
                    className="ig-input"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What attendees should expect"
                    style={{ fontFamily: "inherit", minHeight: 96 }}
                  />
                </div>
              </div>

              <div className="field-row" style={{ alignItems: "stretch" }}>
                <div className="ig-field" style={{ flex: "0 1 140px", maxWidth: 180 }}>
                  <label htmlFor="bk-duration">Duration (min)</label>
                  <input
                    id="bk-duration"
                    className="ig-input"
                    type="number"
                    min={5}
                    step={5}
                    value={durationMin}
                    onChange={(e) => setDurationMin(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div className="ig-field">
                  <label htmlFor="bk-notify">Notify on booking (email)</label>
                  <input
                    id="bk-notify"
                    className="ig-input"
                    type="email"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div className="ig-field">
                <label htmlFor="bk-weekly">Weekly availability (Mon–Fri, comma-separated HH:MM)</label>
                <input
                  id="bk-weekly"
                  className="ig-input"
                  value={weeklyStr}
                  onChange={(e) => setWeeklyStr(e.target.value)}
                  placeholder="09:00,10:00,11:00,14:00,15:00"
                />
              </div>

              <button type="submit" className="ig-btn" disabled={saving} style={btnPrimary}>
                {saving ? "Saving…" : "Save schedule"}
              </button>
            </form>
          )}
        </section>

        <section style={card}>
          <h3 style={sectionTitle}>Recent bookings</h3>
          <div
            style={{
              background: "linear-gradient(135deg, #ecfeff, #eff6ff)",
              border: "1px solid rgba(2, 132, 199, 0.18)",
              padding: "12px 14px",
              borderRadius: 10,
              fontSize: "0.82rem",
              marginBottom: 14,
              color: "#0f172a",
              lineHeight: 1.45,
              wordBreak: "break-all",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4, color: "#0369a1" }}>Public link</div>
            <a
              href={`/book/${SLUG}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#0284c7", fontWeight: 600, textDecoration: "none" }}
            >
              {origin || "…"}/book/{SLUG}
            </a>
          </div>
          <div>
            {bookings === null ? (
              <div style={{ color: "#64748b", fontSize: "0.9rem" }}>Loading…</div>
            ) : bookings.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: "0.88rem", margin: 0 }}>No bookings yet.</p>
            ) : (
              bookings.map((b, i) => (
                <div
                  key={i}
                  style={{
                    borderBottom: "1px solid #f1f5f9",
                    padding: "12px 0",
                    fontSize: "0.88rem",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {b.name} · {b.starts_at ? new Date(b.starts_at).toLocaleString() : ""}
                  </div>
                  <div style={{ color: "#64748b", marginTop: 2 }}>
                    {b.email}
                    {b.phone ? " · " + b.phone : ""}
                  </div>
                  {b.notes && (
                    <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: 4 }}>{b.notes}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
