import { apiGet, type ApiResult } from "@/lib/api";
import { accessLost, responseError, validDate, validMember, type ActiveResponse, type Member } from "@/lib/agencyTimeEntries";

export { accessLost, responseError };
export type Context = { userId: number; tenantId: number };
export type RosterMember = Member & { role?: string | null };
export type Rate = {
  id: string; member_id: string | null; role: string | null; cost_rate: number; bill_rate: number;
  currency: string | null; effective_from: string; effective_to: string | null; active: boolean;
};
export type Draft = {
  scope: "member" | "role"; member_id: string; role: string; cost_rate: string; bill_rate: string;
  currency: string; effective_from: string; effective_to: string; active: boolean;
};
export type Filters = { scope: "all" | "member" | "role"; member_id: string; role: string };
export type RatesResponse = ApiResult & { rates?: Rate[] };
export type RosterResponse = ApiResult & { members?: RosterMember[] };
export type SaveResponse = ApiResult & { rate?: Rate };
type MeResponse = ApiResult & { user?: { id?: number }; activeTenantId?: number | null };
type Access = { error: string | null; lost?: boolean; context?: Context; canRead?: boolean; canWrite?: boolean };
const contextMessage = "Account or workspace changed. The old draft and list were cleared. Verify access to start again.";
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const sameContext = (a: Context, b: Context) => a.userId === b.userId && a.tenantId === b.tenantId;
const contextOf = (me: MeResponse): Context | null => positiveId(me?.user?.id) && positiveId(me.activeTenantId)
  ? { userId: me.user.id, tenantId: me.activeTenantId } : null;

export async function verifyRateCardAccess(expected?: Context): Promise<Access> {
  try {
    const me = await apiGet<MeResponse>("/api/tenants/me");
    const meError = responseError(me);
    if (meError) return { error: meError, lost: accessLost(meError) };
    const context = contextOf(me);
    if (!context) return { error: "Sign in and select an active workspace to view rates.", lost: true };
    if (expected && !sameContext(expected, context)) return { error: contextMessage, lost: true };
    const active = await apiGet<ActiveResponse>("/api/tenants/active");
    const activeError = responseError(active);
    if (activeError) return { error: activeError, lost: accessLost(activeError) };
    if (active.tenant?.id !== context.tenantId) return { error: contextMessage, lost: true };
    if (!Array.isArray(active.permissions) || !active.permissions.every((p) => typeof p === "string")
      || typeof active.isPlatformAdmin !== "boolean") return { error: "Permissions could not be verified." };
    // /active has no user ID. Bracket it with /me so a same-tenant account switch is detected too.
    const after = await apiGet<MeResponse>("/api/tenants/me");
    const afterError = responseError(after);
    if (afterError) return { error: afterError, lost: accessLost(afterError) };
    const afterContext = contextOf(after);
    if (!afterContext || !sameContext(context, afterContext)) return { error: contextMessage, lost: true };
    const can = (p: string) => active.isPlatformAdmin === true || active.permissions!.includes(p);
    const canRead = can("tenant.billing.manage") && can("manage.projects.view");
    return { error: null, context, canRead, canWrite: canRead && can("manage.projects.edit") };
  } catch {
    return { error: "Access verification unavailable. Try again." };
  }
}

export function localCalendarDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const newDraft = (): Draft => ({ scope: "member", member_id: "", role: "", cost_rate: "", bill_rate: "",
  currency: "", effective_from: localCalendarDate(), effective_to: "", active: true });
export const newFilters = (): Filters => ({ scope: "all", member_id: "", role: "" });
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
  && value >= 0 && value <= 1000000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
export function validRate(value: unknown): value is Rate {
  if (!value || typeof value !== "object") return false;
  const row = value as Rate;
  return text(row.id) && (row.member_id === null || text(row.member_id)) && (row.role === null || text(row.role))
    && amount(row.cost_rate) && amount(row.bill_rate) && (row.currency === null || text(row.currency))
    && typeof row.effective_from === "string" && validDate(row.effective_from)
    && (row.effective_to === null || (typeof row.effective_to === "string" && validDate(row.effective_to)
      && row.effective_to >= row.effective_from)) && typeof row.active === "boolean";
}
export function validRosterMember(value: unknown): value is RosterMember {
  if (!validMember(value)) return false;
  const row = value as RosterMember;
  return row.role === undefined || row.role === null || typeof row.role === "string";
}
export function filterError(filters: Filters): string | null {
  if (filters.scope === "member" && !filters.member_id) return "Choose a member to filter rates.";
  if (filters.scope === "role" && (!filters.role.trim() || filters.role.trim().length > 200)) return "Enter an exact role (up to 200 characters).";
  return null;
}
export function ratesUrl(filters: Filters): string {
  const query = new URLSearchParams();
  if (filters.scope === "member") query.set("member_id", filters.member_id);
  if (filters.scope === "role") query.set("role", filters.role.trim());
  return "/api/agency-ops/rates" + (query.size ? "?" + query.toString() : "");
}
export function draftError(draft: Draft, members: RosterMember[]): string | null {
  if (draft.scope === "member") {
    if (draft.role || !members.some((m) => m.id === draft.member_id && m.active)) return "Choose an active member only.";
  } else if (draft.scope !== "role" || draft.member_id || !draft.role.trim() || draft.role.trim().length > 200) {
    return "Enter one named role only (up to 200 characters).";
  }
  for (const key of ["cost_rate", "bill_rate"] as const) {
    const value = draft[key].trim();
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !amount(Number(value))) return "Enter both hourly amounts from 0 to 1,000,000 with at most 2 decimal places.";
  }
  if (!draft.currency.trim() || draft.currency.trim().length > 10) return "Enter a currency (up to 10 characters).";
  if (!validDate(draft.effective_from) || (draft.effective_to && !validDate(draft.effective_to))) return "Choose real effective dates.";
  if (draft.effective_to && draft.effective_to < draft.effective_from) return "Effective to must be on or after Effective from.";
  return null;
}
export function ratePayload(draft: Draft) {
  return { member_id: draft.scope === "member" ? draft.member_id : null, role: draft.scope === "role" ? draft.role.trim() : null,
    cost_rate: Number(draft.cost_rate), bill_rate: Number(draft.bill_rate), currency: draft.currency.trim().toUpperCase(),
    effective_from: draft.effective_from, effective_to: draft.effective_to || null, active: draft.active };
}
export function memberLabel(id: string, members: RosterMember[], rosterVerified = true): string {
  const member = members.find((row) => row.id === id);
  return member ? `${member.member_name} (${id})` : `${id} (${rosterVerified ? "not in active roster" : "roster not verified"})`;
}
