"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiGet, apiPost } from "@/lib/api";
import { goToView } from "@/lib/nav";

const MICROS_PER_USD = 1_000_000;

function formatMicros(n: number | string | null | undefined): string {
  return (Number(n || 0) / MICROS_PER_USD).toFixed(2);
}

function dollarsToMicros(dollars: string | number): number {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * MICROS_PER_USD);
}

const BLOCK_REASON_LABELS: Record<string, string> = {
  insufficient_credits: "Insufficient credits — add a grant or reduce spend.",
  credit_ceiling_exceeded: "Workflow credit ceiling exceeded — raise the workflow ceiling or reduce cost.",
  rate_limit_exceeded: "AI request rate limit exceeded — wait or raise tenant limits.",
  concurrency_limit_exceeded: "Too many concurrent AI operations — wait or raise tenant limits.",
  tenant_cost_limit_exceeded: "Tenant daily or monthly AI cost limit exceeded.",
};

const RESERVATION_STATUSES = new Set(["reserved", "committed", "released", "expired"]);

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
  credit_ceiling_micros?: number;
  block_reason?: string | null;
  blocked_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface CreditAccount {
  available_micros: number;
  reserved_micros: number;
  consumed_micros: number;
  currency: string;
}

interface CreditLimits {
  credit_ceiling_micros: number;
  requests_per_minute: number;
  max_concurrent_ai: number;
  daily_ai_cost_micros: number;
  monthly_ai_cost_micros: number;
  per_workflow_cost_micros: number;
  provider_limits: Record<string, unknown>;
}

interface CreditReservation {
  id: string;
  workflow_id: string;
  amount_micros: number;
  status: string;
  estimated_cost_micros: number;
  actual_cost_micros: number | null;
  cost_status: string | null;
  provider: string | null;
  operation: string | null;
  created_at: string;
}

