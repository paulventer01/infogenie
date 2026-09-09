import type { ApiResult } from "@/lib/api";
import { validDate } from "@/lib/agencyTimeEntries";
import { localCalendarDate } from "@/lib/agencyRateCards";

// Scope budgets intentionally share the rate-card financial permission boundary.
export { accessLost, responseError, verifyRateCardAccess as verifyScopeBudgetAccess } from "@/lib/agencyRateCards";
export type { Context } from "@/lib/agencyRateCards";
export type Baseline = {
  id: string; client_ref: string; project_ref: string | null; name: string;
  period_start: string; period_end: string; contracted_hours: number;
  change_budget_hours: number; contracted_value: number; currency: string; active: true;
};
export type Payload = Omit<Baseline, "id">;
export type Draft = { [K in Exclude<keyof Payload, "active">]: string };
export type Filters = { from: string; to: string; client_ref: string };
export type BaselinesResponse = ApiResult & { baselines?: unknown; period?: unknown };
export type SaveResponse = ApiResult & { baseline?: unknown };
export const scopeAccessMessage = (message: string) => message.replace(/\brates\b/gi, "scope budgets");
export function newFilters(date = new Date()): Filters {
  const today = localCalendarDate(date);
  return { from: today.slice(0, 8) + "01", to: today, client_ref: "" };
}
export function newDraft(): Draft {
  const period = newFilters();
  return { client_ref: "", project_ref: "", name: "", period_start: period.from, period_end: period.to,
    contracted_hours: "", change_budget_hours: "", contracted_value: "", currency: "" };
}
const text = (value: unknown, max = 200): value is string => typeof value === "string"
  && !!value.trim() && value === value.trim() && value.length <= max;
function amount(value: unknown, max: number): number | null {
  // Raw pg NUMERIC values are decimal strings; never coerce blanks, booleans or null to zero.
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
}
export function calendarDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // DATE may serialize as a date or canonical UTC midnight. Reject offsets/non-midnight
  // timestamps rather than arbitrarily truncating a timezone-dependent instant.
  const day = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value) ? value.slice(0, 10) : value;
  return validDate(day) ? day : null;
}
export function normalizeBaseline(value: unknown): Baseline | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const start = calendarDay(row.period_start), end = calendarDay(row.period_end);
  const hours = amount(row.contracted_hours, 1000000), change = amount(row.change_budget_hours, 1000000);
  const contracted = amount(row.contracted_value, 1000000000);
  const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
  if (!text(row.id) || !text(row.client_ref) || !text(row.name) || (row.project_ref !== null && !text(row.project_ref))
    || !start || !end || start > end || hours === null || change === null || contracted === null
    || !text(currency, 10) || row.active !== true) return null;
  // Ignore extra DB tenant/timestamps, exposing only the validated business contract.
  return { id: row.id, client_ref: row.client_ref, project_ref: row.project_ref as string | null, name: row.name,
    period_start: start, period_end: end, contracted_hours: hours, change_budget_hours: change,
    contracted_value: contracted, currency, active: true };
}
export function normalizeBaselines(result: BaselinesResponse, filters: Filters): Baseline[] | null {
  if (!Array.isArray(result.baselines)) return null;
  if (result.period !== undefined) {
    const period = result.period as { from?: unknown; to?: unknown } | null;
    if (!period || calendarDay(period.from) !== filters.from || calendarDay(period.to) !== filters.to) return null;
  }
  const rows: Baseline[] = [], ids = new Set<string>();
  for (const raw of result.baselines) {
    const row = normalizeBaseline(raw);
    if (!row || ids.has(row.id) || row.period_end < filters.from || row.period_start > filters.to
      || (filters.client_ref.trim() && row.client_ref !== filters.client_ref.trim())) return null;
    ids.add(row.id); rows.push(row);
  }
  return rows;
}
export function filterError(filters: Filters): string | null {
  if (!validDate(filters.from) || !validDate(filters.to)) return "Choose real From and To dates.";
  if (filters.from > filters.to) return "From must be on or before To.";
  return filters.client_ref.trim().length > 200 ? "Client reference must be at most 200 characters." : null;
}
export function baselinesUrl(filters: Filters): string {
  const query = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.client_ref.trim()) query.set("client_ref", filters.client_ref.trim());
  return "/api/agency-ops/scope-baselines?" + query.toString();
}
export function draftError(draft: Draft): string | null {
  if (!draft.client_ref.trim() || !draft.name.trim()) return "Client reference and baseline name are required.";
  if ([draft.client_ref, draft.project_ref, draft.name].some((value) => value.trim().length > 200)) return "References and name must be at most 200 characters.";
  if (!validDate(draft.period_start) || !validDate(draft.period_end)) return "Choose real baseline start and end dates.";
  if (draft.period_start > draft.period_end) return "Baseline start must be on or before end.";
  if (amount(draft.contracted_hours.trim(), 1000000) === null || amount(draft.change_budget_hours.trim(), 1000000) === null)
    return "Enter both hours explicitly from 0 to 1,000,000 with at most 2 decimal places.";
  if (amount(draft.contracted_value.trim(), 1000000000) === null) return "Enter contracted value explicitly from 0 to 1,000,000,000 with at most 2 decimal places.";
  return text(draft.currency.trim().toUpperCase(), 10) ? null : "Enter a currency (up to 10 characters).";
}
export function baselinePayload(draft: Draft): Payload {
  return { client_ref: draft.client_ref.trim(), project_ref: draft.project_ref.trim() || null, name: draft.name.trim(),
    period_start: draft.period_start, period_end: draft.period_end, contracted_hours: Number(draft.contracted_hours),
    change_budget_hours: Number(draft.change_budget_hours), contracted_value: Number(draft.contracted_value),
    currency: draft.currency.trim().toUpperCase(), active: true };
}
export function matchesPayload(row: Baseline, payload: Payload): boolean {
  return Object.entries(payload).every(([key, value]) => row[key as keyof Payload] === value);
}
export function overlappingBaselines(rows: Baseline[], payload: Payload): Baseline[] {
  return rows.filter((row) => row.client_ref === payload.client_ref && row.period_start <= payload.period_end
    && row.period_end >= payload.period_start && (!row.project_ref || !payload.project_ref || row.project_ref === payload.project_ref));
}
