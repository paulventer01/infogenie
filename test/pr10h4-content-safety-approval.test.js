// test/pr10h4-content-safety-approval.test.js — PR10H.4 acceptance
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  gateRouteText,
  isContentSafetyError,
  contentSafetyHttpBody,
} = require('../services/ai_governance/route_gate');
const { scanOutput } = require('../services/ai_governance/output_gate');
const { govern } = require('../services/ai_governance/orchestrator');
const { defaultPolicy } = require('../services/ai_governance/policy');
const clientApprovals = require('../services/client_reporting/approvals');
const { assertApprovalFresh } = require('../services/agent_orchestrator/approvals');

describe('PR10H.4 route_gate helper', () => {
  it('blocks prohibited generated text', async () => {
    const out = await gateRouteText({
      tenantId: null,
      text: 'guaranteed 100% returns with zero risk',
      surface: 'ai_content',
    });
    assert.equal(out.ok, false);
    assert.ok(out.userMessage);
  });

  it('returns passing content', async () => {
    const out = await gateRouteText({
      tenantId: null,
      text: 'Schedule a product walkthrough with our team.',
      surface: 'ai_content',
    });
    assert.equal(out.ok, true);
    assert.equal(out.content, 'Schedule a product walkthrough with our team.');
  });

  it('isContentSafetyError recognises gate failures', () => {
    assert.equal(isContentSafetyError({ code: 'content_safety_blocked' }), true);
    assert.equal(isContentSafetyError({ code: 'other' }), false);
  });

  it('contentSafetyHttpBody omits usable content', () => {
    const body = contentSafetyHttpBody({
      error: 'content_safety_blocked',
      userMessage: 'blocked',
      warnings: ['x'],
    });
    assert.equal(body.ok, false);
    assert.equal(body.content, undefined);
    assert.equal(body.plan, undefined);
  });
});

describe('PR10H.4 warning-only mode retains visible warnings', () => {
  it('returns content with warnings when tenant opts into warning_only', async () => {
    const orch = require('../services/ai_governance/orchestrator');
    const loadPolicyOrig = orch.loadPolicy;
    orch.loadPolicy = async (tid) => ({
      ...defaultPolicy(tid),
      content_safety_mode: 'warning_only',
      content_safety_explicit: true,
    });
    try {
      const out = await gateRouteText({
        tenantId: 1,
        text: 'guaranteed 100% returns with zero risk',
        surface: 'ai_content',
      });
      assert.equal(out.ok, true);
      assert.ok((out.warnings || out.content_safety_warnings || []).length >= 1);
    } finally {
      orch.loadPolicy = loadPolicyOrig;
    }
  });
});

describe('PR10H.4 gate failure fails closed', () => {
  it('orchestrator errors fail closed for content paths', async () => {
    const gatePath = require.resolve('../services/ai_governance/output_gate');
    const gateCached = require.cache[gatePath];
    const realScan = gateCached.exports.scanOutput;
    gateCached.exports.scanOutput = () => { throw new Error('gate_down'); };
    try {
      const result = await govern({
        tenantId: 1,
        surface: 'ai_content',
        action: 'generate_content',
        payload: { text: 'hello' },
        failClosed: true,
      });
      assert.equal(result.proceeded, false);
      assert.match(result.userMessage, /unavailable/i);
    } finally {
      gateCached.exports.scanOutput = realScan;
    }
  });
});

describe('PR10H.4 skipContentGate bypass removed', () => {
  it('chat_router no longer accepts caller-controlled skipContentGate', () => {
    const src = fs.readFileSync(require.resolve('../services/ai/chat_router'), 'utf8');
    assert.equal(src.includes('skipContentGate'), false);
  });
});

describe('PR10H.4 social publish duplicate guard', () => {
  it('rejects publish when draft is already published', async () => {
    const drafts = require('../services/social_drafts/api');
    drafts._resetMem();
    const tid = 42;
    const draft = await drafts._createForTenant(tid, {
      profile_id: 1,
      status: 'published',
      text: 'Already live',
      platforms: ['linkedin'],
      meta: { published_at: new Date().toISOString() },
    });
    const result = await drafts._approveAndPublish(tid, draft.id, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'already_published');
  });
});

describe('PR10H.4 client report approval scope', () => {
  it('content hash mismatch is rejected for portal approval binding', () => {
    assert.equal(clientApprovals.validContentHash('b'.repeat(64)), true);
    const good = clientApprovals.hashSnapshot({ headline: 'Q1 report' });
    const bad = clientApprovals.hashSnapshot({ headline: 'Q2 report' });
    assert.notEqual(good, bad);
  });

  it('orchestrator approval gate rejects scope mismatch (report approval cannot authorise campaigns)', () => {
    const wf = {
      id: 'wf_test',
      version: 2,
      selected_platforms: ['meta'],
      advertising_budget: 1000,
      credit_ceiling_micros: '1000000000',
      currency: 'USD',
      target_markets: [],
      target_audiences: [],
      landing_page_url: '',
      offer: '',
      objective: '',
      product_or_service: '',
      research_plan: {},
    };
    const approval = {
      gate: 'research_execution',
      object_version: 2,
      content_hash: 'deadbeef',
      decision: 'approved',
    };
    assert.throws(
      () => assertApprovalFresh(wf, approval, 'campaign_publishing'),
      (err) => /approval_scope_mismatch/.test(err.message),
    );
  });
});

describe('PR10H.4 blocked output does not escape via fallback paths', () => {
  it('route_gate blocked result never includes usable content field', async () => {
    const out = await gateRouteText({
      tenantId: null,
      text: 'Contact us at 123-45-6789 for guaranteed risk-free returns',
    });
    assert.equal(out.ok, false);
    assert.equal(out.content, undefined);
    const body = contentSafetyHttpBody(out);
    assert.equal(body.content, undefined);
    assert.equal(body.plan, undefined);
  });
});

describe('PR10H.4 governSafe remains audit-only (not execution gate)', () => {
  it('governSafe on spine still fails open for audit', async () => {
    const { governSafe } = require('../services/ai_governance/hooks');
    const orchPath = require.resolve('../services/ai_governance/orchestrator');
    const orchCached = require.cache[orchPath];
    const origGovern = orchCached.exports.govern;
    orchCached.exports.govern = async () => { throw new Error('audit_down'); };
    try {
      const result = await governSafe({
        tenantId: 1,
        surface: 'marketing_spine',
        action: 'apply_calendar',
        payload: { title: 'calendar apply' },
      });
      assert.equal(result.proceeded, true);
      assert.equal(result.degraded, true);
    } finally {
      orchCached.exports.govern = origGovern;
    }
  });
});
