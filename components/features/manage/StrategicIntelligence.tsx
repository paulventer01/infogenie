"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { showToast } from "@/hooks/useToast";

type Tab = "moat" | "root" | "scenario" | "memory" | "benchmark" | "writeback";

interface MoatStatus {
  ok?: boolean;
  pillars?: Record<string, { score: number; note?: string; facts?: number; decisions?: number; outcomes_reviewed?: number; due_reviews?: number; catalog_actions?: number; jobs?: number; root_cause_runs?: number; scenario_runs?: number }>;
  due_reviews?: { id: number; title: string; decision: string; review_at: string }[];
}

interface Fact {
  id: number;
  category: string;
  title: string;
  fact: string;
  why_it_matters?: string;
}

interface Decision {
  id: number;
  title: string;
  decision: string;
  hypothesis?: string;
  review_at?: string;
  outcome_status: string;
  outcome_summary?: string;
  lesson?: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "moat", label: "Moat" },
  { id: "root", label: "Root cause" },
  { id: "scenario", label: "Scenarios" },
  { id: "memory", label: "Institutional memory" },
  { id: "benchmark", label: "External benchmarks" },
  { id: "writeback", label: "Write-backs" },
];

function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 4 }}>
        <span style={{ fontWeight: 700, color: "#0F172A" }}>{label}</span>
        <span style={{ color: "#64748B" }}>{score}/100</span>
      </div>
      <div style={{ height: 8, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, score)}%`, height: "100%", background: "linear-gradient(90deg,#0F766E,#0284C7)" }} />
      </div>
    </div>
  );
}

export default function StrategicIntelligence() {
  const [tab, setTab] = useState<Tab>("moat");
  const [moat, setMoat] = useState<MoatStatus | null>(null);
  const [problem, setProblem] = useState("ROAS dropped 22% this month — what is the root cause?");
  const [scenarioQ, setScenarioQ] = useState("What if we raise prices 8% and lose 5% of volume?");
  const [rootResult, setRootResult] = useState<Record<string, unknown> | null>(null);
  const [scenarioResult, setScenarioResult] = useState<Record<string, unknown> | null>(null);
  const [benchResult, setBenchResult] = useState<Record<string, unknown> | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [writebacks, setWritebacks] = useState<{ catalog: { system_key: string; system_label: string; action_key: string; action_label: string; description: string; moat: string; risk: string }[]; recent: { id: number; system_key: string; action_key: string; status: string; created_at: string }[]; moat_note?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [factForm, setFactForm] = useState({ category: "seasonality", title: "", fact: "", why_it_matters: "" });
  const [decForm, setDecForm] = useState({ title: "", decision: "", hypothesis: "", expected_impact: "" });
  const [payback, setPayback] = useState("14");
  const [vertical, setVertical] = useState("saas");

  const loadMoat = useCallback(async () => {
    const r = await apiGet<MoatStatus>("/api/strategic/moat-status");
    if (r.ok) setMoat(r);
  }, []);

  const loadMemory = useCallback(async () => {
    const [f, d] = await Promise.all([
      apiGet<{ ok?: boolean; facts?: Fact[] }>("/api/strategic/context"),
      apiGet<{ ok?: boolean; decisions?: Decision[] }>("/api/strategic/decisions"),
    ]);
    if (f.ok) setFacts(f.facts || []);
    if (d.ok) setDecisions(d.decisions || []);
  }, []);

  const loadWritebacks = useCallback(async () => {
    const r = await apiGet<NonNullable<typeof writebacks> & { ok?: boolean }>("/api/strategic/writebacks");
    if (r.ok) setWritebacks(r);
  }, []);

  useEffect(() => {
    loadMoat();
    loadMemory();
    loadWritebacks();
  }, [loadMoat, loadMemory, loadWritebacks]);

  const runRoot = async () => {
    setBusy(true);
    try {
      const r = await apiPost<Record<string, unknown>>("/api/strategic/root-cause", { problem });
      if (r.ok && !r.data_unavailable) {
        setRootResult(r);
        showToast("Root-cause decomposition ready");
        loadMoat();
      } else if (r.data_unavailable) {
        setRootResult(null);
        showToast(String(r.message || "Root-cause analysis unavailable — check AI providers / data mode"));
      } else {
        setRootResult(null);
        showToast(String(r.error || "Root-cause failed"));
      }
    } finally { setBusy(false); }
  };

  const runScenario = async () => {
    setBusy(true);
    try {
      const r = await apiPost<Record<string, unknown>>("/api/strategic/scenario", { question: scenarioQ });
      if (r.ok && !r.data_unavailable) {
        setScenarioResult(r);
        showToast("Scenario modelled");
        loadMoat();
      } else if (r.data_unavailable) {
        setScenarioResult(null);
        showToast(String(r.message || "Scenario modelling unavailable — check AI providers / data mode"));
      } else {
        setScenarioResult(null);
        showToast(String(r.error || "Scenario failed"));
      }
    } finally { setBusy(false); }
  };

  const runBench = async () => {
    setBusy(true);
    try {
      const r = await apiPost<Record<string, unknown>>("/api/strategic/benchmark-worry", {
        vertical,
        your_metrics: { cac_payback_months: Number(payback) || 14 },
      });
      if (r.ok) { setBenchResult(r); showToast(r.worried ? "Peers say: be worried" : "Peers: no major red flag"); }
    } finally { setBusy(false); }
  };

  const addFact = async () => {
    if (!factForm.title || !factForm.fact) return showToast("Title and fact required");
    const r = await apiPost<{ ok?: boolean }>("/api/strategic/context", factForm);
    if (r.ok) { showToast("Institutional fact saved"); setFactForm({ category: "seasonality", title: "", fact: "", why_it_matters: "" }); loadMemory(); loadMoat(); }
  };

  const addDecision = async () => {
    if (!decForm.title || !decForm.decision) return showToast("Title and decision required");
    const r = await apiPost<{ ok?: boolean }>("/api/strategic/decisions", decForm);
    if (r.ok) { showToast("Decision logged — review scheduled in ~90 days"); setDecForm({ title: "", decision: "", hypothesis: "", expected_impact: "" }); loadMemory(); loadMoat(); }
  };

  const recordOutcome = async (id: number) => {
    const summary = window.prompt("What was the outcome? (e.g. ROAS recovered 0.4× within 8 weeks)");
    if (!summary) return;
    const lesson = window.prompt("Lesson for next time? (optional)") || undefined;
    const r = await apiPost<{ ok?: boolean }>(`/api/strategic/decisions/${id}/outcome`, {
      outcome_status: "worked",
      outcome_summary: summary,
      lesson,
    });
    if (r.ok) { showToast("Outcome stored in institutional memory"); loadMemory(); loadMoat(); }
  };

  const queueWriteback = async (system_key: string, action_key: string) => {
    const r = await apiPost<{ ok?: boolean; status?: string }>("/api/strategic/writeback", {
      system_key,
      action_key,
      payload: action_key === "log_decision" || action_key === "annotation"
        ? { title: "Strategic annotation", decision: "Logged from Strategic Intelligence write-back panel", summary: "Operator queued a source-system write-back" }
        : { note: "Queued from Strategic Intelligence" },
    });
    if (r.ok) { showToast(`Write-back ${r.status || "queued"}`); loadWritebacks(); loadMoat(); }
  };

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "18px 14px 48px" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0F766E" }}>
          Durable advantage
        </div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontSize: "1.45rem", fontWeight: 800, color: "#0F172A", margin: "4px 0 6px" }}>
          Strategic Intelligence
        </h1>
        <p style={{ fontSize: "0.88rem", color: "#475569", lineHeight: 1.5, maxWidth: 720, margin: 0 }}>
          Root-cause decomposition, natural-language scenarios, institutional memory, external benchmarks, and write-back to systems of record — the moat most tools never build.
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18, background: "#F1F5F9", borderRadius: 10, padding: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: "0.74rem",
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#0F172A" : "#64748B",
              boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "moat" && moat?.pillars && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 800, marginBottom: 12, color: "#0F172A" }}>Moat health</div>
            <ScoreBar score={moat.pillars.data_mapping?.score || 0} label="Data-mapping quality" />
            <ScoreBar score={moat.pillars.institutional_memory?.score || 0} label="Institutional memory" />
            <ScoreBar score={moat.pillars.write_access?.score || 0} label="Write-access to systems of record" />
            <ScoreBar score={moat.pillars.external_benchmarking?.score || 0} label="External benchmarking" />
            <ScoreBar score={moat.pillars.root_cause_and_scenarios?.score || 0} label="Root-cause & scenarios" />
            <p style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 12, lineHeight: 1.5 }}>
              A tool that gets meaningfully better after eighteen months is nearly impossible to displace — because it remembers your seasonality, your definition of a qualified lead, and whether the March spend cut worked by June.
            </p>
          </div>
          {(moat.due_reviews || []).length > 0 && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 800, color: "#DC2626", marginBottom: 8 }}>Decision reviews due</div>
              {moat.due_reviews!.map((d) => (
                <div key={d.id} style={{ marginBottom: 8, fontSize: "0.84rem", color: "#7F1D1D" }}>
                  <strong>{d.title}</strong> — review by {d.review_at}
                  <div style={{ color: "#991B1B" }}>{d.decision}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "root" && (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Root-cause decomposition</div>
          <p style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 0 }}>Break the symptom into a cause tree with a ranked fix sequence and why that sequence is best.</p>
          <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} style={{ width: "100%", border: "1.5px solid #CBD5E1", borderRadius: 8, padding: 10, fontSize: "0.88rem" }} />
          <button type="button" disabled={busy} onClick={runRoot} style={{ marginTop: 10, padding: "9px 16px", background: "linear-gradient(135deg,#0F766E,#0284C7)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}>
            {busy ? "Decomposing…" : "Decompose root cause"}
          </button>
          {rootResult && (
            <div style={{ marginTop: 16 }} data-ig-no-enhance>
              {rootResult.analysis_mode === "heuristic" && (
                <div style={{ marginBottom: 10, fontSize: "0.75rem", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px" }}>
                  Heuristic decomposition (no live AI response) — still actionable; connect an AI provider for account-specific synthesis.
                </div>
              )}
              <div style={{ fontWeight: 800, color: "#0F172A" }}>Primary cause</div>
              <p style={{ color: "#334155", lineHeight: 1.55 }}>
                {String(rootResult.primary_cause || rootResult.primaryCause || "No primary cause returned.")}
              </p>
              <div style={{ fontWeight: 800, color: "#B45309" }}>Why this fix sequence is best</div>
              <p style={{ color: "#57534E", lineHeight: 1.55 }}>
                {String(rootResult.why_best || rootResult.whyBest || "No rationale returned.")}
              </p>
              <div style={{ fontWeight: 800 }}>Fix sequence</div>
              <ol style={{ paddingLeft: 18, color: "#334155", fontSize: "0.86rem" }}>
                {((rootResult.fix_sequence as { step?: number; action?: string; impact?: string; effort?: string; owner?: string }[])
                  || (rootResult.fixSequence as { step?: number; action?: string; impact?: string }[])
                  || []).map((s, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <strong>{s.action || "Step"}</strong>
                    {s.impact ? ` — ${s.impact}` : ""}
                    {s.owner || s.effort ? (
                      <span style={{ color: "#64748B" }}> ({[s.owner, s.effort].filter(Boolean).join(" · ")})</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              {!((rootResult.fix_sequence as unknown[]) || []).length && (
                <p style={{ color: "#94A3B8", fontSize: "0.84rem" }}>No fix sequence returned.</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "scenario" && (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Scenario modelling (natural language)</div>
          <p style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 0 }}>
            Try: “What happens if our largest customer churns?” or “What if we raise prices 8% and lose 5% of volume?”
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {[
              "What happens if our largest customer churns?",
              "What if we raise prices 8% and lose 5% of volume?",
              "What if we cut Meta ad spend 20% for 90 days?",
            ].map((s) => (
              <button key={s} type="button" onClick={() => setScenarioQ(s)} style={{ padding: "5px 10px", borderRadius: 99, border: "1px solid #CBD5E1", background: "#F8FAFC", fontSize: "0.72rem", cursor: "pointer" }}>{s}</button>
            ))}
          </div>
          <textarea value={scenarioQ} onChange={(e) => setScenarioQ(e.target.value)} rows={3} style={{ width: "100%", border: "1.5px solid #CBD5E1", borderRadius: 8, padding: 10, fontSize: "0.88rem" }} />
          <button type="button" disabled={busy} onClick={runScenario} style={{ marginTop: 10, padding: "9px 16px", background: "linear-gradient(135deg,#0066FF,#0EA5E9)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}>
            {busy ? "Modelling…" : "Run scenario"}
          </button>
          {scenarioResult && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 800 }}>Recommendation</div>
              <p style={{ color: "#334155" }}>{String(scenarioResult.recommendation || "")}</p>
              <div style={{ fontWeight: 800, color: "#B45309" }}>Why best</div>
              <p style={{ color: "#57534E" }}>{String(scenarioResult.why_best || "")}</p>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {((scenarioResult.scenarios as { name?: string; narrative?: string; probability_pct?: number; metrics?: Record<string, unknown> }[]) || []).map((s, i) => (
                  <div key={i} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 800, textTransform: "capitalize" }}>{s.name} · {s.probability_pct ?? "—"}%</div>
                    <div style={{ fontSize: "0.84rem", color: "#475569" }}>{s.narrative}</div>
                    {s.metrics && <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 4 }}>{JSON.stringify(s.metrics)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "memory" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Business facts (seasonality, MQL definition, “why Q2 is weird”)</div>
            <div style={{ display: "grid", gap: 8 }}>
              <input placeholder="Title" value={factForm.title} onChange={(e) => setFactForm({ ...factForm, title: e.target.value })} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }} />
              <select value={factForm.category} onChange={(e) => setFactForm({ ...factForm, category: e.target.value })} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }}>
                {["seasonality", "qualified_lead", "pricing", "channel", "customer", "general"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <textarea placeholder="Fact" value={factForm.fact} onChange={(e) => setFactForm({ ...factForm, fact: e.target.value })} rows={2} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }} />
              <input placeholder="Why it matters" value={factForm.why_it_matters} onChange={(e) => setFactForm({ ...factForm, why_it_matters: e.target.value })} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }} />
              <button type="button" onClick={addFact} style={{ padding: "8px 14px", background: "#0F766E", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>Save fact</button>
            </div>
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              {facts.map((f) => (
                <div key={f.id} style={{ background: "#F8FAFC", borderRadius: 8, padding: 12, border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: "0.86rem" }}>{f.title}</strong>
                    <button type="button" onClick={async () => { await apiDelete(`/api/strategic/context/${f.id}`); loadMemory(); }} style={{ border: "none", background: "transparent", color: "#94A3B8", cursor: "pointer" }}>✕</button>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#475569" }}>{f.fact}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Decisions → outcomes (March cut → June verdict)</div>
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              <input placeholder="Title (e.g. Cut Meta spend 20%)" value={decForm.title} onChange={(e) => setDecForm({ ...decForm, title: e.target.value })} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }} />
              <textarea placeholder="Decision detail" value={decForm.decision} onChange={(e) => setDecForm({ ...decForm, decision: e.target.value })} rows={2} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }} />
              <input placeholder="Hypothesis" value={decForm.hypothesis} onChange={(e) => setDecForm({ ...decForm, hypothesis: e.target.value })} style={{ padding: 9, borderRadius: 8, border: "1.5px solid #CBD5E1" }} />
              <button type="button" onClick={addDecision} style={{ padding: "8px 14px", background: "#0284C7", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", width: "fit-content" }}>Log decision</button>
            </div>
            {decisions.map((d) => (
              <div key={d.id} style={{ borderTop: "1px solid #E2E8F0", padding: "10px 0" }}>
                <div style={{ fontWeight: 700 }}>{d.title} <span style={{ fontSize: "0.7rem", color: "#64748B" }}>· {d.outcome_status} · review {d.review_at || "—"}</span></div>
                <div style={{ fontSize: "0.82rem", color: "#475569" }}>{d.decision}</div>
                {d.outcome_summary && <div style={{ fontSize: "0.8rem", color: "#047857", marginTop: 4 }}>Outcome: {d.outcome_summary}</div>}
                {d.outcome_status === "pending" && (
                  <button type="button" onClick={() => recordOutcome(d.id)} style={{ marginTop: 6, padding: "5px 10px", borderRadius: 6, border: "1px solid #A7F3D0", background: "#ECFDF5", color: "#047857", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer" }}>
                    Record whether it worked
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "benchmark" && (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>External benchmarking</div>
          <p style={{ fontSize: "0.82rem", color: "#64748B" }}>
            “Your CAC payback is 14 months; comparable firms in your sector sit near 9.” Internal data alone can’t answer “should I be worried?”
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 700 }}>Vertical<br />
              <select value={vertical} onChange={(e) => setVertical(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1.5px solid #CBD5E1", minWidth: 140 }}>
                {["saas", "e-commerce", "finance", "agency", "health"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label style={{ fontSize: "0.78rem", fontWeight: 700 }}>Your CAC payback (months)<br />
              <input value={payback} onChange={(e) => setPayback(e.target.value)} style={{ padding: 8, borderRadius: 8, border: "1.5px solid #CBD5E1", width: 120 }} />
            </label>
            <button type="button" disabled={busy} onClick={runBench} style={{ padding: "9px 16px", background: "#0F172A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}>
              Should I be worried?
            </button>
          </div>
          {benchResult && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: benchResult.worried ? "#FEF2F2" : "#ECFDF5", border: `1.5px solid ${benchResult.worried ? "#FECACA" : "#A7F3D0"}` }}>
              <div style={{ fontWeight: 800, color: benchResult.worried ? "#DC2626" : "#047857" }}>{String(benchResult.headline || "")}</div>
              <p style={{ fontSize: "0.86rem", color: "#334155" }}>{String(benchResult.summary || "")}</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {((benchResult.comparisons as { takeaway?: string; source?: string }[]) || []).map((c, i) => (
                  <li key={i} style={{ fontSize: "0.82rem", marginBottom: 4 }}>{c.takeaway} <em style={{ color: "#94A3B8" }}>({c.source})</em></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "writeback" && writebacks && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ background: "#FEF3C7", border: "1.5px solid #FCD34D", borderRadius: 12, padding: 14, fontSize: "0.84rem", color: "#92400E" }}>
            {writebacks.moat_note}
          </div>
          {writebacks.catalog.map((c) => (
            <div key={`${c.system_key}-${c.action_key}`} style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>{c.system_label} · {c.action_label}</div>
                  <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: 4 }}>{c.description}</div>
                  <div style={{ fontSize: "0.74rem", color: "#0F766E", marginTop: 6 }}>{c.moat}</div>
                </div>
                <button type="button" onClick={() => queueWriteback(c.system_key, c.action_key)} style={{ padding: "8px 12px", background: "#0F172A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", height: "fit-content" }}>
                  Queue write-back
                </button>
              </div>
            </div>
          ))}
          {writebacks.recent?.length > 0 && (
            <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
              Recent jobs: {writebacks.recent.slice(0, 5).map((j) => `#${j.id} ${j.system_key}/${j.action_key} (${j.status})`).join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
