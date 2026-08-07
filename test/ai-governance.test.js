// test/ai-governance.test.js — §15 acceptance tests (non-restrictive)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ACTION_TIERS,
  defaultPolicy,
  applyPreset,
  resolveTier,
  mapActionToTierKey,
  PLATFORM_MODE,
} = require('../services/ai_governance/policy');
const { scanOutput } = require('../services/ai_governance/output_gate');
const { govern } = require('../services/ai_governance/orchestrator');

describe('AI Governance defaults (non-restrictive)', () => {
  it('platform mode is always shadow', () => {
    assert.equal(PLATFORM_MODE, 'shadow');
  });

  it('new tenant default policy is shadow + aggressive + soft gates off', () => {
    const p = defaultPolicy(1);
    assert.equal(p.default_mode, 'shadow');
    assert.equal(p.risk_appetite, 'aggressive');
    assert.equal(p.require_context, false);
    assert.equal(p.block_on_caution, false);
  });

  it('default tiers: generate/apply/send/publish auto; launch/budget suggest', () => {
    assert.equal(DEFAULT_ACTION_TIERS.generate_content, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.generate_brief, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.generate_decision, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.generate_analysis, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.apply_calendar, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.send_email, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.publish_social, 'auto');
    assert.equal(DEFAULT_ACTION_TIERS.launch_campaign, 'suggest');
    assert.equal(DEFAULT_ACTION_TIERS.scale_budget, 'suggest');
  });

  it('aggressive preset matches ship posture', () => {
    const a = applyPreset('aggressive');
    assert.equal(a.default_mode, 'shadow');
    assert.equal(a.action_tiers.apply_calendar, 'auto');
    assert.equal(a.action_tiers.launch_campaign, 'suggest');
  });

  it('maps spine apply to apply_calendar tier', () => {
    assert.equal(mapActionToTierKey('marketing_spine', 'apply_calendar'), 'apply_calendar');
    const { tier } = resolveTier(defaultPolicy(1), 'marketing_spine', 'apply_calendar');
    assert.equal(tier, 'auto');
  });
});

describe('AI Governance orchestrator (shadow never blocks)', () => {
  it('mode=shadow + brand-safety block verdict → still succeeds', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'marketing_spine',
      action: 'apply_calendar',
      payload: { title: 'test', __force_brand_safety_block: true },
    });
    assert.equal(result.allowed, true);
    assert.equal(result.proceeded, true);
    assert.equal(result.mode, 'shadow');
    assert.notEqual(result.status, 'pending_review');
    assert.notEqual(result.status, 'blocked');
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

  it('govern() throws → fail-open + governance_degraded', async () => {
    const orchPath = require.resolve('../services/ai_governance/orchestrator');
    const cached = require.cache[orchPath];
    const realGovern = cached.exports.govern;
    cached.exports.govern = async () => { throw new Error('orchestrator_down'); };
    try {
      const { governSafe } = require('../services/ai_governance/hooks');
      const result = await governSafe({
        tenantId: null,
        surface: 'test',
        action: 'generate',
      });
      assert.equal(result.allowed, true);
      assert.equal(result.proceeded, true);
      assert.equal(result.degraded, true);
      assert.ok(result.warnings.includes('governance_degraded'));
    } finally {
      cached.exports.govern = realGovern;
    }

    // Force an internal throw by patching output gate
    const gatePath = require.resolve('../services/ai_governance/output_gate');
    const gateCached = require.cache[gatePath];
    const realScan = gateCached.exports.scanOutput;
    gateCached.exports.scanOutput = () => { throw new Error('gate_down'); };
    try {
      const result = await realGovern({
        tenantId: null,
        surface: 'test',
        action: 'generate',
        payload: {},
      });
      assert.equal(result.allowed, true);
      assert.equal(result.proceeded, true);
      assert.equal(result.status, 'governance_degraded');
    } finally {
      gateCached.exports.scanOutput = realScan;
    }
  });
});

describe('output gate warn-first', () => {
  it('claim caution does not equal block', () => {
    const g = scanOutput({ text: 'We saw 340% ROAS last quarter' });
    assert.equal(g.verdict, 'caution');
    assert.ok(g.warnings.length >= 1);
  });

  it('forced brand-safety block is still a gate verdict only', () => {
    const g = scanOutput({ text: 'hi', __force_brand_safety_block: true });
    assert.equal(g.verdict, 'block');
  });
});
