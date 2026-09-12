import type { Client, Draft } from "@/lib/clientReporting";

export type ScheduleRow = {
  client_id: number;
  cadence: "weekly" | "monthly";
  timezone: string;
  send_time: string;
  format: Draft["default_format"];
  opted_in: boolean;
  paused: boolean;
  next_due_at: string;
  updated_at: string;
};

export type ScheduleDraft = {
  cadence: "weekly" | "monthly";
  timezone: string;
  send_time: string;
  format: Draft["default_format"];
  opt_in: boolean;
};

export type ScheduleResponse = { ok: true; client: Client; configured: boolean; schedule: ScheduleRow | null };

export type DeliveryRow = {
  id: number;
  window_key: string;
  status: "sent" | "failed" | "skipped";
  attempted_at: string;
  recipient_email: string | null;
  profile_version: number | null;
  format: Draft["default_format"] | null;
  error_code: string | null;
};

export type DeliveryHistoryResponse = {
  ok: true;
  client: Client;
  deliveries: DeliveryRow[];
  has_more: boolean;
  next_cursor: number | null;
};

export function defaultTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}

export function scheduleDraft(defaultFormat: Draft["default_format"]): ScheduleDraft {
  return { cadence: "weekly", timezone: defaultTimezone(), send_time: "09:00", format: defaultFormat, opt_in: false };
}

export function scheduleDraftError(draft: ScheduleDraft): string | null {
  if (!draft.opt_in) return "Explicit opt-in is required before enabling scheduled delivery.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.send_time)) return "Send time must use HH:MM (24-hour) format.";
  try { new Intl.DateTimeFormat("en-US", { timeZone: draft.timezone }).format(new Date()); }
  catch { return "Choose a valid timezone."; }
  return null;
}

export function validScheduleResponse(value: unknown, clientId: number): value is ScheduleResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as ScheduleResponse;
  if (row.ok !== true || row.client?.id !== clientId) return false;
  if (!row.configured && row.schedule === null) return true;
  const schedule = row.schedule;
  return !!schedule && schedule.client_id === clientId && ["weekly", "monthly"].includes(schedule.cadence)
    && ["pdf", "pptx", "xlsx"].includes(schedule.format) && typeof schedule.timezone === "string"
    && typeof schedule.send_time === "string";
}

function deliveryHistoryId(value: unknown): boolean {
  if (typeof value === "number") return Number.isInteger(value) && value > 0;
  if (typeof value === "string") return /^\d+$/.test(value) && Number(value) > 0;
  return false;
}

export function validDeliveryHistory(value: unknown, clientId: number): value is DeliveryHistoryResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as DeliveryHistoryResponse;
  return row.ok === true && row.client?.id === clientId && Array.isArray(row.deliveries)
    && row.deliveries.every((entry) => deliveryHistoryId(entry.id) && ["sent", "failed", "skipped"].includes(entry.status));
}

export function normalizeDeliveryHistory(deliveries: DeliveryHistoryResponse["deliveries"]): DeliveryRow[] {
  return deliveries.map((entry) => ({ ...entry, id: Number(entry.id) }));
}