interface CreditsSnapshot {
  account: CreditAccount;
  limits: CreditLimits;
  usage: { daily_micros: number; monthly_micros: number };
  reservations: CreditReservation[];
  workflows: Array<{
    id: string;
    name: string | null;
    current_state: string;
    credit_ceiling_micros: number;
    block_reason: string | null;
    blocked_at: string | null;
  }>;
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

interface ResearchRun {
  id: string;
  state: string;
  error_code: string | null;
  continuation_state?: { honesty_class?: string };
}

type LoadStatus = "loading" | "error" | "ready";

const ACTIVE_RESEARCH_STATES = new Set(["pending", "running"]);

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

function researchHonestyLabel(honestyClass: string | undefined): string {
  if (honestyClass === "fixture" || honestyClass === "synthetic") {
    return "Fixture / not live Meta data";
  }
  if (honestyClass === "live") return "Live Meta Ad Library response";
  return "";
}

async function orchMutate<T extends { ok: boolean; error?: string }>(
  path: string,
  method: "POST" | "PATCH" | "PUT",
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
    credit_ceiling_dollars: "0",
    currency: "USD",
  });
  const [createError, setCreateError] = useState("");
  const [editCeilingDollars, setEditCeilingDollars] = useState("0");

  const [creditsStatus, setCreditsStatus] = useState<LoadStatus>("loading");
  const [creditsLoadError, setCreditsLoadError] = useState("");
  const [creditsData, setCreditsData] = useState<CreditsSnapshot | null>(null);
  const [creditsBusy, setCreditsBusy] = useState("");
  const [creditsMsg, setCreditsMsg] = useState("");
  const [creditsMsgIsError, setCreditsMsgIsError] = useState(false);
  const [grantAmount, setGrantAmount] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustDirection, setAdjustDirection] = useState<"credit" | "debit">("credit");
  const [adjustReason, setAdjustReason] = useState("");
  const [limitsForm, setLimitsForm] = useState({
    credit_ceiling_dollars: "0",
    requests_per_minute: "0",
    max_concurrent_ai: "0",
    daily_ai_cost_dollars: "0",
    monthly_ai_cost_dollars: "0",
    per_workflow_cost_dollars: "0",
  });

  const [metaQuery, setMetaQuery] = useState("");
  const [metaCountries, setMetaCountries] = useState("US");
  const [metaLookback, setMetaLookback] = useState("30");
  const [metaMaxPages, setMetaMaxPages] = useState("2");
  const [metaMaxResults, setMetaMaxResults] = useState("25");
  const [metaMode, setMetaMode] = useState<"fixture" | "live">("fixture");
  const [metaResearchRun, setMetaResearchRun] = useState<ResearchRun | null>(null);
  const [metaResearchBusy, setMetaResearchBusy] = useState("");
  const [metaResearchMsg, setMetaResearchMsg] = useState("");
  const [metaResearchMsgIsError, setMetaResearchMsgIsError] = useState(false);

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

  const loadCredits = useCallback(async () => {
    if (!can("orchestrator.credits.view")) {
      setCreditsData(null);
      setCreditsLoadError("");
      setCreditsStatus("ready");
      return;
    }
    setCreditsStatus("loading");
    setCreditsLoadError("");
    const r = await apiGet<{ ok: boolean; error?: string } & Partial<CreditsSnapshot>>(
      "/api/agent-orchestrator/credits",
    );
    if (r.ok === false) {
      setCreditsData(null);
      setCreditsLoadError(r.error || "Failed to load credit accounting.");
      setCreditsStatus("error");
      return;
    }
    const snap: CreditsSnapshot = {
      account: r.account || {
        available_micros: 0,
        reserved_micros: 0,
        consumed_micros: 0,
        currency: "USD",
      },
      limits: r.limits || {
        credit_ceiling_micros: 0,
        requests_per_minute: 0,
        max_concurrent_ai: 0,
        daily_ai_cost_micros: 0,
        monthly_ai_cost_micros: 0,
        per_workflow_cost_micros: 0,
        provider_limits: {},
      },
      usage: r.usage || { daily_micros: 0, monthly_micros: 0 },
      reservations: r.reservations || [],
      workflows: r.workflows || [],
    };
    setCreditsData(snap);
    setCreditsLoadError("");
    setCreditsStatus("ready");
    if (can("orchestrator.credits.limits.edit")) {
      setLimitsForm({
        credit_ceiling_dollars: formatMicros(snap.limits.credit_ceiling_micros),
        requests_per_minute: String(snap.limits.requests_per_minute ?? 0),
        max_concurrent_ai: String(snap.limits.max_concurrent_ai ?? 0),
        daily_ai_cost_dollars: formatMicros(snap.limits.daily_ai_cost_micros),
        monthly_ai_cost_dollars: formatMicros(snap.limits.monthly_ai_cost_micros),
        per_workflow_cost_dollars: formatMicros(snap.limits.per_workflow_cost_micros),
      });
    }
  }, [can]);

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
    if (wf) {
      setEditCeilingDollars(formatMicros(wf.credit_ceiling_micros ?? 0));
    }

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
    if (permissions.length > 0 || isPlatformAdmin) loadCredits();
  }, [loadCredits, permissions, isPlatformAdmin]);

  useEffect(() => {
    if (selectedId) loadSelected(selectedId);
    else {
      setSelected(null);
      setApprovals([]);
      setSteps([]);
      setTimeline(null);
    }
  }, [selectedId, loadSelected]);

  useEffect(() => {
    setMetaResearchRun(null);
    setMetaResearchMsg("");
    setMetaResearchMsgIsError(false);
  }, [selectedId]);

  useEffect(() => {
    if (!metaResearchRun?.id || !ACTIVE_RESEARCH_STATES.has(metaResearchRun.state)) return;
    const runId = metaResearchRun.id;
    let cancelled = false;
    const poll = async () => {
      const r = await apiGet<{ ok: boolean; run?: ResearchRun; error?: string }>(
        `/api/agent-orchestrator/research/runs/${runId}`,
      );
      if (cancelled || r.ok === false || !r.run) return;
      setMetaResearchRun(r.run);
    };
    poll();
    const iv = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [metaResearchRun?.id, metaResearchRun?.state]);

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
    await loadCredits();
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

    const ceilingMicros = dollarsToMicros(createForm.credit_ceiling_dollars);

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
        credit_ceiling_micros: ceilingMicros,
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
      credit_ceiling_dollars: "0",
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
      credit_ceiling_micros: Number(wf.credit_ceiling_micros ?? 0),
      ...(comment ? { comment } : {}),
    };
  }

  async function saveWorkflowCeiling() {
    if (!selected || !can("orchestrator.workflows.edit")) return;
    setWfBusy("edit-ceiling");
    setWfMsg("");
    setWfMsgIsError(false);
    const r = await orchMutate<{ ok: boolean; workflow?: Workflow; error?: string }>(
      `/api/agent-orchestrator/workflows/${selected.id}`,
      "PATCH",
      { credit_ceiling_micros: dollarsToMicros(editCeilingDollars) },
    );
    setWfBusy("");
    if (r.ok === false) {
      setWfMsgIsError(true);
      setWfMsg(r.error || "Update credit ceiling failed");
      return;
    }
    setWfMsgIsError(false);
    setWfMsg("Workflow credit ceiling updated.");
    await refreshAfterMutation(selected.id);
  }

  async function submitGrant() {
    if (!can("orchestrator.credits.grant")) return;
    const micros = dollarsToMicros(grantAmount);
    if (micros <= 0) {
      setCreditsMsgIsError(true);
      setCreditsMsg("Grant amount must be greater than zero.");
      return;
    }
    setCreditsBusy("grant");
    setCreditsMsg("");
    const r = await orchMutate<{ ok: boolean; account?: CreditAccount; error?: string }>(
      "/api/agent-orchestrator/credits/grant",
      "POST",
      { amount_micros: micros },
    );
    setCreditsBusy("");
    if (r.ok === false) {
      setCreditsMsgIsError(true);
      setCreditsMsg(r.error || "Grant failed");
      return;
    }
    setCreditsMsgIsError(false);
    setCreditsMsg("Credits granted.");
    setGrantAmount("");
    await loadCredits();
  }

  async function submitAdjust() {
    if (!can("orchestrator.credits.adjust")) return;
    const micros = dollarsToMicros(adjustAmount);
    if (micros <= 0) {
      setCreditsMsgIsError(true);
      setCreditsMsg("Adjustment amount must be greater than zero.");
      return;
    }
    if (!adjustReason.trim()) {
      setCreditsMsgIsError(true);
      setCreditsMsg("Reason code is required.");
      return;
    }
    setCreditsBusy("adjust");
    setCreditsMsg("");
    const r = await orchMutate<{ ok: boolean; account?: CreditAccount; error?: string }>(
      "/api/agent-orchestrator/credits/adjust",
      "POST",
      {
        amount_micros: micros,
        direction: adjustDirection,
        reason_code: adjustReason.trim(),
      },
    );
    setCreditsBusy("");
    if (r.ok === false) {
      setCreditsMsgIsError(true);
      setCreditsMsg(r.error || "Adjustment failed");
      return;
    }
    setCreditsMsgIsError(false);
    setCreditsMsg("Credit adjustment applied.");
    setAdjustAmount("");
    setAdjustReason("");
    await loadCredits();
  }

  async function startMetaResearch() {
    if (!selected || !can("orchestrator.workflows.approve.research_execution")) return;
    const query = metaQuery.trim();
    if (metaMode === "live" && !query) {
      setMetaResearchMsgIsError(true);
      setMetaResearchMsg("Search query is required for live Meta research.");
      return;
    }
    const countries = metaCountries.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    setMetaResearchBusy("start");
    setMetaResearchMsg("");
    setMetaResearchMsgIsError(false);
    const r = await orchMutate<{ ok: boolean; run?: ResearchRun; error?: string }>(
      "/api/agent-orchestrator/research/runs",
      "POST",
      {
        workflow_id: selected.id,
        idempotency_key: crypto.randomUUID(),
        requested_platforms: ["meta"],
        mode: metaMode,
        credential_refs: { meta_research: "user_integrations" },
        search_parameters: {
          query: query || "competitor ads",
          countries: countries.length ? countries : ["US"],
          lookback_days: Math.min(365, Math.max(1, Number(metaLookback) || 30)),
          max_pages: Math.min(50, Math.max(1, Number(metaMaxPages) || 2)),
          max_results_per_page: Math.min(100, Math.max(1, Number(metaMaxResults) || 25)),
        },
        research_brief: [selected.objective, selected.product_or_service].filter(Boolean).join(" — ") || query,
      },
    );
    setMetaResearchBusy("");
    if (r.ok === false) {
      setMetaResearchMsgIsError(true);
      setMetaResearchMsg(r.error || "Research start failed");
      return;
    }
    if (r.run) setMetaResearchRun(r.run);
    setMetaResearchMsgIsError(false);
    setMetaResearchMsg("Meta research run started.");
  }

  async function cancelMetaResearch() {
    if (!metaResearchRun?.id) return;
    setMetaResearchBusy("cancel");
    setMetaResearchMsg("");
    const r = await orchMutate<{ ok: boolean; run?: ResearchRun; error?: string }>(
      `/api/agent-orchestrator/research/runs/${metaResearchRun.id}/cancel`,
      "POST",
    );
    setMetaResearchBusy("");
    if (r.ok === false) {
      setMetaResearchMsgIsError(true);
      setMetaResearchMsg(r.error || "Cancel failed");
      return;
    }
    if (r.run) setMetaResearchRun(r.run);
    setMetaResearchMsgIsError(false);
    setMetaResearchMsg("Research run cancelled.");
  }

  async function submitLimits() {
    if (!can("orchestrator.credits.limits.edit")) return;
    setCreditsBusy("limits");
    setCreditsMsg("");
    const r = await orchMutate<{ ok: boolean; limits?: CreditLimits; error?: string }>(
      "/api/agent-orchestrator/credits/limits",
      "PUT",
      {
        credit_ceiling_micros: dollarsToMicros(limitsForm.credit_ceiling_dollars),
        requests_per_minute: Number(limitsForm.requests_per_minute) || 0,
        max_concurrent_ai: Number(limitsForm.max_concurrent_ai) || 0,
        daily_ai_cost_micros: dollarsToMicros(limitsForm.daily_ai_cost_dollars),
        monthly_ai_cost_micros: dollarsToMicros(limitsForm.monthly_ai_cost_dollars),
        per_workflow_cost_micros: dollarsToMicros(limitsForm.per_workflow_cost_dollars),
      },
    );
    setCreditsBusy("");
    if (r.ok === false) {
      setCreditsMsgIsError(true);
      setCreditsMsg(r.error || "Limits update failed");
      return;
    }
    setCreditsMsgIsError(false);
    setCreditsMsg("Tenant limits updated.");
    await loadCredits();
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

  const canStartMetaResearch = can("orchestrator.workflows.approve.research_execution");
  const showCancelMetaResearch = metaResearchRun
    && ACTIVE_RESEARCH_STATES.has(metaResearchRun.state)
    && can("orchestrator.workflows.cancel");
  const metaResearchLocked = !!metaResearchBusy || detailLoading;
  const metaHonestyLabel = researchHonestyLabel(metaResearchRun?.continuation_state?.honesty_class);

  const showCredits = can("orchestrator.credits.view");
  const showLimits = can("orchestrator.credits.limits.view");
  const creditsActionsLocked = creditsStatus === "loading" || !!creditsBusy;
  const filteredReservations = (creditsData?.reservations || []).filter((r) =>
    RESERVATION_STATUSES.has(r.status),
  );
  const selectedCeilingMicros = Number(selected?.credit_ceiling_micros ?? 0);
  const approveCeilingZero = selectedCeilingMicros === 0;
  const currency = creditsData?.account.currency || "USD";

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

        {/* ── Shared credits & cost controls ── */}
        {showCredits && (
          <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: 18, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px" }}>Shared credits &amp; cost controls</h3>

            {creditsStatus === "loading" && (
              <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: 14 }}>Loading credit accounting…</p>
            )}
            {creditsStatus === "error" && (
              <div
                className="ig-alert ig-alert-error"
                style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
              >
                <span>{creditsLoadError || "Failed to load credit accounting."}</span>
                <button
                  type="button"
                  onClick={() => loadCredits()}
                  style={{ ...btnPrimary, padding: "8px 12px", borderRadius: 8, fontSize: "0.75rem" }}
                >
                  Retry
                </button>
              </div>
            )}

            {creditsMsg && (
              <p style={{ fontSize: "0.85rem", color: creditsMsgIsError ? "#B91C1C" : "#3730A3", marginBottom: 14 }}>
                {creditsMsg}
              </p>
            )}

            {creditsStatus === "ready" && creditsData && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600 }}>Available</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                      {formatMicros(creditsData.account.available_micros)} {currency}
                    </div>
                  </div>
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600 }}>Reserved</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                      {formatMicros(creditsData.account.reserved_micros)} {currency}
                    </div>
                  </div>
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600 }}>Consumed</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                      {formatMicros(creditsData.account.consumed_micros)} {currency}
                    </div>
                  </div>
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600 }}>Daily usage</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                      {formatMicros(creditsData.usage.daily_micros)} {currency}
                    </div>
                  </div>
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 600 }}>Monthly usage</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                      {formatMicros(creditsData.usage.monthly_micros)} {currency}
                    </div>
                  </div>
                </div>

                {showLimits && (
                  <div style={{ marginBottom: 16, fontSize: "0.82rem" }}>
                    <h4 style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>Tenant AI limits</h4>
                    <p style={{ margin: "0 0 10px", color: "#6B7280", fontSize: "0.78rem" }}>
                      A credit ceiling of 0 means no credit spending is authorised for this tenant.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
                      <div>
                        <strong>Tenant credit ceiling:</strong>{" "}
                        {formatMicros(creditsData.limits.credit_ceiling_micros)} {currency}
                      </div>
                      <div>
                        <strong>Requests / minute:</strong> {creditsData.limits.requests_per_minute}
                      </div>
                      <div>
                        <strong>Max concurrent AI:</strong> {creditsData.limits.max_concurrent_ai}
                      </div>
                      <div>
                        <strong>Daily AI cost cap:</strong>{" "}
                        {formatMicros(creditsData.limits.daily_ai_cost_micros)} {currency}
                      </div>
                      <div>
                        <strong>Monthly AI cost cap:</strong>{" "}
                        {formatMicros(creditsData.limits.monthly_ai_cost_micros)} {currency}
                      </div>
                      <div>
                        <strong>Per-workflow cost cap:</strong>{" "}
                        {formatMicros(creditsData.limits.per_workflow_cost_micros)} {currency}
                      </div>
                    </div>
                  </div>
                )}

                {can("orchestrator.credits.limits.edit") && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 14, marginBottom: 16, background: "#F9FAFB" }}>
                    <h4 style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>Edit tenant limits (admin)</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 10 }}>
                      <label style={{ fontSize: "0.78rem" }}>
                        Credit ceiling ({currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={limitsForm.credit_ceiling_dollars}
                          onChange={(e) => setLimitsForm((f) => ({ ...f, credit_ceiling_dollars: e.target.value }))}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Requests / minute
                        <input
                          type="number"
                          min="0"
                          value={limitsForm.requests_per_minute}
                          onChange={(e) => setLimitsForm((f) => ({ ...f, requests_per_minute: e.target.value }))}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Max concurrent AI
                        <input
                          type="number"
                          min="0"
                          value={limitsForm.max_concurrent_ai}
                          onChange={(e) => setLimitsForm((f) => ({ ...f, max_concurrent_ai: e.target.value }))}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Daily AI cost cap ({currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={limitsForm.daily_ai_cost_dollars}
                          onChange={(e) => setLimitsForm((f) => ({ ...f, daily_ai_cost_dollars: e.target.value }))}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Monthly AI cost cap ({currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={limitsForm.monthly_ai_cost_dollars}
                          onChange={(e) => setLimitsForm((f) => ({ ...f, monthly_ai_cost_dollars: e.target.value }))}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Per-workflow cost cap ({currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={limitsForm.per_workflow_cost_dollars}
                          onChange={(e) => setLimitsForm((f) => ({ ...f, per_workflow_cost_dollars: e.target.value }))}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                    </div>
                    <p style={{ fontSize: "0.72rem", color: "#6B7280", margin: "0 0 10px" }}>
                      0 = no spend authorised for that limit.
                    </p>
                    <button
                      type="button"
                      disabled={creditsActionsLocked}
                      onClick={submitLimits}
                      style={{ ...btnPrimary, fontSize: "0.75rem", opacity: creditsActionsLocked ? 0.6 : 1 }}
                    >
                      {creditsBusy === "limits" ? "Saving…" : "Save tenant limits"}
                    </button>
                  </div>
                )}

                {can("orchestrator.credits.grant") && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 14, marginBottom: 16, background: "#F9FAFB" }}>
                    <h4 style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>Grant credits (admin)</h4>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <label style={{ fontSize: "0.78rem" }}>
                        Amount ({currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={grantAmount}
                          onChange={(e) => setGrantAmount(e.target.value)}
                          style={{ display: "block", width: 140, marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={creditsActionsLocked}
                        onClick={submitGrant}
                        style={{ ...btnPrimary, fontSize: "0.75rem", opacity: creditsActionsLocked ? 0.6 : 1 }}
                      >
                        {creditsBusy === "grant" ? "Granting…" : "Grant"}
                      </button>
                    </div>
                  </div>
                )}

                {can("orchestrator.credits.adjust") && (
                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 14, marginBottom: 16, background: "#F9FAFB" }}>
                    <h4 style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>Adjust / refund credits (admin)</h4>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <label style={{ fontSize: "0.78rem" }}>
                        Amount ({currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={adjustAmount}
                          onChange={(e) => setAdjustAmount(e.target.value)}
                          style={{ display: "block", width: 140, marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Direction
                        <select
                          value={adjustDirection}
                          onChange={(e) => setAdjustDirection(e.target.value as "credit" | "debit")}
                          style={{ display: "block", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        >
                          <option value="credit">Credit</option>
                          <option value="debit">Debit</option>
                        </select>
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Reason code
                        <input
                          type="text"
                          value={adjustReason}
                          onChange={(e) => setAdjustReason(e.target.value)}
                          placeholder="refund, correction, …"
                          style={{ display: "block", width: 160, marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={creditsActionsLocked}
                        onClick={submitAdjust}
                        style={{ ...btnPrimary, fontSize: "0.75rem", opacity: creditsActionsLocked ? 0.6 : 1 }}
                      >
                        {creditsBusy === "adjust" ? "Applying…" : "Apply adjustment"}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>Credit reservations</h4>
                  {filteredReservations.length === 0 && (
                    <p style={{ color: "#6B7280", fontSize: "0.85rem", margin: 0 }}>No credit activity yet.</p>
                  )}
                  {filteredReservations.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
                          <th style={{ padding: "6px 4px" }}>Status</th>
                          <th style={{ padding: "6px 4px" }}>Amount</th>
                          <th style={{ padding: "6px 4px" }}>Operation</th>
                          <th style={{ padding: "6px 4px" }}>Cost status</th>
                          <th style={{ padding: "6px 4px" }}>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReservations.map((res) => (
                          <tr key={res.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                            <td style={{ padding: "6px 4px" }}>{res.status}</td>
                            <td style={{ padding: "6px 4px" }}>
                              {formatMicros(res.amount_micros)} {currency}
                            </td>
                            <td style={{ padding: "6px 4px" }}>
                              {[res.operation, res.provider].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td style={{ padding: "6px 4px" }}>{res.cost_status || "—"}</td>
                            <td style={{ padding: "6px 4px", color: "#9CA3AF" }}>{res.created_at}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        )}

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
          <strong>Partial rollout — limited live connectors.</strong>{" "}
          Meta competitor-ad research can be run from this panel when the workflow has a research_execution
          approval and Meta credentials are connected via Settings (opaque{" "}
          <code>user_integrations</code> ref). Google and TikTok research remain fixture-only. Creative
          generation, campaign publishing, activation, and optimization are not yet implemented. Do not expect
          live ROAS, CTR, impressions, or fabricated campaign metrics from this control plane. Tenant credit
          balances, ceilings and limits are recorded here.{" "}
          Automatic AI spend charging is not enabled in production yet; live ad-platform spend is not connected.
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
                <label style={{ fontSize: "0.78rem" }}>
                  Workflow credit ceiling ({createForm.currency || "USD"})
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={createForm.credit_ceiling_dollars}
                    onChange={(e) => setCreateForm((f) => ({ ...f, credit_ceiling_dollars: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                  />
                  <span style={{ display: "block", marginTop: 4, color: "#6B7280", fontSize: "0.72rem" }}>
                    0 = no chargeable autonomous spend authorised for this workflow.
                  </span>
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
                        {selected.advertising_budget} {selected.currency} · Credit ceiling:{" "}
                        {formatMicros(selectedCeilingMicros)} {selected.currency}
                      </p>
                    </div>
                  )}

                  {selected.block_reason && (
                    <div
                      className="ig-alert ig-alert-error"
                      style={{ marginBottom: 12, fontSize: "0.82rem" }}
                    >
                      <strong>Execution blocked</strong>
                      <p style={{ margin: "6px 0 0" }}>
                        {BLOCK_REASON_LABELS[selected.block_reason] || selected.block_reason}
                        {selected.blocked_at ? ` · since ${selected.blocked_at}` : ""}
                      </p>
                    </div>
                  )}

                  <div style={{ marginBottom: 12, fontSize: "0.82rem" }}>
                    <strong>Workflow credit ceiling:</strong>{" "}
                    {formatMicros(selectedCeilingMicros)} {selected.currency}
                    {selectedCeilingMicros === 0 && (
                      <span style={{ color: "#B45309", marginLeft: 8 }}>
                        (0 = no chargeable autonomous spend authorised)
                      </span>
                    )}
                  </div>

                  {can("orchestrator.workflows.edit") && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
                      <label style={{ fontSize: "0.78rem" }}>
                        Edit credit ceiling ({selected.currency})
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editCeilingDollars}
                          onChange={(e) => setEditCeilingDollars(e.target.value)}
                          style={{ display: "block", width: 140, marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={wfActionsLocked}
                        onClick={saveWorkflowCeiling}
                        style={{ ...btnSecondary, opacity: wfActionsLocked ? 0.6 : 1 }}
                      >
                        {wfBusy === "edit-ceiling" ? "Saving…" : "Save ceiling"}
                      </button>
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
                        {approveCeilingZero && (
                          <p style={{ width: "100%", fontSize: "0.78rem", color: "#B45309", margin: "0 0 8px" }}>
                            Credit ceiling is 0 — chargeable autonomous work is not authorised.
                          </p>
                        )}
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

                  <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 14, marginBottom: 16, background: "#F9FAFB" }}>
                    <h5 style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>Meta research</h5>
                    <p style={{ margin: "0 0 10px", fontSize: "0.72rem", color: "#6B7280" }}>
                      Uses Meta credentials from Settings via <code>user_integrations</code>. No tokens entered here.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 10 }}>
                      <label style={{ fontSize: "0.78rem", gridColumn: "1 / -1" }}>
                        Search query{metaMode === "live" ? " (required)" : ""}
                        <input
                          type="text"
                          value={metaQuery}
                          onChange={(e) => setMetaQuery(e.target.value)}
                          placeholder="competitor brand or keyword"
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Countries
                        <input
                          type="text"
                          value={metaCountries}
                          onChange={(e) => setMetaCountries(e.target.value)}
                          placeholder="US, GB"
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Lookback days
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={metaLookback}
                          onChange={(e) => setMetaLookback(e.target.value)}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Max pages
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={metaMaxPages}
                          onChange={(e) => setMetaMaxPages(e.target.value)}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                      <label style={{ fontSize: "0.78rem" }}>
                        Results / page
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={metaMaxResults}
                          onChange={(e) => setMetaMaxResults(e.target.value)}
                          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: "0.82rem" }}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10, fontSize: "0.78rem" }}>
                      <span style={{ fontWeight: 600 }}>Mode</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="radio" name="metaMode" checked={metaMode === "fixture"} onChange={() => setMetaMode("fixture")} />
                        Fixture (safe)
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="radio" name="metaMode" checked={metaMode === "live"} onChange={() => setMetaMode("live")} />
                        Live Meta Ad Library
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {canStartMetaResearch && (
                        <button
                          type="button"
                          disabled={metaResearchLocked}
                          onClick={startMetaResearch}
                          style={{ ...btnPrimary, fontSize: "0.75rem", padding: "8px 12px", opacity: metaResearchLocked ? 0.6 : 1 }}
                        >
                          {metaResearchBusy === "start" ? "Starting…" : "Start Meta research"}
                        </button>
                      )}
                      {showCancelMetaResearch && (
                        <button
                          type="button"
                          disabled={metaResearchLocked}
                          onClick={cancelMetaResearch}
                          style={{ ...btnSecondary, opacity: metaResearchLocked ? 0.6 : 1 }}
                        >
                          {metaResearchBusy === "cancel" ? "Cancelling…" : "Cancel run"}
                        </button>
                      )}
                    </div>
                    {metaResearchMsg && (
                      <p style={{ fontSize: "0.78rem", color: metaResearchMsgIsError ? "#B91C1C" : "#3730A3", margin: "0 0 8px" }}>
                        {metaResearchMsg}
                      </p>
                    )}
                    {metaResearchRun && (
                      <div style={{ fontSize: "0.78rem", color: "#374151" }}>
                        <div>Run: {metaResearchRun.id} · State: {metaResearchRun.state}</div>
                        {metaResearchRun.error_code && (
                          <div style={{ color: "#B91C1C" }}>Error: {metaResearchRun.error_code}</div>
                        )}
                        {metaHonestyLabel && (
                          <div style={{ marginTop: 4, color: "#6B7280" }}>{metaHonestyLabel}</div>
                        )}
                      </div>
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
