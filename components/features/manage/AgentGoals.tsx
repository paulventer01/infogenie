"use client";

// Native React port of the legacy `agent-goals` panel (was
// `window.buildAgentGoals` + `_agent*` helpers in public/js/ig_creator_suite.js
// + `#view-agent-goals`). Reads marketing goals, creates new goals with an
// AI-generated plan, toggles/adds tasks, evaluates progress, archives and
// deletes — all against the existing Express API (`/api/agent-goals`,
// `/api/agent-goals/tasks/:id`, `/api/agent-goals/:id/...`) via lib/api.

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

interface Evaluation {
  grade?: string;
  assessment?: string;
}

interface Task {
  id: number;
  title: string;
  status: string;
  action_type?: string;
  due_date?: string | null;
}

interface Goal {
  id: number;
  title: string;
  description?: string;
  status: string;
  progress_pct: number;
  tasks?: Task[];
  last_evaluation?: Evaluation;
}

interface GoalsResult {
  ok?: boolean;
  goals?: Goal[];
  error?: string;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#22c55e",
  B: "#84cc16",
  C: "#f59e0b",
  D: "#f97316",
  F: "#ef4444",
};

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

export default function AgentGoals() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [evaluating, setEvaluating] = useState<number | null>(null);

  // modal fields
  const [mTitle, setMTitle] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mCriteria, setMCriteria] = useState("");
  const [mDeadline, setMDeadline] = useState("");
  const [modalStatus, setModalStatus] = useState<{
    msg: string;
    type: string;
  } | null>(null);

  async function load() {
    setLoadError(false);
    const data = await apiGet<GoalsResult>("/api/agent-goals");
    if (data.ok === false && !data.goals) {
      setLoadError(true);
      return;
    }
    setGoals(data.goals || []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await apiGet<GoalsResult>("/api/agent-goals");
      if (cancelled) return;
      if (data.ok === false && !data.goals) {
        setLoadError(true);
        return;
      }
      setGoals(data.goals || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openModal() {
    setMTitle("");
    setMDesc("");
    setMCriteria("");
    setMDeadline("");
    setModalStatus(null);
    setShowModal(true);
  }

  async function saveGoal() {
    setModalStatus({ msg: "🤖 AI is building your execution plan…", type: "info" });
    const data = await apiPost<{ error?: string }>("/api/agent-goals", {
      title: mTitle,
      description: mDesc,
      success_criteria: mCriteria,
      deadline: mDeadline || null,
    });
    if (data.error) {
      setModalStatus({ msg: data.error, type: "error" });
      return;
    }
    setShowModal(false);
    await load();
  }

  async function toggleTask(taskId: number, status: string) {
    await apiPut(`/api/agent-goals/tasks/${taskId}`, { status });
    await load();
  }

  async function evaluate(goalId: number) {
    setEvaluating(goalId);
    const data = await apiPost<{ error?: string }>(
      `/api/agent-goals/${goalId}/evaluate`,
      {},
    );
    setEvaluating(null);
    if (data.error) {
      alert(data.error);
      return;
    }
    await load();
  }

  async function addTask(goalId: number) {
    const title = prompt("Task title:");
    if (!title) return;
    await apiPost(`/api/agent-goals/${goalId}/tasks`, { title });
    await load();
  }

  async function archive(goalId: number) {
    await apiPut(`/api/agent-goals/${goalId}`, { status: "archived" });
    await load();
  }

  async function remove(goalId: number) {
    if (!confirm("Delete this goal and all its tasks?")) return;
    await apiDelete(`/api/agent-goals/${goalId}`);
    await load();
  }

  function renderCard(g: Goal) {
    const tasks = g.tasks || [];
    const done = tasks.filter((t) => t.status === "done").length;
    const evaluation = g.last_evaluation || {};
    const gradeColor = (evaluation.grade && GRADE_COLORS[evaluation.grade]) || "#94a3b8";
    return (
      <div key={g.id} className="ig-card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>{g.title}</h3>
            {g.description && (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                }}
              >
                {g.description}
              </p>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: 16,
            }}
          >
            {evaluation.grade && (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: gradeColor,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {evaluation.grade}
              </div>
            )}
            <span
              className={`ig-badge ${g.status === "active" ? "ig-badge-green" : "ig-badge-muted"}`}
            >
              {g.status}
            </span>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              marginBottom: 4,
            }}
          >
            <span>Progress</span>
            <span>
              {g.progress_pct}% ({done}/{tasks.length} tasks)
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: "var(--border)",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: "var(--ig-primary,#667eea)",
                width: `${g.progress_pct}%`,
                borderRadius: 3,
                transition: "width 0.5s",
              }}
            />
          </div>
        </div>
        {tasks.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {tasks.slice(0, 5).map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={(e) =>
                    toggleTask(t.id, e.target.checked ? "done" : "pending")
                  }
                  style={{ cursor: "pointer" }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.85rem",
                    ...(t.status === "done"
                      ? {
                          textDecoration: "line-through",
                          color: "var(--text-muted)",
                        }
                      : {}),
                  }}
                >
                  <span className="ig-badge ig-badge-xs" style={{ marginRight: 4 }}>
                    {t.action_type || ""}
                  </span>
                  {t.title}
                </span>
                {t.due_date && (
                  <span
                    style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                  >
                    {fmtDate(t.due_date)}
                  </span>
                )}
              </div>
            ))}
            {tasks.length > 5 && (
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "var(--text-muted)",
                  paddingTop: 6,
                }}
              >
                +{tasks.length - 5} more tasks
              </div>
            )}
          </div>
        )}
        {evaluation.assessment && (
          <div
            style={{
              background: "var(--bg-subtle,#f8f9fa)",
              borderRadius: 8,
              padding: 10,
              fontSize: "0.83rem",
              marginBottom: 12,
            }}
          >
            <strong>Last evaluation:</strong> {evaluation.assessment}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => evaluate(g.id)}
            disabled={evaluating === g.id}
          >
            {evaluating === g.id ? "⏳ Evaluating…" : "🤖 Evaluate Progress"}
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => addTask(g.id)}>
            + Add Task
          </button>
          {g.status === "active" && (
            <button
              className="btn btn-sm btn-outline"
              onClick={() => archive(g.id)}
            >
              Archive
            </button>
          )}
          <button
            className="btn btn-sm btn-danger-outline"
            onClick={() => remove(g.id)}
          >
            🗑️
          </button>
        </div>
      </div>
    );
  }

  const active = (goals || []).filter((g) => g.status === "active");
  const archived = (goals || []).filter((g) => g.status !== "active");

  return (
    <div>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> AI Marketing Agent
              </div>
              <h2 className="view-title">🤖 AI Marketing Agent</h2>
              <p className="view-sub">
                Set a marketing goal, and the AI agent builds an execution plan,
                breaks it into tasks, and evaluates your progress. A judge LLM
                grades how close you are and recommends the next move.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {loadError ? (
          <div className="ig-alert ig-alert-error">Failed to load goals.</div>
        ) : goals === null ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <span className="ig-spinner"></span>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>
                  Active Goals{" "}
                  <span
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--text-muted)",
                      fontWeight: 400,
                    }}
                  >
                    ({active.length})
                  </span>
                </h3>
              </div>
              <button className="btn btn-primary" onClick={openModal}>
                🎯 Set New Goal
              </button>
            </div>
            {active.length === 0 ? (
              <div className="ig-empty-state">
                <div className="ies-icon">🤖</div>
                <h3>No active goals</h3>
                <p>
                  Set a marketing goal and the AI agent will build an execution
                  plan, break it into tasks, and evaluate your progress.
                </p>
              </div>
            ) : (
              active.map(renderCard)
            )}
            {archived.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4 style={{ color: "var(--text-muted)" }}>Archived</h4>
                {archived.map(renderCard)}
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <div
          className="ig-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div className="ig-modal" style={{ maxWidth: 620 }}>
            <div className="ig-modal-header">
              <h3>🎯 Set Marketing Goal</h3>
              <button
                className="ig-modal-close"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>
            <div className="ig-modal-body">
              <div style={{ marginBottom: 12 }}>
                <label className="ig-label">Goal Title *</label>
                <input
                  className="ig-input"
                  value={mTitle}
                  onChange={(e) => setMTitle(e.target.value)}
                  placeholder="e.g. Grow Instagram following by 20% in 90 days"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="ig-label">Description</label>
                <textarea
                  className="ig-textarea"
                  rows={2}
                  value={mDesc}
                  onChange={(e) => setMDesc(e.target.value)}
                  placeholder="What does success look like? More context = better AI plan."
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="ig-label">
                  Success Criteria (how you&apos;ll measure it)
                </label>
                <textarea
                  className="ig-textarea"
                  rows={2}
                  value={mCriteria}
                  onChange={(e) => setMCriteria(e.target.value)}
                  placeholder="e.g. Instagram followers > 12,000, engagement rate > 4%, 3 brand deals closed"
                />
              </div>
              <div>
                <label className="ig-label">Deadline</label>
                <input
                  className="ig-input"
                  type="date"
                  value={mDeadline}
                  onChange={(e) => setMDeadline(e.target.value)}
                />
              </div>
            </div>
            <div className="ig-modal-footer">
              <div>
                {modalStatus && (
                  <div
                    className={`ig-alert ig-alert-${modalStatus.type}`}
                    style={{ margin: "8px 0" }}
                  >
                    {modalStatus.msg}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                  marginTop: 8,
                }}
              >
                <button
                  className="btn btn-outline"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveGoal}>
                  🤖 Set Goal + Generate Plan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
