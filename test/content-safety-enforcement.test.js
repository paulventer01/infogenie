// test/content-safety-enforcement.test.js — PR10H.1 acceptance
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
// Include delivery-boundary acceptance in the existing content-safety gate.
require('./wordpress-publish-safety.test');
require('./wordpress-page-publish-safety.test');
require('./generated-content-metadata-safety.test');
require('./safe-agent-generation-safety.test');
require('./article-topic-safety.test');
require('./review-reply-approval-safety.test');
require('./marketing-brief-safety.test');
require('./marketing-brief-delivery.test');
require('./attack-plan-warning-persistence.test');
require('./attack-plan-client.test');
require('./launch-checklist-save-safety.test');
require('./review-rule-save-safety.test');

const {
  PLATFORM_CONTENT_SAFETY_MODE,
  defaultPolicy,
  _normalizeContentSafetyMode,
} = require('../services/ai_governance/policy');
const { scanOutput, USER_MESSAGES, MAX_OUTPUT_SCAN_CHARS } = require('../services/ai_governance/output_gate');
const { govern, loadPolicy } = require('../services/ai_governance/orchestrator');
const { gateGeneratedContent, governContent } = require('../services/ai_governance/hooks');
const { isContentGeneration } = require('../services/ai_governance/brand_rules');
const { buildSafePreview, redactSensitiveText } = require('../services/ai_governance/preview_redact');

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

  it('scans prohibited content beyond the former 8k prefix window', () => {
    const pad = 'x'.repeat(8100);
    const g = scanOutput({ text: `${pad} guaranteed 100% returns every month` });
    assert.equal(g.verdict, 'block');
    assert.ok(g.checks.some((c) => c.check_type === 'brand_compliance'));
  });

  it('rejects output above supported scan ceiling', () => {
    const g = scanOutput({ text: 'a'.repeat(MAX_OUTPUT_SCAN_CHARS + 1) });
    assert.equal(g.verdict, 'block');
    assert.ok(g.checks.some((c) => c.check_type === 'output_size'));
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

describe('PR10H.1 preview redaction', () => {
  it('redacts synthetic SSN from audit preview material', () => {
    const syntheticId = '123-45-6789';
    const preview = buildSafePreview({ text: `Reach us at ${syntheticId} today.` });
    assert.ok(preview.includes('[redacted]'));
    assert.ok(!preview.includes(syntheticId));
  });

  it('redactSensitiveText strips identifiers from API-facing strings', () => {
    const out = redactSensitiveText('SSN 123-45-6789 on file');
    assert.match(out, /\[redacted\]/);
    assert.ok(!out.includes('123-45-6789'));
  });
});

describe('PR10H.1 chat gate bypass closure', () => {
  it('draftBrandReply does not template-fallback on content safety block', async () => {
    const chatPath = require.resolve('../services/ai/chat_router');
    const redditPath = require.resolve('../services/seo_autopilot/reddit_aeo');
    require(chatPath);
    const chatCached = require.cache[chatPath];
    const origChat = chatCached.exports.chatForCategory;
    chatCached.exports.chatForCategory = async () => {
      const err = new Error('blocked');
      err.code = 'content_safety_blocked';
      throw err;
    };
    try {
      delete require.cache[redditPath];
      const { draftBrandReply } = require(redditPath);
      const result = await draftBrandReply({
        thread: { title: 'Best SEO tool?', subreddit: 'marketing' },
        brand: 'InfoGenie',
        tenantId: 1,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'content_safety_blocked');
      assert.equal(result.reply, undefined);
    } finally {
      chatCached.exports.chatForCategory = origChat;
    }
  });

  it('gateGeneratedContent enforces without tenantId (platform default)', async () => {
    const out = await gateGeneratedContent({
      tenantId: null,
      text: 'guaranteed 100% returns with zero risk',
    });
    assert.equal(out.ok, false);
    assert.ok(out.userMessage);
  });
});

describe('PR10H.1 content surface detection', () => {
  it('marks generate and brief surfaces as content generation', () => {
    assert.equal(isContentGeneration('marketing_brief', 'generate_brief'), true);
    assert.equal(isContentGeneration('content_ai', 'generate_content'), true);
    assert.equal(isContentGeneration('marketing_spine', 'apply_calendar'), false);
  });
});
