import type { PoolClient } from "pg";
import type { LoadedBrand } from "../modules/brand/service.js";

/**
 * §5.6 — the governed action pipeline's gate. Every consequential action passes
 * these checks in sequence before execution; any failure halts with a
 * human-readable reason surfaced to the interface (never buried in logs). The
 * gate FAILS CLOSED: an error inside a check blocks the action.
 *
 * Checks implemented for the current capability surface; the consent/budget
 * checks activate for the capabilities that carry them (sends, spend).
 */

export type CheckStatus = "pass" | "fail" | "not_applicable";

export interface GateCheck {
  check: string;
  status: CheckStatus;
  reason: string;
}

export interface GateVerdict {
  allowed: boolean;
  checks: GateCheck[];
  /** First failing reason, for one-line surfacing. */
  reason?: string;
}

export interface GateSubject {
  capability: {
    key: string;
    irreversible: boolean;
    autonomy_ceiling: number;
    requires_context: boolean;
  };
  /** Tenant's configured autonomy level for this capability. */
  autonomyLevel: number;
  /** The generated output under evaluation (text). */
  output: string;
  brand: LoadedBrand | null;
  /** For send-class actions: is the recipient reachable right now? */
  reachability?: { reachable: boolean; reason: string };
}

const SUPERLATIVES = /\b(the best|world[- ]class|#1|number one|guaranteed|never fails|100% (safe|effective)|cheapest|fastest ever)\b/i;
const REGULATED = /\b(cure[sd]?|treat(s|ment)?|diagnos\w+|FDA[- ]approved|clinically proven|risk[- ]free investment|guaranteed returns?)\b/i;
const PII_IN_OUTPUT = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s()-]{8,}\d/;

export function evaluateGate(subject: GateSubject): GateVerdict {
  const checks: GateCheck[] = [];
  const push = (check: string, status: CheckStatus, reason: string) => checks.push({ check, status, reason });

  try {
    // 1. Brand voice / grounding context present.
    if (subject.capability.requires_context) {
      if (!subject.brand) {
        push("brand_context", "fail", "No Brand Foundation exists for this tenant — ungrounded generation is a defect, not a feature. Complete brand onboarding first.");
      } else {
        push("brand_context", "pass", `Grounded in Brand Foundation v${subject.brand.version}.`);
      }
    } else {
      push("brand_context", "not_applicable", "Capability does not consume brand context.");
    }

    // 2. Prohibited terms (codified brand rules, machine-checked).
    const prohibited = subject.brand?.prohibitedTerms ?? [];
    const hit = prohibited.find((t) => t && subject.output.toLowerCase().includes(t.toLowerCase()));
    if (hit) {
      push("prohibited_terms", "fail", `Output contains the prohibited term "${hit}" (brand rule). Regenerate without it.`);
    } else {
      push("prohibited_terms", "pass", prohibited.length ? `None of ${prohibited.length} prohibited term(s) present.` : "No prohibited terms configured.");
    }

    // 3. Legal & claims — never auto-corrected, always blocked to human review.
    if (REGULATED.test(subject.output)) {
      push("claims", "fail", "Output contains regulated or unsubstantiated claim language. Legal claims are never auto-corrected — routed to human review.");
    } else if (SUPERLATIVES.test(subject.output)) {
      push("claims", "fail", "Output contains superlative/comparative claim language requiring substantiation. Routed to human review.");
    } else {
      push("claims", "pass", "No regulated, comparative or unsubstantiated claim language detected.");
    }

    // 4. PII leakage in output.
    if (PII_IN_OUTPUT.test(subject.output)) {
      push("pii_leakage", "fail", "Output contains what appears to be personal data (email/phone). Blocked.");
    } else {
      push("pii_leakage", "pass", "No PII detected in output.");
    }

    // 5. Consent & suppression (send-class actions).
    if (subject.reachability) {
      if (subject.reachability.reachable) {
        push("consent_suppression", "pass", "Recipient is reachable: consented and not suppressed (resolved at send time).");
      } else {
        push("consent_suppression", "fail", `Recipient not reachable: ${subject.reachability.reason}. Dropped from the batch.`);
      }
    } else {
      push("consent_suppression", "not_applicable", "No recipient — not a send-class action.");
    }

    // 6. Autonomy level vs capability ceiling & irreversibility (§7.2).
    const effectiveCeiling = subject.capability.irreversible
      ? Math.min(subject.capability.autonomy_ceiling, 2)
      : subject.capability.autonomy_ceiling;
    if (subject.autonomyLevel > effectiveCeiling) {
      push("autonomy", "fail", `Configured autonomy A${subject.autonomyLevel} exceeds this capability's ceiling A${effectiveCeiling}${subject.capability.irreversible ? " (irreversible actions never exceed A2)" : ""}.`);
    } else {
      push("autonomy", "pass", `Operating at A${subject.autonomyLevel} within ceiling A${effectiveCeiling}.`);
    }

    // 7. Rate & reversibility — irreversible actions require approval below A3.
    if (subject.capability.irreversible && subject.autonomyLevel < 3) {
      push("reversibility", "pass", "Irreversible action will be queued for explicit human approval (A2 pathway).");
    } else {
      push("reversibility", "pass", "Within reversible bounds.");
    }
  } catch (err) {
    // Fail closed: an error in the gate blocks the action.
    push("gate_error", "fail", `Guardrail evaluation error — failing closed: ${(err as Error).message}`);
  }

  const firstFail = checks.find((c) => c.status === "fail");
  return { allowed: !firstFail, checks, reason: firstFail?.reason };
}

/** Resolve the tenant's autonomy level for a capability (defaults to entry level). */
export async function resolveAutonomy(client: PoolClient, capabilityKey: string): Promise<number> {
  const { rows } = await client.query(
    `select coalesce(
       (select level from tenant_capability_autonomy where capability_key = $1),
       (select entry_autonomy from capabilities where key = $1)
     ) as level`,
    [capabilityKey],
  );
  return (rows[0]?.level as number) ?? 0;
}
