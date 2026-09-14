// test/content-safety-enforcement.test.js — PR10H.1 acceptance
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  PLATFORM_CONTENT_SAFETY_MODE,
  defaultPolicy,
  _normalizeContentSafetyMode,
} = require('../services/ai_governance/policy');
const { scanOutput, USER_MESSAGES } = require('../services/ai_governance/output_gate');
const { govern, loadPolicy } = require('../services/ai_governance/orchestrator');
const { gateGeneratedContent, governContent } = require('../services/ai_governance/hooks');
const { isContentGeneration } = require('../services/ai_governance/brand_rules');

describe('PR10H.1 policy defaults', () => {
  it('platform content safety default is enforce', () => {
    assert.equal(PLATFORM_CONTENT_SAFETY_MODE, 'enforce');
  });

  it('new tenant default policy uses enforce content safety', () => {
    const p = defaultPolicy(1);
    assert.equal(p.content_safety_mode, 'enforce');
    assert.equal(p.content_safety_explicit, false);
    assert.equal(p.default_mode, 'shadow');
  });

  it('legacy inherited shadow without explicit flag migrates to enforce', () => {
    assert.equal(_normalizeContentSafetyMode(null, false, 'shadow'), 'enforce');
  });

  it('explicit warning_only choice is preserved', () => {
    assert.equal(_normalizeContentSafetyMode('warning_only', true, 'shadow'), 'warning_only');
  });
});

describe('PR10H.1 output gate real checks', () => {
  it('PII in content yields block verdict', () => {
    const g = scanOutput({ text: 'Contact us at 123-45-6789 for details' });
    assert.equal(g.verdict, 'block');
    assert.ok(g.checks.some((c) => c.check_type === 'pii'));
  });

  it('guaranteed returns claim yields block verdict', () => {
    const g = scanOutput({ text: 'Invest now for guaranteed 100% returns every month' });
    assert.equal(g.verdict, 'block');
    assert.ok(g.checks.some((c) => c.check_type === 'brand_compliance'));
  });

  it('passing benign content succeeds', () => {
    const g = scanOutput({ text: 'Schedule a demo to learn how our platform helps marketing teams.' });
    assert.equal(g.verdict, 'pass');
  });

  it('gate unavailable fails closed via orchestrator', async () => {
    const result = await governContent({
      tenantId: null,
      surface: 'content_ai',
      action: 'generate_content',
      payload: { text: 'hello' },
      outputChecks: scanOutput({}, { forceUnavailable: true }),
    });
    assert.equal(result.proceeded, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.blockReason, 'content_safety_unavailable');
    assert.ok(result.userMessage);
  });
});

describe('PR10H.1 orchestrator content enforcement', () => {
  it('enforce mode + block verdict prevents usable output', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'content_ai',
      action: 'generate_content',
      failClosed: true,
      payload: { text: 'guaranteed risk-free returns', __force_brand_safety_block: true },
    });
    assert.equal(result.proceeded, false);
    assert.equal(result.status, 'blocked');
    assert.ok(result.userMessage);
  });

  it('warning_only mode returns content with warnings', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      const result = await govern({
        tenantId: 1,
        surface: 'content_ai',
        action: 'generate_content',
        payload: { text: 'guaranteed risk-free returns' },
      });
      assert.equal(result.proceeded, true);
      assert.ok(result.warnings.length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });

  it('spine apply under shadow action mode still proceeds', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'marketing_spine',
      action: 'apply_calendar',
      payload: { title: 'calendar apply' },
    });
    assert.equal(result.proceeded, true);
    assert.notEqual(result.status, 'pending_review');
  });

  it('launch_campaign suggest under shadow action mode still soft-cues', async () => {
    const result = await govern({
      tenantId: null,
      surface: 'safe_agent',
      action: 'launch_campaign',
      payload: { title: 'Launch Meta ads' },
    });
    assert.equal(result.proceeded, true);
    assert.equal(result.executionTier, 'suggest');
    assert.equal(result.softCue, true);
  });

  it('governContent gate throw fails closed', async () => {
    const gatePath = require.resolve('../services/ai_governance/output_gate');
    const gateCached = require.cache[gatePath];
    const realScan = gateCached.exports.scanOutput;
    gateCached.exports.scanOutput = () => { throw new Error('gate_down'); };
    try {
      const result = await governContent({
        tenantId: null,
        surface: 'content_ai',
        action: 'generate_content',
        payload: { text: 'hello' },
      });
      assert.equal(result.proceeded, false);
      assert.equal(result.failClosed, true);
      assert.match(result.userMessage, /unavailable/i);
    } finally {
      gateCached.exports.scanOutput = realScan;
    }
  });
});

describe('PR10H.1 gateGeneratedContent helper', () => {
  it('blocked content is not returned as usable output', async () => {
    const out = await gateGeneratedContent({
      tenantId: null,
      text: 'guaranteed 100% returns with zero risk',
    });
    assert.equal(out.ok, false);
    assert.equal(out.content, undefined);
    assert.ok(out.userMessage);
  });

  it('passing content returns text', async () => {
    const out = await gateGeneratedContent({
      tenantId: null,
      text: 'Book a strategy session with our team.',
    });
    assert.equal(out.ok, true);
    assert.equal(out.content, 'Book a strategy session with our team.');
  });
});

describe('PR10H.1 content surface detection', () => {
  it('marks generate and brief surfaces as content generation', () => {
    assert.equal(isContentGeneration('marketing_brief', 'generate_brief'), true);
    assert.equal(isContentGeneration('content_ai', 'generate_content'), true);
    assert.equal(isContentGeneration('marketing_spine', 'apply_calendar'), false);
  });
});
