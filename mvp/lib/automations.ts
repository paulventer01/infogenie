import { randomUUID } from "node:crypto";
import type { AgencyAccount, AutomationRule, AutomationTrigger, AutomationAction } from "./types";

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  anomaly_cpa: "CPA anomaly fires",
  report_ready: "Weekly report finalized",
  approval_pending: "Approval waiting >24h",
  budget_overspend: "Budget overspend 20%+",
  schedule_weekly: "Every Monday 08:00",
};

export const ACTION_LABELS: Record<AutomationAction, string> = {
  notify_owner: "Notify account owner",
  pause_campaigns: "Pause flagged campaigns",
  generate_report: "Generate white-label report",
  request_approval: "Send for client approval",
  apply_budget_cap: "Apply daily budget cap",
};

export function defaultAutomations(agency: AgencyAccount): AutomationRule[] {
  const now = new Date().toISOString();
  return [
    {
      id: randomUUID(),
      name: "CPA spike → notify owner",
      clientId: "all",
      trigger: "anomaly_cpa",
      action: "notify_owner",
      enabled: true,
      createdAt: now,
    },
    {
      id: randomUUID(),
      name: "Monday report autopilot",
      clientId: "all",
      trigger: "schedule_weekly",
      action: "generate_report",
      enabled: false,
      createdAt: now,
    },
    {
      id: randomUUID(),
      name: "Final report → client approval",
      clientId: "all",
      trigger: "report_ready",
      action: "request_approval",
      enabled: true,
      createdAt: now,
    },
  ];
}

export function createAutomation(
  name: string,
  clientId: string | "all",
  trigger: AutomationTrigger,
  action: AutomationAction
): AutomationRule {
  return {
    id: randomUUID(),
    name,
    clientId,
    trigger,
    action,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

export function runAutomationOnce(
  agency: AgencyAccount,
  ruleId: string
): AgencyAccount {
  const now = new Date().toISOString();
  return {
    ...agency,
    automations: (agency.automations || []).map((r) =>
      r.id === ruleId ? { ...r, lastRunAt: now } : r
    ),
  };
}
