"use client";

// Native React port of the legacy `agent-goals` panel. Marketing Goals:
// set a goal, AI builds an execution plan, track tasks, evaluate progress.
// Express API: `/api/agent-goals*` via lib/api.

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  success_criteria?: string;
  status: string;
  progress_pct: number;
  deadline?: string | null;
  tasks?: Task[];
  last_evaluation?: Evaluation;
}

interface GoalsResult {
  ok?: boolean;
  goals?: Goal[];
  error?: string;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#16a34a",
  B: "#65a30d",
  C: "#d97706",
  D: "#ea580c",
  F: "#dc2626",
};

const ACTION_LABELS: Record<string, string> = {
  content_creation: "Content",
  campaign_launch: "Campaign",
  audience_build: "Audience",
  seo: "SEO",
  outreach: "Outreach",
  analysis: "Analysis",
  competitor_research: "Competitors",
  other: "Task",
};

/* InfoGenie teal tokens — match Brand Deals / theme-v2 */
const IG = {
  ink: "#0b1220",
  muted: "#5b6577",
  border: "rgba(11, 18, 32, 0.1)",
  surface: "#ffffff",
  stage: "#f3f6fb",
  panel2: "#f8fafc",
  teal: "#0f766e",
  blue: "#0284c7",
  green: "#16a34a",
  warm: "#f97316",
  soft: "rgba(15, 118, 110, 0.12)",
  softBlue: "rgba(2, 132, 199, 0.1)",
  shadow: "0 1px 0 rgba(11, 18, 32, 0.04), 0 12px 32px rgba(11, 18, 32, 0.06)",
  grad: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
  radius: 12,
  radiusSm: 8,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: IG.muted,
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 13px",
  borderRadius: IG.radiusSm,
  border: `1.5px solid ${IG.border}`,
  background: IG.surface,
  color: IG.ink,
  fontSize: "0.9rem",
  fontFamily: "inherit",
  outline: "none",
};

const sectionStyle: CSSProperties = {
  border: `1px solid ${IG.border}`,
  borderRadius: IG.radius,
  padding: "16px 16px 14px",
  background: IG.panel2,
  marginBottom: 12,
};

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
}

