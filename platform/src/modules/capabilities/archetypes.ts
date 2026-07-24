import type { CatalogEntry } from "./catalog.js";

/**
 * Archetype engines (§5.1) — the reuse boundary that makes 124 features a
 * scale loop. Each of the six archetypes defines HOW a class of capability
 * executes: the shape of its system prompt and the shape of its output. A
 * feature parameterises an engine (name, description, evidence, brief); it
 * does not get bespoke execution code.
 *
 * The mock generators mirror the live prompt contracts so the offline path
 * produces plausible, feature-true output — and, deliberately, they echo the
 * brief's subject the way a naive model would, so the guardrail gate always
 * has real work to do.
 */

export interface EngineContext {
  feature: Pick<CatalogEntry, "key" | "name" | "domain" | "archetype" | "description">;
  company: string | null;
  brief: string;
  /** Rendered retrieval evidence (already delimited/untrusted at the gateway). */
  evidenceSummary: string;
}

export interface ArchetypeEngine {
  /** System-prompt body (brand context + evidence are appended by the runner). */
  system: (ctx: EngineContext) => string;
  /** Deterministic offline generator. */
  mock: (ctx: EngineContext) => string;
}

const subjectOf = (brief: string) =>
  brief
    .replace(/^(write|draft|create|make|generate|produce|run|analyse|analyze|scan|audit|plan|build)\s+(a|an|the)?\s*/i, "")
    .replace(/[.?!]\s*$/, "")
    .trim() || "the requested subject";

const base = (ctx: EngineContext, role: string, rules: string) =>
  `You are the "${ctx.feature.name}" capability (${ctx.feature.domain} domain) for ${ctx.company ?? "the client"}. ${role}
Capability contract: ${ctx.feature.description}
${rules}
Ground every claim in the brand context and retrieved evidence provided. Do not invent facts. Do not make comparative, superlative, or regulated claims. Uncertainty must be stated, not papered over.`;

export const ENGINES: Record<CatalogEntry["archetype"], ArchetypeEngine> = {
  content_generation: {
    system: (ctx) =>
      base(ctx, "Produce publish-ready marketing content that is unmistakably in this brand's voice.",
        "Match the brand voice exactly. Prefer concrete, verifiable statements over hype."),
    mock: (ctx) => {
      const s = subjectOf(ctx.brief);
      return `${s.charAt(0).toUpperCase() + s.slice(1)} — from ${ctx.company ?? "the client"}. ${ctx.evidenceSummary ? "Drawing on current signals: " + ctx.evidenceSummary.split("\n")[0] : ""}\n\nHonest, on-brand copy: made to last, priced fairly, and explained without hype.`;
    },
  },
  knowledge: {
    system: (ctx) =>
      base(ctx, "Assemble a structured knowledge answer from the retrieved evidence.",
        "Cite which evidence line supports each point. Where evidence conflicts, surface the conflict rather than resolving it silently."),
    mock: (ctx) => {
      const s = subjectOf(ctx.brief);
      return `${ctx.feature.name}: ${s}\n\nKey findings (from retrieved evidence):\n${ctx.evidenceSummary || "- No provider evidence bound to this capability; answer limited to supplied context."}\n\nAssessment: signals are consistent; confidence moderate. Conflicting or missing data is flagged above rather than smoothed over.`;
    },
  },
  analysis: {
    system: (ctx) =>
      base(ctx, "Perform the quantitative/qualitative analysis this capability owns and report it decision-grade.",
        "Express findings with an explicit confidence band and the evidence base (sample size, window, source count). A point estimate without an interval is a defect (§7.9)."),
    mock: (ctx) => {
      const s = subjectOf(ctx.brief);
      return `${ctx.feature.name} — analysis of ${s}\n\nEvidence base:\n${ctx.evidenceSummary || "- internal data only"}\n\nFinding: directionally positive movement on the primary metric.\nConfidence: 68–80% (moderate; single-window observation, ${ctx.evidenceSummary ? "multi-source" : "single-source"}).\nRecommended action: monitor one more cycle before committing budget; this finding is not decision-grade until validated against outcomes.`;
    },
  },
  planning: {
    system: (ctx) =>
      base(ctx, "Turn the brief into an executable, sequenced plan with owners and bounds.",
        "Every step names what runs, in which channel, within what limit (budget, volume, or rate). Steps that act on the outside world are marked for approval."),
    mock: (ctx) => {
      const s = subjectOf(ctx.brief);
      return `${ctx.feature.name} — plan for ${s}\n\n1. Ground: pull current signals (${ctx.evidenceSummary ? "evidence attached" : "no providers bound"}) and confirm audience.\n2. Draft: generate variants through Content Generation (A1 — human approves).\n3. Stage: schedule within declared bounds; outward steps queue for approval (never auto-execute above A2).\n4. Measure: outcomes return to the engine as labelled data.\n\nBounds: no spend or send occurs from this plan without an approved action.`;
    },
  },
  operations: {
    system: (ctx) =>
      base(ctx, "Execute the operational task and report exactly what was done or prepared.",
        "Report is factual and complete: inputs, what would change in the external system, and the reversal path. Destructive or outward effects require the approval pathway."),
    mock: (ctx) => {
      const s = subjectOf(ctx.brief);
      return `${ctx.feature.name} — operation prepared for ${s}\n\nInput signals:\n${ctx.evidenceSummary || "- none bound"}\n\nPrepared result: operation staged successfully. Outward effect (if any) is held behind the approval gate; reversal path documented.`;
    },
  },
  localisation: {
    system: (ctx) =>
      base(ctx, "Adapt the supplied content across languages, markets and cultural contexts without losing brand voice.",
        "Meaning over literalism. Flag culturally sensitive elements instead of silently transforming them."),
    mock: (ctx) => {
      const s = subjectOf(ctx.brief);
      return `${ctx.feature.name} — localisation of ${s}\n\nAdapted for the target market with brand voice preserved. Culturally sensitive phrasing flagged for human review rather than auto-resolved.`;
    },
  },
};
