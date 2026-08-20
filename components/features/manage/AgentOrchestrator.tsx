"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

interface Mod {
  id: string;
  label: string;
  desc: string;
  view: string;
  capabilities?: { context: boolean; suggest: boolean; resolve: boolean; apply: boolean };
}

interface Proposal {
  module: string;
  actionId: string | null;
  title: string;
  action_type: string;
  priority: string;
  canApply: boolean;
  applyPath?: string | null;
  view?: string;
  hint?: string;
}

interface Workflow {
  id: string;
  name: string;
  objective: string;
  product_or_service: string;
  offer: string;
  landing_page_url: string;
  selected_platforms: string[];
  advertising_budget: number;
  currency: string;
  current_state: string;
  current_phase: string;
  next_approval_gate: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
}

interface Approval {
  id: string;
  gate: string;
  object_version: number;
  approved_platforms: string[];
  approved_advertising_budget: number;
  decision: string;
  comment: string | null;
  actor_user_id: number | null;
  created_at: string;
}

interface Step {
  id: string;
  agent_type: string;
  state: string;
  attempt_number: number;
  error_code: string | null;
  phase: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TimelineEvent {
  id: string;
  event: string;
  actor_user_id: number | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

type LoadStatus = "loading" | "error" | "ready";

const PLATFORMS = ["meta", "google", "tiktok"] as const;

const GATE_PERMISSION: Record<string, string> = {
  research_execution: "orchestrator.workflows.approve.research_execution",
  creative_generation: "orchestrator.workflows.approve.creative_generation",
  creative_selection: "orchestrator.workflows.approve.creative_selection",
  campaign_publishing: "orchestrator.workflows.approve.campaign_publishing",
  campaign_activation: "orchestrator.workflows.approve.campaign_activation",
  optimization_application: "orchestrator.workflows.approve.optimization_application",
};

const WAIT_STATE_GATE: Record<string, string> = {
  research_approval_required: "research_execution",
  generation_approval_required: "creative_generation",
  creative_review_required: "creative_selection",
  publishing_approval_required: "campaign_publishing",
  activation_approval_required: "campaign_activation",
  optimization_approval_required: "optimization_application",
};

const APPROVED_STATES = new Set([
  "research_approved",
  "generation_approved",
  "creative_approved",
  "publishing_approved",
  "activation_approved",
  "optimization_approved",
]);

const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "#4F46E5",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.82rem",
};

const btnSecondary: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #E5E7EB",
  background: "white",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "0.75rem",
};

function deriveAutonomousStatus(state: string): string {
  if (
    state.endsWith("_running")
    || state === "publishing"
    || state === "activating"
    || state === "optimization_applying"
  ) {
    return "Autonomous execution in progress";
  }
  if (state.endsWith("_approval_required") || state.endsWith("_review_required")) {
    return "Waiting for human approval";
  }
  if (state === "paused") return "Paused";
  if (state === "failed" || state === "research_failed") return "Failed";
  if (state === "cancelled") return "Cancelled";
  if (state === "completed") return "Completed";
  return "";
}

function gateForWorkflow(wf: Workflow): string | null {
  if (wf.next_approval_gate) return wf.next_approval_gate;
  return WAIT_STATE_GATE[wf.current_state] || null;
}

function isApprovalWaitState(state: string): boolean {
  return state.endsWith("_approval_required") || state.endsWith("_review_required");
}

function validateHttpsUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

