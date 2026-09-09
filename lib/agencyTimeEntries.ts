import { apiGet, type ApiResult } from "@/lib/api";
import { dataUnavailableMessage, isDataUnavailable, monthStartIso, todayIso } from "@/lib/agencyOpsDashboard";

export type Member = { id: string; member_name: string; active: boolean };
export type TimeEntry = {
  id: string; member_id: string; client_ref: string; project_ref: string | null;
  work_item: string; work_date: string; hours: number; billable: boolean; notes: string;
};
export type Draft = Omit<TimeEntry, "id" | "hours" | "project_ref"> & { hours: string; project_ref: string };
export type Filters = { from: string; to: string; client_ref: string; member_id: string };
export type EntriesResponse = ApiResult & { entries?: TimeEntry[] };
export type MembersResponse = ApiResult & { members?: Member[] };
export type SaveResponse = ApiResult & { entry?: TimeEntry };
export type MeResponse = ApiResult & { activeTenantId?: number | null };
export type ActiveResponse = ApiResult & {
  tenant?: { id: number } | null; permissions?: string[]; isPlatformAdmin?: boolean;
};
type Access = { error: string | null; accessLost?: boolean; tenantChanged?: boolean; tenantId?: number; canRead?: boolean; canWrite?: boolean };

export function accessLost(error: string | null): boolean {
  return !!error && /auth_required|unauthorized|permission_denied|forbidden|Request failed \((401|403)\)/i.test(error);
}

export async function verifyTimeEntryAccess(expectedTenantId?: number): Promise<Access> {
  // /me is membership context; only /active supplies verified granular permissions.
  const me = await apiGet<MeResponse>("/api/tenants/me");
  const meError = responseError(me);
  if (meError) return { error: meError, accessLost: accessLost(meError) };
  if (expectedTenantId !== undefined && me.activeTenantId !== expectedTenantId) {
    return { error: "Workspace changed. The old draft and list were cleared. Verify permissions and start a fresh entry.", tenantChanged: true };
  }
  if (!Number.isSafeInteger(me.activeTenantId) || Number(me.activeTenantId) <= 0) {
    return { error: "Select an active tenant to view time entries." };
  }
  const active = await apiGet<ActiveResponse>("/api/tenants/active");
  const error = responseError(active);
  if (error) return { error, accessLost: accessLost(error) };
  if (active.tenant?.id !== me.activeTenantId) {
    return { error: "Tenant context changed during verification. Verify permissions and start a fresh entry.", tenantChanged: true };
  }
  if (!Array.isArray(active.permissions) || !active.permissions.every((permission) => typeof permission === "string")
    || typeof active.isPlatformAdmin !== "boolean") return { error: "Permission context could not be verified." };
  const can = (permission: string) => active.isPlatformAdmin === true || active.permissions!.includes(permission);
  return { error: null, tenantId: me.activeTenantId!,
    canRead: can("tenant.billing.manage") && can("manage.projects.view"), canWrite: can("manage.projects.edit") };
}

export const newFilters = (): Filters => ({ from: monthStartIso(), to: todayIso(), client_ref: "", member_id: "" });
export const newDraft = (): Draft => ({
  member_id: "", client_ref: "", project_ref: "", work_item: "", work_date: todayIso(),
  hours: "", billable: true, notes: "",
});
export const entryDraft = (entry: TimeEntry): Draft => ({
  member_id: entry.member_id, client_ref: entry.client_ref, project_ref: entry.project_ref || "",
  work_item: entry.work_item, work_date: entry.work_date, hours: String(entry.hours),
  billable: entry.billable, notes: entry.notes,
});

const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validEntry(value: unknown): value is TimeEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as TimeEntry;
  return [row.id, row.member_id, row.client_ref, row.work_item].every(text)
    && typeof row.work_date === "string" && validDate(row.work_date)
    && typeof row.hours === "number" && row.hours >= 0.01 && row.hours <= 24
    && typeof row.billable === "boolean" && typeof row.notes === "string"
    && (row.project_ref === null || typeof row.project_ref === "string");
}
export function validMember(value: unknown): value is Member {
  if (!value || typeof value !== "object") return false;
  const row = value as Member;
  return text(row.id) && text(row.member_name) && typeof row.active === "boolean";
}

function withheld(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return isDataUnavailable(row) || row._estimated === true || row._fabricated === true
    || ["placeholder", "fallback", "template", "serp-fallback", "demo", "mock", "sample"].includes(String(row.source));
}
export function responseError(value: ApiResult): string | null {
  if (!value || typeof value !== "object") return "Invalid server response.";
  if (withheld(value) || Object.values(value).some((child) =>
    Array.isArray(child) ? child.some(withheld) : withheld(child))) return dataUnavailableMessage(value);
  return value.ok === true ? null : typeof value.error === "string" && value.error.trim() ? value.error : "Request failed.";
}
export function filterError(filters: Filters): string | null {
  if (!validDate(filters.from) || !validDate(filters.to)) return "Choose real From and To dates.";
  if (filters.from > filters.to) return "From must be on or before To.";
  if (filters.client_ref.trim().length > 200) return "Client reference must be at most 200 characters.";
  return null;
}
export function entriesUrl(filters: Filters): string {
  const query = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.client_ref.trim()) query.set("client_ref", filters.client_ref.trim());
  if (filters.member_id) query.set("member_id", filters.member_id);
  return "/api/agency-ops/time-entries?" + query.toString();
}
export function draftError(draft: Draft, members: Member[], originalMember?: string): string | null {
  if (!(originalMember && draft.member_id === originalMember)
    && !members.some((member) => member.id === draft.member_id && member.active)) {
    return "Choose an active capacity member (or retain the original member for a correction).";
  }
  if (![draft.client_ref, draft.work_item].every(text)) return "Client reference and work item are required.";
  if ([draft.client_ref, draft.project_ref, draft.work_item].some((value) => value.trim().length > 200)) {
    return "References and work item must be at most 200 characters.";
  }
  if (!validDate(draft.work_date)) return "Choose a real work date.";
  const hours = Number(draft.hours);
  if (!Number.isFinite(hours) || hours < 0.01 || hours > 24) return "Hours must be between 0.01 and 24.";
  if (draft.notes.length > 2000) return "Notes must be at most 2000 characters.";
  return null;
}
export function entryPayload(draft: Draft) {
  return {
    member_id: draft.member_id, client_ref: draft.client_ref.trim(), project_ref: draft.project_ref.trim() || null,
    work_item: draft.work_item.trim(), work_date: draft.work_date, hours: Number(draft.hours),
    billable: draft.billable, notes: draft.notes.trim(),
  };
}
