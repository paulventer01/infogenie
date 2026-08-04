"use client";

// Native React port of the legacy `playbook-7day` panel (was
// `window.buildPlaybook7Day` inline in app.js + `#view-playbook-7day` in
// index.html). Renders the 7-Day Marketing Playbook, reads/writes step state and
// AI suggestions against the existing Express API via `lib/api`:
//   • GET  /api/playbook                         — playbook, state, suggestions, runs
//   • POST /api/playbook/step/:id/toggle         — toggle a step done/undone
//   • POST /api/playbook/suggest {stepId,context}— AI suggestion for a step
//   • POST /api/playbook/run-autonomous {day}    — assign steps to AI officers
// The AI-suggestion overlay (previously a DOM-injected modal) is rendered as a
// React component; toasts reuse the shared `showToast` helper.

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

const DAY_COLORS = [
  "#0EA5E9",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#6366F1",
];

const OFFICER_EMOJI: Record<string, string> = {
  marketing: "📣",
  sales: "💼",
  analyst: "📊",
  content: "✍️",
  seo: "🔍",
  cro: "🎯",
  finance: "💰",
  ops: "⚙️",
};

interface Step {
  id: string;
  label: string;
  officer: string;
  detail: string;
}
interface Day {
  day: number;
  officer: string;
  title: string;
  objective: string;
  steps: Step[];
}
interface SuggestionAction {
  step?: string;
  tool?: string;
  owner?: string;
}
interface Suggestion {
  headline?: string;
  rationale?: string;
  actions?: SuggestionAction[];
  kpi?: string;
  risk?: string;
  generatedAt: string;
  snapshot?: unknown;
}
interface Run {
  at: string;
  dayFilter?: number | null;
  totalAdded: number;
  added?: Record<string, unknown>;
}
interface PlaybookData {
  playbook: Day[];
  state: Record<string, string>;
  suggestions: Record<string, Suggestion>;
  runs: Run[];
}

