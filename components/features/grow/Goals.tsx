"use client";

// Native React port of the legacy `goals` panel (was `buildGoals` /
// `_goalCard` / `openAddGoalModal` / `submitNewGoal` / `deleteGoal` /
// `aiSuggestNewGoalField` in app.js + `#view-goals` in index.html).
// Lets the user set targets on tracked metrics; InfoGenie checks progress and
// surfaces a GPT-4o root-cause hypothesis when a goal goes off-track. Uses the
// same Express endpoints:
//   GET    /api/goals/check
//   POST   /api/goals            { metric, target, label }
//   POST   /api/goals/suggest    { metric, field }
//   DELETE /api/goals/:id
// See docs/react-panel-migration.md for the porting pattern.

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

interface GoalMeta {
  unit?: string;
  direction?: string;
}
interface Goal {
  id: string;
  label?: string;
  metric: string;
  status: string;
  pct?: number | null;
  current?: number | string | null;
  target?: number | string | null;
  meta?: GoalMeta;
  error?: string;
}
interface RootCause {
  hypothesis?: string;
  action?: string;
}
interface GoalsCheck {
  ok: boolean;
  error?: string;
  goals?: Goal[];
  rootCause?: Record<string, RootCause>;
}
interface SuggestResult {
  ok: boolean;
  error?: string;
  value?: number | string;
  label?: string;
  current?: number | string;
  reason?: string;
}

const STATUS_COLORS: Record<
  string,
  { bg: string; border: string; text: string; label: string }
> = {
  "on-track": {
    bg: "#ECFDF5",
    border: "#A7F3D0",
    text: "#065F46",
    label: "✓ On Track",
  },
  "at-risk": {
    bg: "#FFFBEB",
    border: "#FDE68A",
    text: "#92400E",
    label: "⚠️ At Risk",
  },
  "off-track": {
    bg: "#FEF2F2",
    border: "#FECACA",
    text: "#991B1B",
    label: "🔴 Off Track",
  },
  unknown: {
    bg: "#F1F5F9",
    border: "#CBD5E1",
    text: "#475569",
    label: "❔ No Data",
  },
  error: {
    bg: "#FEF2F2",
    border: "#FECACA",
    text: "#991B1B",
    label: "⚠️ Error",
  },
};

function GoalCard({ g, rc }: { g: Goal; rc?: RootCause }) {
  const c = STATUS_COLORS[g.status] || STATUS_COLORS.unknown;
  const unit = g.meta?.unit || "";
  const fmt = (v: number | string | null | undefined) => {
    if (v == null || v === "") return "—";
    if (unit === "$")
      return "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (unit === "%") return Number(v).toFixed(1) + "%";
    return Number(v).toLocaleString();
  };
  const pct = g.pct == null ? 0 : g.pct;
  const barColor =
    g.status === "on-track"
      ? "#10B981"
      : g.status === "at-risk"
        ? "#F59E0B"
        : g.status === "off-track"
          ? "#EF4444"
          : "#94A3B8";

  async function onDelete() {
    if (!confirm("Delete this goal?")) return;
    await apiDelete(`/api/goals/${g.id}`);
    window.dispatchEvent(new CustomEvent("ig-goals-refresh"));
  }

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E5E7EB",
        borderRadius: 14,
        padding: 22,
        marginBottom: 14,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0F172A" }}>
            {g.label || g.metric}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 3 }}>
            {g.metric} · target {g.meta?.direction === "lte" ? "≤" : "≥"}{" "}
            {fmt(g.target)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              padding: "5px 11px",
              borderRadius: 999,
              background: c.bg,
              border: `1px solid ${c.border}`,
              color: c.text,
            }}
          >
            {c.label}
          </span>
          <button
            onClick={onDelete}
            style={{
              background: "transparent",
              border: "1px solid #E5E7EB",
              borderRadius: 7,
              padding: "5px 9px",
              cursor: "pointer",
              color: "#64748B",
              fontSize: "0.78rem",
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          marginBottom: 10,
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: ".4px",
              fontWeight: 600,
            }}
          >
            Current
          </div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#0F172A" }}>
            {fmt(g.current)}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: ".4px",
              fontWeight: 600,
            }}
          >
            Target
          </div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#475569" }}>
            {fmt(g.target)}
          </div>
        </div>
      </div>
      <div
        style={{
          height: 8,
          background: "#F1F5F9",
          borderRadius: 999,
          overflow: "hidden",
          marginBottom: rc ? 14 : 0,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: barColor,
            transition: "width .4s",
          }}
        />
      </div>
      {rc && rc.hypothesis && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            background: "#FAFAFA",
            border: "1px solid #E5E7EB",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              color: "#7C3AED",
              textTransform: "uppercase",
              letterSpacing: ".5px",
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            🤖 GPT-4o root-cause hypothesis
          </div>
          <div
            style={{
              fontSize: "0.85rem",
              color: "#0F172A",
              lineHeight: 1.55,
              marginBottom: 8,
            }}
          >
            {rc.hypothesis}
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#0EA5E9",
              textTransform: "uppercase",
              letterSpacing: ".5px",
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            💡 Suggested action
          </div>
          <div style={{ fontSize: "0.85rem", color: "#0F172A", lineHeight: 1.55 }}>
            {rc.action}
          </div>
        </div>
      )}
      {g.status === "error" && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 8,
            fontSize: "0.78rem",
            color: "#991B1B",
          }}
        >
          {g.error}
        </div>
      )}
    </div>
  );
}

