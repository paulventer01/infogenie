// test/ai-governance.test.js — governance unit tests (updated for PR10H.1)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ACTION_TIERS,
  defaultPolicy,
  applyPreset,
  resolveTier,
  mapActionToTierKey,
  PLATFORM_MODE,
  PLATFORM_CONTENT_SAFETY_MODE,
} = require('../services/ai_governance/policy');
const { scanOutput } = require('../services/ai_governance/output_gate');
const { govern } = require('../services/ai_governance/orchestrator');
const { governSafe } = require('../services/ai_governance/hooks');

describe('AI Governance defaults', () => {
  it('platform action mode remains shadow-first', () => {
    assert.equal(PLATFORM_MODE, 'shadow');
  });

  it('platform content safety default is enforce', () => {
    assert.equal(PLATFORM_CONTENT_SAFETY_MODE, 'enforce');
  });

  it('new tenant default policy is enforce content safety + shadow actions', () => {
    const p = defaultPolicy(1);
    assert.equal(p.content_safety_mode, 'enforce');
    assert.equal(p.default_mode, 'shadow');
    assert.equal(p.risk_appetite, 'aggressive');
    assert.equal(p.require_context, false);
    assert.equal(p.block_on_caution, false);
  });

  it('default tiers: generate/apply/send/publish auto; launch/budget suggest', () => {
    assert.equal(DEFAULT_ACTION_TIERS.generate_content, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.launch_campaign, 'suggest');
    assert.equal(DEFAULT_ACTION_TIERS.scale_budget, 'suggest');
  });

  it('aggressive preset keeps action shadow + content enforce', () => {
    const a = applyPreset('aggressive');
    assert.equal(a.default_mode, 'shadow');
    assert.equal(a.content_safety_mode, 'enforce');
    assert.equal(a.action_tiers.apply_calendar, 'auto');
  });

  it('maps spine apply to apply_calendar tier', () => {
    assert.equal(mapActionToTierKey('marketing_spine', 'apply_calendar'), 'apply_calendar');
    const { tier } = resolveTier(defaultPolicy(1), 'marketing_spine', 'apply_calendar');
    assert.equal(tier, 'auto');
  });
});

describe('AI Governance orchestrator (action shadow + content enforce)', () => {
  it('content generation block verdict stops output under enforce', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'content_ai',
      action: 'generate_content',
      failClosed: true,
      payload: { text: 'test', __force_brand_safety_block: true },
    });
    assert.equal(result.allowed, false);
    assert.equal(result.proceeded, false);
    assert.equal(result.status, 'blocked');
  });

  it('spine apply under defaults → no pending_review', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'marketing_spine',
      action: 'apply',
      payload: { title: 'calendar apply' },
    });
    assert.equal(result.proceeded, true);
    assert.equal(result.executionTier, 'auto');
    assert.notEqual(result.status, 'pending_review');
  });

  it('shadow + launch_campaign suggest → still succeeds (soft cue)', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'safe_agent',
      action: 'launch_campaign',
      payload: { title: 'Launch Meta ads' },
    });
    assert.equal(result.proceeded, true);
    assert.equal(result.allowed, true);
    assert.equal(result.executionTier, 'suggest');
    assert.equal(result.softCue, true);
    assert.notEqual(result.status, 'pending_review');
  });

  it('governSafe on spine still fails open', async () => {
    const orchPath = require.resolve('../services/ai_governance/orchestrator');
    const cached = require.cache[orchPath];
    const realGovern = cached.exports.govern;
    cached.exports.govern = async () => { throw new Error('orchestrator_down'); };
    try {
      const result = await governSafe({
        tenantId: null,
        surface: 'marketing_spine',
        action: 'apply',
      });
      assert.equal(result.allowed, true);
      assert.equal(result.proceeded, true);
      assert.equal(result.degraded, true);
    } finally {
      cached.exports.govern = realGovern;
    }
  });
});

describe('output gate', () => {
  it('claim caution does not equal block alone when no block rules hit', () => {
    const g = scanOutput({ text: 'We saw 340% ROAS last quarter' });
    assert.equal(g.verdict, 'caution');
    assert.ok(g.warnings.length >= 1);
  });

  it('forced brand-safety block is a block verdict', () => {
    const g = scanOutput({ text: 'hi', __force_brand_safety_block: true });
    assert.equal(g.verdict, 'block');
  });
});
