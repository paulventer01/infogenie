"use client";

// Native React port of the legacy `content-autopilot` panel (was
// `window.buildAutopilot` + `#view-content-autopilot` in index.html, defined in
// public/js/ig_content_pro.js). Schedules automated content generation on a
// recurring cadence with optional WordPress auto-publish. All data comes from
// the existing Express API via `lib/api`:
//   GET  /api/autopilot/schedules           · GET    /api/autopilot/logs?limit=20
//   POST /api/autopilot/schedules           · PATCH  /api/autopilot/schedules/:id
//   DELETE /api/autopilot/schedules/:id      · POST   /api/autopilot/run-now/:id
//   GET  /api/wordpress/sites
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

interface Schedule {
  id: number;
  name: string;
  keyword: string;
  mode: string;
  frequency: string;
  enabled: boolean;
  wp_site_name?: string | null;
  run_count: number;
  next_run_at?: string | null;
}
interface LogEntry {
  status: string;
  schedule_name?: string;
  created_at: string;
  detail?: string;
  wp_post_url?: string;
}
interface WpSite {
  id: number;
  name: string;
}

const MODE_CONFIG: Record<string, { label: string; color: string }> = {
  article: { label: "📝 Article", color: "#0891B2" },
  affiliation: { label: "💰 Affiliation", color: "#D97706" },
  ecommerce: { label: "🛒 E-commerce", color: "#7C3AED" },
  local: { label: "📍 Local SEO", color: "#059669" },
  update: { label: "🔄 Update Content", color: "#6B7280" },
  discovery: { label: "🔥 Google Discovery", color: "#DC2626" },
};

const FREQ_LABELS: Record<string, string> = {
  daily: "Daily",
  every3days: "Every 3d",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
};

function toast(msg: string, ok = true) {
  if (typeof document === "undefined") return;
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${ok ? "#10B981" : "#EF4444"};color:#fff;padding:10px 18px;border-radius:10px;font-size:0.8rem;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 11px",
  border: "1px solid #D1D5DB",
  borderRadius: 7,
  fontSize: "0.84rem",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#6B7280",
  display: "block",
  marginBottom: 4,
};

