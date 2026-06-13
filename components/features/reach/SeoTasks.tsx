"use client";

// Native React port of the legacy `seo-tasks` panel (was `window.buildSeoTasks`
// in public/js/ig_seo.js + `#view-seo-tasks` in index.html). Tracks every SEO
// audit warning/failure as a filterable task with priority, assignee, due date
// and status, backed by the existing Express API (`/api/seo-tasks/*`) via
// `lib/api`.
//
// See `docs/react-panel-migration.md` for the porting pattern.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

interface Task {
  id: number;
  priority: number;
  status: string;
  label: string;
  message?: string;
  fix?: string;
  source_url?: string;
  assignee?: string;
  due_date?: string | null;
}

interface ListResult {
  ok: boolean;
  error?: string;
  tasks: Task[];
}

interface Stats {
  open?: number;
  in_progress?: number;
  snoozed?: number;
  done?: number;
  total?: number;
}

interface StatsResult {
  ok: boolean;
  error?: string;
  stats: Stats;
}

interface ReauditResult {
  ok: boolean;
  error?: string;
  score: number;
  grade: string;
  autoClosed: number;
  imported: number;
}

const PRI: Record<number, { label: string; color: string }> = {
  1: { label: "P1", color: "#EF4444" },
  2: { label: "P2", color: "#F59E0B" },
  3: { label: "P3", color: "#9CA3AF" },
};

const STATUS_OPTS: [string, string][] = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["snoozed", "Snoozed"],
  ["done", "Done"],
  ["wont_fix", "Won't fix"],
];

function fmtN(v: number | undefined): string {
  return Number(v || 0).toLocaleString();
}

function safeUrl(u: string): string {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.href : "#";
  } catch {
    return "#";
  }
}

