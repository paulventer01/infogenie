import type { Client, Draft } from "@/lib/clientReporting";

export type RecipientResponse = { ok: true; client: Client; profile_version: number; format: Draft["default_format"];
  recipient: { email: string; source: "weekly_report_sub"; brand: string } };
export type EmailResponse = { ok: true; sent: true; recipient: string; format: Draft["default_format"]; profile_version: number };

const email = (value: unknown): value is string => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function validRecipient(value: unknown, clientId: number, version: number, format: string): value is RecipientResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as RecipientResponse;
  return row.ok === true && row.client?.id === clientId && row.profile_version === version && row.format === format
    && email(row.recipient?.email) && row.recipient.source === "weekly_report_sub"
    && typeof row.recipient.brand === "string" && row.recipient.brand.length > 0;
}
