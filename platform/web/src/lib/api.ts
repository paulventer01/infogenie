"use client";

// Thin client for the platform API. The session token and active tenant live in
// localStorage; every tenant-scoped call carries Authorization + X-Tenant-Id,
// and the server resolves access (membership / agency-parent / JIT) before any
// data is touched — the UI never enforces tenancy itself.

export interface GateCheck { check: string; status: "pass" | "fail" | "not_applicable"; reason: string }
export interface GateVerdict { allowed: boolean; reason?: string; checks: GateCheck[] }
export interface ActionRow {
  id: string; capability_key: string; status: string; autonomy_level: number;
  gate: GateVerdict; created_at: string; decided_at: string | null;
}
export interface Capability {
  key: string; name: string; domain: string; archetype: string; agent_type: string;
  irreversible: boolean; entry_autonomy: number; autonomy_ceiling: number;
  description: string | null; level: number; integrations: string[];
}
export interface Integration {
  key: string; name: string; purpose: string; status: string; reason: string | null;
  auth_kind: string; capability_count: number; connected: boolean; secret_hint: string | null;
}
export interface Tenant { id: string; name: string; type: "agency" | "client"; slug: string }
export interface Brand {
  id: string; version: number; company_name: string; mission: string | null;
  positioning: string | null; voice_tone: string | null; key_messages: string[];
  differentiators: string[]; competitors: string[]; prohibited_terms: string[];
  mandatory_disclaimers: string[]; created_at: string;
}
export interface RunResult {
  actionId: string; status: "pending_approval" | "executed" | "blocked";
  output: string | null; gate: GateVerdict; autonomyLevel: number;
  mode: "live" | "mock"; brandVersion: number | null;
}
export interface Competitor {
  name: string; domain: string; positioning: string;
  strengths: string[]; weaknesses: string[];
  threat: "low" | "medium" | "high" | "critical"; counterMove: string;
}
export interface MarketMap { subject: string; industry: string; region: string; competitors: Competitor[] }
export type AnalyseResult = RunResult & { market: MarketMap };

export const session = {
  get token() { return typeof window === "undefined" ? null : localStorage.getItem("ig.token"); },
  set token(v: string | null) {
    if (v) localStorage.setItem("ig.token", v);
    else localStorage.removeItem("ig.token");
  },
  get tenantId() { return typeof window === "undefined" ? null : localStorage.getItem("ig.tenant"); },
  set tenantId(v: string | null) {
    if (v) localStorage.setItem("ig.tenant", v);
    else localStorage.removeItem("ig.tenant");
  },
  clear() { this.token = null; this.tenantId = null; },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit & { tenant?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (init?.tenant !== false && session.tenantId) headers["X-Tenant-Id"] = session.tenantId;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }), tenant: false }),
  myTenants: () => request<{ tenants: Tenant[] }>("/api/me/tenants", { tenant: false }),
  brand: () => request<{ brand: Brand | null }>("/api/brand"),
  saveBrand: (input: Record<string, unknown>) =>
    request<{ id: string; version: number }>("/api/brand", { method: "PUT", body: JSON.stringify(input) }),
  capabilities: () => request<{ capabilities: Capability[]; engine: "live" | "mock" }>("/api/capabilities"),
  run: (key: string, brief: string, vars?: Record<string, string>) =>
    request<RunResult>(`/api/capabilities/${key}/run`, { method: "POST", body: JSON.stringify({ brief, vars }) }),
  actions: () => request<{ actions: ActionRow[]; engine: "live" | "mock" }>("/api/actions"),
  integrations: () => request<{ integrations: Integration[] }>("/api/integrations"),
  saveIntegrationCredential: (key: string, secret: string) =>
    request<{ connected: boolean; hint: string }>(`/api/integrations/${key}/credential`, {
      method: "PUT", body: JSON.stringify({ secret }),
    }),
  approve: (id: string) => request<{ status: string }>(`/api/actions/${id}/approve`, { method: "POST" }),
  analyse: (input: { website?: string; sector?: string; region?: string }) =>
    request<AnalyseResult>("/api/analyse/run", { method: "POST", body: JSON.stringify(input) }),
};