export default function SeoTasks() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [listError, setListError] = useState("");

  const [fltStatus, setFltStatus] = useState("");
  const [fltPri, setFltPri] = useState("");
  const [fltUrl, setFltUrl] = useState("");

  const [reUrl, setReUrl] = useState("");
  const [reauditing, setReauditing] = useState(false);

  async function loadStats() {
    const r = await apiGet<StatsResult>("/api/seo-tasks/stats");
    if (r.ok) setStats(r.stats);
  }

  async function load() {
    setListError("");
    const q = new URLSearchParams();
    if (fltStatus) q.set("status", fltStatus);
    if (fltPri) q.set("priority", fltPri);
    if (fltUrl) q.set("url", fltUrl);
    const r = await apiGet<ListResult>("/api/seo-tasks/list?" + q.toString());
    if (!r.ok) {
      setTasks([]);
      setListError(r.error || "failed");
      return;
    }
    setTasks(r.tasks || []);
  }

  useEffect(() => {
    loadStats();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLocal(id: number, patch: Partial<Task>) {
    setTasks((prev) => (prev ? prev.map((t) => (t.id === id ? { ...t, ...patch } : t)) : prev));
  }

  async function patchTask(id: number, body: Record<string, unknown>) {
    await apiPatch("/api/seo-tasks/" + id, body);
    loadStats();
  }

  async function deleteTask(id: number) {
    if (!confirm("Delete this task?")) return;
    await apiDelete("/api/seo-tasks/" + id);
    load();
    loadStats();
  }

  async function reaudit() {
    let url = reUrl.trim();
    if (!url) {
      alert("Enter a URL to re-audit");
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    setReauditing(true);
    const r = await apiPost<ReauditResult>("/api/seo-tasks/reaudit", { url });
    setReauditing(false);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    alert(
      `✓ New score: ${r.score}/100 (${r.grade})\nAuto-closed: ${r.autoClosed} task(s)\nNewly imported: ${r.imported} task(s)`,
    );
    load();
    loadStats();
  }

  const statCard = (label: string, n: number | undefined, color: string) => (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, textAlign: "center" }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color }}>{fmtN(n)}</div>
      <div style={{ fontSize: "0.7rem", color: "#6B7280", fontWeight: 700, marginTop: 2 }}>{label}</div>
    </div>
  );

  const fltLabel = { display: "block", fontSize: "0.66rem", fontWeight: 700, color: "#6B7280", marginBottom: 3 } as const;
  const selStyle = { padding: 7, border: "1px solid #D1D5DB", borderRadius: 5, fontSize: "0.82rem" } as const;

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Reach</span> <span className="bc-sep">›</span> SEO Task Manager
              </div>
              <h2 className="view-title">✅ SEO Task Manager</h2>
              <p className="view-sub">
                Every warning and failure from the SEO On-Page Auditor becomes a trackable task — set priority, assignee,
                due date, status. Re-run the audit to auto-close anything that now passes. Turns the audit from a snapshot
                into a living to-do list.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 18 }}>
          {stats && (
            <>
              {statCard("OPEN", stats.open, "#EF4444")}
              {statCard("IN PROGRESS", stats.in_progress, "#F59E0B")}
              {statCard("SNOOZED", stats.snoozed, "#9CA3AF")}
              {statCard("DONE", stats.done, "#10B981")}
              {statCard("TOTAL", stats.total, "#0A1628")}
            </>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 14,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "end",
          }}
        >
          <div>
            <label style={fltLabel}>STATUS</label>
            <select value={fltStatus} onChange={(e) => setFltStatus(e.target.value)} style={selStyle}>
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="snoozed">Snoozed</option>
              <option value="done">Done</option>
              <option value="wont_fix">Won&apos;t fix</option>
            </select>
          </div>
          <div>
            <label style={fltLabel}>PRIORITY</label>
            <select value={fltPri} onChange={(e) => setFltPri(e.target.value)} style={selStyle}>
              <option value="">All</option>
              <option value="1">P1 (high)</option>
              <option value="2">P2 (med)</option>
              <option value="3">P3 (low)</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={fltLabel}>URL CONTAINS</label>
            <input
              value={fltUrl}
              onChange={(e) => setFltUrl(e.target.value)}
              placeholder="example.com"
              style={{ width: "100%", padding: 7, border: "1px solid #D1D5DB", borderRadius: 5, fontSize: "0.82rem", boxSizing: "border-box" }}
            />
          </div>
          <button
            onClick={load}
            style={{
              background: "#0066FF",
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 5,
              fontSize: "0.82rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Filter
          </button>
          <div style={{ flex: 1 }} />
          <div>
            <label style={fltLabel}>RE-AUDIT URL</label>
            <input
              value={reUrl}
              onChange={(e) => setReUrl(e.target.value)}
              placeholder="https://yoursite.com"
              style={{ padding: 7, border: "1px solid #D1D5DB", borderRadius: 5, fontSize: "0.82rem", width: 240, boxSizing: "border-box" }}
            />
          </div>
          <button
            onClick={reaudit}
            disabled={reauditing}
            style={{
              background: "linear-gradient(135deg,#10B981,#0066FF)",
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 5,
              fontSize: "0.82rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {reauditing ? "⏳ Auditing…" : "🔄 Re-audit & auto-close"}
          </button>
        </div>

        <div>
          {listError ? (
            <div style={{ color: "#B91C1C" }}>{listError}</div>
          ) : tasks === null ? null : tasks.length === 0 ? (
            <div style={{ color: "#9CA3AF", textAlign: "center", padding: 30, background: "#fff", borderRadius: 10 }}>
              No tasks yet. Run an audit and click <strong>📋 Add to Task Manager</strong>.
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB", width: 50 }}>P</th>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>Issue</th>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>URL</th>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB", width: 130 }}>Status</th>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB", width: 140 }}>Assignee</th>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB", width: 120 }}>Due</th>
                    <th style={{ padding: 10, textAlign: "left", borderBottom: "1px solid #E5E7EB", width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const p = PRI[t.priority] || PRI[3];
                    const isClosed = t.status === "done" || t.status === "wont_fix";
                    return (
                      <tr key={t.id} style={{ opacity: isClosed ? 0.55 : 1 }}>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <span
                            style={{
                              background: p.color,
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: "0.68rem",
                              fontWeight: 800,
                            }}
                          >
                            {p.label}
                          </span>
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <strong style={{ color: "#0A1628" }}>{t.label}</strong>
                          <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 2 }}>
                            {(t.message || "").slice(0, 120)}
                          </div>
                          {t.fix ? (
                            <div style={{ fontSize: "0.72rem", color: "#7C3AED", marginTop: 2 }}>
                              <strong>Fix:</strong> {t.fix.slice(0, 140)}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <a
                            href={safeUrl(t.source_url || "")}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#0066FF", textDecoration: "none", fontSize: "0.78rem" }}
                          >
                            {(t.source_url || "").slice(0, 40)}↗
                          </a>
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <select
                            value={t.status}
                            onChange={(e) => {
                              updateLocal(t.id, { status: e.target.value });
                              patchTask(t.id, { status: e.target.value });
                            }}
                            style={{ width: "100%", padding: 5, border: "1px solid #D1D5DB", borderRadius: 4, fontSize: "0.76rem" }}
                          >
                            {STATUS_OPTS.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <input
                            value={t.assignee || ""}
                            placeholder="—"
                            onChange={(e) => updateLocal(t.id, { assignee: e.target.value })}
                            onBlur={(e) => patchTask(t.id, { assignee: e.target.value })}
                            style={{ width: "100%", padding: 5, border: "1px solid #D1D5DB", borderRadius: 4, fontSize: "0.76rem", boxSizing: "border-box" }}
                          />
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <input
                            type="date"
                            value={t.due_date ? String(t.due_date).slice(0, 10) : ""}
                            onChange={(e) => {
                              updateLocal(t.id, { due_date: e.target.value || null });
                              patchTask(t.id, { dueDate: e.target.value || null });
                            }}
                            style={{ padding: 5, border: "1px solid #D1D5DB", borderRadius: 4, fontSize: "0.76rem" }}
                          />
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #F3F4F6" }}>
                          <button
                            onClick={() => deleteTask(t.id)}
                            style={{ background: "none", border: "none", color: "#B91C1C", cursor: "pointer", fontSize: "1rem" }}
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
