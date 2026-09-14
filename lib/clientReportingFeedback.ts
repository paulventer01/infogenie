import { apiGet, apiPost, type ApiResult } from "@/lib/api";
import { ADMIN_API, PORTAL_API } from "@/lib/clientReportingPortal";

export type FeedbackMessage = {
  id: number;
  author_type: "client" | "agency";
  author_user_id: number | null;
  body: string;
  created_at: string;
};

export type FeedbackThread = {
  id: number;
  kind: "comment" | "change_request";
  status: "open" | "resolved";
  profile_version: number;
  reporting_period: string;
  reporting_timezone: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by_user_id: number | null;
  messages: FeedbackMessage[];
};

export type ReportContext = {
  profile_version: number;
  reporting_period: string;
  timezone: string;
  start_date?: string;
  end_date?: string;
};

export type FeedbackThreadsResponse = ApiResult & {
  client_id?: number;
  threads?: FeedbackThread[];
};

function contextQuery(context: ReportContext): string {
  const params = new URLSearchParams({
    profile_version: String(context.profile_version),
    reporting_period: context.reporting_period,
    timezone: context.timezone,
  });
  if (context.start_date && context.end_date) {
    params.set("start_date", context.start_date);
    params.set("end_date", context.end_date);
  }
  return params.toString();
}

export function reportContextFromPreview(preview: {
  profile_version: number;
  reporting_period?: string;
  reporting_dates?: { start: string; end: string; timezone: string } | null;
}): ReportContext {
  const context: ReportContext = {
    profile_version: preview.profile_version,
    reporting_period: preview.reporting_period || "all_time",
    timezone: preview.reporting_dates?.timezone || "UTC",
  };
  if (preview.reporting_dates) {
    context.start_date = preview.reporting_dates.start;
    context.end_date = preview.reporting_dates.end;
  }
  return context;
}

export function contextPayload(context: ReportContext): Record<string, string | number> {
  const payload: Record<string, string | number> = {
    profile_version: context.profile_version,
    reporting_period: context.reporting_period,
    timezone: context.timezone,
  };
  if (context.start_date && context.end_date) {
    payload.start_date = context.start_date;
    payload.end_date = context.end_date;
  }
  return payload;
}

export async function fetchPortalFeedback(context: ReportContext): Promise<FeedbackThreadsResponse> {
  return apiGet<FeedbackThreadsResponse>(`${PORTAL_API}/feedback/threads?${contextQuery(context)}`);
}

export async function createPortalFeedback(
  kind: "comment" | "change_request",
  body: string,
  context: ReportContext,
): Promise<FeedbackThreadsResponse & { thread?: FeedbackThread }> {
  return apiPost(`${PORTAL_API}/feedback/threads`, { kind, body, ...contextPayload(context) });
}

export async function replyPortalFeedback(
  threadId: number,
  body: string,
): Promise<FeedbackThreadsResponse & { thread?: FeedbackThread }> {
  return apiPost(`${PORTAL_API}/feedback/threads/${threadId}/replies`, { body });
}

export async function fetchAdminFeedback(clientId: number): Promise<FeedbackThreadsResponse> {
  return apiGet<FeedbackThreadsResponse>(`${ADMIN_API}/${clientId}/portal/feedback/threads`);
}

export async function replyAdminFeedback(
  clientId: number,
  threadId: number,
  body: string,
): Promise<FeedbackThreadsResponse & { thread?: FeedbackThread }> {
  return apiPost(`${ADMIN_API}/${clientId}/portal/feedback/threads/${threadId}/replies`, { body });
}

export async function resolveAdminFeedback(
  clientId: number,
  threadId: number,
): Promise<FeedbackThreadsResponse & { thread?: FeedbackThread }> {
  return apiPost(`${ADMIN_API}/${clientId}/portal/feedback/threads/${threadId}/resolve`, {});
}
