/**
 * AI Governance policy — non-restrictive defaults are HARD REQUIREMENTS.
 * Platform default mode is always shadow; enforce is tenant opt-in only.
 */

// H1: platform default is always shadow — enforce is tenant opt-in via Hub UI only.
const PLATFORM_MODE = 'shadow';

const FAIL_OPEN = process.env.AI_GOVERNANCE_FAIL_OPEN !== '0';
const BLOCK_ON_CAUTION_ENV = process.env.AI_GOVERNANCE_BLOCK_ON_CAUTION === '1';
const REQUIRE_CONTEXT_ENV = process.env.AI_GOVERNANCE_REQUIRE_CONTEXT === '1';
const DEFAULT_APPETITE = process.env.AI_GOVERNANCE_DEFAULT_APPETITE || 'aggressive';

/** Default action tiers — matches docs/ai-governance-build-spec.md §0 */
const DEFAULT_ACTION_TIERS = Object.freeze({
  generate_content: 'auto',
  generate_brief: 'auto',
  generate_decision: 'auto',
  generate_analysis: 'auto',
  spine_suggest: 'auto',
  apply_calendar: 'auto',
  send_email: 'auto',
  publish_social: 'auto',
  crm_push: 'auto',
  launch_campaign: 'suggest',
  scale_budget: 'suggest',
});

const ACTION_TIER_KEYS = Object.keys(DEFAULT_ACTION_TIERS);

const PRESETS = Object.freeze({
  aggressive: {
    id: 'aggressive',
    label: 'Aggressive (default)',
    risk_appetite: 'aggressive',
    default_mode: 'shadow',
    block_on_caution: false,
    require_context: false,
    action_tiers: { ...DEFAULT_ACTION_TIERS },
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    risk_appetite: 'balanced',
    default_mode: 'shadow',
    block_on_caution: false,
    require_context: false,
    action_tiers: {
      ...DEFAULT_ACTION_TIERS,
      send_email: 'suggest',
      publish_social: 'suggest',
    },
  },
  conservative: {
    id: 'conservative',
    label: 'Conservative',
    risk_appetite: 'conservative',
    default_mode: 'shadow', // still shadow until tenant explicitly enables enforce
    block_on_caution: false,
    require_context: false,
    action_tiers: {
      ...DEFAULT_ACTION_TIERS,
      send_email: 'suggest',
      publish_social: 'suggest',
      crm_push: 'suggest',
    },
  },
});

function _normalizeTiers(raw) {
  const out = { ...DEFAULT_ACTION_TIERS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of ACTION_TIER_KEYS) {
    const v = raw[key];
    if (v === 'auto' || v === 'suggest' || v === 'block') out[key] = v;
  }
  return out;
}

function defaultPolicy(tenantId) {
  return {
    id: null,
    tenant_id: tenantId ?? null,
    default_mode: PLATFORM_MODE, // always 'shadow'
    risk_appetite: DEFAULT_APPETITE === 'balanced' || DEFAULT_APPETITE === 'conservative'
      ? DEFAULT_APPETITE
      : 'aggressive',
    action_tiers: { ...DEFAULT_ACTION_TIERS },
    block_on_caution: BLOCK_ON_CAUTION_ENV, // env opt-in only; default false
    require_context: REQUIRE_CONTEXT_ENV,   // env opt-in only; default false
    policy_document: '',
    policy_version: 1,
    ethics_contact: null,
    updated_by: null,
    updated_at: null,
    preset: 'aggressive',
    platform: {
      mode_env: process.env.AI_GOVERNANCE_MODE || 'shadow',
      fail_open: FAIL_OPEN,
      block_on_caution_env: BLOCK_ON_CAUTION_ENV,
      require_context_env: REQUIRE_CONTEXT_ENV,
    },
  };
}

function applyPreset(presetId) {
  const p = PRESETS[presetId] || PRESETS.aggressive;
  return {
    risk_appetite: p.risk_appetite,
    default_mode: p.default_mode,
    block_on_caution: p.block_on_caution,
    require_context: p.require_context,
    action_tiers: { ...p.action_tiers },
    preset: p.id,
  };
}

function mapActionToTierKey(surface, action) {
  const s = String(surface || '').toLowerCase();
  const a = String(action || '').toLowerCase();
  if (a === 'apply' || a === 'apply_calendar' || s.includes('spine') || s.includes('calendar')) {
    if (a.includes('launch')) return 'launch_campaign';
    if (a.includes('scale') || a.includes('budget')) return 'scale_budget';
    if (a === 'suggest' || a === 'spine_suggest') return 'spine_suggest';
    return 'apply_calendar';
  }
  if (a.includes('launch') || s.includes('launch')) return 'launch_campaign';
  if (a.includes('budget') || a.includes('scale')) return 'scale_budget';
  if (a.includes('email') || s.includes('email')) return 'send_email';
  if (a.includes('publish') || a.includes('social') || s.includes('social')) return 'publish_social';
  if (a.includes('crm') || s.includes('crm')) return 'crm_push';
  if (a.includes('brief') || s.includes('brief')) return 'generate_brief';
  if (a.includes('decision') || s.includes('decision')) return 'generate_decision';
  if (a.includes('analys') || s.includes('analys')) return 'generate_analysis';
  if (a.startsWith('generate') || a === 'generate') return 'generate_content';
  if (a === 'suggest') return 'spine_suggest';
  return 'generate_content';
}

function resolveTier(policy, surface, action) {
  const key = mapActionToTierKey(surface, action);
  const tiers = policy?.action_tiers || DEFAULT_ACTION_TIERS;
  return { key, tier: tiers[key] || 'auto' };
}

module.exports = {
  PLATFORM_MODE,
  FAIL_OPEN,
  DEFAULT_ACTION_TIERS,
  ACTION_TIER_KEYS,
  PRESETS,
  defaultPolicy,
  applyPreset,
  _normalizeTiers,
  mapActionToTierKey,
  resolveTier,
};
