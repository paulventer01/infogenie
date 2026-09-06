"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { goToView } from "@/lib/nav";
import { useToast } from "@/hooks/useToast";

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "chips";
  options?: string[];
}
interface ToolDef { view: string; label: string }
interface StepDef {
  id: number;
  key: string;
  title: string;
  advice: string;
  insight: string;
  required: string[];
  fields: FieldDef[];
  tools: ToolDef[];
}
interface StepState {
  completed: boolean;
  fields: Record<string, string | string[]>;
}
interface Plan {
  title: string;
  current_step: number;
  steps: Record<string, StepState>;
  updated_at: string | null;
  progress: { completed: number; total: number; pct: number };
  catalog: StepDef[];
}

const FLOW = [
  "Goal", "Customer", "Problem", "Competition", "Positioning",
  "Offer", "Channels", "Conversion", "Metrics", "Optimization",
];

function fieldFilled(def: FieldDef, fields: Record<string, string | string[]>): boolean {
  const v = fields[def.key];
  if (Array.isArray(v)) return v.filter(Boolean).length > 0;
  return String(v || "").trim().length > 0;
}

export default function MarketingPlan() {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stepId, setStepId] = useState(1);
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});

  const catalog = plan?.catalog || [];
  const step = catalog.find((s) => s.id === stepId) || catalog[0];

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiGet<{ ok: boolean; plan: Plan }>("/api/marketing-plan");
    if (r.ok && r.plan) {
      setPlan(r.plan);
      const cur = r.plan.current_step || 1;
      setStepId(cur);
      setDraft(r.plan.steps?.[String(cur)]?.fields || {});
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openStep(id: number) {
    if (!plan) return;
    setStepId(id);
    setDraft(plan.steps?.[String(id)]?.fields || {});
  }

  function setField(key: string, value: string | string[]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleChip(key: string, option: string) {
    const cur = Array.isArray(draft[key]) ? (draft[key] as string[]) : [];
    const next = cur.includes(option) ? cur.filter((x) => x !== option) : [...cur, option].slice(0, 3);
    setField(key, next);
  }

  async function save(opts: { complete?: boolean; advance?: boolean } = {}) {
    if (!step) return;
    setSaving(true);
    const r = await apiPatch<{ ok: boolean; plan: Plan; error?: string }>(`/api/marketing-plan/steps/${step.id}`, {
      fields: draft,
      completed: !!opts.complete,
      advance: !!opts.advance,
    });
    setSaving(false);
    if (!r.ok || !r.plan) {
      toast("❌ " + (r.error || "Could not save"));
      return;
    }
    setPlan(r.plan);
    if (opts.advance && step.id < 10) {
      const next = step.id + 1;
      setStepId(next);
      setDraft(r.plan.steps?.[String(next)]?.fields || {});
      toast(`✅ Step ${step.id} saved — on to ${r.plan.catalog.find((s) => s.id === next)?.title}`);
    } else {
      toast("✅ Plan saved");
    }
  }

  async function rename(title: string) {
    const r = await apiPut<{ ok: boolean; plan: Plan }>("/api/marketing-plan", { title });
    if (r.ok && r.plan) setPlan(r.plan);
  }

  async function reset() {
    if (!confirm("Clear this marketing plan and start over?")) return;
    const r = await apiPost<{ ok: boolean; plan: Plan }>("/api/marketing-plan/reset", {});
    if (r.ok && r.plan) {
      setPlan(r.plan);
      setStepId(1);
      setDraft({});
      toast("Plan reset");
    }
  }

  const requiredOk = useMemo(() => {
    if (!step) return false;
    return step.fields
      .filter((f) => step.required.includes(f.key))
      .every((f) => fieldFilled(f, draft));
  }, [step, draft]);

  if (loading || !plan || !step) {
    return <div style={{ padding: 40, color: "#94a3b8", textAlign: "center" }}>Loading marketing plan…</div>;
  }

  const pct = plan.progress?.pct || 0;

  return (
    <div className="view-header-wrap">
      <div className="view-header ig-panel-hero">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Manage</span>{" "}
                <span className="bc-sep">›</span> Marketing Plan
              </div>
              <h2 className="view-title">🎯 10-Step Marketing Plan</h2>
              <p className="view-sub">
                A guided revenue plan: Goal → Customer → Problem → Competition → Positioning → Offer → Channels → Conversion → Metrics → Optimization.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 56 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={plan.title}
            onChange={(e) => setPlan({ ...plan, title: e.target.value })}
            onBlur={(e) => rename(e.target.value)}
            style={{
              flex: "1 1 220px", fontWeight: 800, fontSize: "1.05rem",
              border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#0f172a",
            }}
          />
          <div style={{ minWidth: 180 }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748b", marginBottom: 4 }}>
              {plan.progress.completed}/{plan.progress.total} steps complete · {pct}%
            </div>
            <div style={{ height: 8, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#0f766e,#0284c7)", transition: "width .3s" }} />
            </div>
          </div>
          <button type="button" onClick={reset} style={ghostBtn}>Reset</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 6, marginBottom: 22 }}>
          {catalog.map((s) => {
            const done = !!plan.steps[String(s.id)]?.completed;
            const active = s.id === stepId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => openStep(s.id)}
                title={s.title}
                style={{
                  padding: "8px 4px",
                  borderRadius: 10,
                  border: active ? "2px solid #0f766e" : "1px solid #e2e8f0",
                  background: done ? "#ecfdf5" : active ? "#f0fdfa" : "#fff",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: done ? "#047857" : "#0f172a" }}>
                  {done ? "✓" : s.id}
                </div>
                <div style={{ fontSize: "0.58rem", color: "#64748b", lineHeight: 1.2, marginTop: 2 }}>
                  {FLOW[s.id - 1]}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 18 }}>
          <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#0f766e", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
              Step {step.id} of 10
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: "1.25rem", color: "#0f172a" }}>{step.title}</h3>
            <p style={{ margin: "0 0 6px", fontSize: "0.92rem", color: "#334155", fontWeight: 600 }}>{step.advice}</p>
            <p style={{ margin: "0 0 18px", fontSize: "0.82rem", color: "#64748b" }}>{step.insight}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {step.fields.map((f) => (
                <label key={f.key} style={{ display: "block" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 5 }}>
                    {f.label}{step.required.includes(f.key) ? " *" : ""}
                  </div>
                  {f.type === "chips" ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(f.options || []).map((opt) => {
                        const on = Array.isArray(draft[f.key]) && (draft[f.key] as string[]).includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => toggleChip(f.key, opt)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: on ? "1px solid #0f766e" : "1px solid #e2e8f0",
                              background: on ? "#ecfdf5" : "#f8fafc",
                              color: on ? "#047857" : "#475569",
                              fontWeight: 700,
                              fontSize: "0.75rem",
                              cursor: "pointer",
                            }}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  ) : f.type === "textarea" ? (
                    <textarea
                      value={String(draft[f.key] || "")}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      rows={3}
                      style={inputStyle}
                    />
                  ) : (
                    <input
                      value={String(draft[f.key] || "")}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      style={inputStyle}
                    />
                  )}
                </label>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
                Open in InfoGenie
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {step.tools.map((t) => (
                  <button
                    key={t.view}
                    type="button"
                    onClick={() => goToView(router, t.view)}
                    style={{
                      padding: "7px 11px",
                      borderRadius: 8,
                      border: "1px solid #bae6fd",
                      background: "#f0f9ff",
                      color: "#0369a1",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    {t.label} →
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 22, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={step.id === 1}
                onClick={() => openStep(step.id - 1)}
                style={{ ...ghostBtn, opacity: step.id === 1 ? 0.45 : 1 }}
              >
                ← Back
              </button>
              <button type="button" disabled={saving} onClick={() => save()} style={ghostBtn}>
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                disabled={saving || !requiredOk}
                onClick={() => save({ complete: true, advance: step.id < 10 })}
                style={{
                  ...primaryBtn,
                  opacity: requiredOk ? 1 : 0.5,
                  cursor: requiredOk ? "pointer" : "not-allowed",
                }}
              >
                {step.id === 10 ? "Complete plan" : "Save & continue →"}
              </button>
            </div>
          </section>

          <aside>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                The real marketing plan
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.78rem", color: "#334155", lineHeight: 1.7 }}>
                {FLOW.map((label, i) => {
                  const done = !!plan.steps[String(i + 1)]?.completed;
                  return (
                    <li key={label} style={{ color: done ? "#047857" : undefined, fontWeight: done ? 700 : 500 }}>
                      <button type="button" onClick={() => openStep(i + 1)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}>
                        {done ? "✓ " : ""}{label}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 12, padding: 14, fontSize: "0.75rem", color: "#64748b", lineHeight: 1.5 }}>
              Fill the required fields, then jump into the linked tools. Everything saves as one workspace plan artifact.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: "0.86rem",
  color: "#0f172a",
  boxSizing: "border-box",
};

const ghostBtn: CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#334155",
  fontWeight: 700,
  fontSize: "0.8rem",
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: 0,
  background: "linear-gradient(135deg,#0f766e,#0284c7)",
  color: "#fff",
  fontWeight: 800,
  fontSize: "0.8rem",
  cursor: "pointer",
};
