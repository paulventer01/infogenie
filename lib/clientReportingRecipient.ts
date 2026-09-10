import type { Client } from "@/lib/clientReporting";

export type Recipient = { client_id: number; email: string; enabled: boolean; updated_at: string };
export type RecipientResponse = { ok: true; client: Client; configured: boolean; recipient: Recipient | null };
export type RecipientDraft = { email: string; enabled: boolean };

const email = (value: unknown): value is string => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function validRecipientRow(value: unknown, clientId: number): value is Recipient {
  if (!value || typeof value !== "object") return false;
  const row = value as Recipient;
  return row.client_id === clientId && email(row.email) && typeof row.enabled === "boolean"
    && typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at));
}

export function validRecipientResponse(value: unknown, clientId: number): value is RecipientResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as RecipientResponse;
  return row.ok === true && row.client?.id === clientId && typeof row.configured === "boolean"
    && (row.recipient === null || validRecipientRow(row.recipient, clientId));
}

export function recipientDraftError(draft: RecipientDraft): string | null {
  if (!email(draft.email.trim().toLowerCase())) return "Enter a valid email address.";
  if (typeof draft.enabled !== "boolean") return "Choose whether delivery is enabled.";
  return null;
}
