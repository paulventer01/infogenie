import { randomUUID } from "node:crypto";
import type { AgencyAccount, ApprovalItem, ClientWorkspace } from "./types";

export function createApprovalFromDraft(
  client: ClientWorkspace,
  draftId: string
): ApprovalItem | null {
  const draft = client.drafts.find((d) => d.id === draftId);
  if (!draft) return null;
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    clientId: client.id,
    kind: "draft",
    refId: draft.id,
    title: draft.title,
    preview: draft.body.slice(0, 600),
    status: "pending",
    shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    createdAt: now,
    updatedAt: now,
  };
}

export function createApprovalFromCampaign(
  client: ClientWorkspace,
  campaignId: string
): ApprovalItem | null {
  const campaign = client.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return null;
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    clientId: client.id,
    kind: "campaign",
    refId: campaign.id,
    title: campaign.name,
    preview: `${campaign.objective} · ${campaign.channels.join(", ")}\n\n${campaign.landingHeadline}\n${campaign.landingBody}`,
    status: "pending",
    shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    createdAt: now,
    updatedAt: now,
  };
}

export function createApprovalFromReport(client: ClientWorkspace): ApprovalItem | null {
  if (!client.weeklyReport) return null;
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    clientId: client.id,
    kind: "report",
    refId: client.weeklyReport.id,
    title: `Weekly report — ${client.name}`,
    preview: client.weeklyReport.narrative.slice(0, 800),
    status: "pending",
    shareToken: randomUUID().replace(/-/g, "").slice(0, 16),
    createdAt: now,
    updatedAt: now,
  };
}

export function decideApproval(
  item: ApprovalItem,
  status: "approved" | "changes_requested",
  note?: string
): ApprovalItem {
  const now = new Date().toISOString();
  return {
    ...item,
    status,
    note: note || item.note,
    updatedAt: now,
    decidedAt: now,
  };
}

export function allApprovals(agency: AgencyAccount): (ApprovalItem & { clientName: string })[] {
  return agency.clients
    .flatMap((c) => (c.approvals || []).map((a) => ({ ...a, clientName: c.name })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function findApprovalByToken(
  agency: AgencyAccount,
  token: string
): { client: ClientWorkspace; item: ApprovalItem } | null {
  for (const client of agency.clients) {
    const item = (client.approvals || []).find((a) => a.shareToken === token);
    if (item) return { client, item };
  }
  return null;
}