export default function Goals() {
  const [loading, setLoading] = useState(true);
  const [check, setCheck] = useState<GoalsCheck | null>(null);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const [metric, setMetric] = useState("drip.bounceRate");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [targetReason, setTargetReason] = useState("");
  const [labelReason, setLabelReason] = useState("");
  const [suggesting, setSuggesting] = useState<"target" | "label" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const j = await apiGet<GoalsCheck>("/api/goals/check");
    if (!j.ok) {
      setLoadError(j.error || "Failed to load goals");
      setCheck(null);
      setLoading(false);
      return;
    }
    setCheck(j);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("ig-goals-refresh", handler);
    return () => window.removeEventListener("ig-goals-refresh", handler);
  }, [load]);

  function openModal() {
    setMetric("drip.bounceRate");
    setTarget("");
    setLabel("");
    setTargetReason("");
    setLabelReason("");
    setModalOpen(true);
  }

  async function aiSuggest(field: "target" | "label") {
    if (!metric) return;
    setSuggesting(field);
    if (field === "target") setTargetReason("");
    else setLabelReason("");
    const j = await apiPost<SuggestResult>("/api/goals/suggest", {
      metric,
      field,
    });
    if (!j.ok) {
      const msg = "⚠️ Could not generate a suggestion — type one in.";
      if (field === "target") setTargetReason(msg);
      else setLabelReason(msg);
      setSuggesting(null);
      return;
    }
    const cur = j.current != null ? ` (current: ${j.current})` : "";
    const reason = "✨ " + (j.reason || "AI suggestion applied") + cur;
    if (field === "target") {
      setTarget(j.value != null ? String(j.value) : "");
      setTargetReason(reason);
    } else {
      setLabel(j.label != null ? String(j.label) : "");
      setLabelReason(reason);
    }
    setSuggesting(null);
  }

  async function submit() {
    const t = parseFloat(target);
    if (!Number.isFinite(t) || t < 0) {
      alert("Please enter a valid non-negative target.");
      return;
    }
    const j = await apiPost("/api/goals", {
      metric,
      target: t,
      label: label.trim() || undefined,
    });
    if (!j.ok) {
      alert("Could not create goal: " + (j.error || "unknown"));
      return;
    }
    setModalOpen(false);
    load();
  }

  const goals = check?.goals || [];
  const rc = check?.rootCause || {};

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    border: "1px solid #CBD5E1",
    borderRadius: 8,
    fontSize: "0.88rem",
    boxSizing: "border-box",
  };
  const aiBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    background: "linear-gradient(135deg,#7C3AED,#A855F7)",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: "0.72rem",
    fontWeight: 700,
  };

  return (
    <div className="view-header-wrap">
      <div
        className="view-header ig-panel-hero"
        style={{
          background:
            "linear-gradient(135deg,#e8f6f3 0%,#eaf2fb 55%,#eef4ff 100%)",
        }}
      >
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb" style={{ color: "#E9D5FF" }}>
                <span
                  className="bc-group"
                  style={{ color: "rgba(233,213,255,.8)" }}
                >
                  Grow
                </span>{" "}
                <span className="bc-sep" style={{ color: '#94a3b8' }}>
                  ›
                </span>{" "}
                Goals &amp; Targets
              </div>
              <h2 className="view-title">Goals &amp; Targets</h2>
              <p className="view-sub">
                Set targets on the metrics that matter, then let InfoGenie
                autonomously check progress and surface a GPT-4o root-cause
                hypothesis the moment a goal goes off-track.
              </p>
            </div>
            <div className="vh-actions">
              <button
                onClick={openModal}
                style={{
                  padding: "10px 16px",
                  background: "white",
                  color: "#7C3AED",
                  border: "none",
                  borderRadius: 9,
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                + Add Goal
              </button>
              <button className="btn-refresh-light" onClick={load}>
                ↻ Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 40 }}>
        <div>
          {loading && (
            <div style={{ textAlign: "center", padding: 48, color: "#64748B" }}>
              ⏳ Evaluating your goals…
            </div>
          )}
          {!loading && loadError && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 14,
                padding: 24,
                color: "#991B1B",
              }}
            >
              <b>⚠️ Could not load goals</b>
              <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{loadError}</div>
            </div>
          )}
          {!loading && !loadError && goals.length === 0 && (
            <div
              style={{
                background: "white",
                border: "1px solid #E5E7EB",
                borderRadius: 14,
                padding: 48,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "2.5rem", marginBottom: 14 }}>🎯</div>
              <div
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "#0F172A",
                  marginBottom: 8,
                }}
              >
                No goals yet
              </div>
              <div
                style={{
                  fontSize: "0.88rem",
                  color: "#64748B",
                  marginBottom: 22,
                  maxWidth: 480,
                  marginLeft: "auto",
                  marginRight: "auto",
                  lineHeight: 1.55,
                }}
              >
                Add a goal on any of InfoGenie&apos;s tracked metrics — drip
                bounce rate, ad spend cap, blended CAC, Amplitude sessions — and
                InfoGenie will autonomously check progress and ask GPT-4o for a
                root-cause hypothesis when you go off-track.
              </div>
              <button
                onClick={openModal}
                style={{
                  padding: "11px 22px",
                  background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                  color: "white",
                  border: "none",
                  borderRadius: 9,
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                + Create Your First Goal
              </button>
            </div>
          )}
          {!loading &&
            !loadError &&
            goals.map((g) => <GoalCard key={g.id} g={g} rc={rc[g.id]} />)}
        </div>
      </div>

      {modalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 14,
              padding: 26,
              width: "min(440px,92vw)",
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
          >
            <div
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "#0F172A",
                marginBottom: 16,
              }}
            >
              Add a new goal
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "#0F172A",
                  marginBottom: 6,
                }}
              >
                Metric
              </label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                style={inputStyle}
              >
                <option value="drip.bounceRate">
                  Drip Bounce Rate (%) — lower is better
                </option>
                <option value="drip.totalSends">
                  Drip Email Sends — higher is better
                </option>
                <option value="drip.deliveryRate">
                  Drip Delivery Rate (%) — higher is better
                </option>
                <option value="amp.sessions">
                  Amplitude Sessions, last 30d — higher is better
                </option>
                <option value="ads.totalSpend">
                  Total Ad Spend, last 30d ($) — lower is better
                </option>
                <option value="ads.cac">
                  Blended CAC ($) — lower is better
                </option>
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <label
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#0F172A",
                  }}
                >
                  Target value
                </label>
                <button
                  type="button"
                  onClick={() => aiSuggest("target")}
                  disabled={suggesting === "target"}
                  style={aiBtnStyle}
                >
                  {suggesting === "target" ? "⏳ Thinking…" : "✨ AI suggest"}
                </button>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 50"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                style={inputStyle}
              />
              <div
                style={{
                  marginTop: 6,
                  fontSize: "0.72rem",
                  color: "#7C3AED",
                  fontStyle: "italic",
                  minHeight: 1,
                }}
              >
                {targetReason}
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <label
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#0F172A",
                  }}
                >
                  Label (optional)
                </label>
                <button
                  type="button"
                  onClick={() => aiSuggest("label")}
                  disabled={suggesting === "label"}
                  style={aiBtnStyle}
                >
                  {suggesting === "label" ? "⏳ Thinking…" : "✨ AI suggest"}
                </button>
              </div>
              <input
                type="text"
                placeholder="e.g. Q2 customer acquisition target"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={inputStyle}
              />
              <div
                style={{
                  marginTop: 6,
                  fontSize: "0.72rem",
                  color: "#7C3AED",
                  fontStyle: "italic",
                  minHeight: 1,
                }}
              >
                {labelReason}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  padding: "10px 16px",
                  background: "white",
                  border: "1px solid #CBD5E1",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                style={{
                  padding: "10px 18px",
                  background: "linear-gradient(135deg,#7C3AED,#A855F7)",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                Create Goal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
