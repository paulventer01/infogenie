import { withTenant } from "../../db/tenantContext.js";
import { loadCurrentBrand } from "../brand/service.js";
import { gatewayCall, type ModelClass } from "../../gateway/llmGateway.js";
import { evaluateGate, resolveAutonomy, type GateVerdict } from "../../gate/guardrailGate.js";
import { appendWith } from "../audit/service.js";
import { fetchEvidence } from "../integrations/hub.js";
import { ENGINES, type EngineContext } from "./archetypes.js";
import type { CatalogEntry } from "./catalog.js";

/**
 * The governed capability runner — the spine of the platform (§5.5 + §5.6
 * composed). Every AI capability executes through this path:
 *
 *   1. Load capability registration (registry — Block 5)
 *   2. Load Brand Foundation (context — Block 2); refuse to run ungrounded
 *      when the capability requires context
 *   3. Assemble the grounded prompt and call the LLM gateway (Block 3)
 *   4. Evaluate the guardrail gate on the output (§5.6, fails closed)
 *   5. Record the action with the gate verdict:
 *        - gate failed            → blocked
 *        - autonomy < A3          → pending_approval (human disposes)
 *        - autonomy ≥ A3, allowed → executed (bounded autonomy)
 *   6. Append the audit record — atomically with the action
 *
 * Registering a new feature = a capability row + a prompt template + a call
 * into this runner. That is what makes the 130-feature surface a scale loop
 * rather than 130 bespoke builds.
 */

export interface RunInput {
  capabilityKey: string;
  /** The user's brief / request — treated as untrusted input. */
  brief: string;
  /** Extra template variables (e.g. format). */
  vars?: Record<string, string>;
  modelClass?: ModelClass;
  actor: { actorType: "user" | "agent"; actorId?: string };
  /** Deterministic mock used when the gateway has no live credential. */
  mock?: (ctx: { company: string | null; brief: string }) => string;
}

export interface RunResult {
  actionId: string;
  status: "pending_approval" | "executed" | "blocked";
  output: string | null;
  gate: GateVerdict;
  autonomyLevel: number;
  mode: "live" | "mock";
  brandVersion: number | null;
}

