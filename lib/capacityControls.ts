import { apiGet, type ApiResult } from "@/lib/api";

export type Context = { userId: number; tenantId: number };
export type RosterMember = { id: string; member_name: string; role: string | null; weekly_hours: number | string;
  allocated_hours: number | string; active: boolean; skills: unknown; notes: unknown };
export type MemberDraft = { id: string; member_name: string; role: string; weekly_hours: string; allocated_hours: string; active: boolean };
export type AssignmentDraft = { member_id: string; work_item: string; hours: string; due_date: string; taskId: string };
export const newMember = (): MemberDraft => ({ id: "", member_name: "", role: "marketer", weekly_hours: "40", allocated_hours: "0", active: true });
export const newAssignment = (): AssignmentDraft => ({ member_id: "", work_item: "", hours: "", due_date: "", taskId: "" });
export const memberDraft = (m: RosterMember): MemberDraft => ({ id: m.id, member_name: m.member_name, role: m.role ?? "",
  weekly_hours: String(m.weekly_hours), allocated_hours: String(m.allocated_hours), active: m.active });
export const responseError = (r: { ok?: boolean; error?: string } | null) => r?.ok === true ? null : r?.error || "Invalid or unavailable response.";
export const accessLost = (error: string | null) => !!error && /auth_required|unauthorized|unauthenticated|permission_denied|forbidden|no_tenant|Request failed \((401|403)\)/i.test(error);
type Me = ApiResult & { user?: { id?: number }; activeTenantId?: number | null };
type Active = ApiResult & { tenant?: { id?: number }; permissions?: string[]; isPlatformAdmin?: boolean };
const contextOf = (m: Me): Context | null => Number.isSafeInteger(m?.user?.id) && Number(m.user?.id) > 0
  && Number.isSafeInteger(m.activeTenantId) && Number(m.activeTenantId) > 0 ? { userId: m.user!.id!, tenantId: m.activeTenantId! } : null;
const same = (a: Context, b: Context) => a.userId === b.userId && a.tenantId === b.tenantId;
export async function verifyCapacityAccess(expected?: Context): Promise<{ error: string | null; lost?: boolean; context?: Context; canRead?: boolean; canWrite?: boolean }> {
  const changed = { error: "Account or workspace changed. Rows and drafts were cleared. Refresh to verify access.", lost: true };
  try {
    const me = await apiGet<Me>("/api/tenants/me"), firstError = responseError(me);
    if (firstError) return { error: firstError, lost: accessLost(firstError) };
    const context = contextOf(me);
    if (!context || (expected && !same(expected, context))) return changed;
    const active = await apiGet<Active>("/api/tenants/active"), activeError = responseError(active);
    if (activeError) return { error: activeError, lost: accessLost(activeError) };
    if (active.tenant?.id !== context.tenantId) return changed;
    // /active has no user ID: bracket its permissions with identity checks.
    const after = await apiGet<Me>("/api/tenants/me"), afterError = responseError(after);
    if (afterError) return { error: afterError, lost: accessLost(afterError) };
    const afterContext = contextOf(after);
    if (!afterContext || !same(context, afterContext)) return changed;
    if (!Array.isArray(active.permissions) || !active.permissions.every((p) => typeof p === "string")
      || typeof active.isPlatformAdmin !== "boolean") return { error: "Permissions could not be verified." };
    const can = (p: string) => active.isPlatformAdmin === true || active.permissions!.includes(p);
    const canRead = can("manage.projects.view");
    return { error: null, context, canRead, canWrite: canRead && can("manage.projects.edit") };
  } catch { return { error: "Access verification unavailable. Refresh to try again." }; }
}
export function amount(value: unknown, max = 9999.99): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}
export function calendarDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value) ? value.slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")) return null;
  const date = new Date(day + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}
export function validRoster(value: unknown): value is RosterMember[] {
  return Array.isArray(value) && value.every((m) => m && typeof m.id === "string" && m.id && typeof m.member_name === "string"
    && m.member_name.trim() && (m.role === null || typeof m.role === "string") && typeof m.active === "boolean"
    && amount(m.weekly_hours, 168) !== null && amount(m.allocated_hours) !== null)
    && new Set(value.map((m) => m.id)).size === value.length;
}
export function memberError(d: MemberDraft, roster: RosterMember[]): string | null {
  if (!d.member_name.trim() || !d.role.trim()) return "Name and role are required.";
  if (d.member_name.trim().length > 200 || d.role.trim().length > 200) return "Name and role must be at most 200 characters.";
  if (amount(d.weekly_hours.trim(), 168) === null || amount(d.allocated_hours.trim()) === null)
    return "Weekly hours: 0–168; base allocated hours: 0–9999.99. Use at most 2 decimal places; zero is valid.";
  const original = roster.find((m) => m.id === d.id);
  return d.id && (!original || original.active !== d.active) ? "Roster status changed. Edit and review the member again." : null;
}
export function memberPayload(d: MemberDraft, roster: RosterMember[]) {
  const original = roster.find((m) => m.id === d.id);
  return { ...(d.id ? { id: d.id } : {}), member_name: d.member_name.trim(), role: d.role.trim(), weekly_hours: Number(d.weekly_hours),
    allocated_hours: Number(d.allocated_hours), active: d.active, skills: original ? original.skills : [], notes: original ? original.notes : "" };
}
export function assignmentError(d: AssignmentDraft, roster: RosterMember[]): string | null {
  if (!roster.some((m) => m.id === d.member_id && m.active)) return "Choose an active person.";
  if (!d.work_item.trim()) return "Work item is required.";
  if (d.work_item.trim().length > 200) return "Work item must be at most 200 characters.";
  const hours = amount(d.hours.trim());
  if (hours === null || hours <= 0) return "Assignment hours must be greater than 0 and at most 9999.99, with at most 2 decimal places.";
  return d.due_date && (calendarDay(d.due_date) !== d.due_date) ? "Enter a real calendar due date: YYYY-MM-DD." : null;
}
export const assignmentPayload = (d: AssignmentDraft) => ({ member_id: d.member_id, work_item: d.work_item.trim(), hours: Number(d.hours),
  due_date: d.due_date || null, source: d.taskId ? "agent_tasks" : "manual", source_ref: d.taskId ? `agent_task:${d.taskId}` : null, status: "open" });
