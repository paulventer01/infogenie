"use client";

// Native React port of the legacy `safe-agent` panel (was `window.buildSafeAgent`
// in public/js/ig_moat_features.js + the empty `#view-safe-agent` div in
// index.html). The AI proposes an action plan, simulates outcomes, then waits for
// approval before executing — with an audit log and one-click rollback. Uses the
// existing Express API:
//   POST /api/safe-agent/propose        { objective, context, budget_guardrail }
//   POST /api/safe-agent/approve/:id
//   POST /api/safe-agent/reject/:id     { reason }
//   POST /api/safe-agent/rollback/:id   { reason }
//   GET  /api/safe-agent/proposals
// Reuses legacy CSS classes (ig-card, form-group, form-control, btn).

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface ProposalAction {
  step?: number;
  action?: string;
  detail?: string;
  channel?: string;
  estimated_cost?: number;
  reversible?: boolean;
}
interface SafetyCheck {
  check?: string;
  status?: string;
  note?: string;
}
interface ProposalBody {
  _title?: string;
  _recommendation?: string;
  _recommendation_reason?: string;
  _safety_checks?: SafetyCheck[];
  actions?: ProposalAction[];
  total_estimated_cost?: number;
  timeline?: string;
  rollback_plan?: string;
}
interface Simulation {
  expected_outcome?: string;
  confidence?: number;
  estimated_revenue_impact?: number;
  best_case?: string;
  worst_case?: string;
  risk_factors?: string[];
}
interface ProposalDetail {
  id?: number;
  title?: string;
  status?: string;
  proposal?: ProposalBody;
  simulation?: Simulation;
}
interface ProposeResponse extends ProposalDetail {
  ok?: boolean;
  error?: string;
}
interface ProposalListItem {
  id: number;
  title: string;
  status: string;
  proposal?: ProposalBody;
  simulation?: Simulation;
  budget_guardrail?: number | string;
  created_at: string;
}
interface ProposalsResponse {
  ok?: boolean;
  proposals?: ProposalListItem[];
}

const STATUS_COL: Record<string, string> = {
  pass: "#10b981", caution: "#f59e0b", fail: "#ef4444", approved: "#10b981",
  pending_approval: "#3b82f6", executing: "#8b5cf6", executed: "#10b981",
  rejected: "#6b7280", rolled_back: "#ef4444",
};
const STATUS_ICON: Record<string, string> = {
  pending_approval: "⏳", executing: "⚙️", executed: "✅", rejected: "✕", rolled_back: "↩",
};
const REC_COL: Record<string, string> = { approve: "#10b981", review: "#f59e0b", reject: "#ef4444" };