export async function runCapability(tenantId: string, input: RunInput): Promise<RunResult> {
  return withTenant(tenantId, async (client) => {
    // 1. Capability registration.
    const capRes = await client.query(
      `select key, name, domain, archetype, irreversible, autonomy_ceiling, requires_context, description
         from capabilities where key = $1`,
      [input.capabilityKey],
    );
    if (capRes.rowCount === 0) {
      throw new Error(`Unknown capability: ${input.capabilityKey}. Register it in the capability registry first (Appendix A).`);
    }
    const capability = capRes.rows[0];

    // 2. Context — Brand Foundation.
    const brand = await loadCurrentBrand(client);
    const autonomyLevel = await resolveAutonomy(client, input.capabilityKey);

    if (capability.requires_context && !brand) {
      // Refuse to generate ungrounded; record the blocked action + audit.
      const gate: GateVerdict = {
        allowed: false,
        reason: "No Brand Foundation exists for this tenant — ungrounded generation is a defect, not a feature. Complete brand onboarding first.",
        checks: [{ check: "brand_context", status: "fail", reason: "No Brand Foundation for tenant." }],
      };
      const blocked = await client.query(
        `insert into actions (tenant_id, capability_key, status, autonomy_level, gate, input, created_by)
         values (app_current_tenant(), $1, 'blocked', $2, $3, $4, $5) returning id`,
        [input.capabilityKey, autonomyLevel, JSON.stringify(gate), JSON.stringify({ brief: input.brief }), input.actor.actorId ?? null],
      );
      await appendWith(client, {
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action: `${input.capabilityKey}.blocked`,
        resourceType: "action",
        resourceId: blocked.rows[0].id,
        evidence: { reason: gate.reason },
        outcome: "blocked",
      });
      return { actionId: blocked.rows[0].id, status: "blocked", output: null, gate, autonomyLevel, mode: "mock", brandVersion: null };
    }

    // 3. Retrieval evidence from bound integrations (§5.5 steps 2–3) — external
    // content, so it travels the gateway's untrusted channel.
    const evidence = await fetchEvidence(client, input.capabilityKey, input.brief.slice(0, 140));
    const evidenceSummary = evidence.map((e) => `- [${e.provider}] ${e.text}`).join("\n");

    // 4. Prompt assembly: explicit versioned template if one exists, otherwise
    // the capability's archetype engine (the reuse boundary of §5.1).
    const engine = ENGINES[capability.archetype as CatalogEntry["archetype"]] ?? ENGINES.knowledge;
    const engineCtx: EngineContext = {
      feature: {
        key: capability.key, name: capability.name, domain: capability.domain,
        archetype: capability.archetype, description: capability.description ?? "",
      },
      company: brand?.companyName ?? null,
      brief: input.brief,
      evidenceSummary,
    };
    const tplRes = await client.query(
      `select template, version from prompt_templates where key = $1 and is_current`,
      [input.capabilityKey],
    );
    const template: string | undefined = tplRes.rows[0]?.template;
    const systemBody = template
      ? template
          .replaceAll("{{company}}", brand?.companyName ?? "the client")
          .replaceAll("{{capability}}", capability.name)
          .replaceAll("{{format}}", input.vars?.format ?? "the requested output")
      : engine.system(engineCtx);
    const system = [
      systemBody,
      brand ? `\n<brand_context version="${brand.version}">\n${brand.contextBlock}\n</brand_context>` : "",
    ].join("\n");

    const gw = await gatewayCall(client, {
      capabilityKey: input.capabilityKey,
      purpose: input.vars?.format ?? capability.archetype,
      modelClass: input.modelClass ?? "frontier",
      system,
      prompt: "Complete the brief below.",
      untrustedInput: input.brief,
      untrustedEvidence: evidence.map((e) => ({ source: e.provider, text: e.text })),
      mock: () => (input.mock ? input.mock({ company: brand?.companyName ?? null, brief: input.brief }) : engine.mock(engineCtx)),
    });

    // 5. Guardrail gate on the output.
    const gate = evaluateGate({
      capability,
      autonomyLevel,
      output: gw.text,
      brand,
    });

    // 6. Decide the action status.
    const status: RunResult["status"] = !gate.allowed ? "blocked" : autonomyLevel >= 3 ? "executed" : "pending_approval";

    const action = await client.query(
      `insert into actions (tenant_id, capability_key, status, autonomy_level, gate, input, output, model_call_id, created_by)
       values (app_current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        input.capabilityKey,
        status,
        autonomyLevel,
        JSON.stringify(gate),
        JSON.stringify({ brief: input.brief, vars: input.vars ?? {} }),
        JSON.stringify({ text: gate.allowed ? gw.text : null, injectionFlagged: gw.injectionFlagged }),
        gw.modelCallId,
        input.actor.actorId ?? null,
      ],
    );

    // 7. Audit — atomic with the action.
    await appendWith(client, {
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      action: `${input.capabilityKey}.${status}`,
      resourceType: "action",
      resourceId: action.rows[0].id,
      evidence: {
        brandVersion: brand?.version ?? null,
        modelCallId: gw.modelCallId,
        mode: gw.mode,
        injectionFlagged: gw.injectionFlagged,
        gateReason: gate.reason ?? "all checks passed",
      },
      outcome: status,
    });

    return {
      actionId: action.rows[0].id,
      status,
      output: gate.allowed ? gw.text : null,
      gate,
      autonomyLevel,
      mode: gw.mode,
      brandVersion: brand?.version ?? null,
    };
  });
}

/** Approve a pending action (the human-disposes half of A0–A2 operation). */
export async function approveAction(
  tenantId: string,
  actionId: string,
  approver: { actorId: string },
): Promise<{ status: string }> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `update actions set status = 'executed', approved_by = $2, decided_at = now()
        where id = $1 and status = 'pending_approval'
        returning id, capability_key`,
      [actionId, approver.actorId],
    );
    if (rows.length === 0) throw new Error("Action not found or not pending approval in this tenant.");
    await appendWith(client, {
      actorType: "user",
      actorId: approver.actorId,
      action: `${rows[0].capability_key}.approved`,
      resourceType: "action",
      resourceId: actionId,
      approval: { approvedBy: approver.actorId },
      outcome: "executed",
    });
    return { status: "executed" };
  });
}