async function orchMutate<T extends { ok: boolean; error?: string }>(
  path: string,
  method: "POST" | "PATCH",
  body?: unknown,
): Promise<T> {
  const key = crypto.randomUUID();
  return apiFetch<T>(path, {
    method,
    headers: { "Idempotency-Key": key },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export default function AgentOrchestrator() {
  const router = useRouter();
  const [modules, setModules] = useState<Mod[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [msgIsError, setMsgIsError] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");

  const [permissions, setPermissions] = useState<string[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [wfStatus, setWfStatus] = useState<LoadStatus>("loading");
  const [wfLoadError, setWfLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [timelineDenied, setTimelineDenied] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [wfBusy, setWfBusy] = useState("");
  const [wfMsg, setWfMsg] = useState("");
  const [wfMsgIsError, setWfMsgIsError] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    objective: "",
    product_or_service: "",
    offer: "",
    landing_page_url: "",
    selected_platforms: ["meta"] as string[],
    advertising_budget: "",
    currency: "USD",
  });
  const [createError, setCreateError] = useState("");

  const can = useCallback(
    (key: string) => isPlatformAdmin || permissions.includes(key),
    [isPlatformAdmin, permissions],
  );

  const load = useCallback(async () => {
    setStatus("loading");
    setLoadError("");
    const r = await apiGet<{ ok: boolean; modules?: Mod[]; error?: string }>(
      "/api/agent-orchestrator/status",
    );
    if (r.ok === false) {
      setModules([]);
      setLoadError(r.error || "Failed to load orchestrator status.");
      setStatus("error");
      return;
    }
    setModules(r.modules || []);
    setLoadError("");
    setStatus("ready");
  }, []);

  const loadPerms = useCallback(async () => {
    const r = await apiGet<{
      ok: boolean;
      permissions?: string[];
      isPlatformAdmin?: boolean;
      error?: string;
    }>("/api/tenants/active");
    if (r.ok === false) return;
    setPermissions(r.permissions || []);
    setIsPlatformAdmin(!!r.isPlatformAdmin);
  }, []);

  const loadWorkflows = useCallback(async () => {
    setWfStatus("loading");
    setWfLoadError("");
    const r = await apiGet<{ ok: boolean; workflows?: Workflow[]; error?: string }>(
      "/api/agent-orchestrator/workflows",
    );
    if (r.ok === false) {
      setWorkflows([]);
      setWfLoadError(r.error || "Failed to load advertising workflows.");
      setWfStatus("error");
      return;
    }
    setWorkflows(r.workflows || []);
    setWfLoadError("");
    setWfStatus("ready");
  }, []);

  const loadSelected = useCallback(async (id: string) => {
    setDetailLoading(true);
    setTimeline(null);
    setTimelineDenied(false);
    setApprovals([]);
    setSteps([]);

    const wfRes = await apiGet<{ ok: boolean; workflow?: Workflow; error?: string }>(
      `/api/agent-orchestrator/workflows/${id}`,
    );
    if (wfRes.ok === false) {
      setSelected(null);
      setWfMsgIsError(true);
      setWfMsg(wfRes.error || "Failed to load workflow.");
      setDetailLoading(false);
      return;
    }
    const wf = wfRes.workflow || null;
    setSelected(wf);

    const [apRes, stRes] = await Promise.all([
      apiGet<{ ok: boolean; approvals?: Approval[]; error?: string }>(
        `/api/agent-orchestrator/workflows/${id}/approvals`,
      ),
      apiGet<{ ok: boolean; steps?: Step[]; error?: string }>(
        `/api/agent-orchestrator/workflows/${id}/steps`,
      ),
    ]);
    if (apRes.ok !== false) setApprovals(apRes.approvals || []);
    if (stRes.ok !== false) setSteps(stRes.steps || []);

    if (can("orchestrator.workflows.audit.view")) {
      const tlRes = await apiGet<{ ok: boolean; events?: TimelineEvent[]; error?: string }>(
        `/api/agent-orchestrator/workflows/${id}/timeline`,
      );
      if (tlRes.ok === false) {
        if (tlRes.error === "forbidden" || tlRes.error === "permission_denied") {
          setTimelineDenied(true);
        }
      } else {
        setTimeline(tlRes.events || []);
      }
    }

    setDetailLoading(false);
  }, [can]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPerms(); }, [loadPerms]);
  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  useEffect(() => {
    if (selectedId) loadSelected(selectedId);
    else {
      setSelected(null);
      setApprovals([]);
      setSteps([]);
      setTimeline(null);
    }
  }, [selectedId, loadSelected]);

  const actionsLocked = status === "loading" || !!busy;
  const wfActionsLocked = wfStatus === "loading" || !!wfBusy || detailLoading;

  async function suggestAll() {
    setBusy("suggest");
    setMsg("");
    setMsgIsError(false);
    const r = await apiPost<{ ok: boolean; proposals?: Proposal[]; count?: number; error?: string }>(
      "/api/agent-orchestrator/suggest",
      { modules: ["spine", "calendar"] },
    );
    setBusy("");
    if (r.ok === false) {
      setMsgIsError(true);
      setMsg(r.error || "Suggest failed");
      return;
    }
    setProposals(r.proposals || []);
    setMsgIsError(false);
    setMsg(`Cross-module suggest returned ${r.count ?? 0} proposal(s).`);
  }

  async function applySpine(actionId: string) {
    setBusy(actionId);
    const r = await apiPost<{ ok: boolean; error?: string }>("/api/agent-orchestrator/apply", {
      module: "spine",
      action_id: actionId,
    });
    setBusy("");
    if (r.ok === false) {
      setMsgIsError(true);
      setMsg(r.error || "Apply failed");
      return;
    }
    setMsgIsError(false);
    setMsg("Applied via orchestrator");
    setProposals((p) => p.filter((x) => x.actionId !== actionId));
  }

  async function refreshAfterMutation(id: string) {
    await loadWorkflows();
    await loadSelected(id);
  }

  async function createWorkflow() {
    setCreateError("");
    if (!createForm.name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    if (!validateHttpsUrl(createForm.landing_page_url)) {
      setCreateError("Landing page URL must be a valid https:// URL.");
      return;
    }
    const budget = Number(createForm.advertising_budget);
    if (!Number.isFinite(budget) || budget < 0) {
      setCreateError("Budget must be a non-negative number.");
      return;
    }
    if (createForm.selected_platforms.length === 0) {
      setCreateError("Select at least one platform.");
      return;
    }
    if (!can("orchestrator.workflows.create")) return;

    setWfBusy("create");
    setWfMsg("");
    const r = await orchMutate<{ ok: boolean; workflow?: Workflow; error?: string }>(
      "/api/agent-orchestrator/workflows",
      "POST",
      {
        name: createForm.name.trim(),
        objective: createForm.objective.trim(),
        product_or_service: createForm.product_or_service.trim(),
        offer: createForm.offer.trim(),
        landing_page_url: createForm.landing_page_url.trim(),
        selected_platforms: createForm.selected_platforms,
        advertising_budget: budget,
        currency: createForm.currency.trim().toUpperCase() || "USD",
      },
    );
    setWfBusy("");
    if (r.ok === false) {
      setWfMsgIsError(true);
      setWfMsg(r.error || "Create failed");
      return;
    }
    setShowCreate(false);
    setCreateForm({
      name: "",
      objective: "",
      product_or_service: "",
      offer: "",
      landing_page_url: "",
      selected_platforms: ["meta"],
      advertising_budget: "",
      currency: "USD",
    });
    if (r.workflow) {
      setSelectedId(r.workflow.id);
      await refreshAfterMutation(r.workflow.id);
    } else {
      await loadWorkflows();
    }
    setWfMsgIsError(false);
    setWfMsg("Advertising workflow created.");
  }

  async function wfAction(
    label: string,
    path: string,
    body?: unknown,
  ) {
    if (!selected) return;
    setWfBusy(label);
    setWfMsg("");
    setWfMsgIsError(false);
    const r = await orchMutate<{ ok: boolean; workflow?: Workflow; error?: string }>(
      `/api/agent-orchestrator/workflows/${selected.id}${path}`,
      "POST",
      body,
    );
    setWfBusy("");
    if (r.ok === false) {
      setWfMsgIsError(true);
      setWfMsg(r.error || `${label} failed`);
      return;
    }
    setWfMsgIsError(false);
    setWfMsg(`${label} succeeded.`);
    await refreshAfterMutation(selected.id);
  }

  function approvePayload(wf: Workflow, comment?: string) {
    const gate = gateForWorkflow(wf);
    return {
      gate,
      object_type: "workflow",
      object_id: wf.id,
      object_version: wf.version,
      platforms: wf.selected_platforms,
      advertising_budget: wf.advertising_budget,
      credit_ceiling: 0,
      ...(comment ? { comment } : {}),
    };
  }

  const selectedGate = selected ? gateForWorkflow(selected) : null;
  const canApproveGate = selectedGate
    ? can(GATE_PERMISSION[selectedGate] || "")
    : false;
  const autonomousLabel = selected ? deriveAutonomousStatus(selected.current_state) : "";

  const showRequestApproval = selected
    && selected.current_state === "draft"
    && selected.next_approval_gate
    && can("orchestrator.workflows.request_approval");

  const showApproveReject = selected
    && isApprovalWaitState(selected.current_state)
    && canApproveGate;

  const showAdvance = selected
    && APPROVED_STATES.has(selected.current_state)
    && can("orchestrator.workflows.edit");

  const showPause = selected
    && selected.current_state !== "paused"
    && selected.current_state !== "cancelled"
    && selected.current_state !== "completed"
    && can("orchestrator.workflows.pause");

  const showResume = selected
    && selected.current_state === "paused"
    && can("orchestrator.workflows.resume");

  const showCancel = selected
    && selected.current_state !== "cancelled"
    && selected.current_state !== "completed"
    && can("orchestrator.workflows.cancel");

  const showRecover = selected
    && (selected.current_state === "failed" || selected.current_state === "research_failed")
    && can("orchestrator.workflows.recover");

  return (
    <div>
      <div className="intel-header ig-panel-hero" style={{ background: "linear-gradient(135deg,#f0f9ff 0%,#fdf4ff 55%,#ecfdf5 100%)" }}>
        <div className="breadcrumb">
          <span className="bc-group" style={{ opacity: 0.85 }}>Manage</span>{" "}
          <span className="bc-sep" style={{ opacity: 0.55 }}>›</span> Agent Orchestrator
        </div>
        <h1 className="ih-title">🤖 Agent Orchestrator</h1>
        <p className="ih-sub">
          Calendar Assistant pattern generalized — suggest → resolve → apply across spine, calendar, decisions, and optimizer.
        </p>
      </div>

      <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={actionsLocked}
            onClick={suggestAll}
            style={{ ...btnPrimary, cursor: actionsLocked ? "not-allowed" : "pointer", opacity: actionsLocked ? 0.6 : 1 }}
          >
            {busy === "suggest" ? "Running…" : "Suggest across Spine + Calendar"}
          </button>
          <button
            type="button"
            onClick={() => goToView(router, "ecosystem-spine")}
            style={{ ...btnSecondary, padding: "10px 16px", borderRadius: 10, fontSize: "0.82rem" }}
          >
            Open Ecosystem Spine →
          </button>
        </div>
        {status === "loading" && (
          <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: 14 }}>Loading orchestrator status…</p>
        )}
        {status === "error" && (
          <div
            className="ig-alert ig-alert-error"
            style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
          >
            <span>{loadError || "Failed to load orchestrator status."}</span>
            <button
              type="button"
              onClick={() => load()}
              style={{ ...btnPrimary, padding: "8px 12px", borderRadius: 8, fontSize: "0.75rem" }}
            >
              Retry
            </button>
          </div>
        )}
        {msg && (
          <p style={{ fontSize: "0.85rem", color: msgIsError ? "#B91C1C" : "#3730A3", marginBottom: 14 }}>{msg}</p>
        )}

        {status === "ready" && modules.length === 0 && (
          <p style={{ color: "#6B7280", fontSize: "0.85rem", marginBottom: 22 }}>
            No orchestrator modules are available right now.
          </p>
        )}

        {modules.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 22 }}>
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => goToView(router, m.view)}
                style={{ textAlign: "left", background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: 16, cursor: "pointer" }}
              >
                <strong style={{ fontSize: "0.92rem" }}>{m.label}</strong>
                <p style={{ margin: "6px 0 10px", fontSize: "0.78rem", color: "#64748B" }}>{m.desc}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["context", "suggest", "resolve", "apply"] as const).map((cap) => (
                    <span
                      key={cap}
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: m.capabilities?.[cap] ? "#D1FAE5" : "#F3F4F6",
                        color: m.capabilities?.[cap] ? "#065F46" : "#9CA3AF",
                      }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 12px" }}>Unified proposals</h3>
          {proposals.length === 0 && (
            <p style={{ color: "#6B7280", fontSize: "0.85rem" }}>Run a cross-module suggest to populate proposals.</p>
          )}
          {proposals.map((p, i) => (
            <div
              key={`${p.module}-${p.actionId || i}`}
              style={{ padding: "12px 0", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                  <span style={{ fontSize: "0.65rem", textTransform: "uppercase", color: "#6366F1", marginRight: 8 }}>{p.module}</span>
                  {p.title}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  {p.action_type}{p.hint ? ` — ${p.hint}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {p.canApply && p.actionId && (
                  <button
                    type="button"
                    disabled={actionsLocked}
                    onClick={() => applySpine(p.actionId!)}
                    style={{ ...btnPrimary, padding: "8px 12px", borderRadius: 8, fontSize: "0.75rem", cursor: actionsLocked ? "not-allowed" : "pointer", opacity: actionsLocked ? 0.6 : 1 }}
                  >
                    Apply
                  </button>
                )}
                {p.view && (
                  <button
                    type="button"
                    onClick={() => goToView(router, p.view!)}
                    style={btnSecondary}
                  >
                    Open →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Advertising workflows (PR 1 control plane) ── */}
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FCD34D",
            borderRadius: 12,
            padding: 14,
            marginBottom: 20,
            fontSize: "0.82rem",
            color: "#92400E",
          }}
        >
          <strong>Future features — not yet implemented.</strong>{" "}
          Competitor research, creative generation, campaign publishing, and performance optimization agents
          are stubbed in PR 1 and do not produce live results. Do not expect live ROAS, CTR, impressions,
          or fabricated campaign metrics from this control plane.
        </div>

        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>Advertising workflows (control plane)</h3>
            {can("orchestrator.workflows.create") && (
              <button
                type="button"
                disabled={wfActionsLocked}
                onClick={() => setShowCreate((v) => !v)}
                style={{ ...btnPrimary, opacity: wfActionsLocked ? 0.6 : 1, cursor: wfActionsLocked ? "not-allowed" : "pointer" }}
              >
                {showCreate ? "Cancel" : "New workflow"}
              </button>
            )}
          </div>

          {showCreate && can("orchestrator.workflows.create") && (
            <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 14, marginBottom: 16, background: "#F9FAFB" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginBottom: 10 }}>
                <label style={{ fontSize: "0.78rem" }}>
                  Name
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem" }}>
                  Objective
                  <input
                    type="text"
                    value={createForm.objective}
                    onChange={(e) => setCreateForm((f) => ({ ...f, objective: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem" }}>
                  Product / service
                  <input
                    type="text"
                    value={createForm.product_or_service}
                    onChange={(e) => setCreateForm((f) => ({ ...f, product_or_service: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem" }}>
                  Offer
                  <input
                    type="text"
                    value={createForm.offer}
                    onChange={(e) => setCreateForm((f) => ({ ...f, offer: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem", gridColumn: "1 / -1" }}>
                  Landing page (https)
                  <input
                    type="url"
                    value={createForm.landing_page_url}
                    onChange={(e) => setCreateForm((f) => ({ ...f, landing_page_url: e.target.value }))}
                    placeholder="https://example.com/landing"
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem" }}>
                  Budget
                  <input
                    type="number"
                    min="0"
                    value={createForm.advertising_budget}
                    onChange={(e) => setCreateForm((f) => ({ ...f, advertising_budget: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
                <label style={{ fontSize: "0.78rem" }}>
                  Currency
                  <input
                    type="text"
                    maxLength={3}
                    value={createForm.currency}
                    onChange={(e) => setCreateForm((f) => ({ ...f, currency: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                </label>
              </div>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>Platforms</span>
                <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                  {PLATFORMS.map((p) => (
                    <label key={p} style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={createForm.selected_platforms.includes(p)}
                        onChange={(e) => {
                          setCreateForm((f) => ({
                            ...f,
                            selected_platforms: e.target.checked
                              ? [...f.selected_platforms, p]
                              : f.selected_platforms.filter((x) => x !== p),
                          }));
                        }}
                      />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              {createError && (
                <p style={{ color: "#B91C1C", fontSize: "0.78rem", marginBottom: 8 }}>{createError}</p>
              )}
              <button
                type="button"
                disabled={wfBusy === "create"}
                onClick={createWorkflow}
                style={{ ...btnPrimary, opacity: wfBusy === "create" ? 0.6 : 1 }}
              >
                {wfBusy === "create" ? "Creating…" : "Create workflow"}
              </button>
            </div>
          )}

          {wfStatus === "loading" && (
            <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: 14 }}>Loading advertising workflows…</p>
          )}
          {wfStatus === "error" && (
            <div
              className="ig-alert ig-alert-error"
              style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
            >
              <span>{wfLoadError || "Failed to load advertising workflows."}</span>
              <button
                type="button"
                onClick={() => loadWorkflows()}
                style={{ ...btnPrimary, padding: "8px 12px", borderRadius: 8, fontSize: "0.75rem" }}
              >
                Retry
              </button>
            </div>
          )}

          {wfMsg && (
            <p style={{ fontSize: "0.85rem", color: wfMsgIsError ? "#B91C1C" : "#3730A3", marginBottom: 14 }}>{wfMsg}</p>
          )}

          {wfStatus === "ready" && workflows.length === 0 && (
            <p style={{ color: "#6B7280", fontSize: "0.85rem", marginBottom: 14 }}>
              No advertising workflows yet.
            </p>
          )}

          {wfStatus === "ready" && workflows.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
                    <th style={{ padding: "8px 6px" }}>Name</th>
                    <th style={{ padding: "8px 6px" }}>State</th>
                    <th style={{ padding: "8px 6px" }}>Phase</th>
                    <th style={{ padding: "8px 6px" }}>Platforms</th>
                    <th style={{ padding: "8px 6px" }}>Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => setSelectedId(w.id)}
                      style={{
                        cursor: "pointer",
                        background: selectedId === w.id ? "#EEF2FF" : "transparent",
                        borderBottom: "1px solid #F3F4F6",
                      }}
                    >
                      <td style={{ padding: "8px 6px", fontWeight: 600 }}>{w.name}</td>
                      <td style={{ padding: "8px 6px" }}>{w.current_state}</td>
                      <td style={{ padding: "8px 6px" }}>{w.current_phase}</td>
                      <td style={{ padding: "8px 6px" }}>{(w.selected_platforms || []).join(", ")}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {w.advertising_budget} {w.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedId && (
            <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
              {detailLoading && (
                <p style={{ fontSize: "0.85rem", color: "#6B7280" }}>Loading workflow details…</p>
              )}
              {!detailLoading && selected && (
                <>
                  <h4 style={{ margin: "0 0 8px" }}>{selected.name}</h4>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: "0.78rem" }}>
                    <span style={{ background: "#F3F4F6", padding: "2px 8px", borderRadius: 4 }}>
                      State: {selected.current_state}
                    </span>
                    <span style={{ background: "#F3F4F6", padding: "2px 8px", borderRadius: 4 }}>
                      Phase: {selected.current_phase}
                    </span>
                    {selected.next_approval_gate && (
                      <span style={{ background: "#FEF3C7", padding: "2px 8px", borderRadius: 4 }}>
                        Next gate: {selected.next_approval_gate}
                      </span>
                    )}
                    <span style={{ background: "#F3F4F6", padding: "2px 8px", borderRadius: 4 }}>
                      Version: {selected.version}
                    </span>
                    {autonomousLabel && (
                      <span style={{ background: "#DBEAFE", padding: "2px 8px", borderRadius: 4 }}>
                        {autonomousLabel}
                      </span>
                    )}
                  </div>

                  {isApprovalWaitState(selected.current_state) && selectedGate && (
                    <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: "0.82rem" }}>
                      <strong>Pending approval</strong>
                      <p style={{ margin: "6px 0 0" }}>
                        Gate: {selectedGate} · Version: {selected.version} · Platforms:{" "}
                        {(selected.selected_platforms || []).join(", ")} · Budget:{" "}
                        {selected.advertising_budget} {selected.currency}
                      </p>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                    {showRequestApproval && selected.next_approval_gate && (
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={() => wfAction("Request approval", "/request-approval", { gate: selected.next_approval_gate })}
                        style={{ ...btnPrimary, fontSize: "0.75rem", padding: "8px 12px", opacity: wfActionsLocked ? 0.6 : 1 }}
                      >
                        Request approval
                      </button>
                    )}
                    {showApproveReject && (
                      <>
                        <button
                          type="button"
                          disabled={wfActionsLocked}
                          onClick={() => wfAction("Approve", "/approve", approvePayload(selected))}
                          style={{ ...btnPrimary, fontSize: "0.75rem", padding: "8px 12px", opacity: wfActionsLocked ? 0.6 : 1 }}
                        >
                          Approve
                        </button>
                        <input
                          type="text"
                          placeholder="Reject comment (optional)"
                          value={rejectComment}
                          onChange={(e) => setRejectComment(e.target.value)}
                          style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.75rem", minWidth: 160 }}
                        />
                        <button
                          type="button"
                          disabled={wfActionsLocked}
                          onClick={() => wfAction("Reject", "/reject", approvePayload(selected, rejectComment || undefined))}
                          style={{ ...btnSecondary, opacity: wfActionsLocked ? 0.6 : 1 }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {showAdvance && (
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={() => wfAction("Advance", "/advance", {})}
                        style={{ ...btnPrimary, fontSize: "0.75rem", padding: "8px 12px", opacity: wfActionsLocked ? 0.6 : 1 }}
                      >
                        Advance
                      </button>
                    )}
                    {showPause && (
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={() => wfAction("Pause", "/pause", {})}
                        style={btnSecondary}
                      >
                        Pause
                      </button>
                    )}
                    {showResume && (
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={() => wfAction("Resume", "/resume", {})}
                        style={btnSecondary}
                      >
                        Resume
                      </button>
                    )}
                    {showCancel && (
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={() => wfAction("Cancel", "/cancel", {})}
                        style={btnSecondary}
                      >
                        Cancel
                      </button>
                    )}
                    {showRecover && (
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={() => wfAction("Recover", "/recover", {})}
                        style={btnSecondary}
                      >
                        Recover
                      </button>
                    )}
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <h5 style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>Approval history</h5>
                    {approvals.length === 0 && (
                      <p style={{ fontSize: "0.78rem", color: "#6B7280", margin: 0 }}>No approvals recorded yet.</p>
                    )}
                    {approvals.map((a) => (
                      <div key={a.id} style={{ fontSize: "0.78rem", padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                        <strong>{a.decision}</strong> · gate {a.gate} · v{a.object_version}
                        {a.comment ? ` — ${a.comment}` : ""}
                        <span style={{ color: "#9CA3AF", marginLeft: 8 }}>{a.created_at}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <h5 style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>Execution steps</h5>
                    {steps.length === 0 && (
                      <p style={{ fontSize: "0.78rem", color: "#6B7280", margin: 0 }}>No steps recorded yet.</p>
                    )}
                    {steps.map((s) => (
                      <div key={s.id} style={{ fontSize: "0.78rem", padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                        {s.agent_type} · {s.state} · attempt {s.attempt_number}
                        {s.error_code ? ` · error: ${s.error_code}` : ""}
                      </div>
                    ))}
                  </div>

                  {can("orchestrator.workflows.audit.view") && (
                    <div>
                      <h5 style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>Audit timeline</h5>
                      {timelineDenied && (
                        <p style={{ fontSize: "0.78rem", color: "#6B7280" }}>
                          You don&apos;t have permission to view the audit trail for this workflow.
                        </p>
                      )}
                      {timeline && timeline.length === 0 && !timelineDenied && (
                        <p style={{ fontSize: "0.78rem", color: "#6B7280", margin: 0 }}>No audit events yet.</p>
                      )}
                      {timeline && timeline.map((ev) => (
                        <div key={ev.id} style={{ fontSize: "0.78rem", padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                          {ev.event}
                          <span style={{ color: "#9CA3AF", marginLeft: 8 }}>{ev.created_at}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