function verdictBadge(v?: string) {
  const bg = STATUS_COL[v || ""] || "#6b7280";
  return (
    <span style={{ background: bg, color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase" }}>
      {(v || "").replace(/_/g, " ")}
    </span>
  );
}

export default function SafeAgent() {
  const [obj, setObj] = useState("");
  const [ctx, setCtx] = useState("");
  const [guardrail, setGuardrail] = useState("");
  const [proposing, setProposing] = useState(false);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [proposals, setProposals] = useState<ProposalListItem[]>([]);

  const loadProposals = useCallback(async () => {
    const d = await apiGet<ProposalsResponse>("/api/safe-agent/proposals");
    setProposals(d.ok && d.proposals?.length ? d.proposals : []);
  }, []);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const propose = async () => {
    const objective = obj.trim();
    if (!objective) {
      window.alert("Enter an objective.");
      return;
    }
    const context: Record<string, string> = {};
    ctx.split("\n").forEach((line) => {
      const [k, ...vs] = line.split(":");
      if (k && vs.length) context[k.trim()] = vs.join(":").trim();
    });
    setProposing(true);
    const gr = parseFloat(guardrail);
    const d = await apiPost<ProposeResponse>("/api/safe-agent/propose", {
      objective,
      context,
      budget_guardrail: guardrail.trim() !== "" && !Number.isNaN(gr) ? gr : null,
    });
    setProposing(false);
    if (!d.ok) {
      window.alert(d.error || "Error");
      return;
    }
    setDetail(d);
    loadProposals();
  };

  const approve = async (id: number) => {
    if (!window.confirm("Approve this proposal for execution?")) return;
    const d = await apiPost(`/api/safe-agent/approve/${id}`);
    if (!d.ok) {
      window.alert(d.error || "Error");
      return;
    }
    window.alert("✅ Approved and executed. Check the audit log for details.");
    loadProposals();
  };
  const reject = async (id: number) => {
    const reason = window.prompt("Reason for rejection (optional):") || undefined;
    const d = await apiPost(`/api/safe-agent/reject/${id}`, { reason });
    if (!d.ok) {
      window.alert(d.error || "Error");
      return;
    }
    loadProposals();
  };
  const rollback = async (id: number) => {
    const reason = window.prompt("Why are you rolling back? (optional):") || undefined;
    const d = await apiPost(`/api/safe-agent/rollback/${id}`, { reason });
    if (!d.ok) {
      window.alert(d.error || "Error");
      return;
    }
    window.alert("↩ Rolled back successfully.");
    loadProposals();
  };

  const renderDetail = () => {
    if (!detail) return null;
    const p = detail.proposal || {};
    const sim = detail.simulation || {};
    const id = detail.id;
    const recCol = REC_COL[p._recommendation || ""] || "#6b7280";
    return (
      <div className="ig-card" style={{ borderTop: `3px solid ${recCol}`, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700 }}>{p._title || detail.title || "Proposal"}</div>
            <div style={{ marginTop: 4, display: "flex", gap: 8 }}>
              {verdictBadge(detail.status || "pending_approval")}
              <span style={{ background: `${recCol}20`, color: recCol, borderRadius: 4, padding: "2px 8px", fontSize: "0.75rem", fontWeight: 700 }}>AI: {p._recommendation || ""}</span>
            </div>
          </div>
          {id && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => approve(id)}>✅ Approve &amp; Execute</button>
              <button className="btn btn-outline" style={{ color: "#ef4444" }} onClick={() => reject(id)}>✕ Reject</button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>ACTION PLAN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(p.actions || []).map((a, i) => (
                <div key={i} style={{ padding: 8, background: "#f9fafb", borderRadius: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>Step {a.step}: {a.action || ""}</span>
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{a.reversible ? "↩ reversible" : "⚠ irreversible"}</span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#374151" }}>{a.detail || ""}</div>
                  {a.channel && (
                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 2 }}>
                      Channel: {a.channel} {a.estimated_cost ? "· Cost: $" + a.estimated_cost : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: "0.8rem" }}>
              <span style={{ color: "#6b7280" }}>Total est. cost: </span>
              <strong>${(p.total_estimated_cost || 0).toLocaleString()}</strong> · Timeline: {p.timeline || ""}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", marginBottom: 8 }}>SIMULATION</div>
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{sim.expected_outcome || ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.8rem", marginBottom: 8 }}>
                <div><span style={{ color: "#6b7280" }}>Confidence: </span><strong>{sim.confidence || 0}%</strong></div>
                <div><span style={{ color: "#6b7280" }}>Rev. impact: </span><strong style={{ color: "#10b981" }}>+${(sim.estimated_revenue_impact || 0).toLocaleString()}</strong></div>
                <div><span style={{ color: "#6b7280" }}>Best: </span><span style={{ color: "#10b981" }}>{sim.best_case || ""}</span></div>
                <div><span style={{ color: "#6b7280" }}>Worst: </span><span style={{ color: "#ef4444" }}>{sim.worst_case || ""}</span></div>
              </div>
              {!!sim.risk_factors?.length && (
                <div style={{ fontSize: "0.75rem", color: "#f59e0b", marginTop: 4 }}>⚠ {sim.risk_factors.join(" · ")}</div>
              )}
            </div>
          </div>
        </div>

        {!!p._safety_checks?.length && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", marginBottom: 6 }}>SAFETY CHECKS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {p._safety_checks.map((s, i) => {
                const col = s.status === "pass" ? "#10b981" : s.status === "warn" ? "#f59e0b" : "#ef4444";
                return (
                  <div key={i} style={{ background: `${col}15`, border: `1px solid ${col}40`, borderRadius: 6, padding: "4px 10px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: col, fontWeight: 700 }}>{s.status === "pass" ? "✓" : s.status === "warn" ? "⚠" : "✗"}</span>
                    <span>{s.check}</span>
                    {s.note && <span style={{ color: "#6b7280" }}>{s.note}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {p.rollback_plan && (
          <div style={{ background: "#faf5ff", borderRadius: 8, padding: 10 }}>
            <span style={{ fontWeight: 600, color: "#8b5cf6" }}>↩ Rollback plan: </span>{p.rollback_plan}
          </div>
        )}
        {p._recommendation_reason && (
          <div style={{ marginTop: 8, fontSize: "0.85rem", color: "#374151" }}>
            <strong>AI says:</strong> {p._recommendation_reason}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="view-header-wrap">
      <div className="view-header">
        <div className="container">
          <div className="vh-inner">
            <div>
              <div className="breadcrumb">
                <span className="bc-group">Grow</span> <span className="bc-sep">›</span> Safe Agent
              </div>
              <h2 className="view-title">🛡️ Safe Agent</h2>
              <p className="view-sub">
                AI proposes an action plan, simulates outcomes, then waits for your approval before executing — with a full audit log and one-click rollback.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div className="ig-card" style={{ flex: 1, minWidth: 300 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 16 }}>New Proposal</h3>
            <div className="form-group">
              <label>Objective</label>
              <textarea className="form-control" rows={3} placeholder="e.g. Improve ROAS from 1.8x to 2.5x across all paid channels while keeping CAC below $300" value={obj} onChange={(e) => setObj(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Business Context (optional)</label>
              <textarea className="form-control" rows={2} placeholder={"Monthly budget: $40k\nMain channels: Google, Meta\nCurrent ROAS: 1.8x"} value={ctx} onChange={(e) => setCtx(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Budget Guardrail (max spend this agent may propose, $)</label>
              <input className="form-control" type="number" placeholder="e.g. 5000" value={guardrail} onChange={(e) => setGuardrail(e.target.value)} />
            </div>
            <button onClick={propose} disabled={proposing} className="btn btn-primary" style={{ width: "100%" }}>
              {proposing ? "AI is proposing & simulating…" : "🛡️ Propose Action Plan"}
            </button>
          </div>

          <div style={{ flex: 2, minWidth: 300 }}>
            {proposals.length === 0 ? (
              <div className="ig-card" style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                No proposals yet — create one to get started.
              </div>
            ) : (
              <>
                <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Proposal Log</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {proposals.map((p) => (
                    <div key={p.id} className="ig-card" style={{ padding: 12, cursor: "pointer" }} onClick={() => setDetail({ id: p.id, title: p.title, status: p.status, proposal: p.proposal, simulation: p.simulation })}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600 }}>{STATUS_ICON[p.status] || "•"} {p.title}</span>
                        <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>{new Date(p.created_at).toLocaleDateString()}</span>
                      </div>
                      <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                        {verdictBadge(p.status)}
                        {p.budget_guardrail && (
                          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Guardrail: ${(+p.budget_guardrail).toLocaleString()}</span>
                        )}
                      </div>
                      {p.status === "executed" && (
                        <button className="btn btn-xs btn-outline" style={{ marginTop: 6, color: "#ef4444" }} onClick={(e) => { e.stopPropagation(); rollback(p.id); }}>↩ Rollback</button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div>{renderDetail()}</div>
      </div>
    </div>
  );
}