function FieldLabel({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ ...labelStyle, marginBottom: hint ? 2 : 0 }}>
        {children}
      </label>
      {hint ? (
        <div style={{ fontSize: "0.72rem", color: IG.muted, lineHeight: 1.35 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none",
        borderRadius: IG.radiusSm,
        padding: "11px 18px",
        background: IG.grad,
        color: "#fff",
        fontWeight: 700,
        fontSize: "0.88rem",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        fontFamily: "inherit",
        boxShadow: "0 8px 20px rgba(15, 118, 110, 0.22)",
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1.5px solid ${danger ? "rgba(220,38,38,0.35)" : IG.border}`,
        background: IG.surface,
        color: danger ? "#dc2626" : IG.ink,
        borderRadius: IG.radiusSm,
        padding: "8px 12px",
        fontWeight: 700,
        fontSize: "0.78rem",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: IG.surface,
        border: `1px solid ${IG.border}`,
        borderRadius: IG.radius,
        padding: "16px 18px",
        boxShadow: IG.shadow,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: IG.muted,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.55rem",
          fontWeight: 800,
          color: IG.ink,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ marginTop: 6, fontSize: "0.75rem", color: IG.muted }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export default function AgentGoals() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [evaluating, setEvaluating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [mTitle, setMTitle] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mCriteria, setMCriteria] = useState("");
  const [mDeadline, setMDeadline] = useState("");
  const [formMsg, setFormMsg] = useState<{ text: string; kind: "info" | "error" } | null>(
    null,
  );

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

  function openForm() {
    setMTitle("");
    setMDesc("");
    setMCriteria("");
    setMDeadline("");
    setFormMsg(null);
    setShowForm(true);
    requestAnimationFrame(() => {
      document
        .getElementById("ig-goal-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function closeForm() {
    setShowForm(false);
    setFormMsg(null);
    setSaving(false);
  }

  async function saveGoal() {
    if (!mTitle.trim()) {
      setFormMsg({ text: "Add a goal title to continue.", kind: "error" });
      return;
    }
    setSaving(true);
    setFormMsg({
      text: "Building your execution plan…",
      kind: "info",
    });
    const data = await apiPost<{ error?: string }>("/api/agent-goals", {
      title: mTitle.trim(),
      description: mDesc.trim(),
      success_criteria: mCriteria.trim(),
      deadline: mDeadline || null,
    });
    setSaving(false);
    if (data.error) {
      setFormMsg({ text: data.error, kind: "error" });
      return;
    }
    closeForm();
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

  const active = useMemo(
    () => (goals || []).filter((g) => g.status === "active"),
    [goals],
  );
  const archived = useMemo(
    () => (goals || []).filter((g) => g.status !== "active"),
    [goals],
  );

  const stats = useMemo(() => {
    const allTasks = active.flatMap((g) => g.tasks || []);
    const done = allTasks.filter((t) => t.status === "done").length;
    const avg =
      active.length === 0
        ? 0
        : Math.round(
            active.reduce((s, g) => s + (g.progress_pct || 0), 0) / active.length,
          );
    return {
      active: active.length,
      tasks: allTasks.length,
      done,
      avg,
    };
  }, [active]);

  function renderGoal(g: Goal) {
    const tasks = g.tasks || [];
    const done = tasks.filter((t) => t.status === "done").length;
    const evaluation = g.last_evaluation || {};
    const gradeColor =
      (evaluation.grade && GRADE_COLORS[evaluation.grade]) || IG.muted;

    return (
      <article
        key={g.id}
        style={{
          background: IG.surface,
          border: `1px solid ${IG.border}`,
          borderRadius: IG.radius,
          boxShadow: IG.shadow,
          padding: "20px 22px",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 6,
                flexWrap: "wrap",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.08rem",
                  fontWeight: 800,
                  color: IG.ink,
                  letterSpacing: "-0.02em",
                }}
              >
                {g.title}
              </h3>
              <span
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "4px 9px",
                  borderRadius: 999,
                  background:
                    g.status === "active" ? IG.soft : "rgba(11,18,32,0.06)",
                  color: g.status === "active" ? IG.teal : IG.muted,
                }}
              >
                {g.status}
              </span>
            </div>
            {g.description ? (
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: "0.88rem",
                  color: IG.muted,
                  lineHeight: 1.45,
                }}
              >
                {g.description}
              </p>
            ) : null}
            {g.deadline ? (
              <div style={{ fontSize: "0.75rem", color: IG.muted }}>
                Deadline · {fmtDate(g.deadline)}
              </div>
            ) : null}
          </div>
          {evaluation.grade ? (
            <div
              title={evaluation.assessment || "Last evaluation grade"}
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: gradeColor,
                color: "#fff",
                fontWeight: 800,
                fontSize: "1.1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 6px 16px rgba(11,18,32,0.15)",
              }}
            >
              {evaluation.grade}
            </div>
          ) : null}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: IG.muted,
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            <span>Progress</span>
            <span>
              {g.progress_pct || 0}% · {done}/{tasks.length} tasks
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: "rgba(11,18,32,0.06)",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, Math.max(0, g.progress_pct || 0))}%`,
                background: IG.grad,
                borderRadius: 999,
                transition: "width 0.45s ease",
              }}
            />
          </div>
        </div>

        {tasks.length > 0 ? (
          <div
            style={{
              border: `1px solid ${IG.border}`,
              borderRadius: IG.radiusSm,
              background: IG.panel2,
              marginBottom: 14,
              overflow: "hidden",
            }}
          >
            {tasks.slice(0, 6).map((t, i) => (
              <label
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderTop: i === 0 ? "none" : `1px solid ${IG.border}`,
                  cursor: "pointer",
                  background: t.status === "done" ? "transparent" : IG.surface,
                }}
              >
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={(e) =>
                    toggleTask(t.id, e.target.checked ? "done" : "pending")
                  }
                  style={{
                    width: 16,
                    height: 16,
                    accentColor: IG.teal,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.86rem",
                    color: t.status === "done" ? IG.muted : IG.ink,
                    textDecoration:
                      t.status === "done" ? "line-through" : "none",
                    lineHeight: 1.35,
                  }}
                >
                  {t.action_type ? (
                    <span
                      style={{
                        display: "inline-block",
                        marginRight: 8,
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: IG.teal,
                        background: IG.soft,
                        padding: "2px 7px",
                        borderRadius: 999,
                      }}
                    >
                      {ACTION_LABELS[t.action_type] || t.action_type}
                    </span>
                  ) : null}
                  {t.title}
                </span>
                {t.due_date ? (
                  <span style={{ fontSize: "0.72rem", color: IG.muted }}>
                    {fmtDate(t.due_date)}
                  </span>
                ) : null}
              </label>
            ))}
            {tasks.length > 6 ? (
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: "0.75rem",
                  color: IG.muted,
                  borderTop: `1px solid ${IG.border}`,
                }}
              >
                +{tasks.length - 6} more tasks
              </div>
            ) : null}
          </div>
        ) : null}

        {evaluation.assessment ? (
          <div
            style={{
              ...sectionStyle,
              background: IG.softBlue,
              borderColor: "rgba(2, 132, 199, 0.2)",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: IG.blue,
                marginBottom: 6,
              }}
            >
              Last evaluation
            </div>
            <div style={{ fontSize: "0.86rem", color: IG.ink, lineHeight: 1.45 }}>
              {evaluation.assessment}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PrimaryBtn
            onClick={() => evaluate(g.id)}
            disabled={evaluating === g.id}
          >
            {evaluating === g.id ? "Evaluating…" : "Evaluate progress"}
          </PrimaryBtn>
          <GhostBtn onClick={() => addTask(g.id)}>+ Add task</GhostBtn>
          {g.status === "active" ? (
            <GhostBtn onClick={() => archive(g.id)}>Archive</GhostBtn>
          ) : null}
          <GhostBtn danger onClick={() => remove(g.id)}>
            Delete
          </GhostBtn>
        </div>
      </article>
    );
  }

  return (
    <div data-ig-no-enhance data-ig-skip>
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Marketing Goals
              </div>
              <h2 className="view-title">Marketing Goals</h2>
              <p className="view-sub">
                Set the outcome you want. InfoGenie builds a concrete plan,
                tracks the work, and grades how close you are.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 64 }}>
        {loadError ? (
          <div
            style={{
              ...sectionStyle,
              background: "rgba(220,38,38,0.06)",
              borderColor: "rgba(220,38,38,0.25)",
              color: "#991b1b",
            }}
          >
            Could not load goals. Refresh and try again.
          </div>
        ) : goals === null ? (
          <div
            style={{
              textAlign: "center",
              padding: 48,
              color: IG.muted,
              fontSize: "0.9rem",
            }}
          >
            Loading goals…
          </div>
        ) : showForm ? (
          <div id="ig-goal-form" style={{ maxWidth: 820 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: "0 0 4px",
                    fontSize: "1.15rem",
                    fontWeight: 800,
                    color: IG.ink,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Set a marketing goal
                </h3>
                <p style={{ margin: 0, fontSize: "0.86rem", color: IG.muted }}>
                  Be specific — clearer goals produce better plans.
                </p>
              </div>
              <GhostBtn onClick={closeForm}>Back to goals</GhostBtn>
            </div>

            <form
              data-ig-no-enhance
              data-ig-skip
              onSubmit={(e) => {
                e.preventDefault();
                saveGoal();
              }}
              style={{
                background: IG.surface,
                border: `1px solid ${IG.border}`,
                borderRadius: IG.radius,
                boxShadow: IG.shadow,
                padding: "22px 24px",
              }}
            >
              <div style={sectionStyle}>
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 800,
                    color: IG.ink,
                    marginBottom: 14,
                  }}
                >
                  Outcome
                </div>
                <div style={{ marginBottom: 14 }}>
                  <FieldLabel hint="One sentence that names the result you want.">
                    Goal title *
                  </FieldLabel>
                  <input
                    style={inputStyle}
                    value={mTitle}
                    onChange={(e) => setMTitle(e.target.value)}
                    placeholder="e.g. Grow Instagram following 20% in 90 days"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <FieldLabel hint="Context helps the plan match your brand and channels.">
                    Description
                  </FieldLabel>
                  <textarea
                    style={{ ...inputStyle, minHeight: 84, resize: "vertical" }}
                    value={mDesc}
                    onChange={(e) => setMDesc(e.target.value)}
                    placeholder="What does success look like for the team?"
                    rows={3}
                  />
                </div>
              </div>

              <div style={sectionStyle}>
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 800,
                    color: IG.ink,
                    marginBottom: 14,
                  }}
                >
                  How you’ll measure it
                </div>
                <div style={{ marginBottom: 14 }}>
                  <FieldLabel hint="Numbers and thresholds the AI can grade against.">
                    Success criteria
                  </FieldLabel>
                  <textarea
                    style={{ ...inputStyle, minHeight: 84, resize: "vertical" }}
                    value={mCriteria}
                    onChange={(e) => setMCriteria(e.target.value)}
                    placeholder="e.g. Followers > 12,000 · engagement > 4% · 3 brand deals closed"
                    rows={3}
                  />
                </div>
                <div style={{ maxWidth: 280 }}>
                  <FieldLabel>Deadline</FieldLabel>
                  <input
                    style={inputStyle}
                    type="date"
                    value={mDeadline}
                    onChange={(e) => setMDeadline(e.target.value)}
                  />
                </div>
              </div>

              {formMsg ? (
                <div
                  style={{
                    marginBottom: 14,
                    padding: "10px 12px",
                    borderRadius: IG.radiusSm,
                    fontSize: "0.84rem",
                    background:
                      formMsg.kind === "error"
                        ? "rgba(220,38,38,0.08)"
                        : IG.soft,
                    color: formMsg.kind === "error" ? "#991b1b" : IG.teal,
                    border: `1px solid ${
                      formMsg.kind === "error"
                        ? "rgba(220,38,38,0.25)"
                        : "rgba(15,118,110,0.25)"
                    }`,
                  }}
                >
                  {formMsg.text}
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <GhostBtn onClick={closeForm}>Cancel</GhostBtn>
                <PrimaryBtn type="submit" disabled={saving}>
                  {saving ? "Generating plan…" : "Set goal + generate plan"}
                </PrimaryBtn>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                marginBottom: 22,
              }}
            >
              <Metric
                label="Active goals"
                value={String(stats.active)}
                sub={stats.active ? "In flight" : "None yet"}
              />
              <Metric
                label="Avg progress"
                value={`${stats.avg}%`}
                sub="Across active goals"
              />
              <Metric
                label="Tasks done"
                value={`${stats.done}/${stats.tasks}`}
                sub="On active goals"
              />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: "0 0 2px",
                    fontSize: "1.05rem",
                    fontWeight: 800,
                    color: IG.ink,
                  }}
                >
                  Active goals
                </h3>
                <p style={{ margin: 0, fontSize: "0.82rem", color: IG.muted }}>
                  Plans, tasks, and progress evaluations in one place.
                </p>
              </div>
              <PrimaryBtn onClick={openForm}>Set new goal</PrimaryBtn>
            </div>

            {active.length === 0 ? (
              <div
                style={{
                  background: `linear-gradient(160deg, ${IG.surface} 0%, ${IG.stage} 100%)`,
                  border: `1px solid ${IG.border}`,
                  borderRadius: IG.radius,
                  padding: "40px 28px",
                  textAlign: "center",
                  boxShadow: IG.shadow,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    margin: "0 auto 16px",
                    borderRadius: 16,
                    background: IG.grad,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "1.4rem",
                    fontWeight: 800,
                    boxShadow: "0 10px 24px rgba(15,118,110,0.28)",
                  }}
                  aria-hidden
                >
                  ◎
                </div>
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: "1.15rem",
                    fontWeight: 800,
                    color: IG.ink,
                    letterSpacing: "-0.02em",
                  }}
                >
                  No active goals yet
                </h3>
                <p
                  style={{
                    margin: "0 auto 20px",
                    maxWidth: 420,
                    fontSize: "0.9rem",
                    color: IG.muted,
                    lineHeight: 1.5,
                  }}
                >
                  Name the outcome you want — growth, launches, pipeline —
                  and get a prioritised plan with tasks you can track.
                </p>
                <PrimaryBtn onClick={openForm}>Set your first goal</PrimaryBtn>
              </div>
            ) : (
              active.map(renderGoal)
            )}

            {archived.length > 0 ? (
              <div style={{ marginTop: 28 }}>
                <h4
                  style={{
                    margin: "0 0 12px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: IG.muted,
                  }}
                >
                  Archived
                </h4>
                {archived.map(renderGoal)}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
