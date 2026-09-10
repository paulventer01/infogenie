import { apiGet, apiPost, type ApiResult } from "@/lib/api";
import { responseError } from "@/lib/clientReporting";
import type { Client } from "@/lib/clientReporting";
import type { Preview } from "@/lib/clientReportingReport";

export const PORTAL_API = "/api/client-reporting/portal";
export const ADMIN_API = "/api/client-reporting/clients";

export type PortalStatus = {
  enabled: boolean;
  revoked_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  pending_invitations: number;
  active_sessions: number;
};

export type PortalResponse = ApiResult & { client?: Client; portal?: PortalStatus };
export type InviteResponse = ApiResult & {
  client?: Client;
  invitation?: { id: number; expires_at: string; created_at: string };
  invite_path?: string;
};

export type DeliveryRow = {
  id: number;
  window_key: string;
  status: "sent" | "failed" | "skipped";
  attempted_at: string;
  recipient_email: string | null;
  profile_version: number | null;
  format: string | null;
  error_code: string | null;
};

export type PortalHistoryResponse = ApiResult & {
  client_id?: number;
  deliveries?: DeliveryRow[];
  has_more?: boolean;
  next_cursor?: number | null;
};

export function validPortalStatus(value: unknown): value is PortalStatus {
  if (!value || typeof value !== "object") return false;
  const row = value as PortalStatus;
  return typeof row.enabled === "boolean" && typeof row.pending_invitations === "number"
    && typeof row.active_sessions === "number";
}

export function validPortalResponse(result: PortalResponse, clientId: number): boolean {
  if (responseError(result) || !result.client || result.client.id !== clientId) return false;
  return validPortalStatus(result.portal);
}

export function inviteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function redeemInvite(token: string): Promise<ApiResult> {
  const cleaned = token.replace(/[^a-f0-9]/gi, "");
  return apiPost(`${PORTAL_API}/redeem/${cleaned}`, {});
}

export async function fetchPortalReport(): Promise<Preview & ApiResult> {
  return apiGet<Preview & ApiResult>(`${PORTAL_API}/report`);
}

export async function fetchPortalHistory(cursor = 0): Promise<PortalHistoryResponse> {
  return apiGet<PortalHistoryResponse>(`${PORTAL_API}/delivery-history?cursor=${cursor}&limit=20`);
}