export default function ContentAutopilot() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [wpSites, setWpSites] = useState<WpSite[]>([]);

  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mode, setMode] = useState("article");
  const [freq, setFreq] = useState("weekly");
  const [wpSite, setWpSite] = useState("");
  const [wpStatus, setWpStatus] = useState("draft");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError("");
    const [sr, lr] = await Promise.all([
      apiGet<{ ok: boolean; schedules?: Schedule[]; error?: string }>(
        "/api/autopilot/schedules",
      ),
      apiGet<{ ok: boolean; logs?: LogEntry[] }>(
        "/api/autopilot/logs?limit=20",
      ),
    ]);
    setLoading(false);
    if (!sr.ok) {
      setListError(sr.error || "Failed to load schedules");
      setSchedules([]);
    } else {
      setSchedules(sr.schedules || []);
    }
    setLogs(lr.ok && lr.logs ? lr.logs : []);
  }, []);

  useEffect(() => {
    apiGet<{ ok: boolean; sites?: WpSite[] }>("/api/wordpress/sites").then((r) =>
      setWpSites(r.ok && r.sites ? r.sites : []),
    );
    refresh();
  }, [refresh]);

  async function create() {
    if (!name) {
      toast("⚠️ Name required", false);
      return;
    }
    if (!keyword) {
      toast("⚠️ Keyword required", false);
      return;
    }
    setCreating(true);
    const r = await apiPost<{ ok: boolean; error?: string }>(
      "/api/autopilot/schedules",
      {
        name,
        keyword,
        mode,
        frequency: freq,
        auto_publish: !!wpSite,
        wp_site_id: wpSite || null,
        wp_status: wpStatus,
      },
    );
    setCreating(false);
    if (!r.ok) {
      toast("❌ " + (r.error || "failed"), false);
      return;
    }
    toast("✅ Schedule created");
    setName("");
    setKeyword("");
    refresh();
  }

  async function toggle(id: number, enabled: boolean) {
    await apiPatch(`/api/autopilot/schedules/${id}`, { enabled });
    refresh();
  }

  async function remove(id: number) {
    if (!confirm("Delete this schedule?")) return;
    await apiDelete(`/api/autopilot/schedules/${id}`);
    toast("Deleted");
    refresh();
  }

  async function runNow(id: number) {
    toast("⏳ Running now — check logs in a few seconds");
    const r = await apiPost<{ ok: boolean; error?: string }>(
      `/api/autopilot/run-now/${id}`,
    );
    if (r.ok) setTimeout(refresh, 4000);
    else toast("❌ " + (r.error || "failed"), false);
  }

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Create</span>{" "}
                <span className="bc-sep">›</span> Content Autopilot
              </div>
              <h2 className="view-title">🤖 Content Autopilot</h2>
              <p className="view-sub">
                Schedule automated content generation on a recurring cadence.
                Optionally auto-publish to WordPress as draft or live.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 360px",
            gap: 18,
            alignItems: "start",
          }}
        >
          {/* Schedule list */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div
                style={{ fontWeight: 800, fontSize: "1rem", color: "#0A1628" }}
              >
                🤖 Active Schedules
              </div>
              <button
                onClick={refresh}
                style={{
                  padding: "6px 12px",
                  background: "#fff",
                  border: "1px solid #D1D5DB",
                  borderRadius: 7,
                  fontSize: "0.76rem",
                  fontWeight: 700,
                  color: "#374151",
                  cursor: "pointer",
                }}
              >
                🔄 Refresh
              </button>
            </div>

            <div>
              {loading ? (
                <div style={{ color: "#6B7280" }}>⏳ Loading…</div>
              ) : listError ? (
                <div style={{ color: "#B91C1C" }}>{listError}</div>
              ) : schedules.length === 0 ? (
                <div
                  style={{
                    background: "#F9FAFB",
                    border: "1px dashed #D1D5DB",
                    borderRadius: 10,
                    padding: 24,
                    textAlign: "center",
                    color: "#6B7280",
                    fontSize: "0.85rem",
                  }}
                >
                  No schedules yet. Create your first one →
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  {schedules.map((s) => {
                    const cfg = MODE_CONFIG[s.mode] || {
                      color: "#6B7280",
                      label: s.mode,
                    };
                    return (
                      <div
                        key={s.id}
                        style={{
                          background: "#fff",
                          border: "1px solid #E5E7EB",
                          borderLeft: `4px solid ${s.enabled ? cfg.color : "#D1D5DB"}`,
                          borderRadius: 10,
                          padding: "14px 16px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                alignItems: "center",
                                marginBottom: 4,
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  background: s.enabled ? cfg.color : "#9CA3AF",
                                  color: "#fff",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: "0.66rem",
                                  fontWeight: 800,
                                }}
                              >
                                {cfg.label}
                              </span>
                              <span
                                style={{
                                  background: "#F3F4F6",
                                  color: "#374151",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: "0.66rem",
                                  fontWeight: 700,
                                }}
                              >
                                {FREQ_LABELS[s.frequency] || s.frequency}
                              </span>
                              {s.wp_site_name && (
                                <span
                                  style={{
                                    background: "#EFF6FF",
                                    color: "#1D4ED8",
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    fontSize: "0.66rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  📤 WP: {s.wp_site_name}
                                </span>
                              )}
                              {!s.enabled && (
                                <span
                                  style={{
                                    background: "#F3F4F6",
                                    color: "#9CA3AF",
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    fontSize: "0.66rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  PAUSED
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#0A1628",
                                fontSize: "0.9rem",
                              }}
                            >
                              {s.name}
                            </div>
                            <div
                              style={{ fontSize: "0.76rem", color: "#6B7280" }}
                            >
                              Keyword: {s.keyword} · Runs: {s.run_count} · Next:{" "}
                              {s.next_run_at
                                ? new Date(s.next_run_at).toLocaleDateString()
                                : "—"}
                            </div>
                          </div>
                          <div
                            style={{ display: "flex", gap: 6, flexShrink: 0 }}
                          >
                            <button
                              onClick={() => runNow(s.id)}
                              title="Run now"
                              style={{
                                padding: "6px 10px",
                                background: "#ECFDF5",
                                border: "1px solid #BBF7D0",
                                borderRadius: 6,
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                color: "#059669",
                                cursor: "pointer",
                              }}
                            >
                              ▶ Now
                            </button>
                            <button
                              onClick={() => toggle(s.id, !s.enabled)}
                              style={{
                                padding: "6px 10px",
                                background: "#FFFBEB",
                                border: "1px solid #FDE68A",
                                borderRadius: 6,
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                color: "#92400E",
                                cursor: "pointer",
                              }}
                            >
                              {s.enabled ? "⏸ Pause" : "▶ Resume"}
                            </button>
                            <button
                              onClick={() => remove(s.id)}
                              style={{
                                padding: "6px 10px",
                                background: "#FEE2E2",
                                border: "1px solid #FECACA",
                                borderRadius: 6,
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                color: "#991B1B",
                                cursor: "pointer",
                              }}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "0.88rem",
                  color: "#0A1628",
                  marginBottom: 10,
                }}
              >
                📋 Recent Runs
              </div>
              <div>
                {loading ? (
                  <div style={{ color: "#9CA3AF" }}>⏳ Loading logs…</div>
                ) : logs.length === 0 ? (
                  <div style={{ color: "#9CA3AF", fontSize: "0.8rem" }}>
                    No runs yet.
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {logs.map((l, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#fff",
                          border: "1px solid #E5E7EB",
                          borderLeft: `3px solid ${l.status === "ok" ? "#10B981" : "#EF4444"}`,
                          borderRadius: 7,
                          padding: "8px 12px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.8rem",
                              fontWeight: 700,
                              color: l.status === "ok" ? "#059669" : "#B91C1C",
                            }}
                          >
                            {l.status === "ok" ? "✅" : "❌"}{" "}
                            {l.schedule_name || "Unknown"}
                          </span>
                          <span
                            style={{ fontSize: "0.7rem", color: "#9CA3AF" }}
                          >
                            {new Date(l.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.76rem",
                            color: "#374151",
                            marginTop: 3,
                          }}
                        >
                          {l.detail || ""}
                        </div>
                        {l.wp_post_url && (
                          <a
                            href={l.wp_post_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: "0.74rem", color: "#1D4ED8" }}
                          >
                            🔗 View WP post
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Create new schedule */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 12,
              padding: 18,
              position: "sticky",
              top: 80,
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: "0.9rem",
                color: "#0A1628",
                marginBottom: 14,
              }}
            >
              ➕ New Schedule
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={labelStyle}>NAME</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Weekly SEO blog"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>
                  KEYWORD / TOPIC <span style={{ color: "#DC2626" }}>*</span>
                </label>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. best running shoes"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>CONTENT MODE</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  style={inputStyle}
                >
                  {Object.entries(MODE_CONFIG)
                    .filter(([k]) => k !== "update")
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>FREQUENCY</label>
                <select
                  value={freq}
                  onChange={(e) => setFreq(e.target.value)}
                  style={inputStyle}
                >
                  <option value="daily">Daily</option>
                  <option value="every3days">Every 3 days</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>AUTO-PUBLISH TO WORDPRESS</label>
                <select
                  value={wpSite}
                  onChange={(e) => setWpSite(e.target.value)}
                  style={{ ...inputStyle, marginBottom: 6 }}
                >
                  <option value="">— Don&apos;t auto-publish —</option>
                  {wpSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {wpSite && (
                  <select
                    value={wpStatus}
                    onChange={(e) => setWpStatus(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="draft">Save as Draft</option>
                    <option value="publish">Publish immediately</option>
                    <option value="pending">Pending review</option>
                  </select>
                )}
              </div>
              <button
                onClick={create}
                disabled={creating}
                style={{
                  padding: 10,
                  background: "linear-gradient(135deg,#0891B2,#0E7490)",
                  border: "none",
                  borderRadius: 8,
                  fontSize: "0.84rem",
                  fontWeight: 800,
                  color: "#fff",
                  cursor: "pointer",
                  marginTop: 2,
                }}
              >
                {creating ? "⏳ Creating…" : "🤖 Create Schedule"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
