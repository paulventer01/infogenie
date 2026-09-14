import { apiGet, apiPost, type ApiResult } from "@/lib/api";
import { ADMIN_API, PORTAL_API } from "@/lib/clientReportingPortal";
import type { Client } from "@/lib/clientReporting";
import type { ApprovalBinding, Preview } from "@/lib/clientReportingReport";

export type ApprovalSnapshot = {
  id: number;
  submission_number: number;
  profile_version: number;
  reporting_period: string;
  reporting_timezone: string;
  period_start: string | null;
  period_end: string | null;
  selected_metrics: string[];
  content_hash: string;
  created_at: string;
  created_by_user_id: number | null;
};

export type ApprovalRequest = {
  id: number;
  status: "pending" | "approved" | "changes_requested" | "withdrawn";
  submitted_at: string;
  submitted_by_user_id: number | null;
  decided_at: string | null;
  decision_actor_type: "portal_client" | null;
  decision_comment: string | null;
  withdrawn_at: string | null;
  withdrawn_by_user_id: number | null;
  snapshot: ApprovalSnapshot;
  snapshot_payload?: Preview;
};

export type ApprovalListResponse = ApiResult & {
  client?: Client;
  pending?: ApprovalRequest | null;
  requests?: ApprovalRequest[];
};

export type ApprovalResponse = ApiResult & {
  client?: Client;
  client_id?: number;
  request?: ApprovalRequest;
  pending?: ApprovalRequest | null;
};

export function approvalErrorMessage(code: string): string {
  switch (code) {
    case "approval_pending":
      return "A report is already pending client approval. Withdraw it before submitting a new version.";
    case "approval_not_pending":
      return "This approval request is no longer pending. Reload to see the latest status.";
    case "approval_not_found":
      return "This approval request could not be found. Reload and try again.";
    case "approval_stale":
      return "This report changed since you opened it. Reload the portal page and review the latest submission.";
    case "preview_stale":
      return "The displayed preview is no longer valid. Preview the report again before submitting.";
    case "version_conflict":
      return "The saved profile changed. Reload the profile and preview again before submitting.";
    case "no_mapped_records":
      return "No mapped records are available for this report. Assign records before submitting.";
    case "portal_revoked":
      return "Portal access has been revoked. Ask your agency for a new invitation.";
    case "portal_session_expired":
      return "Your portal session expired. Use your invitation link to sign in again.";
    case "portal_auth_required":
      return "Sign in via your invitation link to continue.";
    case "csrf_rejected":
      return "This action was blocked for security. Reload the page and try again.";
    default:
      return "This approval action could not be completed. Check your connection and try again.";
  }
}

export function approvalStatusLabel(status: ApprovalRequest["status"]): string {
  switch (status) {
    case "pending": return "Pending client approval";
    case "approved": return "Approved";
    case "changes_requested": return "Changes requested";
    case "withdrawn": return "Withdrawn";
    default: return status;
  }
}

export function decisionActorLabel(actor: ApprovalRequest["decision_actor_type"]): string {
  if (actor === "portal_client") return "Client via portal link";
  return "—";
}

export async function fetchAdminApprovals(clientId: number): Promise<ApprovalListResponse> {
  return apiGet<ApprovalListResponse>(`${ADMIN_API}/${clientId}/approval-requests`);
}

export async function submitAdminApproval(clientId: number, contentHash: string): Promise<ApprovalResponse> {
  return apiPost(`${ADMIN_API}/${clientId}/approval-requests`, { content_hash: contentHash });
}

export async function withdrawAdminApproval(clientId: number, requestId: number): Promise<ApprovalResponse> {
  return apiPost(`${ADMIN_API}/${clientId}/approval-requests/${requestId}/withdraw`, {});
}

export async function fetchPortalPendingApproval(): Promise<ApprovalResponse> {
  return apiGet<ApprovalResponse>(`${PORTAL_API}/approval-requests/pending`);
}

export async function approvePortalRequest(binding: ApprovalBinding): Promise<ApprovalResponse> {
  return apiPost(`${PORTAL_API}/approval-requests/${binding.request_id}/approve`, {
    confirm: true,
    snapshot_id: binding.snapshot_id,
    content_hash: binding.content_hash,
  });
}

export async function requestPortalChanges(binding: ApprovalBinding, comment: string): Promise<ApprovalResponse> {
  return apiPost(`${PORTAL_API}/approval-requests/${binding.request_id}/request-changes`, {
    comment,
    snapshot_id: binding.snapshot_id,
    content_hash: binding.content_hash,
  });
}