function SuggestionModal({
  stepId,
  sug,
  onClose,
}: {
  stepId: string;
  sug: Suggestion;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 640,
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
            color: "#0f172a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: ".7rem",
                letterSpacing: ".18em",
                textTransform: "uppercase",
                fontWeight: 700,
                opacity: 0.85,
              }}
            >
              🤖 AI Suggestion
            </div>
            <div style={{ fontSize: "1.05rem", fontWeight: 800, marginTop: 4 }}>
              {sug.headline || stepId}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.18)",
              border: "none",
              color: "#fff",
              width: 34,
              height: 34,
              borderRadius: "50%",
              fontSize: "1.1rem",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
          <div
            style={{
              fontSize: ".86rem",
              color: "#0F172A",
              lineHeight: 1.55,
              marginBottom: 14,
            }}
          >
            {sug.rationale || ""}
          </div>
          {sug.actions && sug.actions.length > 0 && (
            <>
              <div
                style={{
                  fontWeight: 800,
                  color: "#0F172A",
                  fontSize: ".82rem",
                  marginBottom: 6,
                }}
              >
                Recommended actions
              </div>
              <ul
                style={{
                  margin: "0 0 14px 18px",
                  padding: 0,
                  color: "#0F172A",
                  fontSize: ".84rem",
                  lineHeight: 1.5,
                }}
              >
                {sug.actions.map((a, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    <strong>{a.step || ""}</strong>
                    {a.tool && (
                      <span style={{ color: "#0EA5E9", fontSize: ".78rem" }}>
                        {" "}
                        · {a.tool}
                      </span>
                    )}
                    {a.owner && (
                      <span
                        style={{
                          background: "#F1F5F9",
                          color: "#475569",
                          padding: "2px 7px",
                          borderRadius: 99,
                          fontSize: ".7rem",
                          marginLeft: 4,
                        }}
                      >
                        {OFFICER_EMOJI[a.owner] || ""} {a.owner}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sug.kpi && (
            <div
              style={{
                background: "#F0FDF4",
                borderLeft: "3px solid #10B981",
                padding: "8px 12px",
                borderRadius: "0 8px 8px 0",
                marginBottom: 8,
                fontSize: ".8rem",
              }}
            >
              <strong style={{ color: "#15803D" }}>KPI to watch:</strong>{" "}
              {sug.kpi}
            </div>
          )}
          {sug.risk && (
            <div
              style={{
                background: "#FEF2F2",
                borderLeft: "3px solid #B91C1C",
                padding: "8px 12px",
                borderRadius: "0 8px 8px 0",
                fontSize: ".8rem",
              }}
            >
              <strong style={{ color: "#991B1B" }}>Watch out:</strong>{" "}
              {sug.risk}
            </div>
          )}
          <div style={{ marginTop: 14, fontSize: ".7rem", color: "#64748B" }}>
            Generated {new Date(sug.generatedAt).toLocaleString()}
            {sug.snapshot ? " · grounded in live platform snapshot" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Playbook7Day() {
  const [data, setData] = useState<PlaybookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [modal, setModal] = useState<{ stepId: string; sug: Suggestion } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/playbook", { credentials: "same-origin" });
      const j = (await r.json()) as PlaybookData;
      setData({
        playbook: j.playbook || [],
        state: j.state || {},
        suggestions: j.suggestions || {},
        runs: j.runs || [],
      });
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStep = useCallback(
    async (stepId: string) => {
      const j = await apiPost<{ state?: Record<string, string> }>(
        `/api/playbook/step/${stepId}/toggle`,
      );
      if (j.state) {
        setData((d) => (d ? { ...d, state: j.state! } : d));
      }
    },
    [],
  );

  const suggest = useCallback(async (stepId: string) => {
    const ctx = window.prompt(
      "Optional: any business context for the AI? (industry, current pain, target market — or leave blank)",
      "",
    );
    if (ctx === null) return;
    setBusyStep(stepId);
    try {
      const j = await apiPost<{ ok: boolean; error?: string; suggestion?: Suggestion }>(
        "/api/playbook/suggest",
        { stepId, context: ctx || "" },
      );
      if (!j.ok || !j.suggestion) throw new Error(j.error || "failed");
      const sug = j.suggestion;
      setData((d) =>
        d ? { ...d, suggestions: { ...d.suggestions, [stepId]: sug } } : d,
      );
      setModal({ stepId, sug });
    } catch (err) {
      window.alert(
        "AI Suggest failed: " +
          (err instanceof Error ? err.message : "unknown"),
      );
    } finally {
      setBusyStep(null);
    }
  }, []);

  const runAutonomous = useCallback(
    async (dayFilter: number | null) => {
      const label = dayFilter ? `Day ${dayFilter}` : "all 7 days";
      if (
        !window.confirm(
          `Assign every step in ${label} to its AI officer as a tracked task?\n\nThe Daily Report Scheduler will then start cross-referencing them against real platform activity. This is safe — it only adds tasks; nothing is deleted.`,
        )
      )
        return;
      try {
        const j = await apiPost<{ ok: boolean; error?: string; message?: string }>(
          "/api/playbook/run-autonomous",
          { day: dayFilter },
        );
        if (!j.ok) throw new Error(j.error || "failed");
        if (j.message) showToast(j.message);
        // Refresh runs.
        const r2 = await fetch("/api/playbook", { credentials: "same-origin" });
        const j2 = (await r2.json()) as PlaybookData;
        setData((d) => (d ? { ...d, runs: j2.runs || d.runs } : d));
      } catch (err) {
        window.alert(
          "Run failed: " + (err instanceof Error ? err.message : "unknown"),
        );
      }
    },
    [],
  );

  const body = () => {
    if (loading)
      return (
        <div style={{ textAlign: "center", color: "#64748B", padding: 40 }}>
          ⏳ Loading playbook…
        </div>
      );
    if (error || !data)
      return (
        <div style={{ color: "#B91C1C", padding: 20 }}>
          Failed to load: {error}
        </div>
      );

    const allIds = data.playbook.flatMap((d) => d.steps.map((s) => s.id));
    const done = allIds.filter((id) => data.state[id] === "done").length;
    const total = allIds.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const recentRun = data.runs[0];

    return (
      <>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 14,
            padding: 20,
            marginBottom: 18,
            boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: ".7rem",
                  color: "#64748B",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                Strategic Plan
              </div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#0F172A" }}>
                7-Day Marketing Playbook
              </div>
              <div style={{ fontSize: ".82rem", color: "#475569", marginTop: 4 }}>
                {done} / {total} steps marked done · {pct}% complete
                {recentRun
                  ? ` · last autonomous run ${new Date(recentRun.at).toLocaleString()} (${recentRun.totalAdded} tasks)`
                  : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                title="Assign every step to an AI officer as a tracked task"
                onClick={() => runAutonomous(null)}
                style={{
                  padding: "11px 18px",
                  background: "linear-gradient(135deg,#0f766e,#0284c7)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: ".92rem",
                }}
              >
                ▶ Run Autonomously (all 7 days)
              </button>
            </div>
          </div>
          <div
            style={{
              height: 8,
              background: "#F1F5F9",
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "linear-gradient(135deg,#10B981,#0EA5E9)",
                transition: "width .3s",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))",
            gap: 16,
          }}
        >
          {data.playbook.map((d, idx) => {
            const dayDone = d.steps.filter(
              (s) => data.state[s.id] === "done",
            ).length;
            const c = DAY_COLORS[idx % DAY_COLORS.length];
            return (
              <div
                key={d.day}
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
                }}
              >
                <div
                  style={{
                    padding: "16px 18px",
                    background: `linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)`,
                    color: "#0f172a",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: ".66rem",
                          letterSpacing: ".18em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                          opacity: 0.85,
                        }}
                      >
                        Day {d.day} · Lead: {OFFICER_EMOJI[d.officer] || ""}{" "}
                        {d.officer}
                      </div>
                      <div
                        style={{ fontSize: "1.05rem", fontWeight: 800, marginTop: 4 }}
                      >
                        {d.title}
                      </div>
                    </div>
                    <button
                      title="Assign just this day's steps to officers"
                      onClick={() => runAutonomous(d.day)}
                      style={{
                        padding: "7px 11px",
                        background: "linear-gradient(135deg,#0f766e,#0284c7)",
                        border: "none",
                        color: "#fff",
                        borderRadius: 7,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: ".72rem",
                        whiteSpace: "nowrap",
                        boxShadow: "0 4px 12px rgba(15,118,110,0.25)",
                      }}
                    >
                      ▶ Run Day {d.day}
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: ".78rem",
                      opacity: 0.9,
                      marginTop: 6,
                      lineHeight: 1.4,
                    }}
                  >
                    {d.objective}
                  </div>
                  <div style={{ fontSize: ".7rem", opacity: 0.85, marginTop: 6 }}>
                    {dayDone}/{d.steps.length} steps done
                  </div>
                </div>
                <div style={{ padding: "6px 10px" }}>
                  {d.steps.map((s) => {
                    const isDone = data.state[s.id] === "done";
                    const sug = data.suggestions[s.id];
                    return (
                      <div
                        key={s.id}
                        style={{
                          padding: "11px 8px",
                          borderTop: "1px solid #F1F5F9",
                        }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
                        >
                          <button
                            title="Mark done / undo"
                            onClick={() => toggleStep(s.id)}
                            style={{
                              marginTop: 2,
                              width: 22,
                              height: 22,
                              borderRadius: 5,
                              border: `1.5px solid ${isDone ? "#10B981" : "#CBD5E1"}`,
                              background: isDone ? "#10B981" : "#fff",
                              color: "#fff",
                              cursor: "pointer",
                              fontSize: ".78rem",
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {isDone ? "✓" : ""}
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#0F172A",
                                fontSize: ".86rem",
                                ...(isDone
                                  ? { textDecoration: "line-through", opacity: 0.6 }
                                  : {}),
                              }}
                            >
                              {s.label}{" "}
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: "#64748B",
                                  fontSize: ".72rem",
                                }}
                              >
                                · {OFFICER_EMOJI[s.officer] || ""} {s.officer}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: ".74rem",
                                color: "#475569",
                                marginTop: 3,
                                lineHeight: 1.45,
                              }}
                            >
                              {s.detail}
                            </div>
                            <div
                              style={{
                                marginTop: 8,
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                              }}
                            >
                              <button
                                disabled={busyStep === s.id}
                                onClick={() => suggest(s.id)}
                                style={{
                                  padding: "5px 10px",
                                  background: "#0EA5E9",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 6,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  fontSize: ".7rem",
                                }}
                              >
                                {busyStep === s.id ? "⏳ …" : "🤖 AI Suggest"}
                              </button>
                              {sug && (
                                <button
                                  onClick={() => setModal({ stepId: s.id, sug })}
                                  style={{
                                    padding: "5px 10px",
                                    background: "#F1F5F9",
                                    color: "#0F172A",
                                    border: "1px solid #CBD5E1",
                                    borderRadius: 6,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    fontSize: ".7rem",
                                  }}
                                >
                                  👁️ View suggestion
                                </button>
                              )}
                            </div>
                            {sug && (
                              <div
                                style={{
                                  marginTop: 8,
                                  padding: "8px 10px",
                                  background: "#F0F9FF",
                                  borderLeft: "3px solid #0EA5E9",
                                  borderRadius: "0 6px 6px 0",
                                  fontSize: ".74rem",
                                  color: "#0F172A",
                                }}
                              >
                                <strong>{sug.headline || ""}</strong>{" "}
                                <span style={{ color: "#64748B" }}>
                                  · {new Date(sug.generatedAt).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {data.runs.length > 0 && (
          <details
            style={{
              marginTop: 18,
              background: "#fff",
              border: "1px solid #E2E8F0",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 700,
                color: "#0F172A",
                fontSize: ".86rem",
              }}
            >
              ▸ Autonomous run history ({data.runs.length})
            </summary>
            <div style={{ marginTop: 10 }}>
              {data.runs.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 0",
                    borderTop: "1px solid #F1F5F9",
                    fontSize: ".78rem",
                    color: "#0F172A",
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <span>
                    {new Date(r.at).toLocaleString()} ·{" "}
                    {r.dayFilter ? `Day ${r.dayFilter}` : "All 7 days"}
                  </span>
                  <span style={{ color: "#64748B" }}>
                    {r.totalAdded} tasks across{" "}
                    {Object.keys(r.added || {}).length} officers
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </>
    );
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> 7-Day Marketing Playbook
              </div>
              <h2 className="view-title">📖 7-Day Marketing Playbook</h2>
              <p className="view-sub">
                A day-by-day strategic plan led by your AI officers — track every
                step, get AI suggestions grounded in real data, and assign whole
                days to autopilot.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {body()}
      </div>

      {modal && (
        <SuggestionModal
          stepId={modal.stepId}
          sug={modal.sug}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
