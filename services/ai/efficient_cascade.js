/**
 * Efficient AI cascade — right-size models per surface, escalate only when needed.
 *
 * Poster analogue for InfoGenie (API-hosted LLMs, not self-hosted weights):
 *   fast  ≈ student / distilled path (mini, no high reasoning, lean context)
 *   strong ≈ teacher path (AutoClaw / analysis models, fuller context)
 *
 * Fail-open: plans always resolve; callers still get a usable call even if
 * escalate is skipped or strong path is unavailable.
 */

const FAST_SURFACES = new Set([
  'social_self_heal',
  'social_inbox_triage',
  'evergreen_winners',
  'caption_polish',
  'compose_assist',
  'inbox_reply_suggest',
  'writing',
]);

const STRONG_SURFACES = new Set([
  'autoclaw',
  'strategic_intelligence',
  'analysis',
  'decision_engine',
  'lead_intelligence',
  'aeo',
  'safe_agent',
]);

/** Default OpenAI-compatible models per tier (env-overridable). */
function fastModel() {
  return process.env.AI_FAST_MODEL || process.env.OPENAI_FAST_MODEL || 'gpt-4o-mini';
}

function strongModel() {
  return process.env.AI_STRONG_MODEL || process.env.OPENAI_STRONG_MODEL || 'gpt-4o';
}

/**
 * @param {{ category?: string, surface?: string, tier?: 'fast'|'strong'|'auto' }} input
 * @returns {{
 *   tier: 'fast'|'strong',
 *   model: string,
 *   useAutoclaw: boolean,
 *   reasoning_effort: string|undefined,
 *   contextLimit: number,
 *   max_tokens: number,
 *   useContextPack: boolean,
 *   timeoutMs: number,
 *   escalate_default: boolean,
 *   reason: string,
 * }}
 */
function resolveCascadePlan(input = {}) {
  const category = String(input.category || 'writing');
  const surface = String(input.surface || category);
  let tier = input.tier;

  if (tier !== 'fast' && tier !== 'strong') {
    if (STRONG_SURFACES.has(surface) || category === 'analysis') tier = 'strong';
    else if (FAST_SURFACES.has(surface) || category === 'writing') tier = 'fast';
    else tier = 'fast'; // default lean for unknown high-volume paths
  }

  if (tier === 'fast') {
    return {
      tier: 'fast',
      model: fastModel(),
      useAutoclaw: false,
      reasoning_effort: undefined,
      contextLimit: 3,
      max_tokens: 500,
      useContextPack: true,
      timeoutMs: 25000,
      escalate_default: true,
      reason: `fast path for surface=${surface}`,
    };
  }

  return {
    tier: 'strong',
    model: strongModel(),
    useAutoclaw: true,
    reasoning_effort: process.env.AI_STRONG_REASONING || 'high',
    contextLimit: 8,
    max_tokens: 1200,
    useContextPack: true,
    timeoutMs: 90000,
    escalate_default: false,
    reason: `strong path for surface=${surface}`,
  };
}

/**
 * Merge a cascade plan into chat_router opts without clobbering explicit caller overrides.
 */
function applyPlanToOpts(opts = {}, plan) {
  const out = { ...opts };
  if (opts.model == null) out.model = plan.model;
  if (opts.useAutoclaw == null) out.useAutoclaw = plan.useAutoclaw;
  if (opts.reasoning_effort == null && plan.reasoning_effort) out.reasoning_effort = plan.reasoning_effort;
  if (opts.contextLimit == null) out.contextLimit = plan.contextLimit;
  if (opts.max_tokens == null) out.max_tokens = plan.max_tokens;
  if (opts.useContextPack == null) out.useContextPack = plan.useContextPack;
  if (opts.timeoutMs == null) out.timeoutMs = plan.timeoutMs;
  out._cascade = plan;
  return out;
}

/**
 * Decide whether a fast-tier result should escalate to strong.
 * @param {{ content?: string, ok?: boolean }|null} result
 * @param {{ force?: boolean, minChars?: number, predicate?: function }|undefined} gate
 */
function shouldEscalate(result, gate = {}) {
  if (gate.force === true) return true;
  if (typeof gate.predicate === 'function') {
    try { return !!gate.predicate(result); } catch { return true; }
  }
  if (!result) return true;
  const content = String(result.content || '').trim();
  if (!content) return true;
  const minChars = gate.minChars != null ? gate.minChars : 8;
  if (content.length < minChars) return true;
  // Refusal / empty-ish patterns
  if (/^(i'?m sorry|as an ai|i cannot|unable to)/i.test(content)) return true;
  return false;
}

function cascadeStatus() {
  return {
    ready: true,
    note: 'Efficient cascade — fast models for high-volume surfaces; escalate to strong on weak results',
    fast_model: fastModel(),
    strong_model: strongModel(),
    fast_surfaces: [...FAST_SURFACES],
    strong_surfaces: [...STRONG_SURFACES],
  };
}

module.exports = {
  FAST_SURFACES,
  STRONG_SURFACES,
  resolveCascadePlan,
  applyPlanToOpts,
  shouldEscalate,
  cascadeStatus,
  fastModel,
  strongModel,
};
