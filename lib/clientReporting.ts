import { apiGet, type ApiResult } from "@/lib/api";
import { responseError } from "@/lib/agencyTimeEntries";

export { responseError };
export type Context = { userId: number; tenantId: number };
export type Client = { id: number; name: string; slug: string | null; website: string | null; status: "active" };
export type Branding = Partial<Record<"agencyName" | "footerText" | "primaryColor" | "accentColor" | "textColor", string>>;
export type Draft = { report_source: "search-intel" | "campaigns"; default_format: "pdf" | "pptx" | "xlsx";
  report_title: string; branding_mode: "workspace" | "custom"; branding_overrides: Branding };
export type Profile = Draft & { client_id: number; version: number; created_at: string; updated_at: string };
export type ClientsResponse = ApiResult & { clients?: Client[]; has_more?: boolean; next_cursor?: number | null };
export type ProfileResponse = ApiResult & { client?: Client; configured?: boolean; profile?: Profile | null };
type MeResponse = ApiResult & { user?: { id?: number }; activeTenantId?: number; memberships?: { tenantId: number }[] };
type ActiveResponse = ApiResult & { tenant?: { id: number; status: string }; permissions?: string[]; isPlatformAdmin?: boolean };
type Access = { context?: Context; error?: string; lost?: boolean };
export const API = "/api/client-reporting/clients";
export const BRAND_FIELDS = [
  ["agencyName", "Agency name", 80], ["footerText", "Footer text", 200],
  ["primaryColor", "Primary colour", 7], ["accentColor", "Accent colour", 7], ["textColor", "Text colour", 7],
] as const;
export const positiveId = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const sameContext = (a: Context, b: Context) => a.userId === b.userId && a.tenantId === b.tenantId;
export const accessLost = (error: string) => /auth_required|unauthorized|permission_denied|forbidden|no_tenant|not_a_member|Request failed \((401|403)\)/i.test(error);
const contextMessage = "Account, workspace or membership changed. Previous client details and unsaved changes were cleared. Verify access to continue.";
function contextOf(me: MeResponse): Context | null {
  return positiveId(me?.user?.id) && positiveId(me.activeTenantId) && Array.isArray(me.memberships)
    && me.memberships.some((member) => member?.tenantId === me.activeTenantId)
    ? { userId: me.user.id, tenantId: me.activeTenantId } : null;
}
export async function verifyAccess(expected?: Context): Promise<Access> {
  const me = await apiGet<MeResponse>("/api/tenants/me");
  const error = responseError(me);
  if (error) return { error, lost: accessLost(error) };
  const context = contextOf(me);
  if (!context || (expected && !sameContext(expected, context))) return { error: contextMessage, lost: true };
  const active = await apiGet<ActiveResponse>("/api/tenants/active");
  const activeError = responseError(active);
  if (activeError) return { error: activeError, lost: accessLost(activeError) };
  if (active.tenant?.id !== context.tenantId || active.tenant.status !== "active") return { error: contextMessage, lost: true };
  if (!Array.isArray(active.permissions) || !active.permissions.every((p) => typeof p === "string")
    || typeof active.isPlatformAdmin !== "boolean") return { error: "Workspace access could not be verified. Try again." };
  // /active has no actor ID. Check membership and actor again before using its grants.
  const after = await apiGet<MeResponse>("/api/tenants/me");
  const afterError = responseError(after);
  if (afterError) return { error: afterError, lost: accessLost(afterError) };
  const afterContext = contextOf(after);
  if (!afterContext || !sameContext(context, afterContext)) return { error: contextMessage, lost: true };
  if (!active.isPlatformAdmin && !active.permissions.includes("tenant.settings.manage")) {
    return { error: "Access denied. Ask your workspace administrator for workspace settings access.", lost: true };
  }
  return { context };
}
export const newDraft = (): Draft => ({ report_source: "search-intel", default_format: "pdf", report_title: "", branding_mode: "workspace", branding_overrides: {} });
export function profileDraft(profile: Profile): Draft {
  return { report_source: profile.report_source, default_format: profile.default_format, report_title: profile.report_title,
    branding_mode: profile.branding_mode, branding_overrides: { ...profile.branding_overrides } };
}
export function draftError(draft: Draft): string | null {
  if (!["search-intel", "campaigns"].includes(draft.report_source) || !["pdf", "pptx", "xlsx"].includes(draft.default_format)) return "Choose a report source and format.";
  if (typeof draft.report_title !== "string" || !draft.report_title.trim() || draft.report_title.trim().length > 160) return "Enter a report title of 1 to 160 characters.";
  if (!["workspace", "custom"].includes(draft.branding_mode)) return "Choose a branding option.";
  if (draft.branding_mode === "custom") {
    if (!draft.branding_overrides || typeof draft.branding_overrides !== "object" || Array.isArray(draft.branding_overrides)) return "Check the custom branding values.";
    for (const [key, value] of Object.entries(draft.branding_overrides)) {
      const field = BRAND_FIELDS.find(([name]) => name === key);
      if (!field || typeof value !== "string" || value.trim().length > field[2]) return "Check the custom branding values and character limits.";
      if (key.endsWith("Color") && value !== "" && !/^#[0-9a-fA-F]{6}$/.test(value)) return "Enter colours as #RRGGBB, or leave them blank.";
    }
  }
  return null;
}
export function profilePayload(draft: Draft, version: number) {
  const branding: Branding = {};
  if (draft.branding_mode === "custom") for (const [key] of BRAND_FIELDS) {
    const value = draft.branding_overrides[key];
    if (value !== undefined && (value !== "" || !key.endsWith("Color"))) branding[key] = value.trim();
  }
  return { report_source: draft.report_source, default_format: draft.default_format, report_title: draft.report_title.trim(),
    branding_mode: draft.branding_mode, branding_overrides: branding, expected_version: version };
}
export function validClient(value: unknown): value is Client {
  if (!value || typeof value !== "object") return false;
  const client = value as Client;
  return positiveId(client.id) && typeof client.name === "string" && !!client.name.trim() && client.status === "active"
    && (client.slug === null || typeof client.slug === "string") && (client.website === null || typeof client.website === "string");
}
export function validPage(result: ClientsResponse, cursor: number | null): boolean {
  return Array.isArray(result.clients) && result.clients.length <= 50 && result.clients.every(validClient)
    && result.clients.every((client, i, rows) => client.id > (i ? rows[i - 1].id : cursor || 0))
    && typeof result.has_more === "boolean" && (result.has_more
      ? result.clients.length === 50 && result.next_cursor === result.clients.at(-1)?.id : result.next_cursor === null);
}
export function validProfile(value: unknown, clientId: number): value is Profile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Profile;
  const branding = profile.branding_overrides;
  return profile.client_id === clientId && positiveId(profile.version) && !draftError(profile)
    && !!branding && typeof branding === "object" && !Array.isArray(branding)
    && Object.entries(branding).every(([key, text]) => BRAND_FIELDS.some(([name]) => name === key) && typeof text === "string"
      && (!key.endsWith("Color") || /^#[0-9a-fA-F]{6}$/.test(text)))
    && (profile.branding_mode !== "workspace" || Object.keys(branding).length === 0)
    && [profile.created_at, profile.updated_at].every((date) => typeof date === "string" && Number.isFinite(Date.parse(date)));
}
export function saveMatches(profile: Profile, payload: ReturnType<typeof profilePayload>): boolean {
  return profile.version === payload.expected_version + 1
    && ["report_source", "default_format", "report_title", "branding_mode"].every((key) => profile[key as keyof Draft] === payload[key as keyof Draft])
    && JSON.stringify(Object.entries(profile.branding_overrides).sort()) === JSON.stringify(Object.entries(payload.branding_overrides).sort());
}
