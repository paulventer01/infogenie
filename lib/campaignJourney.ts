import { apiGet, type ApiResult } from "@/lib/api";

export const API = "/api/agent-orchestrator/campaign-drafts";
export const VIEW = "orchestrator.workflows.view", EDIT = "orchestrator.workflows.edit";
export const APPROVE = "orchestrator.workflows.approve.campaign_publishing";
export type Context = { userId: number; tenantId: number; permissions: string[]; admin: boolean };
export type Brief = { id: number; brand: string; headline: string; greeting: string; generated_by: string; content_hash: string; content_safety_warnings?: string[]; signals?: { headline: string; detail?: string }[]; sections?: { title: string; items: string[] }[] };
export type Creative = { id: string; artifact_id: string; version: number; content_hash: string; format: string; objective: string };
export type Workflow = { id: string; name: string; landing_page_url: string; objective: string; currency: string; advertising_budget: number; target_markets: string[]; target_audiences: string[]; selected_platforms: string[] };
export type Contract = { contract_version: string; objective: string; platforms: string[];
  accounts: { platform: string; credential_ref: string }[]; destination: { landing_page_url: string };
  budget: { amount_micros: number; currency: string }; schedule: { start_at: string; end_at?: string };
  geo: { countries: string[] }; audience: { name: string }; creatives: { kind: string; asset_id: string; version: number; content_hash: string }[];
  tracking: { utm_source: string; utm_medium: string; utm_campaign: string };
  provenance: { workflow_id: string; marketing_brief_id?: number; marketing_brief_hash?: string } };
export type Campaign = { id: string; tenant_id: number; workflow_id: string; label: string; status: string; current_revision: number;
  contract_hash: string; contract: Contract; validation_status: string; validation: { errors: { code: string; field?: string }[] }; approval_expires_at: string | null };
export type Form = { label: string; objective: string; platform: string; landing: string; amount: string; currency: string; country: string; audience: string; start: string; creative: string };
export const emptyForm = (): Form => ({ label: "", objective: "", platform: "", landing: "", amount: "", currency: "", country: "", audience: "", start: "", creative: "" });
export const allowed = (context: Context | null, permission: string) => !!context && (context.admin || context.permissions.includes(permission));
export function requireOk<T extends ApiResult>(result: T): T {
  if (result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "The response could not be verified.");
  return result;
}
export async function access(expected?: Context | null): Promise<Context> {
  type Me = ApiResult & { user: { id: number }; activeTenantId: number; memberships: { tenantId: number }[] };
  const me = requireOk(await apiGet<Me>("/api/tenants/me"));
  if (!Number.isInteger(me.user?.id) || !Number.isInteger(me.activeTenantId) || !me.memberships?.some(m => m.tenantId === me.activeTenantId)) throw new Error("Workspace membership could not be verified.");
  const active = requireOk(await apiGet<ApiResult & { tenant: { id: number; status: string }; permissions: string[]; isPlatformAdmin: boolean }>("/api/tenants/active"));
  const after = requireOk(await apiGet<Me>("/api/tenants/me"));
  if (after.user?.id !== me.user.id || after.activeTenantId !== me.activeTenantId || active.tenant?.id !== me.activeTenantId || active.tenant.status !== "active"
    || expected && (expected.userId !== me.user.id || expected.tenantId !== me.activeTenantId)) throw new Error("Account or workspace changed. Reload the journey to continue.");
  if (!Array.isArray(active.permissions) || !active.permissions.every(p => typeof p === "string") || typeof active.isPlatformAdmin !== "boolean") throw new Error("Workspace permissions could not be verified.");
  const context = { userId: me.user.id, tenantId: me.activeTenantId, permissions: active.permissions, admin: active.isPlatformAdmin };
  if (!allowed(context, VIEW) || !allowed(context, "reports.view")) throw new Error("You need marketing brief and campaign viewing access. Ask your workspace administrator.");
  return context;
}
export function buildContract(form: Form, workflowId: string, brief: Brief, creative: Creative): Contract {
  const amount = Number(form.amount), start = new Date(form.start);
  if (!form.label.trim() || !["awareness", "traffic", "leads", "sales", "app"].includes(form.objective)
    || !["meta", "google", "tiktok"].includes(form.platform) || !["USD", "EUR", "GBP", "AUD", "CAD"].includes(form.currency)
    || !/^[A-Z]{2}$/.test(form.country) || !form.audience.trim() || !Number.isFinite(start.getTime())
    || !/^\d+(\.\d{1,6})?$/.test(form.amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 1e6))) throw new Error("Complete the campaign details with a positive budget and valid schedule.");
  if (new URL(form.landing).protocol !== "https:") throw new Error("Enter an HTTPS landing page.");
  return { contract_version: "campaign_draft_v1", objective: form.objective, platforms: [form.platform],
    accounts: [{ platform: form.platform, credential_ref: "user_integrations" }], destination: { landing_page_url: form.landing.trim() },
    budget: { amount_micros: Math.round(amount * 1e6), currency: form.currency }, schedule: { start_at: start.toISOString() },
    geo: { countries: [form.country] }, audience: { name: form.audience.trim() },
    creatives: [{ kind: "creative_brief", asset_id: creative.artifact_id, version: creative.version, content_hash: creative.content_hash }],
    tracking: { utm_source: "ig", utm_medium: "cpc", utm_campaign: form.label.trim().slice(0,64) },
    provenance: { workflow_id: workflowId, marketing_brief_id: brief.id, marketing_brief_hash: brief.content_hash } };
}
export function approvalBody(draft: Campaign) {
  const c = draft.contract;
  return { revision: draft.current_revision, contract_hash: draft.contract_hash, platforms: c.platforms,
    accounts: c.accounts.map(a => a.credential_ref), creatives: c.creatives.map(a => ({ asset_id: a.asset_id, version: a.version })),
    budget: c.budget, schedule: c.schedule, targeting: { geo: c.geo }, landing_page_url: c.destination.landing_page_url };
}
export function verifiedDraft(value: Campaign, tenantId: number, workflowId: string): Campaign {
  if (!value || value.tenant_id !== tenantId || value.workflow_id !== workflowId || typeof value.id !== "string"
    || !Number.isInteger(value.current_revision) || value.current_revision < 1 || !/^[a-f0-9]{64}$/.test(value.contract_hash)
    || value.contract?.provenance?.workflow_id !== workflowId || !Array.isArray(value.validation?.errors)) throw new Error("The saved draft could not be verified.");
  return value;
}
